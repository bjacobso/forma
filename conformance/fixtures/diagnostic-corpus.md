# Reader and typecheck diagnostic expectations

The `expectation` field in each `reader/*-error/expected.json` and
`typecheck/*/expected.json` stores the success, warning, or error assertion
previously encoded in the OCaml corpus gate scripts. It includes expected codes
and author offsets; warning fixtures also pin severity and message. Existing
`normalized` snapshots are retained as historical comparison data; the new
`expectation` field is authoritative for the current native gate assertions.

The OCaml compiler remains unchanged as the reference implementation. Native
fixture readers recover the original annotation vocabulary using the
[hash-pinned input manifest](../ocaml-reference/README.md). TypeScript
runs these stored assertions in `packages/ts/test/shared-corpus.test.ts` as part
of `pnpm test`. Every case runs, including known differences. A `typescript`
override must provide an explicit reason and a complete expectation; it is not
a skip. Currently the differences are narrower argument spans in two builtin
errors, qualified constructor names in three match warnings, and seven authored
span shifts after migrating numeric annotations to Float. Numeric values and
collection semantics are checked in separate parity fixtures.
