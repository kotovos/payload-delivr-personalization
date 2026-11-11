# Spec: Delivr.ai personalization core

**Version:** 2.2 (replaces the 2026-05-28 draft)
**Status:** Ready for build, v1 scope
**Last updated:** 2026-11-11

This file specifies the core package. Companion files:

- [CLIENT-IP.md](CLIENT-IP.md): finding and checking the visitor's address
- [RULES.md](RULES.md): rule matching and the two selectors
- [PAYLOAD.md](PAYLOAD.md): the PayloadCMS layer
- [RESOLVE-API.md](RESOLVE-API.md): the one backend dependency

The 2026-05-28 draft described Delivr endpoints that do not exist. It is in
git history at `480597c`. Do not build from it.

---

## 1. Scope

**v1 does one thing:** resolve the visitor's IP to a company, then pick which
content variant or block to render for that company.

| In v1                                            | Not in v1                              |
| ------------------------------------------------ | -------------------------------------- |
| IP to company through the Visitor Resolve API    | Contact identity (email, title, role)  |
| Rule matching on domain, NAICS, HQ country       | Rules on company size or revenue       |
| `selectVariant` and `selectBlocks`               | Audience sync, intent topics           |
| Payload `audienceRules` field on opted-in blocks | Webhooks, endpoints, jobs, collections |
| Hooks for the host's own analytics               | Server-side event ingest to Delivr     |
| Dogfood on delivr-ai-website (plain Next.js)     | npm publish, public docs site          |

## 2. Packages

| Package                         | Runtime dependencies | Contains                                         |
| ------------------------------- | -------------------- | ------------------------------------------------ |
| `@delivr/personalization`       | none                 | Resolve client, cache, breaker, rules, selectors |
| `@delivr/payload-plugin-delivr` | core, `payload`      | `audienceRules` field, block injection           |

- The core has **zero** runtime dependencies. It imports nothing from `next`,
  `react` or `payload`. The LRU is hand-written.
- The core does **not** import `server-only`. The host's own wiring file does
  (section 3). That keeps the core runnable in tests, in plain Node and in
  `proxy.ts` (Next 16) or `middleware.ts` (Next 15).
- Both packages are `"private": true` until a publish decision is made.

The scaffold in `packages/` predates this spec. Phase A of the ROADMAP lists
what to remove from it.

## 3. Configuration

```ts
// lib/delivr.ts in the host app
import "server-only";
import { createDelivr } from "@delivr/personalization";

export const delivr = createDelivr({
  enabled: process.env.DELIVR_ENABLED !== "false",
  resolveUrl: process.env.DELIVR_RESOLVE_URL,
  resolveKey: process.env.DELIVR_RESOLVE_KEY,
  pixelId: process.env.DELIVR_PIXEL_ID,
  clientIp: { forwardedFor: { trustedProxies: 1 } },
});
```

```ts
export interface DelivrOptions {
  enabled?: boolean; // default true. false is the kill switch
  resolveUrl?: string; // full https URL of the Visitor Resolve API
  resolveKey?: string; // server only
  pixelId?: string;
  clientIp?: ClientIpSource; // CLIENT-IP.md. No default
  timeoutMs?: number; // default 100
  cacheTtlSeconds?: number; // default 300, matched results
  negativeCacheTtlSeconds?: number; // default 60, not-matched results
  cacheMaxEntries?: number; // default 1000
  isBot?: (userAgent: string | null) => boolean; // section 11
  onResolve?: (event: ResolveEvent) => void; // section 12
  onSelect?: (event: SelectEvent) => void; // RULES.md section 8
  logger?: Logger; // default console
}

export interface Logger {
  warn(message: string, meta?: object): void;
  error(message: string, meta?: object): void;
}

export interface Delivr {
  getVisitorContext(headers: Headers): Promise<VisitorContext>;
  selectVariant: SelectVariant; // RULES.md section 6
  selectBlocks: SelectBlocks; // RULES.md section 7
}

export function createDelivr(options: DelivrOptions): Delivr;
```

