# Roadmap

**Status:** v1 scope, 2026-11-12. Replaces the IP-based roadmap of 2026-11-11
and the 10-week plan of 2026-05-28.

Six phases. Estimates are not filled in: the builder sets them after Phase 0.

```
0  Data check ──► A  Foundation + contract ──┬──► B  Resolve service + first-party cookie ──┐
                                             │                                             ├──► D  Dogfood
                                             └──► C  Core library ─────────────────────────┘

D stage 1 decision ──► E  Payload layer (only if the decision is to continue)
```

B and C run in parallel once A freezes the contract. D needs both. E waits
for the product owner's decision after D stage 1, so no Payload work is spent
before the numbers say the product is worth it.

---

## Phase 0: data check

**Goal:** know how many page views could be personalized before building
anything.

The method, the data and the results are internal. They are recorded outside
this repository.

Tasks, using the dogfood site's own pixel data for a recent period:

- By browser family, the share of page views whose request to the site would
  have carried a first-party pixel cookie
- Among page views that were not a cookie's first, the share whose cookie
  already had an identity attached
- The time from a cookie's first event to its first attached identity
- The share of attached identities with a profile, and how often each of the
  five rule inputs is filled (company domain, NAICS, company country,
  seniority, department)
- From those, the personalized share (PRD M11) to expect once every browser
  has a first-party cookie

**Exit:** a written result with those numbers exists, and the product owner
has recorded one of: continue, change scope, stop.

## Phase A: foundation and contract

**Goal:** the repository builds, both sides share one frozen contract, and the
first-party cookie approach is chosen.

Tasks:

