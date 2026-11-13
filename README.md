# payload-delivr-personalization

Delivr.ai personalization for Next.js and PayloadCMS.

Reads the Delivr pixel cookie a visitor's browser already carries, learns the
visitor's role and company from Delivr.ai, then picks which content variant or
block to render. Works in a plain Next.js app and in a PayloadCMS site.

## How it works

1. The site runs the Delivr pixel. The pixel sets a visitor cookie, and Delivr
   attaches the visitor's hashed email to it within seconds.
2. On a later page request, the site's server reads that cookie and asks the
   Visitor Resolve API who it belongs to.
3. The answer is a role and a company: seniority, department, company domain,
   NAICS code, company country. Never an email, a name or any identifier.
4. Rules written by developers or editors pick the content.

The first page view of a brand-new browser always gets default content,
because the cookie does not exist yet when that page renders.

## Status

**Design ready for review for v1. No functionality is built yet.**

The repository holds a no-op plugin stub and the design docs. The one backend
dependency, the Visitor Resolve API, is specified but does not exist yet. The
two lookups behind it already exist inside Delivr.

v1 is an internal dogfood. Nothing is published to npm.

## Docs

Read in this order:

1. [PRD](docs/PRD.md): decisions, scope, how success is measured
2. [SPEC](docs/SPEC.md): the core package, behavior by behavior
3. [IDENTITY](docs/IDENTITY.md): the pixel cookie, consent, GPC, CDN rules
4. [RULES](docs/RULES.md): rule matching and the two selectors
5. [RESOLVE-API](docs/RESOLVE-API.md): the backend contract
6. [PAYLOAD](docs/PAYLOAD.md): the PayloadCMS layer
7. [ARCHITECTURE](docs/ARCHITECTURE.md): request flow, failure modes
8. [ROADMAP](docs/ROADMAP.md): phases, exit criteria, existing issues

## What v1 does

- Server-side: one call returns the visitor's role and company, or an
  anonymous context
- Rules on named accounts (domain), industry (NAICS), company country,
  seniority and department
- `selectVariant` and `selectBlocks` choose content from those rules
- A PayloadCMS plugin adds an `audienceRules` field to the blocks you choose
- Honors Global Privacy Control and the site's own consent check
- Hard 100 ms cap on added latency. Default content on any failure

## What v1 does not do

IP address resolution, first-page-view personalization, showing the visitor's
own details, audience sync, intent, webhooks, form pre-fill and analytics
ingest. See SPEC section 18.

## Planned usage

Not implemented yet. This is the target API.

Plain Next.js:

```ts
// lib/delivr.ts
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createDelivr } from "@delivr/personalization";

export const delivr = createDelivr({
  enabled: process.env.DELIVR_ENABLED !== "false",
  resolveUrl: process.env.DELIVR_RESOLVE_URL,
  resolveKey: process.env.DELIVR_RESOLVE_KEY,
  pixelId: process.env.DELIVR_PIXEL_ID,
  consent: (headers) => hasMarketingConsent(headers), // your site's check
  visitorCountry: (headers) => headers.get("x-edge-country"), // set by your edge
});

export const getVisitor = cache(async () =>
  delivr.getVisitorContext(await headers()),
);
```

```tsx
// app/platform/page.tsx
import { delivr, getVisitor } from "@/lib/delivr";

const heroes = [
  { id: "finance", rules: { naicsPrefixes: ["52"] }, headline: "For banks" },
  {
    id: "cfo",
    rules: { seniorities: ["cxo"], departments: ["finance"] },
    headline: "For CFOs",
  },
  { id: "default", headline: "For everyone" },
];

export default async function Page() {
  const ctx = await getVisitor();
  const hero = delivr.selectVariant(heroes, ctx, { slot: "platform-hero" });
  return <h1>{hero?.headline}</h1>;
}
```

The site's pixel cookie must be first-party, and the CDN must forward it to
the origin. See [IDENTITY](docs/IDENTITY.md).

PayloadCMS:

```ts
// payload.config.ts
import { delivrPlugin } from "@delivr/payload-plugin-delivr";

export default buildConfig({
  plugins: [delivrPlugin({ blocks: { include: ["hero", "cta"] } })],
});
```

```tsx
// app/[slug]/page.tsx
const ctx = await getVisitor();
return <RenderBlocks blocks={delivr.selectBlocks(page.layout, ctx)} />;
```

## License

MIT