**`createDelivr` never throws.** A build step often imports this module
without runtime secrets, and a throw there fails the build or every route.

| State             | When                                                                                                  | Contexts returned         |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ------------------------- |
| **Off**           | `enabled` is false. Nothing else is checked                                                           | `reason: "disabled"`      |
| **Misconfigured** | `enabled` is not false, and `resolveUrl`, `resolveKey`, `pixelId` or `clientIp` is missing or invalid | `reason: "misconfigured"` |
| **Active**        | Everything valid                                                                                      | Section 4                 |

- A string option that is empty or only whitespace counts as missing. An
  empty `DELIVR_RESOLVE_KEY` must show up as misconfigured, not as a stream
  of 401 responses.
- `resolveUrl` is invalid unless it parses as an `https:` URL.
- `pixelId` is invalid when it is longer than 64 characters.
- `clientIp` validity is defined in CLIENT-IP.md section 1.
- A misconfigured instance calls `logger.error` once, naming each bad option.
- The selectors work normally in every state.

Off and misconfigured are different reasons on purpose. The kill switch is
expected. A misconfigured production instance is a fault, and it must show up
in the numbers (section 12).

Within one request, wrap the call so components share one result and
`onResolve` fires once:

```ts
import { cache } from "react";
import { headers } from "next/headers";

export const getVisitor = cache(async () =>
  delivr.getVisitorContext(await headers()),
);
```

## 4. `getVisitorContext(headers)`

It never rejects and never throws. A page must not fail because Delivr did.

The first row that applies decides the outcome. `onResolve` fires exactly once
per call, on every row.

| #   | Condition                                         | `source`   | `reason`                    | Cached | Breaker   |
| --- | ------------------------------------------------- | ---------- | --------------------------- | ------ | --------- |
| 1   | Instance is off                                   | `skipped`  | `disabled`                  | no     | untouched |
| 2   | Instance is misconfigured                         | `skipped`  | `misconfigured`             | no     | untouched |
| 3   | `isBot(user-agent)` is true                       | `skipped`  | `bot`                       | no     | untouched |
| 4   | No usable client IP (CLIENT-IP.md)                | `skipped`  | `no_ip`                     | no     | untouched |
| 5   | Cache hit, and the request has no GPC signal      | `cache`    | as stored                   | n/a    | untouched |
| 6   | Same key, same GPC state, call already in flight  | `shared`   | the outcome of that call    | n/a    | untouched |
| 7   | Breaker open, or its probe is in flight           | `skipped`  | `breaker_open`              | no     | untouched |
| 8   | 200, valid body, `matched: true`                  | `fresh`    | none                        | 300 s  | section 9 |
| 9   | 200, valid body, `matched: false`                 | `fresh`    | service reason or `unknown` | 60 s   | section 9 |
| 10  | Deadline hit before the body is fully read        | `fallback` | `timeout`                   | no     | section 9 |
| 11  | Network error, 5xx, or a 200 with an invalid body | `fallback` | `error`                     | no     | section 9 |
| 12  | 429                                               | `fallback` | `rate_limited`              | no     | section 9 |
| 13  | 401 or 403                                        | `fallback` | `rejected`                  | no     | section 9 |
| 14  | Any other status                                  | `fallback` | `rejected`                  | no     | section 9 |

- Rows 8 and 9 are not cached when the request carries a GPC signal
  (section 8).
- Row 6: the waiting request gets a copy of the other call's result with
  `source: "shared"`. The company and `reason` are the same.
- A redirect response is a network error (row 11), because the call is made
  with `redirect: "error"`.
- `resolvedAt` is the time the service answered. Rows 5 and 6 keep the
  original value. Every other row uses the current time.
- If `isBot` throws, the visitor is treated as not a bot and `logger.warn` is
  called. If a `clientIp` function throws, the outcome is row 4 and
  `logger.warn` is called. Each kind of warning is logged at most once per
  minute.

Calls are not retried. A retry cannot fit inside a 100 ms budget.

## 5. Types

