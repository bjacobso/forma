---
"@formalang/ts": minor
---

Register `construct/query` and `construct/declaration` meta builtins in the TypeScript engine, matching the OCaml engine, so the bundled ontology preludes elaborate queries without patching. Runtime string literals in construct output are now marked with the Forma-owned `$forma.runtimeExpr` key, exported as `RUNTIME_STRING_LITERAL_KEY` together with an `isRuntimeStringLiteral` guard from `@formalang/ts/descriptor`.
