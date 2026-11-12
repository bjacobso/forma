# Reading-list processing
Write `main.lisp`, exporting `Book` (`title : String`, `pages : Int`, `read : Bool`).
Export `unread-titles : (List Book) -> (List String)` preserving input order,
`total-pages : (List Book) -> Int` summing all pages, and
`long-titles : (List Book) -> Int -> (List String)` selecting pages >= threshold.
Empty lists must work. Use checked collection operations.

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
