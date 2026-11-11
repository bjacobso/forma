# Routes for a help desk
Write `main.lisp` using the existing `route` macro from `preludes/routes.forma`.
Export builders `ticket-url` for /teams/:team/tickets/:ticket and `home-url` for /.
Capture fields are Strings. Preserve the supplied field text without encoding.
Export `sample` equal to ticket-url for team "support", ticket "T-42".

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
