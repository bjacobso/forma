---
"@forma-language/forma": minor
---

Cut over Effect elaboration, `AnalysisWorkspace`, `Engine.typecheck`, and LSP analysis to the unified Hindley-Milner Effect checker (`checkEffectForms` / `checkEffectProgram`), eliminating runtime calls to the legacy `mechanics/check.ts` checker while preserving generated Effect TypeScript output.
