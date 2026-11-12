# Dispatch decisions with the kernel library
Write `main.lisp`, importing `cond`, `and`, `or`, `not` from `preludes/modules/kernel.lisp`.
Export `dispatch : Bool -> Bool -> Int -> String` (enabled, urgent, backlog).
Disabled always returns "paused"; enabled with urgent or backlog >= 20 returns
"express"; remaining enabled with backlog > 0 returns "normal"; otherwise "idle".
Also export `safe-divide : Int -> Int -> Int`: return 0 for a zero divisor,
otherwise quot. Use the library's short-circuiting forms to guard division.

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
