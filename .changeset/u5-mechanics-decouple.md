---
"@forma-language/forma": patch
---

Decouple mechanics Effect TypeScript and Effect Schema codegen behind the solver-neutral `CheckedEffectProgram` contract so downstream emitters no longer depend on `mechanics/check.ts` or `mechanics/builtins.ts`.
