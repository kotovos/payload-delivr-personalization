# Roadmap

**Status:** v1 scope, 2026-11-11. Replaces the 10-week plan of 2026-05-28.

Six phases. Estimates are not filled in: the builder sets them after Phase 0.

```
0  Data check ──► A  Foundation + contract ──┬──► B  Resolve service ──┐
                                             │                         ├──► D  Dogfood
                                             └──► C  Core library ─────┘
                                                        │
                                                        └──► E  Payload layer (off the critical path)
```

B and C run in parallel once A freezes the contract. D needs both. E needs
only C. It can slip without delaying D.

---

## Phase 0: data check

**Goal:** know whether the data can carry the product before building on it.

The method, the sample and the results are internal. They are recorded
outside this repository.

Tasks:

- Confirm the data source and its snapshot date
- Take a sample of real visitor addresses from an existing internal record.
  The sample stays internal and is deleted when Phase 0 closes
- For that sample, count matched, ambiguous and no-record at several
  candidate thresholds

**Exit:** a written result with those counts exists, and the product owner
has recorded one of: continue, change scope, stop.

## Phase A: foundation and contract

**Goal:** the repository builds, and both sides share one frozen contract.

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
- `tools/mock-resolve`: a server that replays the fixtures
- Review RESOLVE-API.md from the service side. Answer R1 and R2. Freeze

**Exit:**

- CI passes build, lint, typecheck and test
- A test asserts the mock server returns every fixture
- A test asserts every `conforming: true` fixture with status 200 validates
  against the schema
- RESOLVE-API.md status line reads `Frozen` with a date, and R1 and R2 are
  answered in the file

## Phase B: resolve service

**Goal:** the Visitor Resolve API answers real requests.

Not built in this repository. Tracked in Delivr's own tracker. Implementation
tasks are recorded internally.

Contract-level tasks:

- Every request, response and status in RESOLVE-API.md
- One company or none, with the threshold from Phase 0
- Rate limit and quota per key
- Request count, latency and reason metrics

**Exit:**

- Conformance checks C1 to C14 in RESOLVE-API section 9.2 pass against the
  deployed service
- Server-side p99 is written into RESOLVE-API section 7 with method, request
  count and date
- One request sent from the dogfood site's own network returns a 200 inside
  the 100 ms deadline

## Phase C: core library

**Goal:** `@delivr/personalization` complete against the mock server.

Tasks:

