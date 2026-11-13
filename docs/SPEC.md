# Spec: Delivr.ai personalization core

**Version:** 3.0 (replaces 2.2, which resolved by IP address)
**Status:** Ready for review, v1 scope
**Last updated:** 2026-11-12

Companion files: [IDENTITY.md](IDENTITY.md) (cookie, consent, GPC, CDN),
[RULES.md](RULES.md) (rules and selectors), [PAYLOAD.md](PAYLOAD.md) (Payload
layer), [RESOLVE-API.md](RESOLVE-API.md) (the one backend dependency).

Version 2.2 identified visitors by IP address. Delivr identifies visitors by
its pixel cookie and the hashed email attached to it, so 2.2 was wrong at its
premise. It is in git history. Do not build from it, or from the 2026-05-28
draft at `480597c`.

---

## 1. Scope

**v1 does one thing:** read the Delivr pixel cookie, learn the visitor's role
and company from it, then pick which content variant or block to render.

| In v1                                                      | Not in v1                                   |
| ---------------------------------------------------------- | ------------------------------------------- |
| Cookie to role and company through the Visitor Resolve API | IP address resolution of any kind           |
| Rules on company domain, NAICS, company country            | Rules on company size or revenue            |
| Rules on seniority and department                          | Names, emails or any identifier in the page |
| `selectVariant` and `selectBlocks`                         | Audience sync, intent topics                |
| Payload `audienceRules` field on opted-in blocks           | Webhooks, endpoints, jobs, collections      |
| Hooks for the host's own analytics                         | Server-side event ingest to Delivr          |
| Dogfood on delivr-ai-website (plain Next.js)               | Client-side swaps, npm publish              |

## 2. Packages

| Package                         | Runtime dependencies | Contains                                         |
| ------------------------------- | -------------------- | ------------------------------------------------ |
| `@delivr/personalization`       | none                 | Resolve client, cache, breaker, rules, selectors |
| `@delivr/payload-plugin-delivr` | core, `payload`      | `audienceRules` field, block injection           |

- The core has **zero** runtime dependencies. It imports nothing from `next`,
  `react` or `payload`. The LRU is hand-written.
- The core does **not** import `server-only`. The host's wiring file does
  (section 3). That keeps the core runnable in tests, in plain Node and in
  `proxy.ts` (Next 16) or `middleware.ts` (Next 15).
- Both packages are `"private": true` until a publish decision is made.

The scaffold in `packages/` predates this spec. ROADMAP Phase A lists what to
remove from it.

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
  consent: (headers) => hasMarketingConsent(headers), // the site's own check
  visitorCountry: (headers) => headers.get("x-edge-country"), // set by your edge
});
```

```ts
export interface DelivrOptions {
  enabled?: boolean; // default true. false is the kill switch
  resolveUrl?: string; // full https URL of the Visitor Resolve API
  resolveKey?: string; // server only
  pixelId?: string; // the site's Delivr pixel id
  visitorCountry: (headers: Headers) => string | null | undefined; // IDENTITY.md section 6
  consent?: (headers: Headers) => boolean; // IDENTITY.md section 5
  timeoutMs?: number; // default 100. Maximum 100
  cacheTtlSeconds?: number; // default 300, matched answers
  negativeCacheTtlSeconds?: number; // default 60, no_profile, declined, unknown
  cacheMaxEntries?: number; // default 1000, per cache (section 9)
  isBot?: (userAgent: string | null) => boolean; // section 12
  onResolve?: (event: ResolveEvent) => void; // section 13
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
  inspectCookie(headers: Headers): string | undefined; // debug only
  inspectCountry(headers: Headers): string | undefined; // debug only
}

