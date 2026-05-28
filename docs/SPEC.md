# Integration Spec — Delivr.ai × PayloadCMS

**Version:** 1.0
**Status:** Draft
**Last updated:** 2026-05-28

---

## 1. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ Browser                                                             │
│  ├─ Delivr Pixel JS (loaded via Next.js Script)                    │
│  │   ├─ fires pageview to pixel-api                                │
│  │   └─ sets _dlvr cookie (1st-party)                              │
│  └─ React UI (rendered by Next.js)                                 │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ HTTP (Next.js host)
                           ▼
┌────────────────────────────────────────────────────────────────────┐
│ Next.js App Router (Payload's frontend)                            │
│                                                                     │
│  app/layout.tsx                                                    │
│    └─ <DelivrPixel pixelId={env.DELIVR_PIXEL_ID} />               │
│                                                                     │
│  app/[...slug]/page.tsx (RSC)                                     │
│    └─ ctx = await getVisitorContext()                              │
│    └─ page = await payload.findByID(...)                           │
│    └─ renderBlocks(page.layout, ctx)                               │
│                                                                     │
│  app/api/delivr/webhook/route.ts                                   │
│    └─ inbound Delivr → updates audiences collection                │
└──────────────────────────┬─────────────────────────────────────────┘
                           │
       ┌───────────────────┼────────────────────┐
       ▼                   ▼                    ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  pixel-api   │  │     data-api     │  │ integration-svc  │
│  ingest evts │  │  /resolve        │  │ /audiences sync  │
└──────────────┘  └────────┬─────────┘  └────────┬─────────┘
                           │                     │
                           ▼                     ▼
              ┌───────────────────────────────────────┐
              │ NebulaGraph + Snowflake + Neon PG    │
              └───────────────────────────────────────┘
```

## 2. Plugin shape

`@delivr/payload-plugin-delivr` exports:

```ts
import type { Plugin } from "payload";

export interface DelivrPluginOptions {
  pixelId: string; // public
  apiKey: string; // server-only, x-api-key header
  dataApiUrl: string; // https://data-api.delivr.ai
  pixelApiUrl?: string; // default https://pixel.delivr.ai
  integrationApiUrl?: string; // default https://integration.delivr.ai
  enableBlockRules?: boolean; // default true
  enableVariantFields?: boolean; // default true
  enableAudienceSync?: boolean; // default true
  enableWebhook?: boolean; // default true
  enablePerformanceMirror?: boolean; // default false (v2)
  resolutionTimeoutMs?: number; // default 100
  cacheTtlSeconds?: number; // default 300
  cookieName?: string; // default '_dlvr'
  requireConsent?: () => boolean | Promise<boolean>; // CMP integration
  collections?: {
    // which collections get audienceRules injected
    include?: string[];
    exclude?: string[];
  };
  blocks?: {
    // which blocks get audienceRules
    include?: string[];
    exclude?: string[];
  };
  industries?: { label: string; value: string }[]; // override defaults (NAICS-based)
  revenueRanges?: { label: string; value: string }[];
  employeeBuckets?: { label: string; value: string }[];
  seniorityLevels?: { label: string; value: string }[];
}

export const delivrPlugin: (opts: DelivrPluginOptions) => Plugin;
```

## 3. Type contracts

### VisitorContext (canonical)

```ts
export interface VisitorContext {
  resolvedAt: string; // ISO timestamp
  source: "fresh" | "cache" | "fallback";
  anonymous: boolean; // true if no resolution
  company?: {
    domain: string;
    name?: string;
    industry?: string;
    naics?: string;
    sic?: string;
    revenueRange?: string;
    employeeCount?: string;
    employeeBucket?: string; // 1-10, 11-50, 51-200, 201-1000, 1001-5000, 5001+
    technologies?: string[];
    linkedinUid?: string;
    hqCountry?: string;
    hqRegion?: string;
  };
  contact?: {
    email?: string; // only if consent + HEM matched
    hem?: string; // sha256
    title?: string;
    seniority?: "IC" | "Manager" | "Director" | "VP" | "CXO" | "Founder";
    department?: string;
    workHistory?: Array<{
      company: string;
      title: string;
      start?: string;
      end?: string;
    }>;
  };
  audiences: string[]; // Delivr audience IDs
  intentSignals: string[]; // topic IDs visitor's company researching
  visit: {
    isReturning: boolean;
    visitCount: number;
    lastSeenAt?: string;
    referrer?: string;
    country?: string;
    region?: string;
  };
}
```

### AudienceRule (per Block)

```ts
export interface AudienceRule {
  industries?: string[];
  naicsPrefixes?: string[];
  revenueRanges?: string[];
  employeeBuckets?: string[];
  technologies?: string[]; // tech slug IDs
  audiences?: string[]; // Delivr audience IDs
  seniority?: VisitorContext["contact"]["seniority"][];
  departments?: string[];
  intent?: string[];
  countries?: string[];
  visitCountMin?: number;
  visitCountMax?: number;
  isReturning?: boolean;
  isKnownAccount?: boolean; // matches CRM
  fallback?: boolean; // default block if nothing matches
}
```

## 4. Server APIs

### `getVisitorContext()`

```ts
// packages/payload-plugin-delivr/src/server/getVisitorContext.ts
export async function getVisitorContext(opts?: {
  headers?: Headers;
  cookies?: ReadonlyRequestCookies;
  skipCache?: boolean;
}): Promise<VisitorContext>;
```

Behavior:

1. Reads `x-forwarded-for` / `x-real-ip` headers and `_dlvr` cookie.
2. Checks per-request memo (React `cache()`).
3. Checks LRU cache keyed by `(ip, cookie)`. TTL = `cacheTtlSeconds`.
4. POSTs `{ip, cookie, consent}` to `${dataApiUrl}/v1/resolve` with `AbortController` timeout = `resolutionTimeoutMs`.
5. On timeout/error: returns `{ anonymous: true, source: 'fallback', audiences: [], intentSignals: [], visit: { isReturning: false, visitCount: 0 } }`.
6. Caches success result.

### `renderBlocks(blocks, ctx)`

```ts
export function renderBlocks<
  T extends { blockType: string; audienceRules?: AudienceRule },
>(blocks: T[], ctx: VisitorContext, options?: { emitEvents?: boolean }): T[];
```

Filtering algorithm:

1. Group blocks by stable `blockKey` (slot identifier). Default: block index.
2. Within each group, score each block against `ctx` using rule match count.
3. Pick max-score block. Ties broken by author order.
4. If no block matches and a `fallback: true` block exists, render it.
5. If no fallback, render first block in group.
6. If `emitEvents`, fire `cms.variant_shown` per rendered block.

### `pickVariant(field, ctx)`

```ts
export function pickVariant<T extends { rules?: AudienceRule }>(
  variants: T[],
  ctx: VisitorContext,
): T | undefined;
```

Same scoring algorithm. Used by variant field renderers (Hero, CTA, RichText).

## 5. Field shapes injected into Payload

### `audienceRules` group field (auto-injected into every Block)

```ts
{
  name: 'audienceRules',
  type: 'group',
  admin: { description: 'Show this block only to matching audiences. Leave empty for all.' },
  fields: [
    { name: 'industries', type: 'select', hasMany: true, options: industryOptions },
    { name: 'revenueRanges', type: 'select', hasMany: true, options: revenueOptions },
    { name: 'employeeBuckets', type: 'select', hasMany: true, options: employeeOptions },
    { name: 'technologies', type: 'relationship', relationTo: 'delivr-technologies', hasMany: true },
    { name: 'audiences', type: 'relationship', relationTo: 'delivr-audiences', hasMany: true },
    { name: 'seniority', type: 'select', hasMany: true, options: seniorityOptions },
    { name: 'intent', type: 'select', hasMany: true, options: intentOptions },
    { name: 'countries', type: 'select', hasMany: true, options: countryOptions },
    { name: 'isReturning', type: 'checkbox' },
    { name: 'isKnownAccount', type: 'checkbox' },
    { name: 'fallback', type: 'checkbox', admin: { description: 'Default if nothing else matches' } },
  ],
}
```

### Variant array field helper

```ts
import { variantField } from "@delivr/payload-plugin-delivr/fields";

const Hero = {
  slug: "hero",
  fields: [
    variantField({
      name: "hero",
      contentFields: [
        { name: "headline", type: "text", required: true },
        { name: "subhead", type: "text" },
        { name: "ctaLabel", type: "text" },
        { name: "ctaHref", type: "text" },
        { name: "image", type: "upload", relationTo: "media" },
      ],
    }),
  ],
};
```

Generates an array field with each row containing `{ rules: AudienceRule, content: {...contentFields} }`.

## 6. Collections injected

### `delivr-audiences`

```ts
{
  slug: 'delivr-audiences',
  admin: { useAsTitle: 'name', group: 'Delivr' },
  access: { create: () => false, update: () => false, delete: () => false },  // read-only synced
  fields: [
    { name: 'audienceId', type: 'text', required: true, unique: true, index: true },
    { name: 'name', type: 'text', required: true },
    { name: 'description', type: 'textarea' },
    { name: 'memberCount', type: 'number' },
    { name: 'syncedAt', type: 'date' },
  ],
}
```

### `delivr-technologies`

Synced reference list of tracked technologies (Salesforce, HubSpot, Snowflake, …).

### `delivr-variant-performance` (v2, opt-in)

```ts
{
  slug: 'delivr-variant-performance',
  fields: [
    { name: 'pageId', type: 'relationship', relationTo: 'pages' },
    { name: 'blockKey', type: 'text' },
    { name: 'variantId', type: 'text' },
    { name: 'audienceLabel', type: 'text' },
    { name: 'date', type: 'date' },
    { name: 'impressions', type: 'number' },
    { name: 'conversions', type: 'number' },
    { name: 'ctr', type: 'number' },
  ],
}
```

## 7. Endpoints injected

| Method | Path                     | Purpose                                                  |
| ------ | ------------------------ | -------------------------------------------------------- |
| GET    | `/api/delivr/health`     | Healthcheck — verifies `data-api` reachability + auth    |
| POST   | `/api/delivr/webhook`    | Inbound — audience updates, intent triggers              |
| POST   | `/api/delivr/resolve`    | Client fallback resolve (rare; mostly RSC)               |
| GET    | `/api/delivr/preview-as` | Admin preview-as helper (sets cookie with simulated ctx) |

Webhook signature: HMAC-SHA256 of body using `apiKey`. Header `x-delivr-signature`.

## 8. Jobs / cron

Registered via Payload `jobs.tasks`:

| Job                         | Schedule          | Action                                                                |
| --------------------------- | ----------------- | --------------------------------------------------------------------- |
| `delivr-audiences-sync`     | nightly 03:00 UTC | Pull from `${integrationApiUrl}/v1/audiences`, upsert by `audienceId` |
| `delivr-technologies-sync`  | weekly Sun 04:00  | Pull tech list, upsert                                                |
| `delivr-performance-rollup` | hourly (v2)       | Pull yesterday's variant_shown + conversion joins, upsert rows        |
| `delivr-cache-warm`         | every 5 min       | Pre-warm top 100 IP ranges (optional)                                 |

## 9. Pixel + event flow

### Client-side pixel

```html
<!-- emitted by <DelivrPixel /> component in layout.tsx -->
<script
  async
  src="https://pixel.delivr.ai/p.js"
  data-pixel-id="DELIVR_PIXEL_ID"
></script>
```

Pixel sets `_dlvr` cookie. Fires `pageview` automatically. Exposes `window.dlvr.track(name, props)` for custom events.

### Server-side variant_shown emit

Fired from `renderBlocks` when a non-fallback variant renders. Sent server→server to `${pixelApiUrl}/v1/events/batch` with payload:

```json
{
  "events": [
    {
      "event_type": "cms.variant_shown",
      "pixel_id": "...",
      "organization_id": "...",
      "occurred_at": "2026-05-28T12:34:56Z",
      "context": {
        "page_id": "...",
        "page_slug": "/platform",
        "block_key": "hero-0",
        "variant_id": "industry:software",
        "audience_match": ["aud-saas-rev-50m+"],
        "company_domain": "acme.com",
        "company_industry": "software"
      }
    }
  ]
}
```

Batched via async queue, flushed every 5s or 100 events.

## 10. Caching

| Layer                | Key                         | TTL          | Backend                                    |
| -------------------- | --------------------------- | ------------ | ------------------------------------------ |
| Per-request memo     | request                     | one request  | React `cache()`                            |
| Resolution cache     | `(ip_class_c, cookie_hash)` | 300s         | `LRUCache` (default) or pluggable Redis/KV |
| Audiences collection | n/a                         | nightly sync | Payload DB                                 |
| Pixel script         | n/a                         | 1 day        | CDN                                        |

Pluggable cache interface:

```ts
export interface DelivrCache {
  get(key: string): Promise<VisitorContext | undefined>;
  set(key: string, value: VisitorContext, ttlSec: number): Promise<void>;
}
```

## 11. Security

- `apiKey` server-only. Never exposed to client. Validated on plugin init.
- Webhook HMAC verification. Reject if header missing or mismatch.
- Cookie `_dlvr`: `Secure`, `HttpOnly` (read by pixel JS — so not HttpOnly), `SameSite=Lax`, 1-year max.
- HEM never logged. Email never persisted in Payload by default.
- IP hashed before cache key (`ip_class_c` = first 3 octets) to avoid PII storage.
- CSP additions documented for host app:
  ```
  script-src 'self' https://pixel.delivr.ai
  connect-src 'self' https://pixel.delivr.ai https://data-api.delivr.ai
  ```

## 12. Privacy + consent

- Default: IP→company firmographics treated as B2B legitimate interest. No consent required.
- HEM resolution gated on `requireConsent()` returning true.
- If CMP not configured and `requireConsent` returns false (default), `getVisitorContext` skips HEM lookup. Company data only.
- DSAR/right-to-be-forgotten handled by upstream Delivr graph. Plugin emits `cms.dsr_request` event when host calls `await deleteVisitor(hem)`.

## 13. Env vars

| Var                            | Required | Default                       | Purpose             |
| ------------------------------ | -------- | ----------------------------- | ------------------- |
| `DELIVR_PIXEL_ID`              | yes      | —                             | Public pixel ID     |
| `DELIVR_API_KEY`               | yes      | —                             | Server-only secret  |
| `DELIVR_DATA_API_URL`          | yes      | https://data-api.delivr.ai    | Resolution endpoint |
| `DELIVR_PIXEL_API_URL`         | no       | https://pixel.delivr.ai       | Event ingest        |
| `DELIVR_INTEGRATION_API_URL`   | no       | https://integration.delivr.ai | Audience sync       |
| `DELIVR_RESOLUTION_TIMEOUT_MS` | no       | 100                           | Hard timeout        |
| `DELIVR_CACHE_TTL_SECONDS`     | no       | 300                           | Resolution cache    |

## 14. Errors + observability

- All Delivr calls wrapped with `withRetry({ attempts: 2, backoffMs: 50 })`.
- Logs structured JSON via Payload logger.
- Metrics emitted (when host configures sink): `delivr.resolve.duration_ms`, `delivr.resolve.cache_hit`, `delivr.resolve.error`, `delivr.event.dispatched`.
- `/api/delivr/health` returns:
  ```json
  { "ok": true, "dataApi": "ok", "pixelApi": "ok", "lastAudienceSync": "..." }
  ```

## 15. Testing

- Unit: rule matcher, scorer, fallback selection (Vitest).
- Integration: mock `data-api`, assert RSC render output (Playwright + Next.js test harness).
- E2E: demo app `examples/nextjs-payload-demo` with seeded audiences, hits `/api/delivr/preview-as`.
- CI matrix: Payload 3.x, Next.js 15/16, Node 22.

## 16. Versioning

- SemVer. v0.x = pre-GA breaking changes.
- Compatibility matrix in README.
- Migration scripts in `packages/payload-plugin-delivr/migrations/` if schema changes.

## 17. Compatibility

| Dep        | Version  |
| ---------- | -------- |
| Payload    | ^3.0.0   |
| Next.js    | >=15.0.0 |
| React      | >=19.0.0 |
| Node       | >=22.0.0 |
| TypeScript | >=5.5    |