- Tooling: tsconfig, eslint, prettier, vitest, build (#1)
- CI on Node 22: build, lint, typecheck, test (#2)
- Add `packages/personalization` as the core package
- Scaffold cleanup:
  - Set `"private": true` on both packages
  - Plugin `package.json`: drop the `./client`, `./server`, `./fields` and
    `./types` exports, the `lru-cache` dependency, and the `next` and `react`
    peer dependencies
  - Plugin `src/index.ts`: drop the default URLs, `cookieName` and every
    option that is not in PAYLOAD.md
  - Plugin `src/types.ts`: reduce to `DelivrPayloadOptions`. Core types move
    to the core package
- `contracts/resolve/fixtures/`: the client fixtures in RESOLVE-API section
  9.1
- `contracts/resolve/response.schema.json`: the section 5 bodies as a JSON
  Schema
- `tools/mock-resolve`: a server that replays the fixtures by `cookie_id`
- Latency spike on the service side: read a cookie's identity and a slim
  profile from the fast storage the service will use, measure p99 over
  distinct real cookies, and measure how long a background profile fill
  takes. This answers R7
- Review RESOLVE-API.md from the service side. Answer R1, R2 and R7. Freeze
- Choose how the dogfood site's pixel cookie becomes first-party in every
  major browser (PRD Q3)

**Exit:**

- CI passes build, lint, typecheck and test
- A test asserts the mock server returns every fixture
- A test asserts every `conforming: true` fixture with status 200 validates
  against the schema
- RESOLVE-API.md status line reads `Frozen` with a date, and R1, R2 and R7
  are answered in the file
- The answer to Q3 is recorded

## Phase B: resolve service and first-party cookie

**Goal:** the Visitor Resolve API answers real requests, and the dogfood site's
server receives the pixel cookie from every major browser.

Not built in this repository. Tracked in Delivr's own tracker. Implementation
tasks are recorded internally.

Service tasks, at contract level:

- Every request, response and status in RESOLVE-API.md
- Answers from fast storage, with `pending` and a background fill for
  profiles that are not ready
- One person per cookie (R3)
- Regional policy from `visitor_country`, answered as `declined` (R5)
- Pixel binding (R4). Required before D stage 2 and before any second site
  receives a key
- Rate limit and quota per key
- Request count, latency and reason metrics

Pixel task:

- A first-party pixel cookie on the dogfood site in every major browser, as
  chosen in Phase A

**Exit:**

- Conformance checks C1 to C14 and C16 in RESOLVE-API section 9.2 pass against
  the deployed service. C15, pixel binding, may pass later, but before D
  stage 2
- Server-side p99 is at or below 25 ms over at least 10,000 requests for
  distinct real cookies, and is
  written into RESOLVE-API section 7 with method, request count and date. If
  it is higher, the client budget and the contract are revisited before
  Phase D
- From the dogfood site's own network, the end-to-end p99 of at least 1,000
  calls is under 100 ms
- In Chrome, Safari, Firefox and Edge, after one page view the browser holds
  `__pixelId` for the dogfood site's own domain
- Mean daily pixel event volume over the 7 days after the pixel change is
  inside the range of the 4 weekly means before it (PRD M7)

## Phase C: core library

**Goal:** `@delivr/personalization` complete against the mock server.

Tasks:

- `createDelivr`: off, misconfigured and active states, logging
- Identity: cookie parsing, GPC, consent and country hooks (#24, rewritten)
- Resolve client: fetch, deadline, body validation, field mapping (#6, #27)
- Cache: in-process LRU, per-reason TTLs, single flight (#7)
- Circuit breaker (cooldown)
- Bot guard
- `matchRule`, normalization, specificity, with company and role conditions
  (#12)
- `selectVariant` (#15, core half) and `selectBlocks` (#13)
- `onResolve` and `onSelect` hooks (#14, rewritten)

**Exit:**

- Every row of SPEC section 16 has tests, and CI passes
- Every row of both RULES.md section 9 tables is a test case
- Every row of the IDENTITY.md section 3 and section 10 tables is a test case
- The test setup fails any outbound request that is not to the mock server

## Phase D: dogfood on delivr-ai-website

**Goal:** real traffic, real numbers. Measures M1 to M11 are in PRD section 7.

**Stage 0, baseline.** Before any change to the site:

- Record 4 weeks of daily pixel event volume (M7). If Phase B changed the
  pixel setup, the baseline is the 4 weeks before that change
- Record TTFB p75 for the routes chosen in PRD Q2 (M8)
- Decide package distribution (PRD Q1)
- Wire the site's consent signal into `consent` (PRD Q6)
- Confirm the CDN forwards the pixel cookies on the chosen routes and does not
  cache them (PRD Q4)

**Stage 1, shadow.** At least 7 days and at least 1,000 eligible events:

- Call `getVisitorContext` on the chosen routes
- Run the selectors with the planned variants, but always render the default.
  `onSelect` then records what would have been shown
- Wire `onResolve` and `onSelect` to the site's analytics, tagged with browser
  family
- Debug view of the resolved context, not reachable by the public (#9)
- Run checks I1 to I9 in IDENTITY.md section 9
- Kill switch verified: `DELIVR_ENABLED=false` with the other settings removed

**Stage 1 report.** A value for each of M1 to M11, with M5 split by browser
family.

**Gates.** Each is recorded as pass or fail in the report:

- M6: zero page errors traced to the integration
- M7: mean daily pixel volume inside the range of the 4 baseline weekly means
- M10: zero `misconfigured` events
- I1 and I2 pass in each of Chrome, Safari, Firefox and Edge
- I3 to I9 pass

**Decision.** The product owner reads the report and records one of:
continue to stage 2, change scope, stop.

**Stage 2.** Only if the decision is to continue, every gate passed, and
these also pass, because from here a visitor can see personalized content
(IDENTITY.md section 8):

- C15: the service answers only for cookies the dogfood site's pixel has seen
- I10: the edge rate-limits personalized routes per client
- I11: no context field appears in the page source or the data payload

Then one variant slot on one route renders for real.

**Exit:**

- The stage 1 report exists with all eleven values and all gate results
- The decision is recorded
- If the decision was to continue: one variant slot is live

## Phase E: Payload layer

**Goal:** the same core drives a Payload site. Starts only if the product
owner's decision after D stage 1 is to continue.

Tasks:

- Pin one Payload 3.x version. Work through P1 to P7 in PAYLOAD.md section 6
- `audienceRulesField` with hooks and validation, company and role fields
  (#10)
- `injectIntoBlocks`: opt-in by slug, idempotent, throws on an unknown slug
  (#11)
- `examples/nextjs-payload-demo` (#3) running against the mock server
- One demo page: a `hero` slot with an industry block, a role block and a
  fallback block

**Exit:**

- An automated test starts the demo with the mock server and sends requests
  with a browser user agent and a fixture cookie. One cookie's fixture matches
  the industry block, and the test asserts it renders. Another matches only the
  role block, and the test asserts that one renders. A third has no fixture,
  and the test asserts the fallback renders
- P1 to P7 are answered in PAYLOAD.md, and the pinned version is in SPEC
  section 17

---

## Existing issues

Filed 2026-05-28 against the old plan. None are closed. They need relabeling
to match this roadmap. That has not been done yet.

| Issue      | Title (short)                                                                | v1 disposition                                           |
| ---------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| #1         | Repo scaffolding                                                             | Phase A. Add the second package                          |
| #2         | CI matrix, PR template, CODEOWNERS                                           | Phase A                                                  |
| #3         | Demo app skeleton                                                            | Phase E                                                  |
| #4         | Changesets, npm publish dry run                                              | Deferred. No publish in v1                               |
| #5         | DelivrPixel component                                                        | Deferred. The site's existing pixel is used              |
| #6         | getVisitorContext                                                            | Phase C. Rewrite to SPEC section 5                       |
| #7         | Cache, LRU, IP bucketing                                                     | Phase C. Keyed by cookie. No IP, no pluggable interface  |
| #8         | /api/delivr/health                                                           | Deferred                                                 |
| #9         | Debug banner                                                                 | Phase D                                                  |
| #10        | audienceRulesField                                                           | Phase E. New field list with role fields                 |
| #11        | injectIntoBlocks                                                             | Phase E. Opt-in only                                     |
| #12        | Rule matcher and scorer                                                      | Phase C. New semantics with role conditions              |
| #13        | renderBlocks                                                                 | Phase C. Becomes `selectBlocks`                          |
| #14        | cms.variant_shown emitter                                                    | Phase C. Becomes the `onSelect` hook                     |
| #15        | variantField and pickVariant                                                 | Split. `selectVariant` in Phase C. Field helper deferred |
| #16 to #23 | Audiences, sync, technologies, pre-fill, preview-as, badge, webhook, logging | Deferred                                                 |
| #24        | Consent gate                                                                 | Phase C. Becomes the `consent` hook and GPC guard        |
| #25, #26   | KV cache, load test                                                          | Deferred                                                 |
| #27        | HEM identity resolution                                                      | Phases B and C. The core of v1, rewritten to RESOLVE-API |
| #28 to #31 | Publish, docs site, partners, launch                                         | Deferred                                                 |

## Work with no issue yet

- Phase 0 data check
- Core package split and scaffold cleanup
- Contract fixtures, response schema and mock server
- Circuit breaker
- Cookie reading, GPC guard, country hook
- Bot guard
- First-party pixel cookie on the dogfood site in every major browser
- Dogfood integration, all stages
- Package distribution for the dogfood
- The resolve service itself (tracked outside this repository)

---

## Risk register

| Risk                                              | Phase | Mitigation                                     |
| ------------------------------------------------- | ----- | ---------------------------------------------- |
| Too few page views carry an identity              | 0     | Measured first, before any build               |
| Contract changes after C starts                   | A     | Freeze in A. Additive changes only afterwards  |
| The service misses the latency target             | B     | `pending` design. Measured in B exit, before D |
| First-party cookie change breaks pixel collection | B     | Volume check in B exit, M7 gate in D           |
| Cookie stripped by the CDN                        | D     | Q4 in stage 0, I1 gate                         |
| Consent not wired on the server                   | D     | Q6 in stage 0, I6 gate                         |
| Configuration missing in production               | D     | M10 gate                                       |
| Personalized HTML cached in front of the site     | D     | I8 gate                                        |
| Static marketing routes become dynamic            | D     | One or two routes only. M8 before and after    |
| Cold connections time out after each deploy       | D     | Watch M2 after deploys. Warm-up is deferred    |
| Scope creeps back toward the old plan             | all   | SPEC section 18 is the fence                   |
