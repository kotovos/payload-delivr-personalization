# PRD: Delivr.ai personalization for Next.js and PayloadCMS

**Owner:** GK (CTO, Delivr.ai)
**Status:** v1 scope approved 2026-11-11
**Last updated:** 2026-11-11

"Product owner" below is the owner named above. "Builder" is the engineer
assigned to this work.

---

## 1. Problem

Marketing sites show the same content to every visitor. Tailoring the hero or
a call to action to the visitor's company normally means adding a separate
personalization product, with duplicate authoring and separate analytics.

Delivr.ai associates IP addresses with companies through entity resolution.
Nothing lets a website consume that signal at render time.

## 2. Decisions (2026-11-11)

| #   | Decision                                                                                       |
| --- | ---------------------------------------------------------------------------------------------- |
| D1  | One builder owns both sides: the client packages and the resolve endpoint                      |
| D2  | The resolve endpoint is built and hosted by Delivr. Its home is recorded internally            |
| D3  | v1 is company-only block and variant swap. No contact identity, audiences, webhook or pre-fill |
| D4  | First deployment is a dogfood on delivr-ai-website. No npm publish in v1                       |
| D5  | The core is split from Payload, because delivr-ai-website runs no CMS                          |
| D6  | Resolution uses Delivr.ai data only. Never fall back to another dataset                        |

## 3. Users

| Persona          | v1 need                                                        |
| ---------------- | -------------------------------------------------------------- |
| Developer        | One function call returns who the visitor's company is         |
| Marketing editor | Mark a block or variant for an industry or a named account     |
| Growth           | See how often resolution succeeds and which variants are shown |
| Visitor          | Content relevant to their company. Default content otherwise   |

## 4. Goals for v1

- **G1.** Prove the resolve path end to end on real traffic: latency, match
  rate, failure behavior.
- **G2.** A page never breaks, and never slows beyond a fixed bound, because
  of Delivr. Hard cap: 100 ms added, default content on any failure. A build
  never fails because of it either.
- **G3.** Rule logic is exact and tested. An editor can predict which block a
  given company sees.
- **G4.** The same core serves a plain Next.js site and a Payload site.

## 5. Non-goals for v1

- Contact identity: email, title, seniority.
- Rules on company size or revenue.
- Audience sync, intent topics, technologies.
- Webhooks, admin UI beyond one field group, preview-as.
- A/B statistics.
- Public npm release, public docs, design partners.
- Non-Next.js hosts.

## 6. Scope

**In:**

- Visitor Resolve API: IP in, one company or none out
- `@delivr/personalization`: resolve client, cache, circuit breaker, client IP
  handling, bot guard, rule matcher, `selectVariant`, `selectBlocks`
- `@delivr/payload-plugin-delivr`: `audienceRules` field on opted-in blocks
- Contract fixtures, a response schema and a mock resolve server
- Payload demo app
- Dogfood on one or two routes of delivr-ai-website

**Out:** everything in SPEC section 17.

## 7. Success measures

The 2026-05-28 draft set targets with no data behind them (65% company match,
+15% conversion lift, 50 ms p50). They are withdrawn. v1 measures first.

Event terms are defined in SPEC section 12. "Made a call" means `source` is
`fresh` or `fallback`.

| #   | Measure                               | Definition                                                               | v1 outcome                          |
| --- | ------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| M1  | Resolve latency, p50 and p99          | `durationMs` over events that made a call. Timeouts are included         | Reported                            |
| M2  | Timeout rate                          | `timeout` events that made a call, over all events that made a call      | Reported                            |
| M3  | Match rate                            | Matched `fresh` events over all `fresh` events                           | Reported                            |
| M4  | Ambiguous rate                        | `ambiguous` `fresh` events over all `fresh` events                       | Reported. Drives the threshold      |
| M5  | `no_ip` rate                          | `no_ip` events over all events except `bot`, `disabled`, `misconfigured` | At or below 0.5%. Starting gate     |
| M6  | Page errors caused by the integration | Errors in the host's error tracking traced to this code                  | Zero                                |
| M7  | Existing pixel event volume           | Daily events during dogfood against the 4 weeks before it                | Inside that 4-week min to max range |
| M8  | Page timing on personalized routes    | TTFB p75 before and after, from the host's own measurement               | Reported                            |
| M9  | Variant exposure by slot              | `onSelect` events. In stage 1 these are "would have been shown"          | Reported                            |
| M10 | Misconfigured events                  | Count of `misconfigured` events in production                            | Zero                                |

**Sample floor.** No measure is read as a gate until it covers at least 7
days and at least 1,000 events that made a call. A rate computed on nothing
passes nothing.

"Reported" means there is no target yet, because no baseline exists. Whether
to go further (more rule inputs, Payload release, public release) is the
product owner's decision on these numbers.

## 8. Constraints

- **Latency:** 100 ms deadline on the resolve call. No retries.
- **Data:** Delivr.ai resolution only. No third-party fallback (D6).
- **Privacy:** company-level data only. The visitor IP is sent server to
  server over HTTPS and held only in process memory.
- **Caching:** personalized HTML must not be stored by a shared cache.
- **Compatibility:** Node 22, Next.js 15 or later, React 19. Payload 3.x for
  the Payload layer.
- **Repository:** this repository is public. Internal service details stay
  out of it.

## 9. Risks

| Risk                                                    | Mitigation                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| The resolve endpoint does not exist                     | Contract first. Client builds against fixtures and a mock server   |
| An address can be shared by several companies           | Confidence threshold. The ambiguous rate is unknown until measured |
| Match rate on real traffic is too low to matter         | Phase 0 checks this before anything is built                       |
| Wrong client IP setting gives silently wrong answers    | No default. Core-side checks. `no_ip` measure. Forged-header test  |
| Personalized HTML cached in front of the site           | Response header check per route in the deployed environment        |
| Making static marketing pages dynamic costs performance | Named routes only. Page timing is measured (M8)                    |
| Resolve endpoint used as a bulk IP lookup               | Per-key rate limit and quota. Correct client IP configuration      |
| Missing configuration breaks a build or a route         | `createDelivr` never throws. Kill switch needs no other settings   |
| Missing configuration goes unnoticed                    | `misconfigured` is its own reason, and M10 must be zero            |

## 10. Dependencies

| Dependency          | State                                          |
| ------------------- | ---------------------------------------------- |
| Visitor Resolve API | Not built. Contract in RESOLVE-API.md          |
| delivr-ai-website   | Next.js 16, no CMS. Receives the core package  |
| Payload 3.x         | Needed for the Payload layer and the demo only |

## 11. Open questions

For the builder unless marked.

| #   | Question                                                                          |
| --- | --------------------------------------------------------------------------------- |
| Q1  | How does delivr-ai-website consume a private package? Registry or git             |
| Q2  | Which routes are personalized first, and with what variants? (product owner)      |
| Q3  | What is the correct client IP setting behind the website's proxy chain?           |
| Q4  | Does anything in front of the website cache HTML?                                 |
| Q5  | Should this repository move to the company's GitHub organization? (product owner) |
| Q6  | Service-side items R1 to R8 in RESOLVE-API.md                                     |

## 12. After v1

Considered only once the v1 measures are in:

- More rule inputs, each backed by a verified data contract
- Resolution in `proxy.ts` with pre-rendered variants
- Payload field-level variants, admin badges, preview-as
- Contact identity with consent gating
- Audience sync and intent
- Shared cache
- Public npm release and docs
