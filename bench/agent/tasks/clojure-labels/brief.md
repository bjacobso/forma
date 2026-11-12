# Labels with the Clojure spelling library
Write `main.lisp` using `def` and `defn` from `preludes/modules/clojure.lisp`.
Export `prefix` equal to "job", `label : String -> Int -> String` returning
"<name>#<number>", and `labels : (List Int) -> (List String)` mapping label
with prefix over numbers in order. Export `sample` equal to labels [2 5].

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
