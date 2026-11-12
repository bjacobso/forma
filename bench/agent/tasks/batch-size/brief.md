# Batch declaration language
Write `forms.lisp` exporting `batch` and `BatchIR`, and `main.lisp` importing
that form and declaring `example` with `size` equal to `50`.
Syntax: `(batch name size)`. `name` declares a BatchDecl.
The IR record must contain kind "Batch", name (Symbol), and size (Int).
Add a :check returning an error with code `batch/size`, attached to :size, when
size is outside the inclusive range 1..50.

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
