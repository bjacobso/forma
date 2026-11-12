# Numeric semantics specification

This is an independent specification of numeric inference. Stage 2 is implemented
and runs in the normal suite; Stage 3 remains an opt-in proposal.

Run the Stage 2 contract from the repository root:

```sh
FORMA_NUMERIC_SPEC=2 pnpm --filter @formalang/ts test test/numeric-spec.test.ts
```

`expected.json` records the expected type and printed result independently of
the check-run divergence ledger. Each case runs through inference and both
execution paths. Overflow must typecheck as Int and fail at runtime in both
paths. Float reuse checks the same helper after an earlier Int call.
Mixed collections retain their current element tags; this contract does not
require collection-boundary coercion.

Cases marked `stage: 2` cover E2, G1–G3, total, Float reuse, mixed collections,
numeric instance dispatch, Int overflow, and Float division. These cases pass in the normal suite. Cases marked `stage: 3` cover G4/G5 and require
separately approved branch-join coercion. To run those future expectations too,
set `FORMA_NUMERIC_SPEC=3`.

Without `FORMA_NUMERIC_SPEC`, Stage 2 runs and Stage 3 is skipped. Keep the
expected results independent of implementation output.
