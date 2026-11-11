# Architecture

**Status:** v1 scope, 2026-11-11. Replaces the 2026-05-28 draft.

## System diagram

```
Visitor browser
   │  GET /platform
   ▼
Host edge / proxy chain          (sets or forwards the client IP header)
   │
   ▼
Next.js host app (server)
   │
   │  ctx = await delivr.getVisitorContext(await headers())
   │        ├─ off or misconfigured? -> anonymous
   │        ├─ bot?            -> anonymous
   │        ├─ client IP       -> none or blocked -> anonymous
   │        ├─ process cache   -> hit -> ctx        (skipped when GPC is set)
   │        ├─ breaker open?   -> anonymous
   │        └─ POST Visitor Resolve API (100 ms deadline)
   │                 │
   │                 ▼
   │        Delivr resolve service                  [NOT BUILT]
   │                 │
   │                 ▼
   │        Delivr.ai entity resolution data: IP -> company
   │
   │  variant = delivr.selectVariant(variants, ctx)     no I/O
   │  blocks  = delivr.selectBlocks(page.layout, ctx)   no I/O
   ▼
HTML response (must not be stored by a shared cache)
```

There is one network dependency: the Visitor Resolve API. Its contract is in
[RESOLVE-API.md](RESOLVE-API.md). It does not exist yet.

## What v1 is not

- No pixel install, no cookie, no client-side JavaScript from this project.
- No Delivr event ingest. Measurement goes through the host's own analytics.
- No Payload collections, endpoints or jobs.

## Request lifecycle

1. Browser requests a personalized route.
2. The route calls `getVisitorContext` with the request headers.
3. The core runs its guards: off, misconfigured, bot, client IP. The address
   is parsed, canonicalized and checked against the blocked ranges by the
   core, whatever its source.
4. Cache lookup on `pixelId` plus the canonical address, unless the request
   carries a GPC signal.
5. On a miss, one POST to the Visitor Resolve API under a 100 ms deadline.
6. The response becomes a `VisitorContext`. A miss, an error or a timeout
   becomes an anonymous context. The call never throws.
7. `selectVariant` or `selectBlocks` picks content. Both are synchronous and
   do no I/O.
8. The page renders. `onResolve` and `onSelect` have fired, and the host has
   sent them to its analytics.

The exact outcome of every branch is the table in SPEC section 4.

## Packages

```
packages/
├─ personalization/                 @delivr/personalization (core)
│  ├─ src/
│  │  ├─ index.ts                   public exports
│  │  ├─ createDelivr.ts            options, disabled instance, wiring
│  │  ├─ getVisitorContext.ts       outcome table, orchestration
│  │  ├─ resolveClient.ts           fetch, deadline, body validation, mapping
│  │  ├─ breaker.ts                 circuit breaker
│  │  ├─ cache.ts                   in-process LRU, single flight
│  │  ├─ clientIp.ts                sources, parsing, blocked ranges
│  │  ├─ bots.ts                    default isBot
│  │  ├─ rules/
│  │  │  ├─ normalize.ts            domain, NAICS, country
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
   │  └─ options/                   industry and country lists
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

| Failure                                 | Behavior                                                            |
| --------------------------------------- | ------------------------------------------------------------------- |
| Required option missing or invalid      | Anonymous, `misconfigured`, one error log. No throw, so builds pass |
| Kill switch on                          | Anonymous, `disabled`. No other setting is needed                   |
| Resolve API deadline hit                | Anonymous, `timeout`. Counts toward the breaker                     |
| Network error, 5xx, invalid 200 body    | Anonymous, `error`. Counts toward the breaker                       |
| 5 consecutive failures                  | Breaker opens for 30 s. Requests skip the call                      |
| 429                                     | Anonymous, `rate_limited`. Breaker opens for `Retry-After`          |
| 401 or 403                              | Anonymous, `rejected`. Breaker opens for 60 s, one error log        |
| Any other status                        | Anonymous, `rejected`. Breaker unchanged unless it was the probe    |
| No client IP, or a blocked one          | Anonymous, `no_ip`. No call is made                                 |
| `isBot` or a `clientIp` function throws | Caught and logged. Not a bot, or `no_ip`                            |
| Wrong client IP setting                 | Silent. Wrong or no company. Watch the `no_ip` and match rates      |
| Visitor forges the client IP header     | Only possible when the setting is wrong. See CLIENT-IP.md           |
| Shared cache stores personalized HTML   | One company's variant reaches everyone. Check response headers      |
| Hook throws                             | Caught and logged. Rendering continues                              |

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

The deadline covers the whole call: connect, send, read and parse. The cache
is synchronous and in process, so it adds nothing to the worst case.

None of the latency numbers are measured. Dogfood produces the first real
values. The first call after a process starts pays connection setup inside
the deadline and may time out.

## Rendering model

Reading headers makes a route dynamic. v1 accepts that for a small set of
named routes.

A site whose marketing pages are static has a second option: resolve in
`proxy.ts`, then rewrite to a pre-rendered variant path keyed by segment. That
keeps pages static and cacheable. The core already works there because it
takes plain `Headers`. It is deferred until v1 shows the match rate is worth
it.

## Cache scope

The cache is per process and lives in memory. On a host that runs several
instances or short-lived functions the hit rate is low. A shared store is
deferred. v1 has no pluggable cache interface.

## Security boundaries

- The resolve key lives in server environment only. The host's wiring file
  imports `server-only`, so a client bundle that pulls it in fails the build.
- The visitor IP leaves the host only in the server-to-server resolve call,
  over HTTPS.
- The cache holds visitor addresses in process memory for up to the TTL.
  Nothing is persisted.
- A GPC request never reads or writes the cache, so the service's policy
  always sees it.
- No person-level data flows through v1.

## Deployment

- Dogfood: the core is consumed by delivr-ai-website as a private package.
  How it is distributed is an open question in the PRD.
- No service is deployed from this repository. The Visitor Resolve API is
  deployed by its owner.
