# payload-delivr-personalization

Delivr.ai identity + personalization plugin for PayloadCMS.

Resolves anonymous visitors to **company firmographics** (industry, revenue, employees, NAICS, technologies) and **contact identity** (email, title, seniority) via Delivr.ai's identity graph (6.5B vertices, 1.137B IP→company mappings, 4.564B emails). Then drives audience-conditional content rendering inside PayloadCMS — block swaps, field variants, role-based copy, intent-triggered modules.

## What it does

- Drops Delivr pixel into Next.js host app (Payload's frontend)
- Server-side resolves every request → `VisitorContext` (company + contact + audiences + intent)
- Injects `audienceRules` field into every Payload Block
- Provides RSC renderer that filters/scores variants
- Syncs Delivr audiences into Payload as a managed collection
- Mirrors variant performance rollups for inline admin analytics
- Webhook endpoint for inbound Delivr events

## Status

Alpha. Active build. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Docs

- [PRD](docs/PRD.md) — product requirements
- [SPEC](docs/SPEC.md) — integration spec, APIs, types
- [ARCHITECTURE](docs/ARCHITECTURE.md) — system design
- [ROADMAP](docs/ROADMAP.md) — phases + milestones

## Quick start

```bash
pnpm add @delivr/payload-plugin-delivr
```

```ts
// payload.config.ts
import { delivrPlugin } from "@delivr/payload-plugin-delivr";

export default buildConfig({
  plugins: [
    delivrPlugin({
      pixelId: process.env.DELIVR_PIXEL_ID!,
      apiKey: process.env.DELIVR_API_KEY!,
      dataApiUrl: process.env.DELIVR_DATA_API_URL!,
      enableBlockRules: true,
      enableVariantFields: true,
      enableAudienceSync: true,
    }),
  ],
});
```

```tsx
// app/[slug]/page.tsx
import {
  getVisitorContext,
  renderBlocks,
} from "@delivr/payload-plugin-delivr/server";

export default async function Page({ params }) {
  const ctx = await getVisitorContext();
  const page = await payload.findByID({ collection: "pages", id: params.slug });
  return <>{renderBlocks(page.layout, ctx)}</>;
}
```

## License

MIT
