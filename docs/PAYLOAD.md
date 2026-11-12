# PayloadCMS layer

**Status:** v1, 2026-11-11. Part of the spec. Read after [RULES.md](RULES.md).

`@delivr/payload-plugin-delivr` adds one field group to the blocks a host
chooses. It adds nothing else in v1: no collections, no endpoints, no jobs.
Resolution and selection are the core's job.

This layer is not on the dogfood critical path. The first deployment target
has no CMS. See the ROADMAP.

Statements about Payload behavior below are from the Payload 3 documentation
as understood at writing time. Section 6 says how they get confirmed.

---

## 1. Usage

```ts
// payload.config.ts
import { delivrPlugin } from "@delivr/payload-plugin-delivr";

export default buildConfig({
  plugins: [delivrPlugin({ blocks: { include: ["hero", "cta"] } })],
});
```

```ts
export interface DelivrPayloadOptions {
  blocks: { include: string[] }; // block slugs that receive audienceRules
  industryOptions?: { label: string; value: string }[]; // default: section 4
  countryOptions?: { label: string; value: string }[]; // default: section 4
}
```

## 2. Injection rules

- **Opt-in by block slug.** Only slugs listed in `blocks.include` are touched.
  Each injected field changes that block's schema, which on a SQL adapter
  means a migration. The host chooses where that cost is paid.
- **Where blocks are found.** The plugin walks the field trees of every
  collection and global and visits every `blocks` field at any depth: inside
  tabs, groups, arrays, rows, collapsibles and other blocks.
- **Unknown slug.** If a slug in `include` matches no block anywhere, the
  plugin throws while the config is built, naming the slug. This is a
  programming error and should stop the boot. The lookup must cover every
  place the pinned Payload version lets a block be declared (P2 in section
  6). Until P2 is answered, treat this rule as provisional.
- **Idempotent.** The injected group carries a marker,
  `custom: { delivrAudienceRules: true }`. A block definition that already
  has the marked field is left alone. That covers one block object referenced
  from several places, and repeated config builds during hot reload.
- **Name collision.** A block that has a field named `audienceRules` without
  the marker has a field of the host's own. The plugin throws while the
  config is built, naming the block. It never reuses, extends or overwrites a
  host field, because editors would then not get the documented fields.
- **Empty `include`.** The plugin does nothing.

Injection can reach nested blocks. Selection does not recurse (RULES.md
section 7). A host that puts rules on nested blocks calls `selectBlocks` on
that inner list where it renders it.

## 3. The field

```ts
{
  name: "audienceRules",
  type: "group",
  admin: { description: "Leave empty to show this block to everyone." },
  fields: [
    { name: "slot", type: "text" },
    { name: "domains", type: "text", hasMany: true },
    { name: "industries", type: "select", hasMany: true, options: industryOptions },
    { name: "naicsPrefixes", type: "text", hasMany: true },
    { name: "hqCountries", type: "select", hasMany: true, options: countryOptions },
  ],
}
```

Stored data may hold `null` for an empty list and an empty string for an
empty text field. The core treats both as not set (RULES.md section 2).

**Cleaning on save.** A `beforeValidate` field hook trims `slot` and works
through `domains` and `naicsPrefixes` in this order:

1. Remove entries that are blank. Blank means empty after trimming what the
   editor typed, before any other step.
2. Normalize each remaining entry (RULES.md section 2). A pasted
   `https://www.acme.com/pricing` becomes `acme.com`.
3. If normalization leaves an entry empty or invalid, keep it exactly as
   typed. `https://` is the example: it is not blank, and normalizing it
   leaves nothing.

Step 3 matters. Dropping such an entry would empty the field, and an empty
field shows the block to everyone. Keeping it lets validation reject it.

The stored value is normalized here, and the core normalizes it again at
match time. That is safe because normalization is idempotent (RULES.md
section 2): `www.www.acme.com` is stored as `acme.com`, and normalizing
`acme.com` again gives `acme.com`.

**Validation.** After cleaning:

| Field           | Rule                                        | Message to the editor              |
| --------------- | ------------------------------------------- | ---------------------------------- |
| `domains`       | Each entry looks like a hostname with a dot | "Enter a domain like acme.com"     |
| `naicsPrefixes` | Each entry is 2 to 6 digits                 | "NAICS prefixes are 2 to 6 digits" |

An entry that is still invalid after cleaning is rejected, so it cannot be
saved. The core applies the same normalization at match time. Invalid data
that reaches it another way matches nobody (RULES.md section 2).

## 4. Default options

**`industryOptions`.** The NAICS sectors. The value holds the sector's
two-digit codes. Values use underscores so they stay valid as database enum
values and API names.

| Label                                            | Value      |
| ------------------------------------------------ | ---------- |
| Agriculture, Forestry, Fishing and Hunting       | `11`       |
| Mining, Quarrying, and Oil and Gas Extraction    | `21`       |
| Utilities                                        | `22`       |
| Construction                                     | `23`       |
| Manufacturing                                    | `31_32_33` |
| Wholesale Trade                                  | `42`       |
| Retail Trade                                     | `44_45`    |
| Transportation and Warehousing                   | `48_49`    |
| Information                                      | `51`       |
| Finance and Insurance                            | `52`       |
| Real Estate and Rental and Leasing               | `53`       |
| Professional, Scientific, and Technical Services | `54`       |
| Management of Companies and Enterprises          | `55`       |
| Administrative and Support Services              | `56`       |
| Educational Services                             | `61`       |
| Health Care and Social Assistance                | `62`       |
| Arts, Entertainment, and Recreation              | `71`       |
| Accommodation and Food Services                  | `72`       |
| Other Services                                   | `81`       |
| Public Administration                            | `92`       |

A host that overrides `industryOptions` only has to keep NAICS digits in each
value. Nothing else needs to agree with the core, because the core reads the
digits straight from the stored value.

**`countryOptions`.** The ISO 3166-1 alpha-2 list. Value is the uppercase
code, label is the English short name. The plugin ships the list as a static
file.

## 5. Rendering

Same calls as any other host. `delivr` is the instance from SPEC section 3.

```tsx
const ctx = await getVisitor();
return <RenderBlocks blocks={delivr.selectBlocks(page.layout, ctx)} />;
```

Fetch the page with the depth the renderer needs. `selectBlocks` only reads
`id` and `audienceRules` from each block.

## 6. Version pin and confirmations

Phase E pins one exact Payload 3.x version and records it in SPEC section 16.
Against that version, confirm each of these and correct this file where
reality differs:

| #   | To confirm                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------ |
| P1  | The plugin signature and the shape of collection, global and block configs                                   |
| P2  | Whether blocks can be declared once at config level and referenced by slug. If so, the walk covers those too |
| P3  | `hasMany` on `text` fields                                                                                   |
| P4  | Allowed characters in `select` option values, on the SQL adapters and in GraphQL                             |
| P5  | What an empty `hasMany` field and an empty text field come back as                                           |
| P6  | That `beforeValidate` field hooks run inside a group injected into a block                                   |
| P7  | That a field accepts a `custom` property the plugin can read back at config time                             |

## 7. Not in v1

- Field-level variant helper
- Admin badges and preview-as
- Any collection, endpoint or job
- Pixel installation
