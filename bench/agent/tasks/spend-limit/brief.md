# Spend declaration language
Write `forms.lisp` exporting `spend` and `SpendIR`, and `main.lisp` importing
that form and declaring `example` with `amount` equal to `100`.
Syntax: `(spend name amount)`. `name` declares a SpendDecl.
The IR record must contain kind "Spend", name (Symbol), and amount (Int).
Add a :check returning an error with code `spend/over-limit`, attached to :amount, when
amount exceeds 100. Values at or below 100 are accepted.

Write your solution in the sandbox root. Use only `.lisp` for authored source.
`bin/forma` is also on PATH. Commands print JSON and exit nonzero on errors:

```sh
forma file typecheck main.lisp
forma file evaluate main.lisp
forma file declarations main.lisp   # elaborate forms and inspect FormApplication payloads
```

Read the supplied docs as needed. Existing library paths retain their repository
extensions. Do not edit supplied context. Hidden tests import your exports and
exercise additional inputs. No network or new dependencies are needed.
