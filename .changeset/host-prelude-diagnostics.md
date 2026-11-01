---
"@formalang/ts": minor
---

Help host preludes report precise diagnostics. A `:check` diagnostic may carry
`:at`, a path into the form's authored syntax, and is reported at that node.
Preserve existing Syntax-value locations and child diagnostic codes and spans.
Add the `declarations-of` and
`type-definition` reflection builtins, and let an optional positional `String`
hole (a docstring) be omitted before other positional arguments. Cover the
existing quantification of `:scope` signatures with host-prelude regressions.
