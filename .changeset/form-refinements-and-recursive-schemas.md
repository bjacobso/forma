---
"@formalang/ts": minor
"@formalang/host": patch
---

Check `:pattern`, `:min-length`, `:max-length`, `:min`, `:max`, and `:finite` refinements
in form hole and IR types instead of rejecting refined fields, and generate the
matching Effect schema filters. Add `Null`, JSON `null`, as a schema type. Generate recursive Effect schemas with
`Schema.suspend` unless the recursion passes through a brand or a class. Hole
types and scoped expressions accept enum aliases by member, `=` reports a
literal outside an enum, generic `:scope` functions are instantiated per use,
and child form diagnostics point at the child.
Form hooks expand their programs once per descriptor rather than on every use,
which makes re-checking a document with many forms several times faster.
`:check` diagnostics accept `:at` to point inside a `Syntax` hole. Edit scripts
insert record entries laid out like their siblings, and slot affordances name
the concrete forms a category of children accepts.
