---
"@formalang/ts": minor
---

Check `:pattern`, `:min-length`, `:max-length`, `:min`, and `:max` refinements
in form hole and IR types instead of rejecting refined fields, and generate the
matching Effect schema filters. Generate recursive Effect schemas with
`Schema.suspend` unless the recursion passes through a brand or a class. Hole
types and scoped expressions accept enum aliases by member, `=` reports a
literal outside an enum, generic `:scope` functions are instantiated per use,
and child form diagnostics point at the child.
