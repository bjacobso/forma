# Greeting declaration language
Write `forms.lisp` exporting `greeting` and `GreetingIR`, and `main.lisp` importing
that form and declaring `example` with `message` equal to `"Hello Ada"`.
Syntax: `(greeting name message)`. `name` declares a GreetingDecl.
The IR record must contain kind "Greeting", name (Symbol), and message (String).
Add a :check returning an error with code `greeting/empty`, attached to :message, when
the message is empty after trim. Preserve the original text in the IR.

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
