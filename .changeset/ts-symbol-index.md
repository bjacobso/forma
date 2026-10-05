---
"@formalang/ts": minor
"@formalang/host": minor
---

Add a symbol index for editors. `indexSymbols` in `@formalang/ts/editor` returns definitions and references with node ids and spans for one or more documents. It resolves programs after macro expansion, so definitions made by macros are found and macro temporaries are not, handles `define`, `fn`, `let`, `do!`, `match`, `catch`, types, typeclasses, services, and operations, and uses descriptors (including `define-form`s in the indexed documents) for domain forms. `findReferences` returns a symbol's definition and references. `TsLanguageHost` implements the optional `symbolIndex` and `findReferences` host methods, including a session's loaded sources.
