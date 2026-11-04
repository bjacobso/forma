# Form extensions and named maps

`prelude.lisp` uses two unrelated extension namespaces. Load it after
`preludes/compiler.lisp`; `program.lisp` must project exactly `expected.json`'s
payloads and extension data. The expectation explicitly retains false and null
property values, including an absent optional hole. `invalid-extension.lisp`
must reject executable metadata at the captured expression's source location.

`packages/ts/test/form-extensions.test.ts` also checks literal validation,
namespace precedence, the deprecated constant-definition attachment convention,
macro argument errors and lexical scope, and metadata on imported forms.
