# T5: converge checker boundaries before replacing rules

Status: stage 1 boundary implemented under RFC 0004; checker rules remain unchanged.

## Evidence and reproduction

```sh
node docs/proposals/scripts/measure.mjs
pnpm --filter @formalang/ts test test/numeric-types.test.ts test/check-run.test.ts test/effect-typescript-conformance.test.ts
pnpm surfaces
```

Observed: **155 tests passed; 249 surface comparisons, zero failures**.
[evidence.json](./scripts/evidence.json), `matrix`, lists every source filename,
HM verdict/display, mechanics declaration count, and rejection messages.
The matrix runs **149 fixtures**: all
`conformance/fixtures/typecheck/*/source.lisp` and
`conformance/effect-typescript/cases/*/program.lisp`.
It directly invokes `Type.inferSource` and
`Mechanics.elaborateEffectProgram`; it does not compare the already routed
public facade against itself. Mechanics acceptance requires at least one
projected declaration, preventing empty projections from counting as success.

`packages/ts/src/type/types.ts:15–111` represents curried functions, HM
variables, open record rows and effect rows. `mechanics/types.ts:39–85`
represents schema literals, brands, unions, nominal errors/services, Effect
provenance sets, Ref/Fiber/Stream/Layer and numeric-id variables. A printer
adapter cannot preserve all these semantics.

Aggregate counts (HM/mechanics): **2 accept/accept, 63 accept/reject,
13 reject/accept, 71 reject/reject**. These include domain mismatches and
expected rejection fixtures, not 76 bugs. Domain generators for Elm/email/HTTP
have their own entry points; their standalone mechanics failures are not
evidence that those products are broken.

## Fixture matrix

Paths below use `T = conformance/fixtures/typecheck/` (suffix `/source.lisp`)
and `E = conformance/effect-typescript/cases/` (suffix `/program.lisp`).
The JSON contains the exhaustive 149-file inventory and exact diagnostics.

| Construct / fixture | HM | Mechanics | Interpretation |
| --- | --- | --- | --- |
| `T/let-polymorphism-success` | Accept | Reject | Pure expression program is outside declaration projection |
| `T/generic-adt-match-success` | Accept | Reject | HM generic constructor/match coverage |
| `T/typeclass-hkt-instance-success` | Accept | Reject | Higher-kinded class/instance coverage |
| `T/partial-application-success` | Accept | Reject | HM currying; runtime agreement remains a separate problem |
| `E/builtin-contracts` | Accept | Accept | Shared numeric/collection contracts |
| `E/operational-effects` | Accept | Accept | Overlap does exist |
| `E/concurrent-workflow` | Reject: “Use List instead of Array” | Accept | Surface/schema vocabulary differs |
| `E/edge-cases` | Reject: Map arity | Accept | Different schema Map conventions |
| `E/config-and-logging` | Reject: unbound config | Accept | Mechanics services/config vocabulary |
| `E/recursive-schemas` | Reject: List arity | Accept | Recursive schema syntax boundary |
| `E/pure-domain-logic` | Reject: record vs Discount | Accept | Nominal schema construction |
| `E/reject-literal-widening` | Accept | Reject | Literal/refinement contract missing in raw HM path |
| `E/reject-non-exhaustive-match` | Accept | Reject | Acceptance severity differs |
| `E/reject-cond-order` | Accept | Reject | Declaration checker enforces ordering |
| `E/reject-load-order` | Accept | Reject | Declaration dependency contract |
| `E/reject-recursive-schema` | Accept | Reject | Schema validation is not ordinary HM inference |
| `E/reject-unrepresentable-values` | Accept | Reject | Portable representation is an additional contract |
| `T/type-error` | Reject | Reject | Rejection alone does not establish diagnostic parity |

The other mechanics-only positives are `crud-users`, `multi-service-checkout`,
`ontology-actions`, `resource-scope`, `schemas-and-decoding`, `stream-pipeline`,
`surface-review`, and `typed-errors` (all E). Remaining HM-only positives and
shared negatives are enumerated in the linked matrix rather than inferred
from their fixture names.

## Options and compatibility

**Replace mechanics with HM now.** On the measured direct-entry matrix,
13 currently accepted declarations become rejections, while six mechanics
rejection fixtures become accepted. Generated TypeScript and schema goldens
cannot be preserved by merely translating types. HM expression fixtures are
retained, but Effect preludes and nominal/provenance semantics need explicit
new rules. Reject this option until independent Effect contracts pass.

