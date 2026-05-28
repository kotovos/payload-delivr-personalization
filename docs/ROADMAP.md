# Roadmap

10-week build to GA. 5 phases. Each phase ships a usable cut.

---

## Phase 0 — Foundation (Week 1)

**Goal:** Repo ready. Tooling green. Empty plugin installs into demo Next.js+Payload app.

Tasks:

- Repo scaffolding (pnpm workspace, tsconfig, eslint, prettier, vitest)
- CI (lint, typecheck, test on Node 22, Payload 3.x matrix)
- Plugin skeleton (`delivrPlugin` no-op)
- Demo app (`examples/nextjs-payload-demo`) — fresh Payload + Next.js install
- README + initial docs committed
- Issue templates, PR template, CODEOWNERS
- npm publish dry run

**Exit criteria:** `pnpm add @delivr/payload-plugin-delivr` works locally. CI green. Demo boots.

---

## Phase 1 — α1: IP firmographics + pixel (Weeks 2-3)

**Goal:** Pixel fires. RSC resolves IP → company. No personalization yet — just signal capture + visibility.

Tasks:

- `<DelivrPixel/>` client component + Script integration
- `getVisitorContext()` server util (IP-only path)
- `resolveFromDataApi` client with timeout + retry
- LRU cache layer + pluggable interface
- Types module (`VisitorContext`, `AudienceRule`)
- `/api/delivr/health` endpoint
- `cms.pageview_resolved` event emit (server-side)
- Demo app shows `ctx.company` in a debug banner
- Unit tests for matcher (forward-looking)
- Plugin options validation

**Exit criteria:** Demo site loaded with corporate IP → banner shows correct company. p50 resolution < 50ms.

---

## Phase 2 — α2: Block audienceRules + RSC renderer (Weeks 4-5)

**Goal:** First real personalization. Marketing editor can author conditional Blocks. Page renders matched block.

Tasks:

- `audienceRulesField` group field
- `injectIntoBlocks` config mutator — opt-in via `blocks.include` / `exclude`
- Rule matcher (industries, revenue, employee, naics, countries, isReturning)
- Specificity scorer
- `renderBlocks(blocks, ctx)` RSC helper
- Fallback block selection
- Server-side `cms.variant_shown` event emit
- Demo app: 1 page with 3 industry-conditional Hero blocks
- Vitest: matcher + scorer 100% coverage
- Documentation: "Author your first audience-conditional block"

**Exit criteria:** Demo `/platform` page shows different Hero per industry. Editor configured audience rules via Payload admin.

---

## Phase 3 — β1: Variant fields + form pre-fill + audience sync (Weeks 6-7)

**Goal:** Variants at field level (Hero headline, CTA). Audiences synced from Delivr. Forms pre-fill.

Tasks:

- `variantField()` helper — array field generator
- `pickVariant()` selector
- React `useDelivrPrefill()` client hook
- `delivr-audiences` collection
- `delivr-technologies` collection
- `audiencesSync` job (nightly)
- `technologiesSync` job (weekly)
- Block list admin badge — "3 audience variants"
- Demo: full landing page using variant fields
- `preview-as` endpoint + admin toolbar control
- Docs: variant field API

**Exit criteria:** Editor configures 3 hero variants per audience in admin. Preview-as toggle switches rendered output. Form auto-populates `company` + `industry`.

---

## Phase 4 — β2: Webhook + observability + hardening (Weeks 8-9)

**Goal:** Inbound webhook. Healthcheck robust. Metrics + logs. CSP + privacy docs.

Tasks:

- `/api/delivr/webhook` + HMAC verification
- Webhook handlers: audience updated, member added/removed
- Structured logging (`utils/logger.ts`)
- Metrics emitter (pluggable sink)
- `/api/delivr/health` deep checks
- Cookie consent gate + `requireConsent` option
- HEM resolution path (gated)
- CSP + privacy + compliance docs
- Load test (k6) — 1000 RPS RSC render with resolution
- Vercel KV cache adapter (optional)
- Error tracking (Sentry sink example)

**Exit criteria:** 1000 RPS sustained. p99 < 100ms added latency. Webhook updates `delivr-audiences` in real time.

---

## Phase 5 — GA (Week 10)

**Goal:** Public release. 3 design-partner sites in production.

Tasks:

- npm publish `@delivr/payload-plugin-delivr@1.0.0`
- Public docs site (`docs.delivr.ai/payload`)
- Launch blog post + LinkedIn series
- 3 design-partner sites migrated (one is `delivr-ai-website`)
- Support runbook
- Compatibility matrix maintained
- Public roadmap for v1.1 (intent triggers, account-based CTAs, performance mirror)

**Exit criteria:** Public on npm. 3 sites live. >65% B2B identification on each. NPS feedback collected.

---

## Post-GA (v1.1 — v2)

| Cut  | Feature                                                      |
| ---- | ------------------------------------------------------------ |
| v1.1 | Intent-signal triggered modules                              |
| v1.2 | Account-based CTAs (known account → assigned AE)             |
| v1.3 | `delivr-variant-performance` mirror + inline admin analytics |
| v1.4 | Repeat-visitor escalation rules                              |
| v1.5 | Geo/locale Global field + nav reorder                        |
| v2.0 | Edge-resolved personalization (Vercel Edge Middleware)       |
| v2.1 | Multi-armed bandit variant selection                         |
| v2.2 | Lexical inline personalization                               |
| v2.3 | Embedded Delivr analytics admin view                         |

---

## Workstream sequencing (parallel-safe)

Phase 0 must finish before any other phase.

Phase 1 + Phase 2 can overlap by 1 week (Phase 2 starts when `getVisitorContext` stable).

Phase 3 splits cleanly into 3 parallel streams:

- A: variant fields + renderer
- B: collections + sync jobs
- C: pre-fill hook + admin badge

Phase 4 splits:

- A: webhook + security
- B: observability + load test
- C: HEM path + consent

Phase 5 = launch ops, no parallel split.

---

## Risk register

| Risk                                             | Phase | Mitigation                                  |
| ------------------------------------------------ | ----- | ------------------------------------------- |
| data-api `/v1/resolve` endpoint not yet built    | 1     | Coordinate with data-api team; stub locally |
| Payload 3.x Block field injection API unstable   | 2     | Pin minor version range; track CHANGELOG    |
| Vercel function cold start kills cache hit rate  | 4     | KV adapter ready by β2                      |
| Cookie consent reduces HEM hit rate below target | 4-5   | Document IP-only path as primary value prop |
| Design partner scope creep                       | 5     | Strict v1 feature freeze at β2              |
