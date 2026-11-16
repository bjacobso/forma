---
"@forma-language/forma": patch
---

Form `Type` holes accept the value refinements `:pattern`, `:min-length`, `:max-length`, `:min`, `:max`, and `:finite`, so `(entity Person {:age (Int :min 0)})` no longer fails with "Unknown type metadata :min". A refinement on a type it does not apply to, after aliases and brands are resolved, is reported at the refinement key with the mechanics checker's message, such as `:min applies to Int and Float.` for `(String :min 1)`; previously these were reported as unknown metadata.

`(type-definition 'Name :refinements)` returns a type definition with its value refinements, such as `(Int :min 0)` for `(type Allowances (Int :min 0 :doc "Count"))`. Without the option, `type-definition` still strips all metadata.
