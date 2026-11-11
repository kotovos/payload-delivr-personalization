# Rules and selection

**Status:** v1, 2026-11-11. Part of the spec. Read after [SPEC.md](SPEC.md).

Rules decide which content a resolved company sees. This file is exact on
purpose. Every case has one answer, and section 9 turns the cases into tests.

---

## 1. The rule

```ts
export interface AudienceRule {
  domains?: string[] | null; // named accounts
  naicsPrefixes?: string[] | null; // "52", "5415"
  industries?: string[] | null; // each value holds NAICS prefixes, e.g. "31_32_33"
  hqCountries?: string[] | null; // ISO 3166-1 alpha-2
}
```

`industries` exists so a CMS can offer a friendly select next to free-text
prefixes. It has no meaning of its own. Every run of 2 to 6 digits in a value
is one NAICS prefix, and the result is merged with `naicsPrefixes`.
`"31_32_33"` gives `31`, `32`, `33`. `"52"` gives `52`.

There is no industry map and no configuration for it.

## 2. Normalization

Applied before matching, to rule entries and to the company alike.

**Domain**, in this order:

1. Trim. Lowercase.
2. Remove a scheme: everything up to and including `://`.
3. Cut at the first `/`, `?` or `#`.
4. Remove a port: a final `:` followed by digits.
5. Remove one leading `www.`.
6. Remove one trailing `.`.

Valid when what is left has at least one dot and only letters, digits,
hyphens and dots. So `https://www.Acme.com/pricing?x=1` becomes `acme.com`.

**NAICS prefix.** Trim. Valid when it is 2 to 6 digits.

**`industries` value.** Valid when it contains at least one run of 2 to 6
digits.

**Country.** Trim. Uppercase. Valid when it is two letters A to Z.

**Entries.** For every rule field:

- `null`, `undefined` and entries that are blank after trimming are ignored.
- A non-blank entry that is not valid stays in the list as an entry that can
  never match.
- A field is **populated** when at least one entry is left, valid or not.

So an empty field restricts nothing, and a field holding only a typo matches
nobody. A typo must never widen the audience.

**Company side.** A `naics` that is not 2 to 6 digits and an `hqCountry` that
is not two letters are treated as absent.

A **condition** is a populated field. A rule has at most three:

| Condition | From                                     |
| --------- | ---------------------------------------- |
| Domain    | `domains`                                |
| NAICS     | `naicsPrefixes` and `industries`, merged |
| Country   | `hqCountries`                            |

`slot` (section 7) is never a condition.

## 3. Matching

- A rule with no conditions is **unconditional**. `undefined` and `null`
  rules are unconditional too. It matches every visitor, anonymous included.
- **Within a condition: OR.** Any one entry matching is enough.
- **Across conditions: AND.** Every condition of the rule must match.
- An **anonymous** visitor matches unconditional rules only.
- A condition on a field the company lacks does not match.

| Condition | Matches when                                       |
| --------- | -------------------------------------------------- |
| Domain    | The normalized company domain equals a valid entry |
| NAICS     | The company `naics` starts with a valid entry      |
| Country   | The company `hqCountry` equals a valid entry       |

Domain matching is exact. A rule for `acme.com` does not match a company
whose domain is `eu.acme.com`.

## 4. Specificity

When several rules match, the most specific wins.

| Matched condition | Score                                                |
| ----------------- | ---------------------------------------------------- |
| Domain            | 100                                                  |
| NAICS             | 10 plus the length of the longest entry that matched |
| Country           | 1                                                    |

Scores add. The maximum is 117. An unconditional rule scores 0. A named
account always beats an industry rule. A longer NAICS prefix beats a shorter
one. Ties go to author order: the earlier item wins.

## 5. `matchRule`

```ts
export function matchRule(
  rule: AudienceRule | null | undefined,
  ctx: VisitorContext,
): { matches: boolean; conditional: boolean; score: number };
```

Pure: no I/O, no hooks, never throws.

