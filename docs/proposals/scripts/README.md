# Trust proposal measurements

Run from the repository root with Node 24 and the frozen pnpm dependencies.
No network or additional dependencies are needed.

```sh
pnpm surfaces
node docs/proposals/scripts/measure.mjs
pnpm bench:latency --out docs/proposals/scripts/latency.json
```

`pnpm surfaces` rebuilds ts and host before checking their reviewed goldens.
`measure.mjs` overwrites only `evidence.json`. Its counter experiment rewrites
three expressions in a temporary copy of the built VM module, resolves imports
to the original engine, and removes the copy in `finally`. No package source,
test, built VM module or golden is edited. Patch match assertions intentionally
fail if the built VM layout changes.

The checked-in JSON files are observations from revision
`2cd1a2a14fb0c43a183615179076676d255bdb66`, not golden expectations. Timings will
vary. Preserve original rejection text in this raw evidence, including any
existing diagnostic presentation defects; proposals use descriptive prose.

## Coverage

- `parity`: every conformance `.lisp` file plus inline surface and ledger
  programs, and JSON `source`/`program` strings outside expected/golden data.
  Inputs are independent, without fixture-specific sessions, modules or service
  implementations. Shared expansion failures are counted separately. Equality
  is printed values (top-level functions normalized) or error tag/message;
  it is not structured value, source-location or side-effect-trace equivalence.
- `matrix`: every kernel typecheck source and Effect case program, through raw
  HM inference and mechanics elaboration independently. At least one mechanics
  declaration is required for acceptance. Specialized Elm/email/HTTP generator
  routing is deliberately not substituted for the mechanics checker.
- `numeric`: all eight ledger entries through the public check/evaluate facade.
  `numericInterventions`: four explicit Int annotation examples and two explicit
  Float branch edits, demonstrating bounded author-level repairs. These do not
  implement constrained inference, annotation enforcement, or typed coercions.
- `prelude`: independent source checks of every `.lisp` prelude. These omit
  normal prelude session setup; their errors are not prelude regression counts.
- `timing`: evaluation only, shared expanded forms, precompiled VM bytecode,
  three warmups/nine samples and alternating order. Compilation is excluded;
  environment setup/copying is included. Every sample's result is checked.
  `localCounterDifferences` compares values, errors and step counts over the
  same corpus, including frontend failures. No async/cancellation/observer
  equivalence is claimed.

## Verification from this work package

| Command | Result |
| --- | --- |
| `pnpm surfaces` | Pass: 249 comparisons, 0 failures, 0 runner failures; rebuilds ts/host |
| `node docs/proposals/scripts/measure.mjs` | Pass: 464 inputs, 15 tree/VM differences; 0 counter differences; 149 checker fixtures |
| `pnpm bench:latency --out docs/proposals/scripts/latency.json` | Pass: report written; baseline not updated |
| `pnpm --filter @formalang/ts test test/numeric-types.test.ts test/check-run.test.ts test/effect-typescript-conformance.test.ts` | Pass: 3 files, 155 tests |
| `ALCHEMY_HOME=$(mktemp -d) pnpm check` | Failed in test phase: 8 test timeouts at 5000 ms; 1153 ts tests passed. Earlier branding, legacy-form guard, alchemy, diagnostic and type checks passed. Later gates were not reached. |
| `pnpm --filter @formalang/ts test test/descriptor-typing.test.ts test/effect-typescript-codegen.test.ts test/effect4-schema-codegen.test.ts test/http-api.test.ts --maxWorkers=1` | Pass: all 4 failed-suite files rerun; 85 tests passed |
| `pnpm check:preludes` | Pass: 135 form docstrings and 135 checked examples |
| `pnpm docs:build` | Pass: bundles/pages and llms structure/source/link checks |
| `pnpm website:build` | Pass: website/docs build, assembled site and llms checks |
| `pnpm test:site` | Failed before browser tests: sandbox denied Wrangler loopback bind on 127.0.0.1:9229 |
| `node --check docs/proposals/scripts/measure.mjs` | Pass |
| Node `existsSync` assertion on `dist-docs/proposals` | Pass: no proposal output directory |
| Node assertions on both output directories and proposal word counts | Pass: excluded from dist-docs/dist-site; all three proposals under 1,500 words |
| `git diff --check` | Pass |

Full-check failure tail:

```text
Test Files  4 failed | 58 passed (62)
Tests  8 failed | 1153 passed (1161)
Failed: @formalang/ts#test
ERROR run failed: command exited (1)
```

All eight failures said `Test timed out in 5000ms`. They covered record/query
descriptor cases, two Effect generation cases, two schema codegen cases and
one HTTP builder case. The successful serial rerun is evidence of load
sensitivity, not a claim that the complete check passed.

Two initial measurement-script attempts failed while developing the harness;
both were corrected before recording evidence. The first omitted `await` on
public engine operations and ended with
`TypeError: Cannot read properties of undefined (reading 'filter')`. The second
did not relocate a side-effect import in the temporary VM copy and ended with
`ERR_MODULE_NOT_FOUND: Cannot find module '…/forma-trust-…/opcodes.mjs'`.
The final script awaits those operations and relocates both import forms;
its subsequent recorded runs passed.

Site-test failure tail:

```text
[WebServer] [ERROR] Failed to bind to 127.0.0.1:9229: permission denied.
Error: Process from config.webServer was not able to start. Exit code: 1
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @formalang/website test:site
Exit status 1
```

This failed at local server startup, before browser assertions. The separate
website build passed; the test command also completed its own build before
Wrangler could not bind.

No stored golden was rewritten. No package source/test, changeset, commit,
deployment or release was created. Alternative-wide numeric compatibility and
full hosted/session runtime parity remain implementation gates, explicitly
identified in the proposals.