- `createDelivr`: off, misconfigured and active states, logging
- Resolve client: fetch, deadline, body validation, field mapping (#6)
- Cache: in-process LRU, GPC bypass, single flight (#7)
- Circuit breaker, including the probe
- Client IP: the three source forms, parsing, blocked ranges
- Bot guard
- `matchRule`, normalization, specificity (#12)
- `selectVariant` (#15, core half) and `selectBlocks` (#13)
- `onResolve` and `onSelect` hooks (#14, rewritten)

**Exit:**

- Every row of SPEC section 15 has tests, and CI passes
- Every row of both RULES.md section 9 tables is a test case
- Every table row in CLIENT-IP.md is a test case
- The test setup fails any outbound request that is not to the mock server

## Phase D: dogfood on delivr-ai-website

**Goal:** real traffic, real numbers. Measures M1 to M10 are in PRD section 7.

**Stage 0, baseline.** Before any change:

- Record 4 weeks of daily pixel event volume (M7)
- Record TTFB p75 for the routes chosen in PRD Q2 (M8)
- Decide package distribution (PRD Q1)
- Set `clientIp` for the site's proxy chain (PRD Q3)
- Confirm the origin accepts traffic only from the trusted proxies
  (CLIENT-IP.md section 7)

**Stage 1, shadow.** At least 7 days and at least 1,000 events that made a
call:

- Call `getVisitorContext` on the chosen routes
- Run the selectors with the planned variants, but always render the default.
  `onSelect` then records what would have been shown
- Wire `onResolve` and `onSelect` to the site's analytics
- Check the response headers of each chosen route for shared caching (PRD Q4)
- Debug view of the resolved context, not reachable by the public (#9)
- Run the forged-header check in CLIENT-IP.md section 8, using the debug
  view. It includes requests sent around the edge, straight to the origin,
  for the debug view and for a personalized route
- Kill switch verified: `DELIVR_ENABLED=false` with the other settings removed

**Stage 1 report.** A value for each of M1 to M10.

**Gates.** Each is recorded as pass or fail in the report:

- M5: `no_ip` rate at or below 0.5%
- M6: zero page errors traced to the integration
- M7: pixel volume inside the baseline range
- M10: zero `misconfigured` events
- The response header check is recorded for each route, and none allows
  shared caching
- The forged-header check passed on every point in CLIENT-IP.md section 8

**Decision.** The product owner reads the report and records one of:
continue to stage 2, change scope, stop.

**Stage 2.** Only if the decision is to continue and every gate passed: one
variant slot on one route renders for real.

**Exit:**

- The stage 1 report exists with all ten values and all six gate results
- The decision is recorded
- If the decision was to continue: one variant slot is live

## Phase E: Payload layer

**Goal:** the same core drives a Payload site.

Tasks:

- Pin one Payload 3.x version. Work through P1 to P7 in PAYLOAD.md section 6
- `audienceRulesField` with hooks and validation (#10)
- `injectIntoBlocks`: opt-in by slug, idempotent, throws on an unknown slug
  (#11)
- `examples/nextjs-payload-demo` (#3) running against the mock server
- One demo page: a `hero` slot with an industry block and a fallback block

**Exit:**

- An automated test starts the demo with the mock server and sends requests
  with a browser user agent and a forced documentation-range address. One
  address has a matching fixture, and the test asserts the industry block
  renders. Another has none, and the test asserts the fallback renders
- P1 to P7 are answered in PAYLOAD.md, and the pinned version is in SPEC
  section 16

---

## Existing issues

Filed 2026-05-28 against the old plan. None are closed. They need relabeling
to match this roadmap. That has not been done yet.

| Issue      | Title (short)                                                                                                              | v1 disposition                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| #1         | Repo scaffolding                                                                                                           | Phase A. Add the second package                          |
| #2         | CI matrix, PR template, CODEOWNERS                                                                                         | Phase A                                                  |
| #3         | Demo app skeleton                                                                                                          | Phase E                                                  |
| #4         | Changesets, npm publish dry run                                                                                            | Deferred. No publish in v1                               |
| #5         | DelivrPixel component                                                                                                      | Deferred. v1 installs no pixel                           |
| #6         | getVisitorContext                                                                                                          | Phase C. Rewrite to SPEC section 4                       |
| #7         | Cache, LRU, IP bucketing                                                                                                   | Phase C. No bucketing, no pluggable interface            |
| #8         | /api/delivr/health                                                                                                         | Deferred                                                 |
| #9         | Debug banner                                                                                                               | Phase D                                                  |
| #10        | audienceRulesField                                                                                                         | Phase E. New field list                                  |
| #11        | injectIntoBlocks                                                                                                           | Phase E. Opt-in only                                     |
| #12        | Rule matcher and scorer                                                                                                    | Phase C. New semantics                                   |
| #13        | renderBlocks                                                                                                               | Phase C. Becomes `selectBlocks`                          |
| #14        | cms.variant_shown emitter                                                                                                  | Phase C. Becomes the `onSelect` hook                     |
| #15        | variantField and pickVariant                                                                                               | Split. `selectVariant` in Phase C. Field helper deferred |
| #16 to #31 | Audiences, sync, pre-fill, preview-as, webhook, logging, consent, KV, load test, HEM, publish, docs site, partners, launch | Deferred                                                 |

## Work with no issue yet

- Phase 0 data check
- Core package split and scaffold cleanup
- Contract fixtures, response schema and mock server
- Circuit breaker
- Client IP handling
- Bot guard
- Dogfood integration, all stages
- Package distribution for the dogfood
- The resolve service itself (tracked outside this repository)

---

## Risk register

| Risk                                                 | Phase | Mitigation                                    |
| ---------------------------------------------------- | ----- | --------------------------------------------- |
| Match rate is too low to be useful                   | 0     | Checked first, before any build               |
| Contract changes after C starts                      | A     | Freeze in A. Additive changes only afterwards |
| The service misses the latency target                | B     | Measured in B exit, before D                  |
| Client IP setting wrong behind the website's proxies | D     | M5 gate and the forged-header check           |
| Configuration missing in production                  | D     | M10 gate                                      |
| Personalized HTML cached in front of the site        | D     | Header check per route before stage 2         |
| Static marketing routes become dynamic               | D     | One or two routes only. M8 before and after   |
| Cold connections time out after each deploy          | D     | Watch M2 after deploys. Warm-up is deferred   |
| Scope creeps back toward the old plan                | all   | SPEC section 17 is the fence                  |