```ts
export interface VisitorContext {
  resolvedAt: string; // ISO 8601 timestamp
  source: "fresh" | "cache" | "shared" | "skipped" | "fallback";
  anonymous: boolean; // true exactly when company is undefined
  reason?: AnonymousReason; // present exactly when anonymous is true
  company?: CompanyContext;
  confidence?: Confidence; // when matched, and for "ambiguous" when the service sends it
  asOf?: string; // YYYY-MM-DD, data snapshot date from the service
}

export interface Confidence {
  share: number; // 0 to 1
  companiesOnIp: number;
}

export interface CompanyContext {
  domain: string; // normalized, see RULES.md section 2
  name?: string;
  naics?: string; // 2 to 6 digits
  hqCountry?: string; // ISO 3166-1 alpha-2, uppercase
  industry?: string; // display only in v1
  employeeRange?: string; // display only in v1
  revenueRange?: string; // display only in v1
}

export type AnonymousReason =
  // decided by the client, no call made
  | "disabled"
  | "misconfigured"
  | "bot"
  | "no_ip"
  | "breaker_open"
  // the call failed
  | "timeout"
  | "error"
  | "rate_limited"
  | "rejected"
  // answered by the service
  | "no_record"
  | "ambiguous"
  | "non_public_ip"
  | "unsupported_ip_version"
  | "declined"
  | "unknown"; // a service reason this client does not know, or none given
```

## 6. Client IP

Specified in [CLIENT-IP.md](CLIENT-IP.md). The two rules that matter most:

- There is **no default**. The host must say where the visitor's address
  comes from.
- Whatever the source returns, the **core** parses it, canonicalizes it and
  checks it against the blocked ranges before anything is cached or sent. A
  custom function cannot bypass that.

## 7. The resolve call

One `fetch` per request that reaches row 8 or later.

| Aspect          | Value                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Method and URL  | `POST resolveUrl`                                                                                                                    |
| Headers         | `Content-Type: application/json`, `Accept: application/json`, `X-Delivr-Resolve-Key`, `User-Agent: delivr-personalization/<version>` |
| Body            | `ip` (canonical), `pixel_id`, `gpc`, `request_id` (a fresh UUID)                                                                     |
| `fetch` options | `cache: "no-store"`, `redirect: "error"`, an abort signal                                                                            |
| Deadline        | `timeoutMs` from the start of `fetch` until the body is read and parsed                                                              |

`gpc` is `true` when the visitor request has the header `Sec-GPC: 1`.

**Validating a 200 body.** It must be a JSON object with a boolean `matched`.

- `matched: true` requires `company.domain` to be a string that is a valid
  domain after normalization (RULES.md section 2). Otherwise the body is
  invalid (row 11).
- Any other optional field of the wrong type, or `null`, is dropped. That is
  not an error.
- `matched: false` takes `reason` when it is one of the known service
  reasons. A missing, non-string or unrecognized `reason` becomes `unknown`.
- `confidence` is read on both matched and not-matched bodies when both of
  its numbers are valid. Otherwise it is dropped.
- Unknown fields are ignored.

**Field mapping.** Wire names are snake case.

| Wire                         | `VisitorContext`           |
| ---------------------------- | -------------------------- |
| `company.domain`             | `company.domain`           |
| `company.name`               | `company.name`             |
| `company.naics`              | `company.naics`            |
| `company.industry`           | `company.industry`         |
| `company.hq_country`         | `company.hqCountry`        |
| `company.employee_range`     | `company.employeeRange`    |
| `company.revenue_range`      | `company.revenueRange`     |
| `confidence.share`           | `confidence.share`         |
| `confidence.companies_on_ip` | `confidence.companiesOnIp` |
| `as_of`                      | `asOf`                     |

**Cold connections.** The first call after a process starts pays DNS and TLS
inside the deadline and may time out. v1 does not mitigate this. Watch the
timeout rate after deploys in dogfood before adding a warm-up.

## 8. Cache

