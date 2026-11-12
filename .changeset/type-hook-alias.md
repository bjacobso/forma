---
"@forma-language/forma": patch
---

Resolve type names returned by a form's `:type` hook through the prelude's alias map, as hole types already were. A hook returning `(quote Truth)` for `(type Truth (Brand Bool))` again satisfies an `(Expr Truth)` hole instead of failing with `value expects Brand<Truth, Bool>, found Truth`.
