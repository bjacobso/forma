---
"@formalang/ts": minor
---

Let libraries claim retired spellings (RFC 0021, stage 0). `def`, `defn`,
`defmacro`, `lambda`, and `let*` are now rejected after macro expansion
instead of before it, so a macro in scope may use one of those names. An
unclaimed use still reports `Use define instead of defn` (or the matching
replacement) at the author's form, and the file-module typechecker now keeps
that diagnostic's `surface/invalid-form` code and inner span instead of
reporting a type mismatch at the top-level form. Macros gain `sexpr-vector?`.
