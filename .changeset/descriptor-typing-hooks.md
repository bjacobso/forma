---
"@formalang/ts": minor
---

Run descriptor infer, check, bindings, and result-type hooks in the active
Hindley–Milner context, including source-local hooks and prelude hooks in editor
analysis. Add their meta helper vocabulary and preserve diagnostic codes and
authored expression spans. Export the plain `checkDescriptors` stage for
descriptor definition and application validation, with a callback for artifact
contract checks. Host prelude-loading integration remains separate.
