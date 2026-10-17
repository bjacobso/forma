# Invoice ontology fit spike

This is an executable **subset experiment**, not an EN 16931 validator, a UBL
emitter, or the proposed benchmark. See [RFC 0018](../../docs/rfcs/0018-einvoice-slice.md)
for the exact proposed slice, rule allowlist, benchmark arms, and gaps.

`packages/ts/test/einvoice.test.ts` bootstraps the bundled compiler and ontology
preludes with this directory's local `prelude.lisp`. It elaborates `model.lisp`,
`parties.lisp`, `lines.lisp`, and one `cases/*.lisp` source as separate author
sources. There are no compiler changes or external-validator calls.

- `model.lisp` declares flat invoice, party, postal address, line, and VAT
  breakdown entities. Repeated groups are lists of entity IDs.
- `prelude.lisp` defines `invoice-seed`, reusing ontology seed schema/ID checks
  and canonical `RecordIR`. Its `:check` traverses referenced authored seed
  fields, with a diagnostic at the authored fields map (`:slot :fields`).
  For dynamic reflection lookups it uses the existing `meta/get` raw lookup;
  ordinary two-argument dictionary `get` returns an Option.
- Money is **Int EUR cents**, quantities are Int, and rates are Int basis
  points (2000 = 20%). S tax uses integer cross-products with exact cent
  results only. These are spike workarounds; they do not implement Decimal.
- `mixed` passes with 20% S, 5% S and Z lines, net 17500, tax 2250, due 19750.
  `zero` passes with a single Z line, net/due 2500 and tax 0. The shared seed
  library still contains the other available lines; only selected IDs are
  aggregated for each invoice.
- Negative seeds cover header presence/cardinality, required fields and IDs,
  BR-CO-10/13/14/15/16, S/Z group membership/cardinality, S/Z taxable bases,
  line rates, tax and forbidden exemption reasons/codes. `fractional-cent`
  deliberately rejects a standard-valid rounded tax result to pin the limit
  of the `BR-S-09-exact` subset.

The local checks include BR-01–16 presence, BR-CO-10/13–16/18,
BR-S-01/02/05/08/10, BR-Z-01/02/05/08–10, and the exact-cent subset of
BR-S-09. Required seed fields fail schema validation before domain checks run.
A stored `constraint` alone would not execute against these seeds during
elaboration, so this fixture uses `:check` hooks.

Missing library coverage includes full rounded tax, decimal prices/quantities,
line price calculations, date/code-list/VAT-prefix validation, all group
ownership/uniqueness checks, XML structure and serialization. Some need new
numeric/emitter support; many only need more prelude checks. No passing seed
here is claimed to be Peppol-valid XML.

## Commands and goldens

From the repository root after workspace setup:

```sh
pnpm --filter @formalang/ts exec vitest run test/einvoice.test.ts
FORMA_UPDATE_GOLDEN=1 pnpm --filter @formalang/ts exec vitest run test/einvoice.test.ts
```

The first command compares against stored expectations. The second rewrites
`expected/*.json`; review every diff. Ordinary `pnpm check` includes the tests.
The test also independently pins each negative case's rule sequence before it
allows golden generation, so an update cannot silently bless missing checks.

Initial golden review: ten new files; no existing expectations changed. Two
passing files retain all eleven canonical record payloads (including the
shared seed library) and no diagnostics. Eight negative files retain 28 error
diagnostics, with code/severity, source IDs, offsets, line/column spans, and the
exact authored fields-map excerpts. Diagnostic prose is omitted, as in the
surface golden normalization. Missing `:due` and a dangling line ID use two
existing `elaborate/hole-type` reports. The fractional-cent failure is an
intentional spike restriction, not an official Schematron failure. The
benchmark, Decimal, nested UBL shapes, and UBL emitter remain proposed.
