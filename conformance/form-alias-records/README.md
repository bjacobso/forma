# Record aliases in form expression holes

`accepted.lisp` is the benchmark's former reduced repro: a matching record
literal satisfies `Item` inside an `Expr (List Item)` hole. `nested.lisp`
checks `Option Item` and nested lists. `wrong-field.lisp` and
`missing-field.lisp` each produce one `elaborate/hole-type` diagnostic, at
`42` and `{}` respectively. Tests also cover generic aliases and verify that
brands and tagged types reject unconstructed structural values.

These fixtures are exercised by `packages/ts/test/form-alias-records.test.ts`.
