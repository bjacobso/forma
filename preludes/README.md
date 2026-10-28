# Forma preludes

These Lisp sources demonstrate how Forma grows from a small typed core into
domain-specific languages. `kernel.lisp` supplies general-purpose macros,
`compiler.lisp` defines the descriptor vocabulary, and the remaining files are
an example domain stack with elaboration and portable artifact protocols.

The conformance fixtures and example corpus load these files as their domain
stack. Applications are not required to use this domain vocabulary: hosts and the language server accept their own prelude
paths, and the language server loads none by default.

`@formalang/ts/preludes` embeds every file here as a string. Regenerate it with
`pnpm --filter @formalang/ts preludes:generate` after changing a prelude.

`kernel.forma` is an ordinary exported macro library for file modules. It is
regenerated from `kernel.lisp` by the same command above. File modules explicitly
import it or select it as a project prelude; they do not inherit the legacy stack.
The remaining `.lisp` libraries use the existing descriptor bootstrap APIs and
have not yet migrated to ordinary modules. Protocol preludes are also inputs to
generation and snapshot tests.

`http-api.lisp` is an independent Effect 4 declaration prelude. Its forms
also carry TypeScript emit hooks and derive a typed builder DSL. Bootstrap
it with `compiler.lisp`, separately from the ontology's older `api` form.
See [the HTTP API spike](../docs/effect/http-api.md).

The site's [prelude reference](https://forma-lang.com/preludes/) is generated
from these files when the docs build: forms and slot types from descriptors,
signatures from `(: name type)`, and documentation from docstrings and the
comments directly above each definition. Catalog titles and maturity labels
live in `docs/.vitepress/preludes.ts`; a new file appears as uncatalogued until
it has an entry there.
