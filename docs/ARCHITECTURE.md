# Architecture

**Status:** v1 scope, 2026-11-12. Replaces the IP-based design of 2026-11-11.

## System diagram

```
Visitor browser
   │
   │  First page view of a new browser
   │    the site's existing Delivr pixel runs
   │    the pixel's event host sets __pixelId (must be first-party, IDENTITY.md s2)
   │    within seconds Delivr attaches a hashed email to that cookie
   │    the page itself renders default content
   │
   │  Any later page view
   │    GET /platform    Cookie: __pixelId=152345678901234567
   ▼
CDN / edge          (must forward the pixel cookies, must not cache personalized HTML)
   │
   ▼
Next.js host app (server)
   │
   │  ctx = await delivr.getVisitorContext(await headers())
   │        ├─ off or misconfigured?  -> anonymous
   │        ├─ bot?                   -> anonymous
   │        ├─ Sec-GPC: 1?            -> anonymous, no call
   │        ├─ host consent false?    -> anonymous, no call
   │        ├─ pixel cookie           -> none or invalid -> anonymous
   │        ├─ process cache          -> hit -> ctx
   │        ├─ breaker open?          -> anonymous
   │        └─ POST Visitor Resolve API (100 ms deadline)
   │                 │   { cookie_id, pixel_id, visitor_country }
   │                 ▼
   │        Delivr resolve service                         [NOT BUILT]
   │          resolves the cookie to role and company attributes
   │          returns no identifiers
   │
   │  variant = delivr.selectVariant(variants, ctx)     no I/O
   │  blocks  = delivr.selectBlocks(page.layout, ctx)   no I/O
   ▼
HTML response (private, never stored by a shared cache)
```

There is one network dependency: the Visitor Resolve API. Its contract is in
[RESOLVE-API.md](RESOLVE-API.md). The two lookups behind it already exist
inside Delivr. The endpoint that exposes them to a site's server does not.

## What v1 is not

- No pixel install, no cookie writes, no client-side JavaScript from this
  project. The site's existing pixel does all of that.
- No IP address is read, sent or cached.
- No identifier reaches the site. No email, name or hashed email.
- No Delivr event ingest. Measurement goes through the host's own analytics.
- No Payload collections, endpoints or jobs.

## Request lifecycle

1. Browser requests a personalized route. If it has visited before, it sends
   the pixel cookie.
2. The route calls `getVisitorContext` with the request headers.
3. The core runs its guards: off, misconfigured, bot, GPC, consent. Then it
   reads and validates the cookie id itself (IDENTITY.md section 3).
4. Cache lookup on pixel id, cookie id and visitor country.
5. On a miss, one POST to the Visitor Resolve API under a 100 ms deadline.
6. The response becomes a `VisitorContext`. A miss, an error or a timeout
   becomes an anonymous context. The call never throws.
7. `selectVariant` or `selectBlocks` picks content. Both are synchronous and
   do no I/O.
8. The page renders the chosen content. `onResolve` and `onSelect` have fired,
   and the host has sent them to its analytics.

The exact outcome of every branch is the table in SPEC section 5.

## When a visitor can be personalized

| Visit                                        | Result                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| First page view ever in this browser         | Default. No cookie yet (`no_cookie`)                                                    |
| Second page view, seconds after the first    | Personalized if an identity is attached by then. Else `no_identity`, retried after 10 s |
| Any page view in a later session             | Personalized if the cookie has an identity                                              |
| Pixel blocked, or never allowed to run       | Default (`no_cookie`)                                                                   |
| GPC set, or the host's consent check says no | Default. No call                                                                        |
| Cookie not first-party for this browser      | Default (`no_cookie`). IDENTITY.md section 2                                            |

## Packages

```
packages/
├─ personalization/                 @delivr/personalization (core)
│  ├─ src/
│  │  ├─ index.ts                   public exports
│  │  ├─ createDelivr.ts            options, disabled instance, wiring
│  │  ├─ getVisitorContext.ts       outcome table, orchestration
│  │  ├─ identity.ts                cookie parsing, GPC, consent, country
│  │  ├─ resolveClient.ts           fetch, deadline, body validation, mapping
│  │  ├─ breaker.ts                 circuit breaker
│  │  ├─ cache.ts                   in-process LRU, single flight
│  │  ├─ bots.ts                    default isBot
│  │  ├─ rules/
│  │  │  ├─ normalize.ts            domain, NAICS, country, seniority, department
│  │  │  ├─ matchRule.ts            match and score
│  │  │  ├─ selectVariant.ts
│  │  │  └─ selectBlocks.ts
│  │  └─ types.ts
│  └─ tests/
│
└─ payload-plugin-delivr/           @delivr/payload-plugin-delivr
   ├─ src/
   │  ├─ index.ts                   delivrPlugin
   │  ├─ audienceRulesField.ts      the group field, hooks, validation
   │  ├─ injectIntoBlocks.ts        config walker, opt-in by slug
   │  └─ options/                   industry, country, seniority, department lists
   └─ tests/

contracts/resolve/                  shared request and response fixtures
tools/mock-resolve/                 mock server that replays the fixtures
examples/nextjs-payload-demo/       Payload demo app
```

