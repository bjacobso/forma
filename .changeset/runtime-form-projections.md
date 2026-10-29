---
"@formalang/ts": minor
"@formalang/host": patch
---

Add checked runtime projections for module-defined forms through `:lower`.
Declarations retain their compile-time IR and gain independently checked runtime
signatures that link through normal imports and barrel exports. Preserve authored
syntax, definition-site helpers, and introduced fn/let binder hygiene.

Distinguish zero-argument callbacks from values and unary Unit functions, including
returned callbacks and Effect constructor results. Preserve inferred parameter
groups for operations returning pure Steps. Preserve function-valued
constants in the Effect target, import Service method schemes across modules,
capture deferred callback dependencies in handler Layers, and keep Service method
declarations out of collection-syntax normalization.

These are generic compiler foundations; the Elm prototype's Block vocabulary,
composition graph, lifecycle support, and newer Foldkit adapter remain separate work.
