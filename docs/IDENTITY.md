# Visitor identity

**Status:** v1, 2026-11-12. Part of the spec. Read after [SPEC.md](SPEC.md).

How the core knows who the visitor is: the Delivr pixel cookie. This file
replaces the client IP design of 2026-11-11. Delivr does not identify visitors
by IP address, and v1 does not use the visitor's IP for anything.

---

## 1. How Delivr identifies a visitor

1. The site already runs the Delivr pixel. On a browser's first page view the
   pixel's event host sets a cookie, `__pixelId`, holding a numeric visitor id.
   Some browsers also get a partitioned copy, `__pixelIdP`, with the same value.
2. Delivr attaches the visitor's hashed email to that cookie, often within
   seconds of the first page view.
3. Delivr holds person and company profiles keyed by hashed email.
4. On a later request, the site's server reads the cookie and asks the Visitor
   Resolve API ([RESOLVE-API.md](RESOLVE-API.md)) who it is. The answer is a
   role and a company, never an identifier.

Consequences:

- **The very first page view of a new browser is never personalized.** The
  cookie does not exist yet when the server renders it. Later page views can
  be, including the first page of a later session while the cookie lasts.
- **Identity can lag the cookie by seconds.** A second page view right after
  the first may still get `no_identity`. The core caches that answer for only
  10 seconds (SPEC section 9).
- **No pixel, no identity.** A visitor whose pixel never ran, because of
  consent, an ad blocker or GPC, has no identity. That is correct behavior.

## 2. The cookie must be first-party

