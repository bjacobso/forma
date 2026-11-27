---
"@forma-language/forma": minor
---

Retire the legacy `mechanics/check.ts` and `mechanics/builtins.ts` checkers now that pure, DSL, and Effect programs all check through the single Hindley–Milner type checker (`packages/ts/src/type/`). Removes the retired `checkMechanicsDeclarations` and legacy mechanics check type re-exports from `Mechanics`.