The core has no runtime dependencies at all.

## Why two packages

The first deployment target, delivr-ai-website, is a Next.js 16 site with no
CMS. A Payload-only plugin could not be dogfooded there. Splitting the core
out also keeps the rule logic testable without booting Payload.

## Failure modes

| Failure                                       | Behavior                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| Required option missing or invalid            | Anonymous, `misconfigured`, one error log. No throw, so builds pass      |
| Kill switch on                                | Anonymous, `disabled`. No other setting is needed                        |
| Cookie not first-party in some browsers       | Silent. Those visitors are always `no_cookie`. Watch the rate by browser |
| CDN strips the cookie                         | Silent. Every visitor is `no_cookie`. Check I1 in IDENTITY.md            |
| Identity not attached yet                     | Anonymous, `no_identity`. Asked again after 10 s                         |
| Profile not ready at the service              | Anonymous, `pending`. Asked again on the next request                    |
| Resolve API deadline hit                      | Anonymous, `timeout`. Counts toward the breaker                          |
| Network error, 5xx, invalid 200 body          | Anonymous, `error`. Counts toward the breaker                            |
| 5 consecutive failures                        | Breaker opens for 30 s. Requests skip the call                           |
| 429                                           | Anonymous, `rate_limited`. Breaker opens for `Retry-After`               |
| Any other 4xx (401, 403, 404, ...)          | Anonymous, `rejected`. Breaker opens for 60 s, one error log. Wrong key, URL or binding             |
| Visitor sends a junk cookie                   | Anonymous, `no_cookie`. No call                                          |
| Visitor sends a copied or guessed real cookie | That person's variant is shown, no identifier. Bounded by binding and edge rate limits, IDENTITY.md section 8 |
| `isBot`, `consent` or `visitorCountry` throws | Caught and logged. Not a bot, no consent, or no country                  |
| Response body over 16 KB                      | Anonymous, `error`. Not parsed. Counts toward the breaker                |
| Shared cache stores personalized HTML         | One visitor's variant reaches everyone. Check response headers           |
| Hook throws                                   | Caught and logged. Rendering continues                                   |

Every runtime failure degrades to the default content. Nothing in the request
path can fail the page or the build.

## Performance budget

| Operation                        | Budget                     | Status                 |
| -------------------------------- | -------------------------- | ---------------------- |
| Cache hit                        | under 1 ms                 | Target                 |
| Cache miss, service healthy      | bounded by 100 ms deadline | Hard limit             |
| Resolve API p99, server side     | 25 ms                      | Proposed, not measured |
| `selectBlocks`, 50 blocks        | under 1 ms                 | Target                 |
| Worst case added to a page       | 100 ms                     | Hard limit             |
| Worst case with the breaker open | under 1 ms                 | By design              |

The deadline covers the whole call: connect, send, read and parse. The client
reads at most 16 KB, so parsing cannot run long. `timeoutMs` cannot be set
above 100. The cache is synchronous and in process, so it adds nothing to the
worst case.

The service meets 25 ms only by answering from data it already holds in fast
storage, which is why the contract has `pending` (RESOLVE-API section 7).

None of the latency numbers are measured. Dogfood produces the first real
values.

## Rendering model

Reading headers makes a route dynamic. v1 accepts that for a small set of
named routes.

A site whose marketing pages are static has a second option: resolve in
`proxy.ts`, then rewrite to a pre-rendered variant path keyed by segment. That
keeps pages static and cacheable. The core already works there because it
takes plain `Headers`. It is deferred until v1 shows the personalized share is
worth it.

## Cache scope

The cache is per process and lives in memory. On a host that runs several
instances or short-lived functions the hit rate is low. A shared store is
deferred. v1 has no pluggable cache interface.

## Security boundaries

- The resolve key lives in server environment only. The host's wiring file
  imports `server-only`, so a client bundle that pulls it in fails the build.
- The cookie id leaves the host only in the server-to-server resolve call,
  over HTTPS.
- The service returns role and company attributes only.
- The cache holds cookie ids and those attributes in process memory for up to
  the TTL. Nothing is persisted.
- GPC and no-consent requests make no call.
- A key resolves only cookies its own pixel has seen (RESOLVE-API section 6
  point 6). That, and a rate limit at the site's edge, must be in place before
  any visitor sees personalized content (IDENTITY.md section 8).

## Deployment

- Dogfood: the core is consumed by delivr-ai-website as a private package.
  How it is distributed is an open question in the PRD.
- No service is deployed from this repository. The Visitor Resolve API is
  deployed by its owner.
- The dogfood site's pixel needs a first-party cookie in every major browser
  before Phase D can measure anything useful (IDENTITY.md section 2).