**Replace HM with mechanics now.** All 63 HM-only accepted fixtures lose
acceptance at this entry point, including 57 kernel fixture programs and six
mechanics rejection fixtures. Some are outside mechanics' domain rather than
missing type rules; changing the input projection is substantial work. Pure
prelude polymorphism, open rows and higher-kinded typeclasses need preservation.
Do not treat accepting the six negative fixtures as a goal.

**Converge one consumer's result boundary first (recommended).** Keep both
solvers authoritative in their supported domains; remove HM `TypeEnv` from
the editor-facing `DocumentAnalysis` result. Replace it with read-only binding
display and name-membership queries produced inside the analysis adapter.
Merge mechanics displays there with explicit precedence and source ownership.
This removes one representation from one consumer without inventing a lossy
shared solver representation. Expected fixture/prelude/golden changes: zero;
baseline measured breakages: zero. Candidate counts require its implementation.

This is a deliberately limited first step, not completion of RFC 0004.
`analysis/workspace.ts:73` currently exposes `TypeEnv`; lines 430–435 print HM
schemes after trying mechanics bindings. `mechanics/checked.ts:24–56` already
provides located displays. `engine/operations.ts:313–322` already routes
explicit Effect declarations through combined analysis. Preserve that shipped
behavior; the raw HM failures above must not leak through this migration.

## Mergeable stages and acceptance

1. **Boundary PR:** move the raw environment capture/formatting behind an
   analysis adapter and return display/name queries. Keep environments private
   for inference and module schemes. Acceptance: remove `TypeEnv` and
   `showScheme` from the editor result consumer; unchanged completion, hover,
   shadowing, imported generics and source spans; zero surface diffs. Audit
   downstream `DocumentAnalysis.typeEnv` callers and migrate them in this PR.
2. **Contract PR:** turn the matrix's overlap into independently expected
   positive and negative contracts. Acceptance: file CLI, embedding workspace
   and LSP agree on constructor/Option values, named callbacks, shadowed Effect
   names, imported-file errors and literal constraints. Baseline raw-checker
   differences remain documented until deliberately closed.
3. **One shared data-type relation PR:** choose primitive/literal assignability
   only, preserving Int/Float and nominal brands. Acceptance: both checkers use
   that relation; the numeric suite, strict generated TypeScript harnesses and
   all original rejection fixtures pass. Enumerate any intentional differences.
4. **Solver retirement PRs:** migrate one construct family at a time, retaining
   rigid generics, rows, provenance and module invalidation tests. Acceptance
   per family: no fallback to the old representation for that family, full
   conformance plus `pnpm check`, reviewed golden inventory, and accurate
   RFC implementation status.

## Risks

Display strings cannot serve as inference schemes or module interfaces.
WeakMap check tables depend on the exact projected IR objects
(`mechanics/checked.ts:1–3`); cloning invalidates them. Removing a public field
may affect internal consumers and requires a compile-time migration. Shared
syntax does not imply shared assignability. Baseline standalone prelude checks
have six context-dependent errors across 19 files; use normal prelude loading
as the migration gate, not that standalone count.

## Implementation status

Stage 1 (Boundary PR) is implemented. `DocumentAnalysis` exposes
`bindingDisplay(name, offset?)` and `hasBinding(name)` instead of `typeEnv` and
`mechanicsBindingTypes`. The analysis binding adapter captures the HM environment
and formats schemes privately. Mechanics binding displays take precedence over
HM bindings, followed by builtins. Offset queries use only expression spans owned
by the analyzed source; inherited prelude binding names remain visible, and an
unknown name inside a mechanics expression cannot borrow an HM display.

Hover, completion and search consume those queries. The cold/warm equivalence
harness compares binding membership and displays through the same public
boundary. Downstream LSP, language-server, editor, host and website consumers
were audited; none read the removed document fields. Host and prelude scope
environments remain available for inference and module schemes.

This changes the exported analysis API (minor changeset), without changing
checker rules, conformance expectations or surface goldens. Stages 2–4 remain
planned; the 149-fixture direct-checker matrix above still describes the separate
solver domains and is not a claim that the solvers are equivalent.
