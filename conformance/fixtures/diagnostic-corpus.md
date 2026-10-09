# Reader and typecheck diagnostic expectations

The `expectation` field in each `reader/*-error/expected.json` and
`typecheck/*/expected.json` stores the success, warning, or error assertion
previously encoded in the OCaml corpus gate scripts. It includes expected codes
and author offsets; warning fixtures also pin severity and message. Existing
`normalized` snapshots are retained as historical comparison data; the new
`expectation` field is authoritative for the current native gate assertions.

The OCaml scripts remain unchanged as the reference implementation. TypeScript
runs these stored assertions in `packages/ts/test/shared-corpus.test.ts` as part
of `pnpm test`. Every case runs, including known differences. A `typescript`
override must provide an explicit reason and a complete expectation; it is not
a skip. Currently the differences are narrower argument spans in two builtin
errors and qualified constructor names in three match warnings. Numeric and
collection semantics are outside this corpus port.
