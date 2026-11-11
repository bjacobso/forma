# Asset route templates
Write `main.lisp` using `route` from `preludes/modules/routes.lisp`. Export `mirror-url`
for /mirror/:asset/:asset, `revision-url` for /assets/:asset/revisions/:rev,
and `health-url` for /health. Repeated captures use one field.

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
