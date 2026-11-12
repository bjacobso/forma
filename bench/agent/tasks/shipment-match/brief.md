# Shipment state machine
Write `main.lisp`. Export tagged type `Shipment` with alternatives
`(Queued Int)`, `(Moving {:carrier String :days Int})`, `(Delivered String)`, `(Cancelled String)`.
Export `describe : Shipment -> String`: Queued is "queued:<number>", Moving is
"moving:<carrier>:<days>", Delivered is "delivered:<recipient>", Cancelled is
"cancelled:<reason>". Use match. Export `terminal? : Shipment -> Bool`, true
only for Delivered and Cancelled.

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
