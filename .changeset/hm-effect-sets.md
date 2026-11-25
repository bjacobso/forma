---
"@forma-language/forma": minor
---

Add operational effect provenance sets and implicit-by-case `[e]`/`[r]` set variables to the HM kernel checker (RFC 0023 stage 5).

- Added `type/effect-sets.ts` with closed error/requirement provenance sets (`EffectProvenance`), `$name` set-variable keys, signature validation (`mechanics/set-variable-kind`, `mechanics/set-variable-position`, `mechanics/unbound-set-variable`), rigid body checking (`mechanics/undeclared-error`, `mechanics/undeclared-requirement`), and lower-bound call-site instantiation and solving (`EffectSetSolver`, `solveEffectCall`).
- Integrated provenance-set inclusion and rigid escape diagnostics into `type/unify.ts` and call-site solving / signature validation into `type/infer-program.ts`, while preserving existing HM `ERow` effect-row polymorphism.
