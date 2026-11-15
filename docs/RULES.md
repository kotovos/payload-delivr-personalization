# Rules and selection

**Status:** v1, 2026-11-12. Part of the spec. Read after [SPEC.md](SPEC.md).

Rules decide which content a resolved visitor sees. This file is exact on
purpose. Every case has one answer, and section 9 turns the cases into tests.

---

## 1. The rule

```ts
export interface AudienceRule {
  // company
  domains?: string[] | null; // named accounts
  naicsPrefixes?: string[] | null; // "52", "5415"
  industries?: string[] | null; // each value holds NAICS prefixes, e.g. "31_32_33"
  companyCountries?: string[] | null; // ISO 3166-1 alpha-2
  // person
  seniorities?: string[] | null; // "cxo", "vp", "director", "manager", "staff"
  departments?: string[] | null; // "finance", "information technology"
}
```

`industries` exists so a CMS can offer a friendly select next to free-text
prefixes. It has no meaning of its own. A value is one or more NAICS prefixes
joined by underscores, and the prefixes are merged with `naicsPrefixes`.
`"31_32_33"` gives `31`, `32`, `33`. `"52"` gives `52`. A label such as
`"tech_2024"` is not a valid value.

There is no industry map and no configuration for it.

## 2. Normalization

Applied before matching, to rule entries and to the visitor alike.

**Domain**, in this order:

1. Trim. Lowercase.
2. Remove a scheme: if `://` occurs before any `/`, `?` or `#`, remove
   everything up to and including that first `://`.
3. Cut at the first `/`, `?` or `#`.
4. Remove a port: a final `:` followed by digits.
5. Remove every trailing `.`.
6. Remove a leading `www.`, and repeat, for as long as what remains still
   contains a dot. `www.www.acme.com` becomes `acme.com`. `www.com` stays
   `www.com`.

Valid when what is left is at most 253 characters and splits on `.` into at
least two labels, each 1 to 63 characters of letters, digits and hyphens, not
starting or ending with a hyphen. So `https://www.Acme.com/pricing?x=1`
becomes `acme.com`, and `a..b`, `.com` and `-.-` are invalid.

Normalization is **idempotent**: applied to its own valid output, it changes
nothing. That is required, not incidental. A CMS may store the normalized
value, and the core normalizes again at match time. Both must reach the same
value. The same holds for every normalization in this section.

**NAICS prefix.** Trim. Valid when it is 2 to 6 digits.

**`industries` value.** Trim. Valid when it is 2 to 6 digits, or several such
groups joined by single underscores.

**Country.** Trim. Uppercase. Valid when it is two letters A to Z.

**Seniority.** Trim. Lowercase. Valid when it is one of `cxo`, `vp`,
`director`, `manager`, `staff`.

**Department.** Trim. Lowercase. Replace each run of spaces, underscores and
hyphens with one space. Trim again. Valid when 1 to 100 characters remain. So
`Human_Resources` and `human-resources` both become `human resources`.

**Entries.** For every rule field:

- `null`, `undefined` and entries that are blank are ignored. Blank means
  empty after trimming the entry as written, before any other step.
- Every other entry stays in the list. If it is not valid after
  normalization, it stays as an entry that can never match. `https://` is not
  blank as written, so it stays, even though normalization leaves nothing.
- A field is **populated** when at least one entry is left, valid or not.

So an empty field restricts nothing, and a field holding only a typo matches
nobody. A typo must never widen the audience.

**Visitor side.** A `naics` that is not 2 to 6 digits and a `country` that is
not two letters are treated as absent. `department` is normalized as above.

A **condition** is a populated field. A rule has at most five:

| Condition       | From                                     | Side    |
| --------------- | ---------------------------------------- | ------- |
| Domain          | `domains`                                | company |
| NAICS           | `naicsPrefixes` and `industries`, merged | company |
| Company country | `companyCountries`                       | company |
| Seniority       | `seniorities`                            | person  |
| Department      | `departments`                            | person  |

`slot` (section 7) is never a condition.

## 3. Matching

- A rule with no conditions is **unconditional**. `undefined` and `null`
  rules are unconditional too. It matches every visitor, anonymous included.
- **Within a condition: OR.** Any one entry matching is enough.
- **Across conditions: AND.** Every condition of the rule must match.
- An **anonymous** visitor matches unconditional rules only.
- A condition on a field the visitor lacks does not match. A company condition
  never matches a visitor with no company, and a person condition never
  matches a visitor with no person.

| Condition       | Matches when                                            |
| --------------- | ------------------------------------------------------- |
| Domain          | The normalized company domain equals a valid entry      |
| NAICS           | The company `naics` starts with a valid entry           |
| Company country | The company `country` equals a valid entry              |
| Seniority       | The person `seniority` equals a valid entry             |
| Department      | The normalized person `department` equals a valid entry |

