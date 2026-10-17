# RFC 0018: Lossless source formatting

| | |
| --- | --- |
| Status | Accepted design; implementation in progress |
| Created | 2026-10-17 |
| Scope | Lisp source, Markdown fences, CLI, language server, editor and playground |

## Contract

Formatting changes whitespace, never authored token text. Reader shorthand,
number spellings, string escapes and comment markers survive exactly. Comments
keep their order and trailing/own-line placement. Keep at most one blank line
between top-level forms and body items. Output is idempotent, uses LF and ends
in one newline. Invalid Lisp is returned unchanged with diagnostics.

The synchronous `@formalang/ts/format` API provides `formatLisp`,
`formatMarkdown` and `formatRange`, returning `{ text, changed, diagnostics }`.
Range formatting selects intersecting top-level forms. The existing Effect
formatter entry point remains a compatibility wrapper; AST pretty printing is
still available for generated expressions, but cannot preserve source spelling.

## Style decisions

These choices resolve D1–D9 from the implementation plan:

| Decision | Choice and reason |
| --- | --- |
| D1 | Fixed two-space indentation; stable under renaming. |
| D2 | Keep today's maps: flat when they fit, otherwise opening brace on its own line and pairs indented two spaces. Minimizes churn. |
| D3 | CLI and LSP use descriptors from the module graph, including imports. Standalone text uses default preludes and declarations in that text. Resolution failures must be reported, with deterministic local fallback. |
| D4 | A small formatter table for core compiler forms (`define`, `fn`, `let`, `if`, `match`, `do`, `module`, `import`, `:`). This is a documented exception to the rule that domain vocabulary belongs in preludes. Domain forms continue to use descriptors and macro signatures. |
| D5 | Skip fragment fences and report `format/markdown-fragment`. Only strict checking treats them as failures; no fragment migration in this work. |
| D6 | Format only `lisp` and `forma` fences. |
| D7 | `<!-- forma-fmt-ignore -->` immediately before a fence; `; forma-fmt: off` / `; forma-fmt: on` for Lisp regions. Preserve ignored bytes. |
| D8 | 80 columns, with overflow allowed for unbreakable atoms and comments. |
| D9 | Preserve comment markers as written. |

Descriptor surface patterns take precedence over macro signatures, then core
forms, then generic layout. Generic calls keep the head and first argument on
the header when they fit. Keyword/value pairs stay together when possible.
Vectors and maps use fixed indentation. A lossless syntax tree and a small
in-house document printer carry trivia and raw token text; no Prettier runtime
dependency is needed.

## Markdown and tools

A shared fence extractor tracks source offsets and `markdown-fence` origins.
It recognizes backticks and tildes, matching closing lengths, info strings,
indentation and CRLF. Prose and fence delimiters are untouched. Unsupported
container/HTML contexts are skipped and reported rather than guessed at.

`forma fmt [--check] [--strict] <paths…>` and
`forma fmt --stdin --stdin-filepath x.md` share the pure API. Check mode reports
changed paths with short diffs and exits 1; usage errors exit 64. Repository
scripts enumerate tracked Lisp, Forma and Markdown files, excluding intentional
reader-error fixtures. Formatting becomes a required check only after the corpus
migration.

The host JSON ABI exposes formatting. LSP formatting is enabled by default,
returns minimal edits, supports ranges and formats Markdown fences. Editor and
playground commands use the same formatter. No deployment is part of this work.

## Validation and rollout

Implement in eight independently checked commits: this RFC, shared extractor,
lossless core, layout, Markdown/directives, CLI/repo scripts, LSP/UI, then corpus
migration. Each passes `pnpm check`. Tests pin token identity, parsed structure,
idempotence, comments, blank lines, width, syntax identity, seeded trivia
variation and performance on the largest prelude.

The final commit alone reformats the corpus, regenerates prelude sources,
surfaces and homepage snippets, and records the reviewed golden differences.
Documentation must distinguish shipped behavior from planned behavior throughout.
