# Formatter corpus migration

The final formatter commit applies [RFC 0018](./rfcs/0018-formatter.md) to the
corpus, separately from the implementation commits. It also updates the source
producers so regenerating preludes or documentation preserves the formatter's
output.

## Source review

The migration audit compares 153 Lisp/Forma files and 80 Markdown files with
the preceding implementation commit. Across their 360 code units, authored
token spellings, comment text/order and trailing-comment attachment are
unchanged. All 352 parseable units retain their parsed structure and syntax IDs.
The eight invalid fences remain byte-for-byte unchanged. Markdown prose and
fence delimiters are unchanged apart from the explicit documentation updates.

The style keeps two-space indentation, 80 columns and the existing map layout.
The implementation commit includes the blank-line padding correction found by
this migration, so the corpus commit adds no formatter-engine behavior changes.
The audit and corpus tests cover shorthand, escaped strings and numeric spelling.
The workbench demo has 29 outline layout rows after shorter forms become inline;
its 14 top-level forms are unchanged. Header-projection tests use an explicit
multiline fixture, and the identity test compares IDs directly instead of using
a row-count threshold.

Generated `sources.generated.ts` embeds the formatted preludes. The derived
`ontology-ir.lisp` producer now formats its output before checking or writing it;
`preludes:generate` builds the formatter first. Documentation example sources
use the formatter before compilation, so source snippets and their diagnostic
locations agree. The copied entity schema and entity descriptor match their formatted repository
sources. The copied Elm counter matches the executed conformance case;
its missing-update variant and the command diagnostic's line expectation were
updated for the new layout. The wildcard-update rejection test now matches the
intervening whitespace and checks that its input mutation actually occurred.

The regenerated size table has 885 meaningful Forma lines and 1,359 generated
TypeScript lines, a ratio of 1.54. The Effect page now says about 1.5 times as many
lines and roughly 1.7 times as many characters. These are formatting-dependent
measurements, not additional language capabilities.

## Golden and surface review

All 112 surface expectation sets regenerate successfully; 13 surface JSON files
change and the other 99 remain unchanged. Across the 63 changed conformance JSON reference
files, a recursive leaf comparison finds 13,709 changed values, exclusively
source offsets, line numbers and columns. Diagnostic codes, severity, messages,
verdicts, types, declaration payloads, array order and hashes are unchanged.

The generated homepage diagnostic adds one further JSON reference change:
its two span offsets move, and its message's embedded location changes from
`at offset 209` to `at offset 205`. Its diagnostic code and remaining message
text are unchanged. Across all 64 JSON files there are 13,712 changed values:
13,711 numeric location fields and this one embedded offset.

The changed reference files are:

| Reference | Files | Reviewed change |
| --- | ---: | --- |
| Surface goldens | 13 | Reader/expanded tree locations and authored spans |
| Effect rejection diagnostics | 34 | Offsets, lines and columns of the same diagnostics |
| Typecheck fixtures | 15 | Expected authored diagnostic spans |
| Canonical IR fixture | 1 | Declaration provenance spans |
| Homepage diagnostic | 1 | Two span offsets and the message's embedded offset |

All positive Effect TypeScript and HttpApi builder code goldens remain
byte-identical. Module interface, portable scheme and linked-module goldens
remain unchanged. `corpus-golden.json` remains unchanged, retaining 58 example
sources, 548 declarations and the same kind/module counts. The canonical IR
fixture retains its historical native envelope and un-compared native source
hashes; only its compared provenance locations are refreshed.

## Checks and retained limits

Validation includes the whole-corpus token, structure, comment, blank-line,
width and idempotence tests; seeded trivia mutations; syntax identity and timing
checks; CLI/LSP agreement including unsaved Markdown dependencies; editor cursor
and undo tests; and browser Format/shortcut/undo tests. Run `pnpm check`,
`pnpm website:build` and `pnpm test:site` to reproduce the repository and site
checks. Package tests were also run serially in this VM to avoid the existing
five-second compiler-test timeouts under concurrent package load.

`pnpm check` now includes `format:check`. Intentional reader-error programs and
formatter fixtures are excluded. Checking still reports the eight fragment
fences (nine diagnostics) and nine module-layout fallbacks in illustrative or
intentionally invalid programs; ordinary checking permits these reports.
`--strict` rejects them. No fragment programs were repaired, and no planned
language features were added to make the examples resolve.

The changeset covers `@formalang/ts`, `@formalang/host`,
`@formalang/language-server` and `@formalang/editor`. The private workbench
remains unpublished and unversioned.
