# T3: make numeric inference and runtime tags agree

Status: proposal for decision; no language changes implemented.

## Evidence and reproduction

Run from the repository root, with installed dependencies:

```sh
pnpm surfaces
pnpm --filter @formalang/ts test test/numeric-types.test.ts test/check-run.test.ts test/effect-typescript-conformance.test.ts
node docs/proposals/scripts/measure.mjs
```

On revision `2cd1a2a`, Node 24.13.0, surfaces reported **249 comparisons,
0 failures**; the three test files reported **155 passed**. No goldens changed.
The script writes [evidence.json](./scripts/evidence.json): `numeric` contains
every ledger entry, `numericInterventions` contains executable author-level
repairs, `prelude` contains every standalone prelude check. These are observed
results; alternative checker implementations have not been benchmarked.

`packages/ts/src/type/builtin-schemes.ts:39–86` gives arithmetic and ordering
monomorphic Float operands. `type/infer-core.ts:739–755` specializes direct
numeric calls when their operands are already Int, but otherwise chooses Float.
This explains why direct integer addition works while an unconstrained lambda
widening its input contaminates collection inference. `docs/design-decisions.md:24–36`
specifies kind-preserving arithmetic, Int-to-Float assignability, Float joins,
and distinct printed/ABI tags. These rules are individually useful but do not
constitute a coherent value/type correspondence today.

The complete numeric ledger result is:

| Entry | Inferred display | Evaluated output |
| --- | --- | --- |
| E2: named square mapped over integers | List\<Float\> | `[1 4 9]` |
| G1: mapped increment | List\<Float\> | `[1]` |
| G2: filter with numeric predicate | List\<Float\> | `[1]` |
| G3: numeric reduction | Float | `1` |
| G4: `(if false 0.0 1)` | Float | `1` |
| G5: `(if true 0 1.0)` | Float | `0` |

E1 remains an arity failure; R1 remains a rejected incompatible branch.
Neither is solved by numeric inference.

## Options and compatibility

| Option | Ledger impact | Fixtures, preludes, and goldens |
| --- | --- | --- |
| Constrained numeric variable, contextual solving, Int default only at an unresolved monomorphic boundary | Targets E2/G1–G3 (4); G4/G5 still need a join decision | Preserves existing integer runtime tags; changes inferred generic signatures. Must retain fractional and mixed-numeric acceptance. Existing typeclass fixtures constrain implementation choices. |
| Keep Float inference and insert typed coercions | Join-only coercion targets G4/G5 (2); a full checked-boundary elaboration could target all 6 | Changes output to `1.0`/`0.0`, ABI tags, numeric instance dispatch and possibly overflow behavior. Collections require element coercion or coercion before callbacks, not just scalar return retagging. |
| Require numeric parameter annotations | Author edits demonstrably repair E2/G1–G3 (4); joins still disagree (2) | Four edited programs pass with Int signatures and unchanged runtime output. A new requirement would reject their original programs, requiring fixture/prelude migrations and diagnostic expectations. |
| Preserve current rules and explicitly make Float a supertype containing Int runtime values | Reclassifies all 6 as permitted rather than repairing their tags | Zero baseline edits, but contradicts the current ledger oracle and weakens schema/ABI expectations. Every consumer must understand this containment rule. |

The script actually checks the four annotation repairs and two all-Float branch
repairs: **6/6 typecheck and evaluate without errors**. The first four produce
`List<Int>`/`Int`; the last two print `1.0`/`0.0`. These bound the migration
choices; literal edits are **not** an implementation of typed coercion.

Baseline numeric regression coverage is `numeric-types.test.ts` (literals,
mixed arithmetic, division, rounding, overflow, patterns, dispatch, schemas),
the check-run seeds, and surface cases prefixed `numeric-`, plus
`review-numeric-parameters` and `review-higher-kinded-numeric`. Their stored
expectations all pass. Standalone checks cover **19 preludes: 13 clean, 6 with
existing errors**, recorded by filename and diagnostic in `evidence.json`.
These checks omit normal session loading and must not be treated as six broken
preludes; `pnpm check:preludes` passes the repository contract with **135
docstrings and 135 checked examples**.

Exact alternative-wide fixture/golden breakage counts are **unmeasured**:
there is no alternate checker/coercion implementation to run. The table's
4/2/6 counts refer only to the six reproduced ledger cases. Claiming zero
breakages from the green baseline would be misleading. Before approval to
ship, require a scratch implementation and a per-file diff across the above
surfaces, numeric tests, and normally loaded preludes. No golden rewrite is
authorized by this proposal.

## Recommendation

Choose constrained numeric inference with contextual solving, coordinated with
RFC 0018 collection inference and RFC 0019 §2. Retain generic constraints where
possible; default to Int only where generalization would otherwise leave an
unresolved monomorphic value. Defaulting every lambda to Int would break
reusable Float helpers. Preserve `/` returning Float and kind-preserving
arithmetic. Separately approve typed Int-to-Float coercions at mixed branch
joins; this explicitly changes observable tags. Do not silently change the
ledger's matching predicate.

## Mergeable stages and acceptance

1. **Contract PR:** independent expected cases for all six ledger programs,
   Float reuse of the same helper, mixed collections, numeric dispatch and
   overflow. Acceptance: existing suite remains green; proposed cases are an
   explicit opt-in specification, not silently updated goldens.
2. **Inference PR:** solve numeric constraints after callback/input inference;
   generalize reusable functions and default only eligible variables. Acceptance:
   E2/G1–G3 agree, Float reuse passes, no newly accepted invalid callback or rigid
   generic body; enumerate every changed type golden and prelude signature.
3. **Join PR:** carry coercion evidence into typed core and both runtime paths,
   including collection boundaries. Acceptance: G4/G5 print Float values;
   evaluate once, preserve source spans, reject unsafe narrowing, and retain
   NaN/infinity/signed-zero contracts. Review all output/ABI golden changes.
4. **Consumer PR:** generated TypeScript, schema decoding, modules, CLI and LSP
   use the same rules. Acceptance: numeric conformance, surfaces, prelude checks
   and `pnpm check` pass; remove only the ledger entries actually repaired.

## Risks and decision needed

Constraint notation and defaulting interact with existing typeclasses; a new
domain-specific numeric concept must not be hardcoded into unrelated preludes.
Coercion can change instance selection, integer overflow, printing and schema
validation. Unchecked evaluation cannot infer coercions from absent checked
core. Approve the two semantic decisions independently, and require measured
candidate-wide compatibility counts before either implementation ships.