Domain matching is exact. A rule for `acme.com` does not match a company
whose domain is `eu.acme.com`. Department matching is exact after
normalization. `it` does not match `information technology`.

## 4. Specificity

When several rules match, the most specific wins. Rules are compared on five
things, in this order:

1. Did a domain condition match?
2. How long is the longest NAICS entry that matched? No NAICS condition
   counts as 0.
3. Did a department condition match?
4. Did a seniority condition match?
5. Did a company country condition match?

The score puts that order into one number:

| Matched condition | Score                                             |
| ----------------- | ------------------------------------------------- |
| Domain            | 1000                                              |
| NAICS             | 10 times the length of the longest matching entry |
| Department        | 4                                                 |
| Seniority         | 2                                                 |
| Company country   | 1                                                 |

Scores add. NAICS contributes 20 to 60. The maximum is 1067. An unconditional
rule scores 0.

The weights make the order strict, across rules and not only within one,
because each weight is larger than the sum of every weight below it:

- A named account beats every rule without one.
- Otherwise the longer matching NAICS prefix wins, whatever else the rules
  contain. `naicsPrefixes: ["522"]` scores 30 and beats
  `naicsPrefixes: ["52"], departments: ["finance"], seniorities: ["vp"]` at 26.
- Department, then seniority, then country separate rules that are otherwise
  equal.

Ties go to author order: the earlier item wins.

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

Example. A visitor who is a finance VP at a bank: company `naics: "522110"`,
person `seniority: "vp"`, `department: "finance"`.

| #   | Block      | slot   | Rule                         | Kept | Why                                 |
| --- | ---------- | ------ | ---------------------------- | ---- | ----------------------------------- |
| 1   | Hero A     | `hero` | none                         | no   | Slot fallback, not needed           |
| 2   | Hero B     | `hero` | `naicsPrefixes: ["52"]`      | yes  | Best match in slot `hero`, score 20 |
| 3   | Hero C     | `hero` | `departments: ["finance"]`   | no   | Matches, but 4 is below 20          |
| 4   | Logos      |        | none                         | yes  | Unconditional                       |
| 5   | Exec CTA   |        | `seniorities: ["cxo", "vp"]` | yes  | Conditional, matches                |
| 6   | Health CTA |        | `naicsPrefixes: ["62"]`      | no   | Conditional, no match               |

