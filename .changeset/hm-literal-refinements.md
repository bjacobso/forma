---
"@forma-language/forma": minor
---

Check compile-time literal refinements (`:min`, `:max`, `:min-length`, `:max-length`, `:pattern`, `:finite`) in the HM typechecker as well as the mechanics checker (RFC 0019 §11). Out-of-range literals in direct annotations, brand constructors, record fields, call arguments, `succeed`, and `Some` now report `typecheck/refinement` at the literal's author span, while computed values remain runtime-checked.
