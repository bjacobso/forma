---
"@forma-language/forma": minor
---

`(import "forma:effect" [do bind pure])` writes Effect steps as `(do (bind x eff) (let y value) result)`, which expands to `do!` and generates the same code; `pure` is `succeed`. A `do` without `bind` or `let` steps keeps its core meaning. A macro that returns its own call unchanged now declines it, so the head keeps its core meaning, and the new `syntax-error` macro builtin reports a coded diagnostic at the author's form.
