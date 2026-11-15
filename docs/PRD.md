# PRD: Delivr.ai personalization for Next.js and PayloadCMS

**Owner:** Delivr.ai product owner
**Status:** v1 scope revised 2026-11-12
**Last updated:** 2026-11-12

"Product owner" below is that owner. "Builder" is the engineer
assigned to this work.

---

## 1. Problem

Marketing sites show the same content to every visitor. Tailoring the hero or
a call to action to the visitor's company or role normally means adding a
separate personalization product, with duplicate authoring and separate
analytics.

Delivr.ai already identifies a site's visitors. Its pixel sets a visitor
cookie and Delivr attaches the visitor's hashed email to it within seconds.
Delivr holds the person and company profile behind that email. Nothing lets a
website use that knowledge at render time.

## 2. Decisions

| #   | Decision                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | One builder owns both sides: the client packages and the resolve endpoint                                                                                                                     |
| D2  | The resolve endpoint is built and hosted by Delivr. Its home is recorded internally                                                                                                           |
| D3  | Visitors are identified by the Delivr pixel cookie and the hashed email attached to it, never by IP address. v1 swaps blocks and variants on company and role attributes (revised 2026-11-12) |
| D4  | First deployment is a dogfood on delivr-ai-website. No npm publish in v1                                                                                                                      |
| D5  | The core is split from Payload, because delivr-ai-website runs no CMS                                                                                                                         |
| D6  | Resolution uses Delivr.ai data only. Never fall back to another dataset                                                                                                                       |

D1, D2, D4, D5 and D6 date from 2026-11-11. D3 first read "company-only, by
IP address". That was wrong for how Delivr works and was replaced.

## 3. Users

| Persona          | v1 need                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| Developer        | One function call returns the visitor's role and company                 |
| Marketing editor | Mark a block or variant for a named account, an industry, or a role      |
| Growth           | See how often a visitor can be personalized and which variants are shown |
| Visitor          | Content relevant to their company and role. Default content otherwise    |

## 4. Goals for v1

- **G1.** Prove the cookie to role and company path end to end on real
  traffic: how many page views can be personalized, latency, failure behavior.
- **G2.** A page never breaks, and never slows beyond a fixed bound, because
  of Delivr. Hard cap: 100 ms added, default content on any failure. A build
  never fails because of it either.
- **G3.** Rule logic is exact and tested. An editor can predict which block a
  given visitor sees.
- **G4.** The same core serves a plain Next.js site and a Payload site. The
  Payload half is built only if the product owner continues after dogfood
  stage 1 (ROADMAP Phase E).

## 5. Non-goals for v1

- Any IP address based resolution.
- Personalizing the first page view of a brand-new browser. The cookie does
  not exist yet when that page renders.
- Client-side swaps after the pixel runs.
- Showing the visitor anything about themselves: no name, no email, no
  company name on the page.
- Rules on company size or revenue.
- Audience sync, intent topics, technologies.
- Webhooks, admin UI beyond one field group, preview-as.
- A/B statistics.
- Public npm release, public docs, design partners.
- Non-Next.js hosts.

## 6. Scope

**In:**

- Visitor Resolve API: pixel cookie in, role and company attributes out
- A first-party pixel cookie on the dogfood site in every major browser
- `@delivr/personalization`: resolve client, cache, circuit breaker, cookie
  reading, GPC and consent guards, bot guard, rule matcher, `selectVariant`,
  `selectBlocks`
- `@delivr/payload-plugin-delivr`: `audienceRules` field on opted-in blocks,
  conditional on the dogfood stage 1 decision
- Contract fixtures, a response schema and a mock resolve server
- Payload demo app, on the same condition
- Dogfood on one or two routes of delivr-ai-website

**Out:** everything in SPEC section 18.

## 7. Success measures

The 2026-05-28 draft set targets with no data behind them (65% match, +15%
conversion lift, 50 ms p50). They are withdrawn. v1 measures first.

Event terms are defined in SPEC section 13. "Made a call" means `source` is
`fresh` or `fallback`. "Eligible" means every event except `disabled`,
`misconfigured`, `bot`, `gpc` and `consent`.

| #   | Measure                               | Definition                                                          | v1 outcome                          |
| --- | ------------------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| M1  | Resolve latency, p50 and p99          | `durationMs` over events that made a call. Timeouts are included    | Reported                            |
| M2  | Timeout rate                          | `timeout` events that made a call, over all events that made a call | Reported                            |
| M3  | Match rate                            | Matched `fresh` events over all `fresh` events                      | Reported                            |
| M4  | Pending rate                          | `pending` events over all `fresh` events                            | Reported                            |
| M5  | `no_cookie` rate, by browser family   | `no_cookie` events over eligible events                             | Reported. Each family checked by I1 |
| M6  | Page errors caused by the integration | Errors in the host's error tracking traced to this code             | Zero                                |
| M7  | Existing pixel event volume           | Mean daily events over the 7 dogfood days, against the means of each of the 4 weeks before | Inside the range of those 4 weekly means |
| M8  | Page timing on personalized routes    | TTFB p75 before and after, from the host's own measurement          | Reported                            |
| M9  | Variant exposure by slot              | `onSelect` events. In stage 1 these are "would have been shown"     | Reported                            |
| M10 | Misconfigured events                  | Count of `misconfigured` events in production                       | Zero                                |
| M11 | Personalized share                    | Matched events over eligible events                                 | Reported. The headline number       |

