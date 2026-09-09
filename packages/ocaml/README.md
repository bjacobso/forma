# `@formalang/ocaml`

The OCaml implementation of the Forma language engine. It owns parsing, macro
expansion, evaluation, Hindley–Milner inference, descriptor-driven
elaboration, editor analysis, and canonical artifact packaging.

The engine builds to three targets:

- `dist/native/forma_cli.exe`
- `dist/js/jsoo_entry.cjs`
- `dist/wasm/wasm_entry.wasm`

## Build and test

```sh
mise install
mise run forma:ocaml:deps
pnpm --filter @formalang/ocaml build
pnpm --filter @formalang/ocaml test:ocaml
```

The JSON ABI supports one-shot operations and persistent sessions. The native
CLI can process a request directly or run as a newline-delimited daemon:

```sh
packages/ocaml/dist/native/forma_cli.exe request '{"op":"version"}'
packages/ocaml/dist/native/forma_cli.exe daemon
```

`@formalang/ocaml` remains private while its cross-platform npm distribution model
is designed. The source and its ABI are nevertheless exercised by the shared
host and conformance suites.
