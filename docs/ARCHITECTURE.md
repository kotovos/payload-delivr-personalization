# Architecture

## System diagram

```
Browser
  │  pixel.js → POST /events
  │  cookie _dlvr set
  ▼
Next.js host (Payload frontend)
  ├─ <DelivrPixel/> in layout
  ├─ RSC page route
  │     ctx = getVisitorContext()  ──► data-api /v1/resolve
  │     blocks = renderBlocks(page.layout, ctx)
  │     server emits cms.variant_shown ──► pixel-api /v1/events/batch
  ├─ /api/delivr/webhook  (inbound from Delivr)
  └─ Payload Admin
        ├─ delivr-audiences (synced)
        ├─ delivr-technologies (synced)
        └─ Block sidebar "Audience" tab
              ▲
              │ nightly job
              │
        integration-svc /v1/audiences
```

## Request lifecycle

1. Browser GET `/platform`.
2. Next.js RSC runs. `getVisitorContext()` reads IP + cookie.
3. Cache check. Miss → POST `data-api /v1/resolve` with 100ms timeout.
4. data-api: cookie → HEM → contact; IP → company_ip_address → company.
5. Returns VisitorContext.
6. Plugin loads page doc from Payload local API.
7. `renderBlocks` scores each block against ctx. Picks winners.
8. RSC serializes HTML. Response sent.
9. Server fires `cms.variant_shown` events to pixel-api (non-blocking).
10. Browser renders. Pixel script loads. Fires `pageview`.

## Module layout

```
packages/payload-plugin-delivr/
├─ src/
│  ├─ index.ts                    # delivrPlugin entry
│  ├─ options.ts                  # options + defaults + validation
│  ├─ types.ts                    # VisitorContext, AudienceRule, etc.
│  │
│  ├─ server/
│  │  ├─ getVisitorContext.ts     # main resolver
│  │  ├─ resolveFromDataApi.ts    # data-api client
│  │  ├─ cache.ts                 # LRU + interface
│  │  ├─ ipUtils.ts               # ip class C bucketing
│  │  ├─ consent.ts               # consent gate
│  │  └─ events.ts                # variant_shown emitter
│  │
│  ├─ client/
│  │  ├─ DelivrPixel.tsx          # Script tag component
│  │  ├─ useDelivrPrefill.ts      # form pre-fill hook
│  │  └─ track.ts                 # window.dlvr wrapper
│  │
│  ├─ render/
│  │  ├─ renderBlocks.ts          # block-level filter + score
│  │  ├─ pickVariant.ts           # variant array picker
│  │  ├─ matcher.ts               # rule match logic
│  │  └─ scorer.ts                # specificity scoring
│  │
│  ├─ fields/
│  │  ├─ audienceRulesField.ts    # group field
│  │  ├─ variantField.ts          # array helper
│  │  └─ injectIntoBlocks.ts      # config mutator
│  │
│  ├─ collections/
│  │  ├─ delivrAudiences.ts
│  │  ├─ delivrTechnologies.ts
│  │  └─ delivrVariantPerformance.ts  # v2
│  │
│  ├─ endpoints/
│  │  ├─ health.ts
│  │  ├─ webhook.ts
│  │  ├─ resolve.ts
│  │  └─ previewAs.ts
│  │
│  ├─ jobs/
│  │  ├─ audiencesSync.ts
│  │  ├─ technologiesSync.ts
│  │  └─ performanceRollup.ts     # v2
│  │
│  ├─ admin/
│  │  ├─ AudienceBadge.tsx        # block list cell
│  │  └─ PreviewAsControl.tsx     # preview-as toolbar
│  │
│  └─ utils/
│     ├─ hmac.ts
│     ├─ retry.ts
│     └─ logger.ts
│
├─ migrations/
├─ tests/
└─ package.json
```

## Data flow contracts

### data-api `/v1/resolve`

Request:

```json
POST /v1/resolve
x-api-key: ...
{
  "ip": "203.0.113.5",
  "cookie": "_dlvr=abc123",
  "consent": { "hem": true }
}
```

Response (200):

```json
{
  "company": { "domain": "acme.com", "industry": "software", "revenueRange": "$50M-$100M", ... },
  "contact": { "hem": "...", "email": "...", "title": "VP Engineering", ... },
  "audiences": ["aud-saas-50m+", "aud-tech-buyer"],
  "intentSignals": ["identity-resolution", "cdp"],
  "visit": { "isReturning": true, "visitCount": 4 }
}
```

### pixel-api `/v1/events/batch`

```json
POST /v1/events/batch
x-api-key: ...
{ "events": [{ "event_type": "cms.variant_shown", "pixel_id": "...", ... }] }
```

### integration-svc `/v1/audiences`

```json
GET /v1/audiences?organization_id=...
[{ "audience_id": "aud-saas-50m+", "name": "SaaS $50M+", "member_count": 12340 }]
```

## Caching strategy

Two-tier:

1. **Request-scoped memo** via `React.cache()` — same RSC request hits resolver once.
2. **Process-scoped LRU** keyed by `sha256(ip_class_c || cookie_hash)`. 1000 entries default, 5min TTL.

Pluggable backend for multi-instance deploys (Vercel KV, Redis). Interface in `cache.ts`.

## Failure modes

| Failure                | Behavior                                               |
| ---------------------- | ------------------------------------------------------ |
| data-api 5xx           | Anonymous fallback; log; metric `delivr.resolve.error` |
| data-api timeout       | Anonymous fallback after `resolutionTimeoutMs`         |
| Cache backend down     | Bypass cache; direct call; warn once                   |
| pixel-api ingest down  | Events dropped after queue full (1000); log warning    |
| Audience sync fails    | Last good state retained; alarm if stale > 36h         |
| Webhook HMAC bad       | 401; log; rate-limit by IP                             |
| Invalid plugin options | Throw at startup                                       |

## Performance budget

| Op                                     | Budget                                 |
| -------------------------------------- | -------------------------------------- |
| Resolution (cache hit)                 | < 1ms                                  |
| Resolution (cache miss, data-api ok)   | < 50ms p50, < 100ms p99 (hard timeout) |
| renderBlocks (50 blocks, 5 rules each) | < 5ms                                  |
| Total added TTFB                       | < 60ms p50                             |

## Deployment

- Plugin published to npm: `@delivr/payload-plugin-delivr`
- Host app deploys to wherever Payload runs (Vercel, Railway, AWS, GCP)
- No separate service to deploy
- Pixel served from Delivr's CDN (`pixel.delivr.ai`)

## Scaling considerations

- LRU cache stateful per-process. With Vercel functions, low cache hit rate. Switch to KV.
- Variant render is pure function of (blocks, ctx) — cacheable at CDN if URL includes audience hash.
- Heavy variant counts → server-side filter before serialize. Don't ship hidden variants.
- Audience collection grows slowly (hundreds-thousands). No pagination concerns.

## Security boundaries

- Plugin code runs in Payload host process.
- API key in env, never in client bundle. Lint rule + build check.
- HEM never echoed to client.
- Preview-as cookie signed (HMAC) so editors can't impersonate arbitrary contexts without admin token.
