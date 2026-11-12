# Client IP

**Status:** v1, 2026-11-11. Part of the spec. Section 6 of [SPEC.md](SPEC.md).

Getting the visitor's address wrong is silent. Requests succeed, and the wrong
company, or none, comes back. So there is no default, and the core checks
every address itself.

---

## 1. Where the address comes from

```ts
export type ClientIpSource =
  | { forwardedFor: { trustedProxies: number } } // reads x-forwarded-for
  | { header: string } // one header the edge sets itself
  | ((headers: Headers) => string | null | undefined); // custom
```

| Form           | Valid when                                    | Otherwise              |
| -------------- | --------------------------------------------- | ---------------------- |
| `forwardedFor` | `trustedProxies` is a whole number, 1 or more | Instance misconfigured |
| `header`       | The name is a non-empty string                | Instance misconfigured |
| Function       | It is a function                              | Instance misconfigured |
| Not given      | Never                                         | Instance misconfigured |

"Instance misconfigured" is the state in SPEC section 3. `0`, `-1`, `1.5` and
`NaN` are all invalid values for `trustedProxies`.

## 2. `forwardedFor`

Each proxy appends the address it received from. With `n` trusted proxies in
front of the app, the last `n` entries were written by proxies you control,
and the visitor is entry `length - n`, counting from zero. Entries to the
left of that are whatever the visitor's side sent. They are never used.

| `x-forwarded-for`                 | `trustedProxies` | Candidate      |
| --------------------------------- | ---------------- | -------------- |
| `198.51.100.7`                    | 1                | `198.51.100.7` |
| `6.6.6.6, 198.51.100.7`           | 1                | `198.51.100.7` |
| `6.6.6.6, 198.51.100.7, 10.0.0.2` | 2                | `198.51.100.7` |
| `198.51.100.7`                    | 2                | none           |
| header absent                     | 1                | none           |

A repeated header is read as one comma-joined list, which is what
`Headers.get` returns. Entries are split on commas.

## 3. `header`

The whole value of the named header is the candidate. It is for a header the
edge writes itself with a single address, such as `x-real-ip`.

A value that contains a comma is not a single address. The result is none.

## 4. Function

The return value is the candidate. `null`, `undefined` and an empty string
mean none. If the function throws, the result is none and `logger.warn` is
called.

## 5. What the core does with the candidate

Always, for all three forms. A custom function cannot skip this.

1. Trim whitespace.
2. Remove a port, in exactly two shapes: an IPv4 address then one colon and
   digits (`1.2.3.4:5678`), and a bracketed address then a colon and digits
   (`[2001:db8::1]:443`). Remove the brackets. A value with two or more
   colons and no brackets is a bare IPv6 address. Leave it alone.
3. Remove an IPv6 zone id (`%eth0`).
4. Convert any address inside `::ffff:0:0/96` to IPv4, by value and not by
   spelling. `::ffff:1.2.3.4` and `::ffff:102:304` are both `1.2.3.4`.
5. Canonicalize. IPv4 as dotted decimal with no leading zeros. IPv6 lowercase
   and compressed (RFC 5952). The canonical form is what is cached and sent.
6. Anything that does not parse as an address (`unknown`, a hostname) is none.
7. An address in a blocked range (section 6) is none.

"None" at any step is outcome row 4 in SPEC section 4: `reason: "no_ip"`, no
call made.

There is exactly one candidate. The core never looks for a second one.

| Candidate                       | Result                         |
| ------------------------------- | ------------------------------ |
| `198.51.100.7`                  | `198.51.100.7`                 |
| The same, with spaces around it | `198.51.100.7`                 |
| `198.51.100.7:44321`            | `198.51.100.7`                 |
| `2001:db8::1`                   | `2001:db8::1`                  |
| `2001:DB8:0:0:0:0:0:1`          | `2001:db8::1`                  |
| `[2001:DB8::1]:443`             | `2001:db8::1`                  |
| `::ffff:198.51.100.7`           | `198.51.100.7`                 |
| `::ffff:c633:6407`              | `198.51.100.7`                 |
| `::ffff:10.0.0.5`               | none: blocked after conversion |
| `::ffff:a00:5`                  | none: blocked after conversion |
| `10.0.0.5`                      | none: blocked                  |
| `fe80::1%eth0`                  | none: blocked                  |
| `unknown`                       | none: not an address           |
| `example.com`                   | none: not an address           |