The pixel's event host sets the cookie with `HttpOnly; Secure;
SameSite=None`. Page JavaScript cannot read it. The site's server receives it
only when the cookie's domain is the site's own domain.

That happens only when the pixel's requests reach Delivr through a path or a
host on the site's own domain, **set up with Delivr as a verified first-party
route**. A plain reverse proxy without that setup is not enough: the cookie
then still lands on Delivr's domain.

| Route                                         | Notes                                        |
| --------------------------------------------- | -------------------------------------------- |
| A path on the site's own origin               | No browser shortens the cookie's life        |
| A host on the site's domain aliased to Delivr | Safari limits cookies set this way to 7 days |

**Today the dogfood site's cookie is first-party in only some browsers.**
For the rest the core gets `no_cookie`. v1 needs a first-party cookie in every
major browser. How is the builder's call, since the builder owns the pixel
(PRD Q3). Whatever is chosen:

- The pixel script is shared by every Delivr customer. A change to it must be
  scoped to the sites that ask for it.
- The dogfood site's pixel tag is changed only if the chosen route requires
  it. Pixel event volume is watched before and after (PRD M7).
- The result is checked in each browser family (section 9, I1 and I2).

## 3. Reading the cookie

Input: the `Cookie` request header.

1. Split the header on `;`. Trim each part. Split each part at the first `=`
   into a name and a value. A part with no `=` is ignored. Names are case
   sensitive.
2. Candidates, in this order: every `__pixelId` value in header order, then
   every `__pixelIdP` value in header order.
3. The first candidate that is **valid** is the cookie id. If none is valid,
   there is no cookie id.

**Valid** means: 1 to 19 ASCII digits, the first digit not `0`, and the value
at most `9223372036854775807`. Nothing is trimmed from inside the value, and a
quoted value is not valid.

The core does this itself, before anything is cached or sent. There is no
option to supply a different reader.

| `Cookie` header                               | Cookie id            |
| --------------------------------------------- | -------------------- |
| `__pixelId=152345678901234567`                | `152345678901234567` |
| `a=1; __pixelId=152345678901234567; b=2`      | `152345678901234567` |
| `__pixelIdP=152345678901234567`               | `152345678901234567` |
| `__pixelId=152345678901234567; __pixelIdP=42` | `152345678901234567` |
| `__pixelId=abc; __pixelIdP=42`                | `42`                 |
| `__pixelId=abc; __pixelId=42`                 | `42`                 |
| `__pixelId=0123`                              | none                 |
| `__pixelId=9223372036854775808`               | none                 |
| `__pixelId=12345678901234567890`              | none                 |
| `__pixelId="42"`                              | none                 |
| `__pixelId=`                                  | none                 |
| `__PIXELID=42`                                | none                 |
| `pixelId=42`                                  | none                 |
| header absent                                 | none                 |

## 4. Global Privacy Control

A request with the header `Sec-GPC: 1` is never resolved. The core makes no
call and returns an anonymous context with reason `gpc`. The Delivr pixel
already declines to attach identities for these visitors.

## 5. Consent

```ts
consent?: (headers: Headers) => boolean;
```

The host decides whether the visitor has given whatever consent the site
requires for marketing personalization. The core cannot know the site's
consent model, so it asks.

- Only a return value of `true` counts as consent. Anything else gives an
  anonymous context with reason `consent` and no call.
- If the function throws, the result is no consent and `logger.warn` is called
  at most once per minute.
- When the option is not given, every request counts as consented, and
  `createDelivr` calls `logger.warn` once saying so. A site that gates its
  pixel on consent must give this option. Otherwise a visitor who withdrew
  consent after the cookie was set would still be personalized.

The signal must be something the server can read, such as a cookie set by the
site's consent tool. A choice stored only in the browser's local storage is
invisible to the server. Which signal the dogfood site uses is PRD Q6.

## 6. Visitor country

```ts
visitorCountry: (headers: Headers) => string | null | undefined; // required
```

Returns where the visitor is now. The service needs it to apply the same
regional policy the pixel applies (RESOLVE-API section 6 point 7), so the
option is **required**. Without it the instance is misconfigured (SPEC section
3).

- It must read a value the site's edge sets on every request and overwrites if
  the visitor sent one, such as a country header added by the CDN. Never a
  query parameter, a cookie or a header the visitor can supply unchecked.
- The value is trimmed and uppercased. If it is two letters A to Z it is sent
  as `visitor_country`. Otherwise it is left out, and the service applies its
  policy for an unknown location (RESOLVE-API R5).
- If the function throws, the value is left out and `logger.warn` is called at
  most once per minute.
- The value is part of the cache key (SPEC section 9), so a cached answer for
  one country is never reused for another.

## 7. CDN and caching

Both of these are checked on the deployed site, not only locally:

- **The CDN must forward the pixel cookies to the origin** on personalized
  routes. A CDN that strips cookies, or forwards only an allowlist that leaves
  them out, makes every request `no_cookie`.
- **A personalized response must never be stored by a shared cache.** If the
  CDN caches the HTML, one visitor's variant is served to everyone. The
  `Cache-Control` header of a personalized route must contain `private` and
  `no-store`. Next.js adds other directives as well, which is fine. This
  covers full page loads and the framework's own data and prefetch requests
  for the same route.

## 8. Forged, guessed and copied cookies

A visitor can send any cookie value.

| Case                                                       | Result                                          |
| ---------------------------------------------------------- | ----------------------------------------------- |
| Not a valid value (section 3)                              | `no_cookie`. No call                            |
| A made-up value in the valid format                        | Usually `no_identity`. Default content          |
| A guessed value that belongs to a visitor of the same site | That visitor's variant is shown                 |
| A real value copied from another browser                   | That browser's person is used to choose content |

Cookie values are not secret, and they can be guessed with enough attempts.
The cookie is not authentication. Whoever presents one sees the variant chosen
for its person, which can reveal that person's company when a variant targets
a named account. No identifier is ever shown.

So, **before any visitor sees personalized content** (ROADMAP Phase D, stage
2), all of these must hold:

- The service answers only for cookies the key's pixel has seen (RESOLVE-API
  section 6 point 6). Cookies from other Delivr customers' sites then give
  nothing.
- The site's edge rate-limits requests to personalized routes per client, so
  guessing at scale is impractical. The service's own limits are a second
  line.
- The resolved context is never written into the HTML or the framework's data
  payload. The chosen variant is the only visible effect (check I11). Passing
  the context to a client component would break this.
- Any debug view that shows the resolved context is unreachable by the public.

Stage 1 always renders default content, so it shows nothing to a guesser.

## 9. Checks on the deployed site

Used as gates in ROADMAP Phase D. The debug view shows, for the current
request, the cookie id the core read (`inspectCookie`), the country it would
send (`inspectCountry`), the `ResolveEvent` and the context.

| #   | Check                                                                                         | Pass when                                                                                |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| I1  | In each of Chrome, Safari, Firefox and Edge: load any page, then request a personalized route | The debug view shows a cookie id on the second request                                   |
| I2  | Same browsers: compare that cookie id with the `__pixelId` value in the browser's storage     | They are equal                                                                           |
| I3  | Send `Cookie: __pixelId=abc` with a browser user agent                                        | Reason `no_cookie`. Page renders default content                                         |
| I4  | Send a made-up valid cookie value with a browser user agent                                   | A miss reason. Page renders default content                                              |
| I5  | Send a real cookie with `Sec-GPC: 1`                                                          | Reason `gpc`, `durationMs` 0, no `requestId`                                             |
| I6  | Send a real cookie with the consent signal absent                                             | Reason `consent`, `durationMs` 0, no `requestId`                                         |
| I7  | Request the debug view from outside the private network, or without its credential            | Refused                                                                                  |
| I8  | Request each personalized route through the CDN: a page load, a data request, a prefetch      | Each `Cache-Control` contains `private` and `no-store`, and the CDN reports no cache hit |
| I9  | Send a request with a visitor-supplied country header set to a different country              | The debug view shows the edge's country, not the supplied one                            |
| I10 | Send many requests to a personalized route from one client with distinct made-up cookies      | The edge starts refusing them at its configured limit                                    |
| I11 | With a matched cookie, read the page source and the framework's data payload for a personalized route | No context field appears: no domain, NAICS, country, seniority or department, unless it is literal text of the chosen variant |

## 10. Test tables

Every row of the section 3 table is a unit test. So are these:

| #   | Case                                  | Expected                                         |
| --- | ------------------------------------- | ------------------------------------------------ |
| T1  | `Sec-GPC: 1` and a valid cookie       | `gpc`, no call                                   |
| T2  | `Sec-GPC: 0` and a valid cookie       | Not affected by GPC                              |
| T3  | `consent` returns `false`             | `consent`, no call                               |
| T4  | `consent` returns `"yes"`             | `consent`, no call                               |
| T5  | `consent` throws                      | `consent`, no call, one warning                  |
| T6  | `consent` not given                   | Not affected by consent. One warning at creation |
| T7  | `visitorCountry` returns `" us "`     | `visitor_country: "US"` sent                     |
| T8  | `visitorCountry` returns `"USA"`      | `visitor_country` not sent. Call still made      |
| T9  | `visitorCountry` returns `null`       | `visitor_country` not sent. Call still made      |
| T10 | `visitorCountry` throws               | Not sent, one warning, call still made           |
| T11 | `visitorCountry` not given            | Instance misconfigured                           |
| T12 | Same cookie, countries `US` then `DE` | Two cache entries, two calls                     |
