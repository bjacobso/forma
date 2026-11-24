---
"@forma-language/forma": minor
---

Effect operations may be generic. Lowercase type variables are accepted in operation signatures, and a lowercase symbol inside an error or requirement vector is an error-set or requirement-set variable, so `(Effect a [e AuditDown] [r Audit.log])` passes a callback's errors and requirements through to its callers. Each call solves the variables from its arguments and returns closed sets, a body is checked with its variables as rigid members, and generated TypeScript gets generic `E` and `R` parameters. The portable Effect type node gains optional `errorVariables` and `requirementVariables`. New diagnostics: `mechanics/set-variable-kind`, `mechanics/unbound-set-variable`, `mechanics/set-variable-position`. The `for-each`, `timeout`, `retry`, `repeat`, and `race` checks now run through the same signature solver without changing their diagnostics.

`for-each` and `acquire-release` accept the name of a declared operation where they took a literal `fn`, and an incompatible reference reports the expected and actual function types. A literal checked against a refined type, such as `-5` for `(Int :min 0)` or `(Bags 0)` for a branded range, is now a compile-time `mechanics/refinement` error at the literal in the Effect checker; computed values are still checked when decoded.