export function createDelivr(options: DelivrOptions): Delivr;
```

**`createDelivr` never throws.** A build step often imports this module
without runtime secrets, and a throw there fails the build or every route.

| State             | When                                                                                                                             | Contexts returned         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Off**           | `enabled` is false. Nothing else is checked                                                                                      | `reason: "disabled"`      |
| **Misconfigured** | `enabled` is not false, and `resolveUrl`, `resolveKey` or `pixelId` is missing or invalid, or `visitorCountry` is not a function | `reason: "misconfigured"` |
| **Active**        | Everything valid                                                                                                                 | Section 5                 |

- A string option that is empty or only whitespace counts as missing. An
  empty `DELIVR_RESOLVE_KEY` must show up as misconfigured, not as a stream
  of 401 responses.
- `resolveUrl` is invalid unless it parses as an `https:` URL. `pixelId` is
  invalid when it is longer than 64 characters.
- `consent`, `isBot`, `onResolve`, `onSelect` and `logger` are ignored with one
  `logger.warn` when given with the wrong shape. That does not make the
  instance misconfigured. A missing `consent` also logs one warning
  (IDENTITY.md section 5).
- `timeoutMs` above 100 is set to 100, and `logger.warn` is called once. The
  100 ms cap is a guarantee, not a default a host can raise.
- A numeric option that is not a finite number greater than zero falls back
  to its default.
- A misconfigured instance calls `logger.error` once, naming each bad option.
- The selectors work normally in every state.

`visitorCountry` is required in the type. A JavaScript caller can still omit
it, and then the instance is misconfigured rather than throwing.

`inspectCookie` returns the cookie id the core would use for these headers
(IDENTITY.md section 3), or `undefined`. `inspectCountry` returns the
`visitor_country` value the core would send, or `undefined`. Neither makes a
call or fires an event. They exist for a debug view that is not reachable by
the public.

Off and misconfigured are different reasons on purpose. The kill switch is
expected. A misconfigured production instance is a fault, and it must show up
in the numbers (section 13).

Within one request, wrap the call so components share one result and
`onResolve` fires once:

```ts
import { cache } from "react";
import { headers } from "next/headers";

export const getVisitor = cache(async () =>
  delivr.getVisitorContext(await headers()),
);
```

## 4. Identity inputs

Specified in [IDENTITY.md](IDENTITY.md): the cookie id (`__pixelId`, else
`__pixelIdP`, validated by the core), GPC and consent (no call), the visitor
country (sent, and part of the cache key), and the first-party cookie and CDN
rules without which every request is `no_cookie`.

## 5. `getVisitorContext(headers)`

It never rejects and never throws. A page must not fail because Delivr did.

The first row that applies decides the outcome. `onResolve` fires exactly once
per call, on every row.

| #   | Condition                                                      | `source`   | `reason`                    | Cached | Breaker    |
| --- | -------------------------------------------------------------- | ---------- | --------------------------- | ------ | ---------- |
| 1   | Instance is off                                                | `skipped`  | `disabled`                  | no     | untouched  |
| 2   | Instance is misconfigured                                      | `skipped`  | `misconfigured`             | no     | untouched  |
| 3   | `isBot(user-agent)` is true                                    | `skipped`  | `bot`                       | no     | untouched  |
| 4   | `Sec-GPC: 1`                                                   | `skipped`  | `gpc`                       | no     | untouched  |
| 5   | `consent` given and does not return `true`                     | `skipped`  | `consent`                   | no     | untouched  |
| 6   | No valid cookie id (IDENTITY.md section 3)                     | `skipped`  | `no_cookie`                 | no     | untouched  |
| 7   | Cache hit                                                      | `cache`    | as stored                   | n/a    | untouched  |
| 8   | Same key, call already in flight                               | `shared`   | the outcome of that call    | n/a    | untouched  |
| 9   | Breaker open                                                   | `skipped`  | `breaker_open`              | no     | untouched  |
| 10  | 200, valid body, matched with something usable                 | `fresh`    | none                        | 300 s  | section 10 |
| 11  | 200, valid body, `reason: no_identity`                         | `fresh`    | `no_identity`               | 10 s   | section 10 |
| 12  | 200, valid body, `reason: pending`                             | `fresh`    | `pending`                   | no     | section 10 |
| 13  | 200, valid body, any other miss (section 7)                    | `fresh`    | service reason or `unknown` | 60 s   | section 10 |
| 14  | Deadline hit before the body is fully read                     | `fallback` | `timeout`                   | no     | section 10 |
| 15  | Network error, 5xx, another 2xx, or a 200 with an invalid body | `fallback` | `error`                     | no     | section 10 |
| 16  | 429                                                            | `fallback` | `rate_limited`              | no     | section 10 |
| 17  | Any other 4xx                                                  | `fallback` | `rejected`                  | no     | section 10 |

- 300 s and 60 s are `cacheTtlSeconds` and `negativeCacheTtlSeconds`. The 10 s
  for `no_identity` is fixed: identity often arrives seconds after the cookie
  (IDENTITY.md section 1), and a longer negative cache would hide it.
- `pending` is never cached, so the next request asks again.
- Row 8: the waiting request gets a copy of the other call's result with
  `source: "shared"`. Person, company and `reason` are the same.
- A redirect response is a network error (row 15), because the call is made
  with `redirect: "error"`.
- `resolvedAt` is the time the service answered. Rows 7 and 8 keep the
  original value. Every other row uses the current time.
- If `isBot` throws, the visitor is treated as not a bot and `logger.warn` is
  called. Throwing `consent` and `visitorCountry` functions are covered in
  IDENTITY.md. Each kind of warning is logged at most once per minute.

Calls are not retried. A retry cannot fit inside a 100 ms budget.

## 6. Types

```ts
export interface VisitorContext {
  resolvedAt: string; // ISO 8601 timestamp
  source: "fresh" | "cache" | "shared" | "skipped" | "fallback";
  anonymous: boolean; // true exactly when person and company are both undefined
  reason?: AnonymousReason; // present exactly when anonymous is true
  person?: PersonContext;
  company?: CompanyContext;
  asOf?: string; // YYYY-MM-DD, profile data date from the service
}

