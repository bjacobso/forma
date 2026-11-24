# Checker Parity Contracts

Independent positive and negative conformance contracts for the shared overlap
between Forma's Hindley-Milner (`packages/ts/src/type/`) and mechanics
(`packages/ts/src/mechanics/`) checkers, implementing stages 2–3 of
[`docs/proposals/one-checker.md`](../../docs/proposals/one-checker.md).

## What this suite pins

Each case in `manifest.json` is an independent `.lisp` program checked directly
by:

- Raw HM (`Type.inferSource`)
- Raw mechanics (`Mechanics.elaborateEffectProgram`, requiring at least one
  projected declaration for acceptance)
- Public `Engine.typecheck`
- `AnalysisWorkspace`

Categories covered:

- `constructors`: tagged union construction, binding preservation, branch joins,
  invalid payload fields, and cross-union constructor rejection.
- `option-fields`: optional record fields with `Some`, `None`, plain values,
  field propagation, covariant `Option<Int> -> Option<Float>`, and invalid item
  or required-field rejections.
- `numeric`: `Int` to `Float` widening, `Int`/`Float` branch joins, arithmetic
  typing, and rejection of `Float -> Int` narrowing (both direct and via mixed
  branch joins).
- `brands`: nominal brand identity (`UserId` vs `OrderId`), branded value
  assignability to its base type and base supertypes (`Count -> Float`,
  `Option<UserId> -> Option<String>`), and rejection of raw base values where a
  brand is expected.
- `shadowed-effect`: local bindings shadowing outer names or Effect helper
  names without leaking outer types.
- `literal-constraints`: literal union types (`(Union "admin" "member")`,
  `(Union :ready :waiting)`), branch joins into literal unions, literal-to-base
  widening, and rejection of invalid members or unrefined base primitives.

## Documented raw-checker boundaries

The raw checkers still serve distinct domains outside this shared overlap:

- Pure untyped expression programs (without top-level signed declarations) are
  HM-only because mechanics projects signed declarations.
- Effect-specific operational forms (`service`, `layer`, `Ref`, `Fiber`,
  `Stream`, provenance sets) are mechanics-owned and routed through
  `Engine.typecheck` and `AnalysisWorkspace`.
- Both checkers share the primitive, literal, nominal brand, and covariant
  `Option` assignability core via `packages/ts/src/type/data-relation.ts`.
