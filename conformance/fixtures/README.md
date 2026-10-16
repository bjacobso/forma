# Engine fixtures

Implementation-neutral reader, typechecker, and canonical-artifact fixtures.
They were first consumed by the retired OCaml gate and are now checked by the
TypeScript suites: `packages/ts/test/shared-corpus.test.ts` for `reader/` and
`typecheck/` (see [`diagnostic-corpus.md`](diagnostic-corpus.md)),
`packages/ts/test/artifacts.test.ts` for
[`canonical-ir/`](canonical-ir/README.md), and
`packages/host/test/json-abi.test.ts` for `host-plumbing.json`.
