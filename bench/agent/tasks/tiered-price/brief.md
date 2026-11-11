# Tiered ticket prices
Write `main.lisp`, exporting `ticket-price : Int -> Int -> Int` (age, quantity).
A ticket costs 8 for ages below 18, 12 for ages 18–64, and 6 for ages 65+.
For quantities of at least 10, subtract 2 per ticket. Quantity zero costs zero.
Return the total Int. Also export `sample` equal to the price for age 30, quantity 10.

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
