# Reader and typecheck diagnostic expectations

The `expectation` field in each `reader/*-error/expected.json` and
`typecheck/*/expected.json` stores the success, warning, or error assertion.
These assertions were originally encoded in the retired OCaml corpus gate
scripts and are now reviewed TypeScript expectations. They include expected
codes and author offsets; warning fixtures also pin severity and message.

TypeScript runs every case in `packages/ts/test/shared-corpus.test.ts` as part
of `pnpm test`. For successful typecheck cases it also compares the displayed
type with `normalized.type`. The rest of each `normalized` snapshot is
historical OCaml output and is not compared.

When TypeScript was made the only engine, the inherited expectations were
updated to its current behavior: narrower argument spans in two builtin errors,
qualified constructor names in three match warnings, seven authored span
shifts after migrating numeric annotations to `Int`/`Float`, and display types
in `normalized.type`: `Int`/`Float` where OCaml reported `Number`, `Bool` where
it reported `Boolean`, and keyword literal types (`:else`, `:employee/name`) in
two keyword cases. To change an expectation, edit
the fixture deliberately and review the diff; there is no producer script.
Numeric values and collection semantics are also checked by the
[surface goldens](../surfaces/README.md).