- In-process, synchronous, LRU. `cacheMaxEntries` entries, default 1000.
- Key: `pixelId + ":" + canonical IP`. The full address. The old draft
  bucketed to the first three octets, which would hand one company's answer
  to every neighbor in the same /24.
- TTL: 300 s for matched, 60 s for not matched. Failures are never cached.
- **GPC bypasses the cache both ways.** A request with a GPC signal does not
  read the cache and does not write to it. Otherwise a cached answer could
  skip whatever policy the service applies to that signal, or one visitor's
  declined answer would anonymize a whole office.
- **Single flight.** Concurrent requests for the same key and GPC state share
  one call. The request that made the call is the leader. The others get
  `source: "shared"`.
- The cache holds visitor IP addresses in process memory for up to the TTL.
  Nothing is written to disk.
- There is no pluggable cache in v1. A shared store is deferred.

## 9. Circuit breaker

During an outage every uncached request would otherwise wait the full
deadline.

States: closed, open, half open. It starts closed with a failure count of 0.
When an open period ends, the next request becomes the probe. While the probe
is in flight, other requests take row 7.

| Response                                 | While closed                                      | As the probe            |
| ---------------------------------------- | ------------------------------------------------- | ----------------------- |
| Valid 200, matched or not                | Count resets to 0                                 | Closes. Count is 0      |
| Timeout, network error, 5xx, invalid 200 | Count plus 1. At 5, opens for 30 s                | Reopens for 30 s        |
| 429                                      | Opens for the Retry-After period. Count unchanged | Reopens for that period |
| 401 or 403                               | Opens for 60 s. Count unchanged                   | Reopens for 60 s        |
| Any other status                         | No effect on state or count                       | Reopens for 30 s        |

- **Retry-After period.** The header value when it is a whole number of
  seconds, clamped to 1 to 60. Anything else, including a missing header, a
  decimal or an HTTP date, means 30 s.
- 401 and 403 call `logger.error` once per opening. They mean the key or the
  pixel binding is wrong, and repeating the call cannot help.
- Other statuses call `logger.warn`, at most once per minute.
- Only timeouts, network errors, 5xx and invalid bodies raise the count. Bad
  input from a visitor can therefore never open the breaker.

The numbers are defaults to tune in dogfood.

## 10. Rendering and HTML caching

- Reading request headers makes a route dynamic. A page that was static stops
  being static once it calls `getVisitorContext`.
- v1 personalizes a small, named set of routes. Everything else stays as is.
- **A personalized response must never be stored by a shared cache.** If a
  CDN or reverse proxy caches the HTML, one company's variant is served to
  everyone. Check the response headers of each personalized route in the
  deployed environment, not just locally.
- The alternative for static sites is to resolve in `proxy.ts` and rewrite to
  a pre-rendered variant path. The core supports it, since it only needs
  `Headers`. It is not built in v1.

## 11. Bots

Bots always get default content: search engines index one stable version, and
bot traffic spends no resolve quota.

Default `isBot`:

```ts
const BOT =
  /bot|crawl|spider|slurp|preview|monitor|uptime|pingdom|lighthouse|headless|facebookexternalhit|embedly|curl|wget|python-requests|go-http-client|okhttp|axios|node-fetch/i;

const isBot = (ua: string | null) =>
  ua === null || ua.trim() === "" || BOT.test(ua);
```

A request with no user agent counts as a bot. So do `curl` and most scripts.
**Test harnesses and manual checks must send a browser user agent**, or pass
their own `isBot`. Otherwise they always get default content.

## 12. Observability

No events go to Delivr in v1. The host forwards hooks to its own analytics.

```ts
export interface ResolveEvent {
  source: VisitorContext["source"];
  reason?: AnonymousReason;
  matched: boolean;
  durationMs: number; // time in the network call. 0 when this request made no call
  status?: number; // HTTP status when a response arrived
  requestId?: string; // when this request made the call
  confidence?: Confidence;
}
```

Hooks run synchronously. An error thrown by a hook is caught and passed to
`logger.warn`. Rendering continues.