export interface PersonContext {
  // at least one field is present whenever person is present
  seniority?: Seniority;
  department?: string; // normalized as in RULES.md section 2
}

export type Seniority = "cxo" | "vp" | "director" | "manager" | "staff";

export interface CompanyContext {
  domain: string; // normalized, see RULES.md section 2
  name?: string;
  naics?: string; // 2 to 6 digits
  country?: string; // ISO 3166-1 alpha-2, uppercase
  industry?: string; // display only in v1
  employeeRange?: string; // display only in v1
  revenueRange?: string; // display only in v1
}

export type AnonymousReason =
  // decided by the client, no call made
  | "disabled"
  | "misconfigured"
  | "bot"
  | "gpc"
  | "consent"
  | "no_cookie"
  | "breaker_open"
  // the call failed
  | "timeout"
  | "error"
  | "rate_limited"
  | "rejected"
  // answered by the service
  | "no_identity"
  | "no_profile"
  | "pending"
  | "declined"
  | "unknown"; // a service reason this client does not know, or none given
```

A visitor can be matched with a person and no company, or a company and no
person. Rules on the missing side simply do not match (RULES.md section 3).

## 7. The resolve call

One `fetch` per request that reaches row 10 or later.

| Aspect          | Value                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Method and URL  | `POST resolveUrl`                                                                                                                    |
| Headers         | `Content-Type: application/json`, `Accept: application/json`, `X-Delivr-Resolve-Key`, `User-Agent: delivr-personalization/<version>` |
| Body            | `cookie_id`, `pixel_id`, `visitor_country` when valid, `request_id` (a fresh UUID)                                                   |
| `fetch` options | `cache: "no-store"`, `redirect: "error"`, an abort signal                                                                            |
| Deadline        | `timeoutMs` from the start of `fetch` until the body is read and parsed                                                              |

**Response size.** The client reads at most 16 KB of a body. A longer body is
invalid (row 15) and is not parsed. The contract limits a 200 body to 4 KB.
The bound exists because `JSON.parse` is synchronous and cannot be aborted.

**Validating a 200 body.** It must be a JSON object with a boolean `matched`.
Otherwise it is invalid (row 15).

- `company` is kept only when it is an object whose `domain` is a valid domain
  after normalization (RULES.md section 2). Otherwise `company` is dropped.
- `person.seniority` is kept only when it is one of the five values.
  `person.department` is kept when it is a string that is valid after
  normalization (RULES.md section 2). `person` is kept only when at least one
  of its fields was kept.
- `matched: true` with neither `company` nor `person` left is treated as
  `matched: false` with `reason: "no_profile"` (row 13). Real data can hold a
  domain this client rejects. That is not a service failure.
- Any other optional field of the wrong type, or `null`, is dropped.
- `matched: false` takes `reason` when it is one of the four service reasons.
  A missing, non-string or unrecognized `reason` becomes `unknown`.
- Unknown fields are ignored.

**Field mapping.** Wire names are snake case. `company.employee_range` and
`company.revenue_range` become `employeeRange` and `revenueRange`. `as_of`
becomes `asOf`. Every other field keeps its name.

**Cold connections.** The first call after a process starts pays DNS and TLS
inside the deadline and may time out. v1 does not mitigate this. Watch the
timeout rate after deploys before adding a warm-up.

## 8. What the core never does

- It never sends the visitor's IP address, user agent or any header other than
  those in section 7.
- It never writes the cookie, sets a cookie or calls the pixel.
- It never puts the resolved context into HTML, a client component's props or
  a response header. The host renders the chosen content and nothing else.
- It never passes a cookie id, a domain or a person attribute to the logger.

## 9. Cache

- In-process, synchronous. Two LRUs of `cacheMaxEntries` entries each: one for
  matched answers, one for misses. A flood of distinct made-up cookies can then
  only evict other misses, never a visitor's matched answer.
- Key: `pixelId + ":" + cookieId + ":" + (visitorCountry or "-")`.
- TTLs as in section 5: 300 s matched, 10 s `no_identity`, 60 s other misses.
  `pending` and failures are never cached.
- **Single flight.** Concurrent requests for the same key share one call. The
  others get `source: "shared"`.
- The caches hold cookie ids and the section 6 attributes in process memory
  for up to the TTL. Nothing is written to disk.
- There is no pluggable cache in v1. A shared store is deferred.

## 10. Circuit breaker

During an outage every uncached request would otherwise wait the full
deadline. The breaker is a cooldown: a count of consecutive failures and an
"open until" time. While the current time is before "open until", requests
take row 9 and make no call.

| Result of a call                                       | Effect                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| Valid 200, matched or not                              | Count resets to 0                                               |
| Timeout, network error, 5xx, another 2xx, invalid body | Count plus 1. If the count is now 5 or more, open for 30 s      |
| 429                                                    | Open for the Retry-After period. Count unchanged                |
| Any other 4xx                                          | Open for 60 s. Count unchanged. `logger.error` once per opening |

- Opening never shortens a period already running. "Open until" becomes the
  later of the two times.
- A result applies when it arrives, whenever its call started.
- **Cold start.** Until the process has received its first valid 200, a timeout
  does not raise the count. The first calls after a deploy pay connection
  setup inside the deadline (section 7), and several distinct cookies timing
  out together must not switch personalization off for 30 s.
- When a period ends, requests call again. The count stays at 5 or more until
  a success, so the first further failure reopens at once.
- **Retry-After period.** The header value when it is a whole number of
  seconds, clamped to 1 to 60. Anything else, including a missing header, a
  decimal or an HTTP date, means 30 s.
- Any other 4xx means the key, the pixel binding, the URL or the request
  format is wrong. Repeating the call cannot help.
- A visitor sending junk never reaches the call (row 6). Made-up cookies in the
  valid format do cost calls and quota. The edge rate limit in IDENTITY.md
  section 8 bounds them. If they still exhaust the quota, the 429 opens the
  breaker, which protects the service at the cost of personalization for that
  period.

The numbers are defaults to tune in dogfood.

## 11. Rendering and HTML caching

- Reading request headers makes a route dynamic. A page that was static stops
  being static once it calls `getVisitorContext`.
- v1 personalizes a small, named set of routes. Everything else stays as is.
- **A personalized response must never be stored by a shared cache**, and the
  CDN must forward the pixel cookies on those routes (IDENTITY.md section 7).
- The alternative for static sites is to resolve in `proxy.ts` and rewrite to
  a pre-rendered variant path. The core supports it, since it only needs
  `Headers`. It is not built in v1.

## 12. Bots

Bots always get default content: search engines index one stable version, and
bot traffic spends no resolve quota.

```ts
const BOT =
  /bot|crawl|spider|slurp|preview|monitor|uptime|pingdom|lighthouse|headless|facebookexternalhit|embedly|curl|wget|python-requests|go-http-client|okhttp|axios|node-fetch/i;