An anonymous visitor gets blocks 1 and 4.

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
}
```

The event carries no attribute of the visitor, company or person. Exposure by
slot and variant id is enough for v1 (PRD M9).

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

Visitor A: company `domain: "acme.com"`, `naics: "522110"`, `country: "US"`;
person `seniority: "vp"`, `department: "finance"`.
Visitor B: company `domain: "globex.com"`, no `naics`, no `country`; no person.
Visitor C: no company; person `seniority: "director"`,
`department: "information technology"`.

| #   | Rule                                                                                                                            | Visitor   | Matches | Score |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | --------- | ------- | ----- |
| 1   | `undefined`                                                                                                                     | anonymous | yes     | 0     |
| 2   | `{}`                                                                                                                            | anonymous | yes     | 0     |
| 3   | `{ domains: null, naicsPrefixes: [] }`                                                                                          | A         | yes     | 0     |
| 4   | `{ naicsPrefixes: ["", "  "] }`                                                                                                 | A         | yes     | 0     |
| 5   | `{ naicsPrefixes: ["5 2", "abc"] }`                                                                                             | A         | no      | 0     |
| 6   | `{ naicsPrefixes: ["abc", "52"] }`                                                                                              | A         | yes     | 20    |
| 7   | `{ domains: ["acme.com"] }`                                                                                                     | anonymous | no      | 0     |
| 8   | `{ domains: ["acme.com"] }`                                                                                                     | A         | yes     | 1000  |
| 9   | `{ domains: [" WWW.Acme.com. "] }`                                                                                              | A         | yes     | 1000  |
| 10  | `{ domains: ["https://www.acme.com/pricing?x=1"] }`                                                                             | A         | yes     | 1000  |
| 11  | `{ domains: ["acme.com:443"] }`                                                                                                 | A         | yes     | 1000  |
| 12  | `{ domains: ["acme"] }`                                                                                                         | A         | no      | 0     |
| 13  | `{ domains: ["eu.acme.com"] }`                                                                                                  | A         | no      | 0     |
| 14  | `{ naicsPrefixes: ["52"] }`                                                                                                     | A         | yes     | 20    |
| 15  | `{ naicsPrefixes: ["52", "5221"] }`                                                                                             | A         | yes     | 40    |
| 16  | `{ naicsPrefixes: ["62", "52"] }`                                                                                               | A         | yes     | 20    |
| 17  | `{ industries: ["31_32_33"] }`                                                                                                  | A         | no      | 0     |
| 18  | `{ industries: ["finance"] }`                                                                                                   | A         | no      | 0     |
| 19  | `{ industries: ["52"], naicsPrefixes: ["62"] }`                                                                                 | A         | yes     | 20    |
| 20  | `{ naicsPrefixes: ["52"] }`                                                                                                     | B         | no      | 0     |
| 21  | `{ companyCountries: ["us"] }`                                                                                                  | A         | yes     | 1     |
| 22  | `{ naicsPrefixes: ["52"], companyCountries: ["DE"] }`                                                                           | A         | no      | 0     |
| 23  | `{ naicsPrefixes: ["52"], companyCountries: ["US"] }`                                                                           | A         | yes     | 21    |
| 24  | `{ domains: ["acme.com"], naicsPrefixes: ["522110"], companyCountries: ["US"] }`                                                | A         | yes     | 1061  |
| 25  | `{ domains: ["acme.com"], naicsPrefixes: ["62"] }`                                                                              | A         | no      | 0     |
| 26  | `{ domains: ["https://"] }`                                                                                                     | A         | no      | 0     |
| 27  | `{ naicsPrefixes: ["522"] }`                                                                                                    | A         | yes     | 30    |
| 28  | `{ domains: ["www.www.acme.com"] }`                                                                                             | A         | yes     | 1000  |
| 29  | `{ domains: ["acme.com.."] }`                                                                                                   | A         | yes     | 1000  |
| 30  | `{ seniorities: ["vp"] }`                                                                                                       | A         | yes     | 2     |
| 31  | `{ seniorities: [" VP "] }`                                                                                                     | A         | yes     | 2     |
| 32  | `{ seniorities: ["ceo"] }`                                                                                                      | A         | no      | 0     |
| 33  | `{ seniorities: ["vp"] }`                                                                                                       | B         | no      | 0     |
| 34  | `{ departments: ["finance"] }`                                                                                                  | A         | yes     | 4     |
| 35  | `{ departments: ["Information_Technology"] }`                                                                                   | C         | yes     | 4     |
| 36  | `{ departments: ["it"] }`                                                                                                       | C         | no      | 0     |
| 37  | `{ seniorities: ["director"], departments: ["information technology"] }`                                                        | C         | yes     | 6     |
| 38  | `{ naicsPrefixes: ["52"], seniorities: ["director"] }`                                                                          | C         | no      | 0     |
| 39  | `{ departments: ["finance"], companyCountries: ["US"] }`                                                                        | A         | yes     | 5     |
| 40  | `{ domains: ["acme.com"], naicsPrefixes: ["522110"], companyCountries: ["US"], seniorities: ["vp"], departments: ["finance"] }` | A         | yes     | 1067  |
| 41  | `{ seniorities: ["vp"] }`                                                                                                       | anonymous | no      | 0     |
| 42  | `{ industries: ["tech_2024"] }`                                                                                                 | A         | no      | 0     |
| 43  | `{ domains: ["acme..com"] }`                                                                                                    | A         | no      | 0     |
| 44  | `{ domains: [".acme.com"] }`                                                                                                    | A         | no      | 0     |
| 45  | `{ domains: ["acme.com/go?u=https://x.com"] }`                                                                                  | A         | yes     | 1000  |

Rows 3 and 4 are unconditional: only blanks, so nothing is populated. Rows 5,
12, 18, 26, 32, 42, 43 and 44 are populated by invalid entries, so they match
nobody.
Row 36 is a valid entry that is simply a different department.

Selector cases:

| #   | Case                                                                                                                 | Expected                         |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| S1  | `selectVariant([])`                                                                                                  | `undefined`, one event, no id    |
| S2  | Two matching variants, scores 20 and 1000                                                                            | The 1000                         |
| S3  | Two matching variants, equal score                                                                                   | The earlier one                  |
| S4  | No conditional match, two unconditional variants                                                                     | The earlier unconditional        |
| S5  | No conditional match, no unconditional variant                                                                       | `undefined`                      |
| S6  | `selectBlocks`: the section 7 example, finance VP at a bank                                                          | Blocks 2, 4 and 5                |
| S7  | Same, anonymous visitor                                                                                              | Blocks 1 and 4                   |
| S8  | Same, visitor C                                                                                                      | Blocks 1 and 4                   |
| S9  | Slot with conditional blocks only, none matching                                                                     | No block from that slot          |
| S10 | Blocks with `slot: ""`, `slot: null`, `slot: "  "`                                                                   | All treated as no slot           |
| S11 | Slots `Hero` and `hero`                                                                                              | Two separate slots               |
| S12 | Output order                                                                                                         | Same relative order as the input |
| S13 | A block with a nested block list carrying rules                                                                      | Inner list untouched             |
| S14 | Row 23's rule first, row 27's rule second, visitor A                                                                 | Row 27's rule, 30 over 21        |
| S15 | `{ seniorities: ["vp"], departments: ["finance"], companyCountries: ["US"] }` first, row 14's rule second, visitor A | Row 14's rule, 20 over 7         |
