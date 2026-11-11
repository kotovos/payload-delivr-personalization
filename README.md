# payload-delivr-personalization

Delivr.ai personalization for Next.js and PayloadCMS.

Resolves a visitor's IP address to a company through Delivr.ai entity
resolution, then picks which content variant or block to render for that
company. Works in a plain Next.js app and in a PayloadCMS site.

## Status

**Design complete for v1. No functionality is built yet.**

The repository holds a no-op plugin stub and the design docs. The one backend
dependency, the Visitor Resolve API, is specified but does not exist yet.

v1 is an internal dogfood. Nothing is published to npm.

## Docs

Read in this order:

1. [PRD](docs/PRD.md): decisions, scope, how success is measured
2. [SPEC](docs/SPEC.md): the core package, behavior by behavior
3. [CLIENT-IP](docs/CLIENT-IP.md): finding and checking the visitor's address
4. [RULES](docs/RULES.md): rule matching and the two selectors
5. [RESOLVE-API](docs/RESOLVE-API.md): the backend contract
6. [PAYLOAD](docs/PAYLOAD.md): the PayloadCMS layer
7. [ARCHITECTURE](docs/ARCHITECTURE.md): request flow, failure modes
8. [ROADMAP](docs/ROADMAP.md): phases, exit criteria, existing issues

## What v1 does

- Server-side: one call returns the visitor's company, or an anonymous context
- Rules on named accounts (domain), industry (NAICS) and HQ country
- `selectVariant` and `selectBlocks` choose content from those rules
- A PayloadCMS plugin adds an `audienceRules` field to the blocks you choose
- Hard 100 ms cap on added latency. Default content on any failure

## What v1 does not do

Contact identity, audience sync, intent, webhooks, form pre-fill and analytics
ingest are deferred. See SPEC section 17.

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
  clientIp: { forwardedFor: { trustedProxies: 1 } },
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
  { id: "default", headline: "For everyone" },
];

export default async function Page() {
  const ctx = await getVisitor();
  const hero = delivr.selectVariant(heroes, ctx, { slot: "platform-hero" });
  return <h1>{hero?.headline}</h1>;
}
```

`trustedProxies` must match the proxy chain in front of your app. There is no
default. See [CLIENT-IP](docs/CLIENT-IP.md).

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
