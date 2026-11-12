# Embedding module vocabulary

`packages/host/test/language.test.ts` supplies the expense trial's unmodified
`trials/expense-rules/src/policy.lisp` as a module vocabulary and checks/runs
`expense.lisp` without authored imports. The result is `["manager" "finance"]`.

`items.lisp` pins a public form, its IR type, typed optional slot, docstring,
and checked example. Its private helper is available to the projection and
absent from the description. Modules use normal export visibility and project
prelude imports; the browser-safe facade does not load files itself.
