# `@formalang/language-server`

Language Server Protocol support for Forma, backed by the OCaml JavaScript
engine. It provides diagnostics, hover, completion, definitions, and optional
document formatting.

```sh
npm install -g @formalang/language-server
forma-language-server --stdio
```

Published packages include the portable OCaml JavaScript engine. No OCaml
installation is required. When working from source, build the OCaml workspace
and run `pnpm --filter @formalang/language-server build:release` first.

The server starts with no domain prelude. Consumers can supply a comma-separated
list of absolute paths or paths relative to the workspace root through
`FORMA_LANGUAGE_SERVER_PRELUDES`. Programmatic consumers pass the same paths as
`preludePaths` to `OcamlWorkspaceSession`.

Environment variables:

- `FORMA_LANGUAGE_SERVER_ARTIFACT` overrides the JavaScript engine artifact.
- `FORMA_LANGUAGE_SERVER_PRELUDES` supplies consumer-owned prelude files.
- `FORMA_LANGUAGE_SERVER_ENABLE_FORMATTING=1` enables document formatting.

```sh
pnpm --filter @formalang/language-server test
pnpm --filter @formalang/language-server typecheck
```
