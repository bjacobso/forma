---
"@formalang/ts": minor
"@formalang/host": minor
---

Type host builtins in editor analysis and keep types around a type error. `analyzeEditor` accepts the `hostBuiltins` and `typePolicy` that `typecheck` does, or takes them from `sessionId`'s session, so a call to a host builtin is typed by its `typeScheme` instead of failing as unbound. Editor analysis now reports every top-level form that does not type, and still types the other forms: a definition that fails is anything to its users, and one failing definition no longer leaves the definitions next to it untyped. Typed spans are resolved with everything inference learned, so a lambda's parameters show their types instead of type variables. `Lsp.analyzeLsp` gains `inferOptions`, `inferProgram` gains an opt-in `onFormError`, and `Engine.typeInferOptions` is exported.