const isBot = (ua: string | null) =>
  ua === null || ua.trim() === "" || BOT.test(ua);
```

A request with no user agent counts as a bot. So do `curl` and most scripts.
**Test harnesses and manual checks must send a browser user agent**, or pass
their own `isBot`.

## 13. Observability

No events go to Delivr in v1. The host forwards hooks to its own analytics.

```ts
export interface ResolveEvent {
  source: VisitorContext["source"];
  reason?: AnonymousReason;
  matched: boolean;
  hasPerson: boolean;
  hasCompany: boolean;
  durationMs: number; // time in the network call. 0 when this request made no call
  status?: number; // HTTP status when a response arrived
  requestId?: string; // when this request made the call
}
```

The event carries no cookie id and no attribute values. The host adds what it
needs, such as the browser family from the user agent, which IDENTITY.md
section 2 makes important.

Hooks run synchronously. An error thrown by a hook is caught and passed to
`logger.warn`. Rendering continues.

**This request made a call** exactly when `source` is `fresh` or `fallback`.
**Eligible** events are all events except `disabled`, `misconfigured`, `bot`,
`gpc` and `consent`: the requests the integration could have personalized.

| Measure            | Definition                                                                 |
| ------------------ | -------------------------------------------------------------------------- |
| Latency            | `durationMs` over events that made a call. Timeouts are included           |
| Timeout rate       | `timeout` events with `source: "fallback"` over events that made a call    |
| Match rate         | `matched` events with `source: "fresh"` over events with `source: "fresh"` |
| Pending rate       | `pending` events over events with `source: "fresh"`                        |
| `no_cookie` rate   | `no_cookie` events over eligible events. Split by browser family           |
| Personalized share | `matched` events over eligible events. Counts every source                 |
| Misconfigured      | Count of `misconfigured` events. Must be zero in production                |

`cache` and `shared` events repeat an earlier answer, so they are left out of
latency, timeout, match and pending rates. `no_cookie` rate and personalized
share describe requests, so they count every eligible event.

`SelectEvent` is defined in RULES.md section 8.

## 14. Security and privacy

- `resolveKey` is server only. The host's wiring file imports `server-only`,
  so a client bundle that pulls it in fails the build.
- The cookie id is sent to Delivr server to server, over HTTPS only.
- The service returns role and company attributes only. No email, hashed
  email, name, title, phone, address or profile URL reaches the site
  (RESOLVE-API section 6 point 3). No event carries attribute values.
- The caches hold cookie ids and those attributes in memory. Nothing is
  persisted.
- GPC requests and requests without consent make no call (IDENTITY.md sections
  4 and 5).
- Forged, guessed and copied cookies, and what must hold before any visitor
  sees personalized content, are in IDENTITY.md section 8.

## 15. Environment variables

The core reads no environment variables. The examples use these names.

| Variable             | Purpose                                       |
| -------------------- | --------------------------------------------- |
| `DELIVR_RESOLVE_URL` | Full https URL of the Visitor Resolve API     |
| `DELIVR_RESOLVE_KEY` | Server-only secret                            |
| `DELIVR_PIXEL_ID`    | The site's Delivr pixel id                    |
| `DELIVR_ENABLED`     | `false` turns resolution off. The kill switch |

With `DELIVR_ENABLED=false` the other three may be absent.

## 16. Testing

| Level       | What                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------- |
| Unit        | Every row of the section 5 table, plus a throwing `isBot`                                         |
| Unit        | Identity: the IDENTITY.md section 3 and section 10 tables                                         |
| Unit        | Body validation and field mapping, section 7, including each dropped-field case                   |
| Unit        | Cache: each TTL, `pending` not cached, both LRUs, eviction, country in the key, single flight     |
| Unit        | Breaker: every row of the section 10 table, the later-time rule, reopening, cold start, each Retry-After form |
| Unit        | `createDelivr`: off, each option missing or invalid, no throw, one log, `timeoutMs` cap           |
| Unit        | Section 8: no outbound header beyond section 7, no logger call holding a cookie id or attribute   |
| Unit        | Rules and selectors: the RULES.md section 9 tables                                                |
| Contract    | Resolve client against every client fixture (RESOLVE-API section 9.1)                             |
| Integration | Demo app with a fixture cookie and a browser user agent, against the mock server                  |

Vitest. No test touches a real network. Tests use fixture cookie values only.

## 17. Compatibility

Both packages: Node 22 or later, TypeScript 5.5 or later. Host apps: Next.js
15 or later, React 19 or later. Payload layer: Payload 3.x, the exact version
pinned in Phase E. The core needs only `fetch`, `Headers` and
`AbortController`.

## 18. Deferred

Out of v1. Each needs a real backend contract before it is specified.

- Personalizing the first page view of a new browser
- Client-side swaps after the pixel runs
- Rules on company size, revenue, technologies, intent, audiences
- Showing anything about the visitor on the page
- Audience and technology collections with sync jobs
- Webhook, health and preview-as endpoints
- Field-level variant helper for Payload
- Form pre-fill
- Server-side event ingest to Delivr
- Shared or pluggable cache
- Connection warm-up
- Resolution in `proxy.ts` with pre-rendered variants
- npm publish and public docs
