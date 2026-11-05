---
"@formalang/ts": patch
---

Keep imported macro names out of type annotations. A module that imported a
macro named `->`, as `preludes/clojure.forma` re-exports from
`preludes/kernel.forma`, could no longer write a function type: `(: total
(-> Int Int))` resolved the arrow to the imported macro and failed with
`Cannot unify Float -> Float with ->…<Int, Int>` at a span inside the
library. Module resolution now leaves `macro` and `form` bindings alone in
type position, where they can never be a type, so the annotation means what
it says. Value, type, service, and error bindings resolve as before.
