# PRD — Delivr.ai Personalization for PayloadCMS

**Owner:** GK (CTO, Delivr.ai)
**Status:** Draft v1
**Last updated:** 2026-05-28

---

## 1. Problem

PayloadCMS sites render the same content to every visitor. Marketing teams running Payload-backed sites cannot tailor hero, CTA, or layout to **who** the visitor is — their company, industry, role, or buying intent — without bolting on a separate personalization engine (Mutiny, Intellimize, Optimizely). Those tools require duplicate content authoring, fragmented analytics, and ignore B2B identity signals.

Delivr.ai already resolves 70%+ of B2B traffic to company + contact identity via its 6.5B-vertex identity graph. The signal exists. The CMS does not consume it.

## 2. Users

| Persona                 | Need                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| **Marketing editor**    | Author one page with audience-specific variants in the same admin UI |
| **Demand gen / growth** | Know which variants convert per industry/persona; iterate            |
| **Developer**           | One plugin install. No custom personalization stack.                 |
| **Sales / RevOps**      | Personalized CTAs route known accounts to assigned AE Calendly       |
| **Visitor (B2B buyer)** | Sees content relevant to their company + role                        |

## 3. Goals

**G1.** Drop-in plugin. < 30 min to working personalization on existing Payload site.
**G2.** No editor leaves Payload admin to configure audiences or variants.
**G3.** Zero TTFB regression. Personalization runs in RSC under 50ms p50.
**G4.** Single source of truth for analytics — Delivr Snowflake. Mirror rollups for inline admin badges.
**G5.** Privacy-compliant. GDPR/CCPA aware. Anonymous fallback always works.

## 4. Non-goals (v1)

- A/B test statistical engine (use Delivr existing analytics).
- Email personalization. Web only.
- Mobile native SDK.
- Multi-CMS support — Payload only.
- Non-Next.js hosts — Payload's official frontend is Next.js App Router.

## 5. Success Metrics

| Metric                                     | Target (90 days post-GA) |
| ------------------------------------------ | ------------------------ |
| Time-to-first-personalized-render          | < 30 min from `pnpm add` |
| Sites in production                        | 10                       |
| Avg variants per page                      | ≥ 3                      |
| Identification rate (B2B traffic)          | ≥ 65% company match      |
| Conversion lift on personalized vs control | ≥ +15%                   |
| RSC render p50 with Delivr resolution      | < 50ms                   |
| Editor NPS for variant authoring           | ≥ 40                     |

## 6. Scope — MVP (v1)

**In:**

- Pixel install via Next.js Script in host `app/layout.tsx`
- `getVisitorContext()` RSC server util — IP → company, cookie → HEM → contact
- Block-level `audienceRules` field auto-injected
- RSC `renderBlocks()` helper — filters + scores
- Variant fields for Hero/CTA/RichText/Image
- `delivr-audiences` collection synced nightly
- Form pre-fill helper (`useDelivrPrefill` hook)
- Webhook endpoint `/api/delivr/webhook`
- Per-render emit of `cms.variant_shown` event
- Anonymous fallback path (no consent → render default)
- Env config + healthcheck endpoint
- TypeScript types exported

**Out (v2+):**

- Intent-signal triggered modules
- Embedded Delivr analytics view inside Payload admin
- Visual variant preview ("Preview as Acme CFO")
- Multi-variant scoring + bandit selection
- CDN edge resolution (Vercel Edge Middleware) for static pages
- Account-based routing (known account → assigned AE Calendly)
- Repeat-visitor escalation logic
- Performance rollup mirror collection
- Geo/locale personalization
- Navigation reorder Global field

## 7. MVP cuts (sequence)

| Cut    | Scope                                                           | Ships   |
| ------ | --------------------------------------------------------------- | ------- |
| **α1** | Pixel + `getVisitorContext` + IP-only firmographics             | Week 2  |
| **α2** | Block `audienceRules` field + RSC renderer + industry/size swap | Week 4  |
| **β1** | Variant fields + form pre-fill + audience collection sync       | Week 6  |
| **β2** | Webhook + variant_shown event emit + healthcheck                | Week 8  |
| **GA** | Docs + demo app + 3 design partner sites in prod                | Week 10 |

## 8. Constraints

- **Privacy:** Cookie consent required before HEM resolution. IP-only firmographics treated as business data (lawful basis: legitimate interest B2B).
- **Latency:** `data-api` resolution must not block render > 100ms. Timeout → anonymous fallback.
- **Cost:** Cache resolutions 5 min per (IP, cookie) tuple. Avoid per-page hits.
- **Compatibility:** Payload 3.x, Next.js 15+, Node 22 LTS.
- **Security:** API keys server-only. Pixel ID public. No PII in Payload DB by default.

## 9. Risks

| Risk                                                 | Mitigation                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `data-api` latency spikes block TTFB                 | Hard timeout 100ms + per-request `unstable_cache` + LRU                 |
| Editors over-configure variants → maintenance burden | "Fallback" required on every block; lint warns on >5 variants           |
| Cookie consent denial collapses identification       | IP→company path needs no cookie. Document gracefully.                   |
| Payload schema changes break Block injection         | Pin compatible Payload version range. CI matrix test.                   |
| Variant explosion → CMS performance degrades         | Server-side filter before serialize. Don't ship all variants to client. |

## 10. Open questions

- Should variant_shown events go via pixel-api (client) or integration-service (server)? **Lean server** for reliability.
- Multi-tenant Payload (Payload Cloud) — per-tenant pixel ID config? **v2.**
- Rich text inline personalization (per-paragraph variants) — Lexical extension? **v2.**
- Caching layer: in-process LRU vs Redis vs Vercel KV? **Start LRU. Make pluggable.**

## 11. Dependencies

- Delivr `pixel-api` — must accept `cms.*` event types
- Delivr `data-api` — must expose `/resolve` taking `{ip, cookie?, hem?}` → VisitorContext
- Delivr dashboard — audience export API for `delivr-audiences` sync
- Payload 3.x stable
- `db-organization-model` — no change (CMS is not a CRM destination)

## 12. Launch plan

- Week 1-2: α1 internal dogfood (delivr-ai-website)
- Week 4: α2 design-partner alpha — 2 sites
- Week 6: β1 invite-only — 5 sites
- Week 10: GA, public npm, OSS, launch post