| Rule                  | Visitor  | Result                                            |
| --------------------- | -------- | ------------------------------------------------- |
| Unconditional         | anyone   | `{ matches: true, conditional: false, score: 0 }` |
| Conditional, matches  | resolved | `{ matches: true, conditional: true, score: n }`  |
| Conditional, no match | anyone   | `{ matches: false, conditional: true, score: 0 }` |

## 6. `selectVariant`

For choosing one of several pieces of content defined in code or in a CMS
field.

```ts
type SelectVariant = <T extends { id: string; rules?: AudienceRule | null }>(
  variants: T[],
  ctx: VisitorContext,
  meta?: { slot?: string },
) => T | undefined;
```

1. Among variants whose rule is conditional and matches, take the highest
   score. Ties: earliest.
2. Otherwise take the earliest unconditional variant.
3. Otherwise return `undefined`. The caller decides what to render.

An empty list returns `undefined`. `meta.slot` is only a label for the event.

## 7. `selectBlocks`

For filtering a list of blocks, such as a CMS page layout.

```ts
type BlockLike = {
  id?: string | null;
  audienceRules?: (AudienceRule & { slot?: string | null }) | null;
};

type SelectBlocks = <T extends BlockLike>(
  blocks: T[],
  ctx: VisitorContext,
) => T[];
```

It returns a new array, a subset of the input in the original order. It does
not render anything. The host passes the result to its own block renderer.

**It filters exactly the array it is given. It does not recurse.** A block
that contains its own list of blocks needs its own `selectBlocks` call where
the host renders that inner list. Slots are scoped to one call.

**Slot.** Trim the value. `undefined`, `null` and an empty string mean the
block has no slot. Slot names are case sensitive.

Blocks with no slot:

- Unconditional rule: kept.
- Conditional rule: kept only when it matches.

Blocks that share a slot compete. At most one is kept:

1. The block whose rule is conditional and matches, with the highest score.
   Ties: earliest.
2. Otherwise the earliest block in the slot with an unconditional rule. This
   is the slot's fallback.
3. Otherwise none.

The kept block stays at its own position. A block that has only a slot and no
conditions is unconditional, so it is a fallback candidate.

Example. Visitor from a bank, `naics: "522110"`:

| #   | Block      | slot   | Rule                    | Kept | Why                       |
| --- | ---------- | ------ | ----------------------- | ---- | ------------------------- |
| 1   | Hero A     | `hero` | none                    | no   | Slot fallback, not needed |
| 2   | Hero B     | `hero` | `naicsPrefixes: ["52"]` | yes  | Best match in slot `hero` |
| 3   | Logos      |        | none                    | yes  | Unconditional             |
| 4   | Health CTA |        | `naicsPrefixes: ["62"]` | no   | Conditional, no match     |

An anonymous visitor gets blocks 1 and 3.

This replaces `renderBlocks` from the old draft, which grouped by block index
by default. Every block was its own group, so nothing was ever filtered.

## 8. `SelectEvent`

```ts
export interface SelectEvent {
  kind: "variant" | "slot" | "block";
  slot?: string; // for "variant": meta.slot. for "slot": the slot name
  selectedId?: string; // "variant" and "slot": id of the chosen item, if any
  blockId?: string; // "block": id of the block evaluated, if it has one
  matched: boolean; // see below
  score: number; // score of the chosen or evaluated rule, else 0
  anonymous: boolean;
  companyDomain?: string;
}
```

| Call            | Events                                                             | `matched` means                           |
| --------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| `selectVariant` | One, `kind: "variant"`                                             | The chosen item won by a conditional rule |
| `selectBlocks`  | One per distinct slot, `kind: "slot"`                              | The kept block won by a conditional rule  |
| `selectBlocks`  | One per block with a conditional rule and no slot, `kind: "block"` | The rule matched, so the block was kept   |

- Unconditional blocks with no slot produce no event.
- When nothing is chosen, `selectedId` is absent and `matched` is false.
- An item with no `id` produces an event with no id. Hosts that want
  attribution supply ids. Payload blocks always have one.
- Events fire when the selector runs, not when something renders. Call each
  selector once per request for a given list, or exposure counts double.
- A host may run a selector and render something else, to observe what would
  have been shown. The event is the same.

## 9. Test tables

