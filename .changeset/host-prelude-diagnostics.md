---
"@formalang/ts": minor
---

Help host preludes report precise diagnostics. A `:check` diagnostic may carry
`:at`, a path into the form's authored syntax, and is reported at that node.
Child forms keep their own diagnostic codes and locations instead of failing
their parent with one combined message. Add the `declarations-of` and
`type-definition` reflection builtins, and let an optional positional `String`
hole (a docstring) be omitted before other positional arguments. Quantify type
variables in `:scope` signatures so polymorphic bindings no longer share one
variable (or collide with the checker's fresh names) across uses.
