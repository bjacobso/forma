# `@formalang/language-server`

Language Server Protocol support for Forma, backed by the TypeScript engine.
It provides diagnostics, hover, completion (including the open slots of
descriptor forms), definitions, references, rename, document symbols,
semantic tokens, and document/range formatting enabled by default. Markdown
documents support fence formatting; their prose is not analyzed as Lisp.

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

Formatting returns whitespace edits rather than replacing the document. It uses
imported form and macro layouts through the module graph, including unsaved
open dependencies. Unresolved modules use local layouts and report a warning
in the client log. Markdown formats only `lisp` and `forma` fences; fragments
and unsupported containers are skipped and reported. Include Markdown in your
client's document selector to request fence formatting. Other language services
currently apply to Lisp/Forma documents only.

Environment variables:

- `FORMA_LANGUAGE_SERVER_PRELUDES` supplies consumer-owned prelude files.
- `FORMA_LANGUAGE_SERVER_ENABLE_FORMATTING=0` disables document and range formatting.

```sh
pnpm --filter @formalang/language-server test
pnpm --filter @formalang/language-server typecheck
```