Company A: `domain: "acme.com"`, `naics: "522110"`, `hqCountry: "US"`.
Company B: `domain: "globex.com"`, no `naics`, no `hqCountry`.

| #   | Rule                                                                        | Visitor   | Matches | Score |
| --- | --------------------------------------------------------------------------- | --------- | ------- | ----- |
| 1   | `undefined`                                                                 | anonymous | yes     | 0     |
| 2   | `{}`                                                                        | anonymous | yes     | 0     |
| 3   | `{ domains: null, naicsPrefixes: [] }`                                      | A         | yes     | 0     |
| 4   | `{ naicsPrefixes: ["", "  "] }`                                             | A         | yes     | 0     |
| 5   | `{ naicsPrefixes: ["5 2", "abc"] }`                                         | A         | no      | 0     |
| 6   | `{ naicsPrefixes: ["abc", "52"] }`                                          | A         | yes     | 12    |
| 7   | `{ domains: ["acme.com"] }`                                                 | anonymous | no      | 0     |
| 8   | `{ domains: ["acme.com"] }`                                                 | A         | yes     | 100   |
| 9   | `{ domains: [" WWW.Acme.com. "] }`                                          | A         | yes     | 100   |
| 10  | `{ domains: ["https://www.acme.com/pricing?x=1"] }`                         | A         | yes     | 100   |
| 11  | `{ domains: ["acme.com:443"] }`                                             | A         | yes     | 100   |
| 12  | `{ domains: ["acme"] }`                                                     | A         | no      | 0     |
| 13  | `{ domains: ["eu.acme.com"] }`                                              | A         | no      | 0     |
| 14  | `{ naicsPrefixes: ["52"] }`                                                 | A         | yes     | 12    |
| 15  | `{ naicsPrefixes: ["52", "5221"] }`                                         | A         | yes     | 14    |
| 16  | `{ naicsPrefixes: ["62", "52"] }`                                           | A         | yes     | 12    |
| 17  | `{ industries: ["31_32_33"] }`                                              | A         | no      | 0     |
| 18  | `{ industries: ["finance"] }`                                               | A         | no      | 0     |
| 19  | `{ industries: ["52"], naicsPrefixes: ["62"] }`                             | A         | yes     | 12    |
| 20  | `{ naicsPrefixes: ["52"] }`                                                 | B         | no      | 0     |
| 21  | `{ hqCountries: ["us"] }`                                                   | A         | yes     | 1     |
| 22  | `{ naicsPrefixes: ["52"], hqCountries: ["DE"] }`                            | A         | no      | 0     |
| 23  | `{ naicsPrefixes: ["52"], hqCountries: ["US"] }`                            | A         | yes     | 13    |
| 24  | `{ domains: ["acme.com"], naicsPrefixes: ["522110"], hqCountries: ["US"] }` | A         | yes     | 117   |
| 25  | `{ domains: ["acme.com"], naicsPrefixes: ["62"] }`                          | A         | no      | 0     |

Rows 3 and 4 are unconditional: only blanks, so nothing is populated. Rows 5,
12 and 18 are populated by invalid entries, so they match nobody.

Selector cases:

| #   | Case                                                | Expected                         |
| --- | --------------------------------------------------- | -------------------------------- |
| S1  | `selectVariant([])`                                 | `undefined`, one event, no id    |
| S2  | Two matching variants, scores 12 and 100            | The 100                          |
| S3  | Two matching variants, equal score                  | The earlier one                  |
| S4  | No conditional match, two unconditional variants    | The earlier unconditional        |
| S5  | No conditional match, no unconditional variant      | `undefined`                      |
| S6  | `selectBlocks`: the section 7 example, bank visitor | Blocks 2 and 3                   |
| S7  | Same, anonymous visitor                             | Blocks 1 and 3                   |
| S8  | Slot with conditional blocks only, none matching    | No block from that slot          |
| S9  | Blocks with `slot: ""`, `slot: null`, `slot: "  "`  | All treated as no slot           |
| S10 | Slots `Hero` and `hero`                             | Two separate slots               |
| S11 | Output order                                        | Same relative order as the input |
| S12 | A block with a nested block list carrying rules     | Inner list untouched             |
