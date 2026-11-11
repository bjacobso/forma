# `@formalang/language-server`

Language Server Protocol support for Forma, backed by the TypeScript engine.
It provides diagnostics, hover, completion (including the open slots of
descriptor forms), definitions, references, rename, document symbols,
workspace symbol search, semantic tokens, diagnostic quick fixes, and document formatting.
Workspace symbol search matches names and documentation across preludes and
documents; `produces:IRType` and `type:TypeName` in the query filter by a
form's `:ir` type or a definition's inferred type.

Diagnostics append engine help text on a new line prefixed `help: `. LSP has
no dedicated help field, and `relatedInformation` requires a source location,
so the message makes this advice visible in ordinary diagnostic displays.
Structured `details` and atomic `fix` edits are preserved in diagnostic `data`.
`textDocument/codeAction` offers each supplied fix as one `quickfix`, with all
edits applied together to the requested document's unchanged source. A sole
available quick fix is preferred. Only diagnostics supplied by the analysis
workspace can offer fixes; it currently suppresses unknown-form diagnostics,
including their misspelled-head suggestions.

Document formatting is enabled by default. It returns a full-document edit
and declines documents that do not parse.

```sh
npm install -g @formalang/language-server
forma-language-server --stdio
```

Every feature is a query over an `AnalysisWorkspace` from
`@formalang/ts/analysis`. Documents are typed in the scope of the configured
preludes: their macros expand, their definitions keep their inferred types,
and their descriptor forms are typed and validated. Names that macros and
descriptor forms introduce resolve like any other definition, across open
documents and preludes.

The server starts with no domain prelude. Consumers can supply a
comma-separated list of absolute paths, or paths relative to the workspace
root, through `FORMA_LANGUAGE_SERVER_PRELUDES`. Programmatic consumers pass
the same paths as `preludePaths` to `FormaWorkspace`. Opening a prelude in
the editor replaces its file for every document until it is closed.

Environment variables:

- `FORMA_LANGUAGE_SERVER_PRELUDES` supplies consumer-owned prelude files.

```sh
pnpm --filter @formalang/language-server test
pnpm --filter @formalang/language-server typecheck
```