**This request made a call** exactly when `source` is `fresh` or `fallback`.
A `shared` event made no call and has `durationMs: 0`.

| Measure        | Definition                                                                   |
| -------------- | ---------------------------------------------------------------------------- |
| Latency        | `durationMs` over events that made a call. Timeouts are included             |
| Timeout rate   | `timeout` events with `source: "fallback"` over events that made a call      |
| Match rate     | `matched` events with `source: "fresh"` over events with `source: "fresh"`   |
| Ambiguous rate | `ambiguous` events with `source: "fresh"` over events with `source: "fresh"` |
| `no_ip` rate   | `no_ip` events over all events except `bot`, `disabled`, `misconfigured`     |
| Misconfigured  | Count of `misconfigured` events. Must be zero in production                  |

Every numerator and denominator counts only events from the request that made
the call. `cache` and `shared` events repeat an earlier answer, so they are
never counted in a rate.

`SelectEvent` is defined in RULES.md section 8.

## 13. Security and privacy

- `resolveKey` is server only. The host's wiring file imports `server-only`,
  so a client bundle that pulls it in fails the build.
- The visitor's IP is sent to Delivr server to server, over HTTPS only.
- The in-process cache holds IP addresses in memory. Nothing is persisted.
- v1 handles company-level data only. No email, no hashed email, no name.
- The GPC signal is forwarded to the service, and the cache cannot hide it
  from the service (section 8).
- `companyDomain` in `SelectEvent` is company data. Hosts decide whether to
  forward it.
- Any debug view that shows the resolved context must be unavailable to the
  public. It would otherwise be a lookup tool for forged addresses.

## 14. Environment variables

The core reads no environment variables. The host passes values in. These are
the names the examples use.

| Variable             | Purpose                                       |
| -------------------- | --------------------------------------------- |
| `DELIVR_RESOLVE_URL` | Full https URL of the Visitor Resolve API     |
| `DELIVR_RESOLVE_KEY` | Server-only secret                            |
| `DELIVR_PIXEL_ID`    | Site identifier                               |
| `DELIVR_ENABLED`     | `false` turns resolution off. The kill switch |

With `DELIVR_ENABLED=false` the other three may be absent.

## 15. Testing

| Level       | What                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Unit        | Every row of the section 4 table, plus throwing `isBot` and `clientIp`                          |
| Unit        | Client IP: every table in CLIENT-IP.md, including a custom function returning a blocked address |
| Unit        | Body validation and field mapping, section 7                                                    |
| Unit        | Cache: TTLs, eviction, GPC bypass both ways, single flight and `shared`                         |
| Unit        | Breaker: every cell of the section 9 table, and each Retry-After form                           |
| Unit        | `createDelivr`: off, each option missing or invalid, no throw, one log                          |
| Unit        | Rules and selectors: the RULES.md section 9 tables                                              |
| Contract    | Resolve client against every client fixture (RESOLVE-API section 9.1)                           |
| Integration | Demo app with a forced IP header and a browser user agent, against the mock server              |

Vitest. No test touches a real network. Tests use documentation-range
addresses.

## 16. Compatibility

| Dependency | Version                              | Applies to    |
| ---------- | ------------------------------------ | ------------- |
| Node       | >= 22                                | both packages |
| TypeScript | >= 5.5                               | both packages |
| Next.js    | >= 15                                | host apps     |
| React      | >= 19                                | host apps     |
| Payload    | 3.x, exact version pinned in Phase E | Payload layer |

The core needs only a runtime with `fetch`, `Headers` and `AbortController`.
The dogfood site runs Next.js 16.

## 17. Deferred

Out of v1. Each needs a real backend contract before it is specified.

- Contact identity and consent gating
- Rules on company size, revenue, technologies, intent, audiences
- Audience and technology collections with sync jobs
- Webhook, health and preview-as endpoints
- Field-level variant helper for Payload
- Form pre-fill
- Server-side event ingest to Delivr
- Shared or pluggable cache
- Connection warm-up
- Resolution in `proxy.ts` with pre-rendered variants
- npm publish and public docs
