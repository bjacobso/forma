# Forma preludes

These Lisp sources demonstrate how Forma grows from a small typed core into
domain-specific languages. `kernel.lisp` supplies general-purpose macros,
`compiler.lisp` defines the descriptor vocabulary, and the remaining files are
an example domain stack with elaboration and portable artifact protocols.

The OCaml conformance suite loads these files in a fixed order from
`packages/ocaml/scripts/corpus.mjs`. Applications are not required to use this
domain vocabulary: hosts and the language server accept their own prelude
paths, and the language server loads none by default.

`@formalang/ts/preludes` embeds every file here as a string. Regenerate it with
`pnpm --filter @formalang/ts preludes:generate` after changing a prelude.

All executable examples keep the `.lisp` extension. Protocol preludes are also
inputs to generation and snapshot tests.

`http-api.lisp` is an independent Effect 4 declaration prelude. Its forms
also carry TypeScript emit hooks and derive a typed builder DSL. Bootstrap
it with `compiler.lisp`, separately from the ontology's older `api` form.
See [the HTTP API spike](../docs/effect/http-api.md).
