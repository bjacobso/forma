---
"@formalang/ts": minor
---

Add `@formalang/ts/analysis`, a workspace of preludes and documents whose language services are memoized queries: diagnostics, typed spans, hover, completion (with descriptor slots), definitions, references, rename, document symbols, semantic tokens, and formatting. Documents are typed in the scope of their preludes: prelude macros expand, prelude definitions keep their inferred types, and descriptor forms are typed. `analyzeLsp` accepts that scope (`initialEnv`, `macroEnv`, `captureEnv`), types source-local `form` declarations, and keeps typing the forms around one that does not lower. The symbol index now records macro call heads as references to their macro. `Diagnostic` and `Span` live in `@formalang/ts/diagnostic`.