**Sample floor.** No measure is read as a gate until it covers at least 7
days and at least 1,000 eligible events. A per-browser value of M5 is read
only once that browser family has at least 200 eligible events. A rate computed on nothing passes
nothing.

"Reported" means there is no target yet, because no baseline exists. Whether
to go further (more rule inputs, Payload release, public release) is the
product owner's decision on these numbers.

## 8. Constraints

- **Latency:** 100 ms deadline on the resolve call. No retries.
- **Data:** Delivr.ai data only. No third-party fallback (D6).
- **Privacy:** no identifier reaches the site. The service returns role and
  company attributes only. GPC is honored, and the host's consent check runs
  before any call. These mirror what the pixel already does. They are design
  choices the product owner can revisit.
- **Pixel:** the site's existing pixel stays the only browser piece. Its
  event volume must not drop (M7).
- **Caching:** personalized HTML must not be stored by a shared cache.
- **Compatibility:** Node 22, Next.js 15 or later, React 19. Payload 3.x for
  the Payload layer.
- **Repository:** this repository is public. Internal service details stay
  out of it.

## 9. Risks

| Risk                                                        | Mitigation                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| The resolve endpoint does not exist                         | Contract first. Client builds against fixtures and a mock server. Both lookups behind it exist |
| The pixel cookie is first-party in only some browsers today        | Phase B makes it first-party in every major browser. M5 by browser and check I1                |
| The CDN strips the cookie before the origin                 | Check I1 through the deployed CDN before stage 1                                               |
| Too few visitors carry an identity to matter                | Phase 0 measures it on the site's own pixel data before any build                              |
| A full profile lookup is slower than the client budget      | Service answers from fast storage and returns `pending` otherwise                              |
| A copied or guessed cookie shows that person's variant to someone else | No identifiers in the response. Pixel binding and an edge rate limit before any live variant. Debug view is private |
| A visitor who withdrew consent still gets personalized      | Host consent check before any call (Q6)                                                        |
| Personalized HTML cached in front of the site               | Response header check per route in the deployed environment                                    |
| Making static marketing pages dynamic costs performance     | Named routes only. Page timing is measured (M8)                                                |
| Changing the pixel setup breaks pixel collection            | M7 gate. The pixel tag is changed only if the first-party fix needs it                         |
| Missing configuration breaks a build or a route             | `createDelivr` never throws. Kill switch needs no other settings                               |
| Missing configuration goes unnoticed                        | `misconfigured` is its own reason, and M10 must be zero                                        |

## 10. Dependencies

| Dependency                         | State                                                  |
| ---------------------------------- | ------------------------------------------------------ |
| Visitor Resolve API                | Not built. Contract in RESOLVE-API.md                  |
| Cookie to hashed email, at Delivr  | Exists. Written by the pixel                           |
| Hashed email to profile, at Delivr | Exists                                                 |
| First-party pixel cookie           | Some browsers only today. Needed in every major browser       |
| delivr-ai-website                  | Next.js 16, no CMS, pixel installed. Receives the core |
| Payload 3.x                        | Needed for the Payload layer and the demo only         |

## 11. Open questions

For the builder unless marked.

| #   | Question                                                                                   |
| --- | ------------------------------------------------------------------------------------------ |
| Q1  | How does delivr-ai-website consume a private package? Registry or git                      |
| Q2  | Which routes are personalized first, and with what variants? (product owner)               |
| Q3  | How does the dogfood site's pixel cookie become first-party in every major browser?        |
| Q4  | Does the CDN forward the pixel cookies on the chosen routes, and does anything cache HTML? |
| Q5  | Should this repository move to the company's GitHub organization? (product owner)          |
| Q6  | Which consent signal can the dogfood site's server read? (builder, with the product owner) |
| Q7  | Service-side items R1 to R9 in RESOLVE-API.md                                              |

## 12. After v1

Considered only once the v1 measures are in:

- Personalizing the first page view, for example a client-side swap once the
  pixel has an identity
- More rule inputs, each backed by a verified data contract
- Resolution in `proxy.ts` with pre-rendered variants
- Payload field-level variants, admin badges, preview-as
- Audience sync and intent
- Shared cache
- Public npm release and docs