## 6. Blocked ranges

Never cached, never sent.

| IPv4             | What it is              |
| ---------------- | ----------------------- |
| `0.0.0.0/8`      | This network            |
| `10.0.0.0/8`     | Private                 |
| `100.64.0.0/10`  | Carrier-grade NAT       |
| `127.0.0.0/8`    | Loopback                |
| `169.254.0.0/16` | Link local              |
| `172.16.0.0/12`  | Private                 |
| `192.0.0.0/24`   | Protocol assignments    |
| `192.168.0.0/16` | Private                 |
| `198.18.0.0/15`  | Benchmarking            |
| `224.0.0.0/4`    | Multicast               |
| `240.0.0.0/4`    | Reserved, and broadcast |

| IPv6           | What it is   |
| -------------- | ------------ |
| `::/128`       | Unspecified  |
| `::1/128`      | Loopback     |
| `64:ff9b::/96` | NAT64        |
| `fc00::/7`     | Unique local |
| `fe80::/10`    | Link local   |
| `ff00::/8`     | Multicast    |

**Documentation ranges are not blocked:** `192.0.2.0/24`, `198.51.100.0/24`,
`203.0.113.0/24` and `2001:db8::/32`. Tests, fixtures and examples use them.
They never occur in real traffic behind a correct proxy chain.

## 7. Forged headers

A visitor can submit any address when one of these is true:

- `trustedProxies` is higher than the number of proxies that really append to
  the header.
- The source is a header the visitor controls.
- The app can be reached without passing through the trusted proxies.

The third defeats a correct setting. A request sent straight to the origin
carries whatever headers its sender likes. **The origin must accept traffic
only from the trusted proxies**, by a network rule or an authenticated link
from the edge. That is a deployment requirement. The core cannot enforce it.

When an address can be forged:

- The visitor sees another company's variant.
- They can probe which address maps to a named account.
- A script can burn the resolve quota and fill the cache with junk.

Correct configuration and a closed origin are the defense. The service's
per-key rate limit is the backstop.

## 8. How to tell it is wrong

A `no_ip` rate that is not near zero on real visitor traffic means the source
is misconfigured. SPEC section 12 defines the rate.

The opposite mistake, reading an address the visitor controls, does not show
in that number. It needs a direct test.

**The forged-header check.** Run it in the deployed environment. It needs a
debug view, not reachable by the public, that shows the address the core
used. `delivr.inspectClientIp(headers)` returns it (SPEC section 3).

Let T be the tester's own public address, and X a different address, for
example `203.0.113.99`.

1. Through the real edge, send a request to a personalized route with a
   browser user agent and a forged header. For `forwardedFor`, send
   `x-forwarded-for` holding X repeated `trustedProxies` times, then again
   with one more X. A single forged entry is not enough: when
   `trustedProxies` is too high, a short list gives no address at all, and
   only a list long enough to fill the gap exposes the fault. For `header`,
   forge that header with X.
2. Send the same forged request straight to the origin, around the edge, by
   any route that might exist.
3. Read the address in the debug view each time.

Pass, all of:

- Every request through the edge shows exactly T.
- The request around the edge is refused or cannot connect.

Fail, any of:

- X is shown. The app trusted what the visitor sent.
- No address is shown. `trustedProxies` is higher than the real chain.
- The request around the edge is served.

Fix the `clientIp` setting or close the origin before any variant renders.

Showing "not X" is not a pass. The result has to be the tester's real
address.

A script without a browser user agent is treated as a bot and never reaches
client IP handling, so it proves nothing.
