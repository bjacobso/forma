# RFC 0018: EN 16931 / Peppol invoice slice

| | |
| --- | --- |
| Status | Proposed; benchmark, production prelude, Decimal, nested UBL shapes, and UBL emission not implemented |
| Created | 2026-10-17 |
| Scope | One EN 16931 invoice under Peppol BIS Billing 3.0, S/Z VAT, a three-arm benchmark, and prerequisites |
| Direction | Establish a bounded executable invoice vocabulary, then compare it with an agent using the official validator in a repair loop |

## Summary

Use the EN 16931 core invoice, bound to UBL by Peppol BIS Billing 3.0, to test
whether an executable ontology helps an agent produce correct regulated output.
The external judge is OpenPeppol's published Schematron, not a validator written
for Forma. **Beating an agent with documents alone proves little.** The useful
baseline has those same documents and the official validator in a repair loop.

The benchmark and production invoice prelude in this RFC are proposals. The
accompanying [fit spike](https://github.com/bjacobso/forma/blob/main/conformance/einvoice/README.md) exercises today's
ontology entities, ID references, seed schema checks, and prelude `:check`
hooks. It produces canonical records and author-located diagnostics. It emits
no XML, invokes no Peppol validator, and establishes no Peppol conformance or
benchmark result. Money in the spike is **Int minor units (EUR cents)**, a
spike-only workaround; it is not a Decimal implementation.

## Motivation and external authority

Invoices put several difficult behaviors in one small domain: repeated lines,
category-dependent requirements, sums across groups, and rounded tax arithmetic.
A syntactically plausible invoice can be financially inconsistent. EU
e-invoicing adoption gives a practical reason to test this domain, but this RFC
makes no claim to cover any country's mandate or tax advice.

Use the public [Peppol BIS Billing 3.0 documentation](https://docs.peppol.eu/poacc/billing/3.0/),
[UBL Invoice binding](https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/tree/),
[EN 16931 rules](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-tc434/), and
[Peppol rules](https://docs.peppol.eu/poacc/billing/3.0/rules/ubl-peppol/).
The public binding supplies the BT/BG mapping used here; implementing this
slice does not require reproducing the EN PDF.

The inspected baseline is the **May 2026 release**, retrieved 2026-10-17.
The unversioned URLs can change. Before running a benchmark, archive the
release, all includes, code lists, UBL schemas, processor version, and checksums:

| Official file | SHA-256 of inspected bytes |
| --- | --- |
| [CEN-EN16931-UBL.sch](https://docs.peppol.eu/poacc/billing/3.0/files/CEN-EN16931-UBL.sch) | `268d4f7a2688676695e6c69cba6fba69a6802604fee12cb544a6b30ff09555a3` |
| [PEPPOL-EN16931-UBL.sch](https://docs.peppol.eu/poacc/billing/3.0/files/PEPPOL-EN16931-UBL.sch) | `62e5b67892f12755352d78b06f63229a02cc2eccc748677c56efbc8dbcb336e3` |

Both the CEN and Peppol rules must run. A pass means well-formed XML, valid UBL
structure, and no fatal assertions from either official rule set. Preserve
warnings and SVRL reports separately. Country-specific rules that apply to a
case remain part of scoring; do not disable assertions to fit the slice.
Network delivery, envelopes, and access-point interoperability are separate
from this document benchmark.

## Exact proposed slice

One commercial UBL **Invoice**, type code `380`; no CreditNote or correction
workflow. One invoice currency (BT-5) from ISO 4217; no second VAT accounting
currency. Invoice lines may mix VAT categories **S** and **Z**, including
multiple positive S rates. Z means zero-rated, not exempt, outside scope, or
reverse charge. The scenario must specify the correct tax treatment and rate;
the prelude must not guess tax law from an item name.

Require one seller and one buyer, each with a postal address and VAT ID. This
is deliberately narrower than EN 16931: both VAT IDs are required even where
the standard allows alternatives. Use the seller as payee; no tax
representative. Include electronic endpoints with scheme identifiers, process
and specification identifiers, and a buyer reference so the slice can satisfy
Peppol requirements beyond the core EN model. Require street, city, postcode,
and country in the slice, even when the core permits a less complete address.

Defer **document-level allowances and charges** (BG-20/BG-21), and also line
allowances/charges (BG-27/BG-28) and price discounts. They add separate taxable
bases, rates, reason codes, and rounding interactions. They are useful later
cases but obscure whether simple line aggregation works. Their absence is a
slice restriction, not a claim that Peppol lacks them. Omit BT-107/108 rather
than synthesizing allowance/charge records. Totals use zero contributions for
these absent groups.

Payment means (BG-16) is optional in the standard and **omitted/deferred here**;
no bank, card, or direct-debit details. Carry a due date, no prepayment and no
payable rounding adjustment: BT-115 equals BT-112. Quantities and unit prices
may be decimal in the proposal; the spike is narrower (integer quantities,
cent prices, basis-point rates, exact-cent tax products). Price base quantity
is one, with the same unit as the invoiced quantity.

### Business terms

The following is the term allowlist for the proposal. Each listed repeated
group is part of the one invoice, not a separate invoice document.

| Group | Business terms in scope |
| --- | --- |
| Header | BT-1 invoice number; BT-2 issue date; BT-3 type (`380`); BT-5 currency; BT-9 due date; BT-10 buyer reference; BT-23 business process; BT-24 specification |
| Seller (BG-4/BG-5) | BT-27 name; BT-31 VAT ID; BT-34 electronic address and its scheme; BT-35 street; BT-37 city; BT-38 postcode; BT-40 country |
| Buyer (BG-7/BG-8) | BT-44 name; BT-48 VAT ID; BT-49 electronic address and its scheme; BT-50 street; BT-52 city; BT-53 postcode; BT-55 country |
| Lines (BG-25/BG-29/BG-31) | BT-126 line ID; BT-129 quantity; BT-130 unit; BT-131 net amount; BT-146 item net price; BT-149 price base quantity fixed/defaulted to one; BT-150 price base unit equal to BT-130 if supplied; BT-151 VAT category; BT-152 rate; BT-153 item name |
| VAT breakdown (BG-23) | BT-116 taxable amount; BT-117 tax amount; BT-118 category; BT-119 rate; group by category and rate, with one Z group if Z is used |
| Totals (BG-22) | BT-106 line sum; BT-109 total excluding VAT; BT-110 VAT total; BT-112 total including VAT; BT-115 amount due |

BT-120/121 (exemption text/code) are prohibited for both S and Z; the spike
models them only to reject their presence. All other BTs are out of this first
slice. In particular: BT-6/111 accounting currency, BT-7/8 tax point,
BT-20 payment terms, BT-25/26 preceding invoices, BT-59–69 payee/tax
representative data, BT-73–80 periods/delivery, BT-81–91 payment means,
BT-92–105 document allowances/charges, BT-107/108 allowance/charge totals,
BT-113/114 paid/rounding amounts, BT-122–125 supporting documents,
BT-134–145 line periods/allowances/charges, BT-147/148 price discount/gross
price, and additional item classifications/attributes are deferred.

### Business rules

This table is the **proposed rule coverage**, not a statement of implemented
coverage. The spike coverage is listed separately below. Rules are applied to
the restricted inputs above; general allowance/charge branches are deferred.

| Rule IDs | Obligation within this slice |
| --- | --- |
| BR-01–BR-16 | Header identifiers/date/currency, seller/buyer names and postal addresses/countries, mandatory totals, at least one line |
| BR-21–BR-27 | Line identifier, quantity, unit, net amount, item name and price; nonnegative item net price |
| BR-45–BR-48 | Breakdown taxable amount, tax amount, category, rate |
| BR-62, BR-63 | Scheme identifiers for seller/buyer endpoints |
| BR-CO-04, BR-CO-09, BR-CO-26 | Categorize each line; VAT ID country prefixes (including the EL exception); identify seller via the required VAT ID |
| BR-CO-10 | BT-106 is the sum of BT-131 |
| BR-CO-13 | BT-109 is the line sum in the absence of document allowances/charges |
| BR-CO-14 | BT-110 is the sum of BT-117 |
| BR-CO-15 | BT-112 = BT-109 + BT-110 |
| BR-CO-16 | BT-115 = BT-112, with no paid/rounding amounts |
| BR-CO-17, BR-CO-18 | Rounded tax per breakdown; at least one breakdown |
| BR-S-01, BR-S-02, BR-S-05, BR-S-08–BR-S-10 | S breakdown exists; seller tax identification (fixed here to VAT ID); positive line rate; taxable base by S rate; calculated tax; no exemption reason/code |
| BR-Z-01, BR-Z-02, BR-Z-05, BR-Z-08–BR-Z-10 | Exactly one Z breakdown when used; seller VAT ID; zero line rate; taxable base from Z lines; zero tax; no exemption reason/code |

Also in proposed scope are applicable precision and code-list checks:
BR-DEC-09/12/13/14/18/19/20/23 for the listed monetary totals, breakdowns, and
line net amounts; BR-CL-01/03/04/14/15/17/18/23/25 for invoice type,
currencies, countries, categories, units, and endpoint schemes. These are
external-validator obligations, not existing spike guarantees.

Explicitly out of scope: BR-17–BR-20 and BR-56 (other payee/tax
representative); BR-28–BR-44 (gross price, periods, allowances/charges);
BR-49–BR-55 and BR-57–BR-61 (payments, supporting documents, accounting
currency, item attributes, preceding invoices, delivery); BR-64/65
(optional item identifiers); BR-CO-03/05–08/11/12/19–24 (absent tax-point,
allowance/charge and period features); BR-S-03/04/06/07 and
BR-Z-03/04/06/07 (document allowances/charges); all non-S/Z VAT families
including BR-AE, BR-E, BR-G, BR-IC, BR-O, BR-AF, BR-AG and BR-B.
Unlisted optional features and their rules are deferred. Conditional rules
for absent features are vacuous, not implemented coverage. Future release
changes require reviewing this allowlist against the archived validator.

Peppol is stricter than the EN core. The benchmark must include, among other
applicable assertions, PEPPOL-EN16931-R001 (process), R003 (buyer/order
reference; this slice chooses buyer reference), R004 (specification), R008
(no empty XML elements), R010/R020 (endpoints), R051 (currency consistency),
and R120 (line quantity/price/net calculation). Use the official validator for
all applicable assertions, including rules outside the hand-selected examples.
An unsupported feature is a rejected scenario, not permission to ignore a
validator failure.

## Current state and prerequisite gaps

These observations were checked against this revision's sources.

- **No decimal arithmetic.** `Decimal` occurs only in the scalar-name allowlist
  in `packages/ts/src/ontology/elaborate-ontology.ts`. It does not supply a
  Decimal type, literal, runtime value, or arithmetic. Numeric types/values
  distinguish only Int and Float (`type/types.ts`, `evaluator/types.ts`);
  `builtins/arithmetic.ts` makes `/` return Float and checks Int arithmetic
  against JavaScript's safe integer range. Calling a field `Decimal` does not
  make financial arithmetic exact.
- **Flat ontology records versus a nested tree.** `EntityIR` defines fields,
  `RecordIR` holds an entity, ID and field map, and `(Id Entity)` references
  validate the target's declared entity (`preludes/ontology.lisp`,
  `surface/form.ts`). Lists of IDs let the spike associate repeated lines and
  breakdowns with an invoice; addresses are separate records. UBL instead has
  owned, ordered nested groups and repeated elements. Ordinary Forma records,
  lists and child-form families already support nesting; what is missing is
  a checked invoice/UBL shape and a mapping from flat ontology data, not the
  ability to represent any nested value at all.
- **Relation to row RFCs.** [RFC 0005](./0005-row-operations.md) implements
  closed `Pick`, `Omit`, and disjoint `Merge` in HM types. It does not extend
  the ontology seed pipeline into a recursive UBL schema. Proposed
  [RFC 0006](./0006-qualified-rows.md) adds generic row obligations;
  [RFC 0007](./0007-type-normalization.md) would share normalization with
  coercion/schema consumers; [RFC 0008](./0008-typed-form-results.md) would
  check reflected form result templates;
  [RFC 0009](./0009-field-names-and-row-map.md) would add bounded key indices
  and field mapping. These could reduce duplicated party/group shapes but
  neither implement XML nor settle ownership, multiplicity, or serialization
  order. A concrete nested invoice can be designed before generic row work.
- **No XML/UBL emitter.** Authored `:emit` hooks live in preludes and are run
  by `descriptor/form-emitter.ts`; the current target is TypeScript.
  `preludes/http-api.lisp` supplies HttpApi emitters. The assertion that only
  HttpApi has emitters is stale: `preludes/elm.lisp` also has `:emit` hooks
  for commands/apps. Neither is an XML serializer. UBL namespaces, element
  order, repeated groups, escaping, decimal lexical forms, and source maps
  still need an explicit design.
- **Checks are not a global constraint solver.** The ontology `constraint`
  form stores `RuntimeExpr`/query IR; elaboration checks its syntax/types but
  does not run it over seed data. A prelude `:check` can traverse explicitly
  referenced seed declarations through `declaration-hole`, as this spike
  does. It has no automatic database query, repair engine, or proof that an
  emitter preserves those checked facts.

### What the spike actually checks

`conformance/einvoice/` supplies a local `invoice-seed` form that produces the
same canonical `RecordIR` as ontology `seed`. It reuses `seed-row`,
`seed-values`, `seed-assignments`, and `schema/validate-record`, including
entity ID checks. No compiler changes or bundled production prelude are added.

Money uses Int cents, rates use Int basis points, quantities use Int. The
passing mixed invoice has S at 20% and 5%, plus Z: net EUR 175.00, VAT EUR
22.50, payable EUR 197.50. A Z-only invoice pins zero VAT and EUR 25.00 due.
Checks operate on explicit line/breakdown ID lists, not a precomputed line
sum supplied as an independent assertion.

| Implemented in the local spike | Limit |
| --- | --- |
| Required fields and typed ID/list references | Schema diagnostics use existing engine codes, not every BR identifier |
| BR-01–BR-16 presence/cardinality checks | Missing required fields fail the schema first; strings are not date/code-list validation |
| BR-CO-10/13/14/15/16/18 | No allowance/charge, paid or rounding contributions |
| BR-S-01/02/05/08/10 | Seller VAT ID required instead of alternative identification; sum S bases by rate |
| BR-Z-01/02/05/08/09/10 | Explicit Z group count, base, zero line rate/tax, no exemption reason/code |
| BR-S-09 exact-cent subset | Integer cross-product equality, deliberately named `einvoice/BR-S-09-exact`; not full rounded tax validation |

Passing record payloads and failing diagnostics are stored in `expected/`.
Goldens retain codes, severity, author source IDs, offsets, line/column
locations, and source excerpts. A rule failure points to the authored
`invoice-seed` fields map; cross-record checks point to the invoice map that
selected the records, not a generated file. Individual bad map entries and
related locations for referenced seeds are not currently produced by this
hook: `:slot :fields` locates the whole hole.

The negative cases cover empty header identifiers/no lines, all four requested
total equations independently, missing/duplicate VAT groups, category rates,
incorrect taxable bases, tax/exemption conflicts, missing required fields,
and a dangling ID. The fractional-cent case intentionally rejects 3 cents at
20% with tax of 1 cent, which a rounded rule should accept. This exposes the
spike's restricted arithmetic rather than silently claiming BR-CO-17.

### Remaining rule gaps

| Rule/behavior | Concrete reason and next step |
| --- | --- |
| General BR-CO-17 / BR-S-09 | No Decimal arithmetic. Exact cross-products do not implement rounding, arbitrary price/quantity precision, or values beyond safe integer intermediates. Bounded integer rounding could be written as library code, but is deliberately not substituted for the Decimal follow-up. |
| Full BR-DEC checks and UBL monetary lexical forms | Cent integers have no decimal lexical scale to validate; there is no XML emitter. |
| Nested BG cardinalities and UBL sequence/namespace rules | Flat ID-linked seed schema has no UBL ownership/serialization contract. Lists admit duplicate IDs; checking Z cardinality does not establish all category/rate group uniqueness or ownership. |
| BR-CO-09, BR-CL rules, real dates, Peppol header/endpoint checks | Strings alone do not validate code lists, VAT prefixes, date syntax, or identifier schemes. These are expressible with more prelude data/checks; deferred library coverage, not a compiler impossibility. |
| Complete BR-21–27 / PEPPOL R120 | Schema presence is checked; quantity × price, sign, base-quantity and rounding policies are not implemented by this spike. Integer-only R120 could be another check today; decimal quantities/prices need the numeric design. |
| Breakdown rate coverage/uniqueness beyond BR-S-01/Z-01 | A missing S rate group can escape S-01 if another S group exists. Explicit rate-set and duplicate checks are possible with current folds, but deferred; do not treat this spike as a complete VAT validator. |
| Whole-population seed validation and fine blame | `constraint` IR is not executed by elaboration; hooks see selected declaration data. Richer blame needs original field provenance rather than a hook's single slot location. |
| Correct category/rate for a business scenario | Validator and structural prelude cannot establish the real-world tax facts. A separate scenario oracle must check them. |

Absent allowances/charges and other VAT categories are scope exclusions, not
failures of expressibility. Domain tax vocabulary must remain in preludes and
descriptors; none of these gaps warrants special invoice cases in the compiler.

## Proposed benchmark

Nothing in this section is implemented. Run the same model/version, reasoning
settings, scenario set, documents, time/token/attempt limits and independent
random seeds in three arms. Freeze documents and validator before trials.

| Arm | Agent interface and feedback |
| --- | --- |
| A | Spec documents only; writes UBL XML. The harness scores each submission with the official validator, withholding its reports from the agent. |
| B | Same documents and XML task, plus the official validator as a tool. The agent can inspect its errors and repair the invoice. **This is the baseline Forma must beat.** |
| C | Same documents/scenarios; authors the proposed Forma invoice prelude. Elaboration diagnostics drive repair; the proposed UBL emitter produces the scored XML. Give C the same official-validator access as B, and count those calls too. |

The harness uses the official CEN and Peppol Schematron for **all three arms**,
including A's hidden scoring and C's emitted XML. Forma accepting source does
not count as invoice validity. Count all candidate submissions, tool calls,
failed elaborations and validator runs; C cannot hide failures before XML
emission. Define first-pass validity as the first submitted candidate yielding
an officially valid invoice without feedback-driven repair. Report first
elaboration and first XML validity separately for C, with failed elaborations
counted as first-pass failures in the primary comparison.

Pre-register a held-out scenario corpus with S-only, Z-only, mixed S/Z,
multiple S rates, many lines, boundary rounding, missing-party information,
and intentionally contradictory facts. Distinguish satisfiable cases from
cases where asking for clarification/refusing is correct. Do not tune the
prelude against the held-out cases or leak reference invoices to agents.
Use paired scenarios and repeated trials; publish per-case outcomes and
uncertainty, not just an aggregate success anecdote.

Measure:

- **First-pass validity:** fraction passing the official validator before any
  repair feedback, plus first-pass scenario correctness.
- **Cost to valid output:** attempts, input/output/total model tokens, tool
  calls and elapsed time to first official pass; also time/cost to a pass
  that satisfies the scenario. Report capped failures as failures, not
  successful runs with zero attempts. Separate prelude/emitter development
  cost from per-invoice cost and report both.
- **Valid but semantically wrong:** among official passes, a separately
  authored scenario oracle checks party IDs, invoice identity, currency,
  quantities, unit prices, intended rates and category. For example, choosing
  Z for a scenario that explicitly requires S and consistently setting tax
  to zero can pass arithmetic/category checks but is the wrong invoice.
  Also report this rate over all trials to avoid selection bias.
- **Consistency from one source:** request XML, a human-readable invoice
  summary, and a machine-readable accounting projection. Extract shared BTs
  from every output and compare them to one another and the scenario oracle,
  including every line, category/rate, currency and total. Use the same
  requests in A/B; C must derive outputs from one checked source. Pairwise
  agreement alone is insufficient when all outputs repeat the same error.
  No such multi-output invoice emitter exists today.

The hypothesis is that C improves over **B** on correctness and/or repair cost
without increasing semantic error or inconsistent projections. Pre-register
the decision thresholds and include failures and one-time authoring cost.
C beating A alone shows only the value of executable feedback, which B already
has. Even a C-over-B win on this restricted corpus would not establish full
EN 16931 coverage, legal compliance, or general superiority over validators.

## Alternatives considered

- **Float money:** easy to start, but binary Float and implicit rounding would
  undermine the arithmetic claim. Int cents make the fit experiment explicit
  while leaving production arithmetic unresolved.
- **Full EN 16931 or all VAT categories first:** expands conditional branches
  before the basic tree, arithmetic and diagnostics are established.
- **Only a Forma validator as judge:** would reward agreement with rules we
  wrote. The external validator remains the common judge.
- **Compiler invoice special cases:** would hide whether the prelude model
  fits. Keep the vocabulary and checks in ordinary library forms.

## Staged follow-ups and validation

1. **Decimal.** Specify literals, precision/scale, exact operations, rounding
   and overflow, HM/runtime/schema/host projections and portable artifacts.
   Pin tax-rounding boundaries, signed cases, fractional quantity/unit price,
   and serialization against independent decimal examples. Replace the spike
   workaround only after these contracts exist.
2. **Nested shapes.** Define concrete invoice, line, party/address and VAT
   groups with ownership, ordering and cardinality. Specify how an ID graph
   becomes one tree and reject dangling/multiply owned data where necessary.
   Reuse current record/list/child forms where possible; generic row RFCs are
   separate work. Preserve author blame through projection.
3. **UBL emitter.** Add a prelude-owned mapping and a general XML target as
   needed. Pin XML goldens for namespaces, element order, escaping, repeated
   groups, currency attributes and decimal formatting; validate against UBL
   schemas and both archived official Schematron sets. Add traceability from
   validator paths back to source. No emitter is added by this RFC's spike.
4. **Benchmark harness.** Archive validator/toolchain inputs, build held-out
   scenarios and a separate semantic oracle, implement A/B/C feedback and
   accounting, then run and publish reproducible trials. This depends on
   production arithmetic, shapes and emission; today's golden tests are not
   that harness.

For this change, the ordinary TypeScript suite compares the local spike with
stored goldens under `pnpm check`; the docs build checks this proposal and its
links. Regeneration and review instructions live with the fixture. No package
API, benchmark claim, deployment, or new core numeric feature is introduced.

## Decisions still required

- Decimal representation, rounding contract, and supported amount bounds.
- The first production nested-shape API and graph-to-tree ownership policy.
- Whether future payment support first adds credit transfer or merely BT-81.
- Benchmark corpus size, stopping limits, statistical thresholds, and how much
  prelude authoring cost to amortize across invoice volumes.
