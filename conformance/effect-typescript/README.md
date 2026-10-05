# Effect TypeScript conformance

This suite runs Effect programs written in Forma end to end. Each program is
read, projected to mechanics declarations, checked, and generated as an Effect
4 (`effect@4.0.0-rc.112`) module. The generated module is compared with a
golden file, typechecked under the repository's strictest settings, and
executed. Programs that Forma must reject are checked for their exact,
located diagnostics.

The runner is `packages/ts/test/effect-typescript-conformance.test.ts`, which
runs as part of `pnpm test:js`. `pnpm typecheck` also typechecks every golden
and harness through `tsconfig.json` in this directory, which extends
`tsconfig.base.json` (`strict`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`,
`noImplicitReturns`, `noPropertyAccessFromIndexSignature`).

[`COVERAGE.md`](./COVERAGE.md) maps Effect constructs to Forma forms and
lists what is still missing. [`docs/effect.md`](../../docs/effect.md) is the
language guide.

## Positive cases

A directory under `cases/` with these files:

| File | Purpose |
| --- | --- |
| `program.lisp` | The Forma program. |
| `expected.ts` | The exact generated module, which is the golden. |
| `harness.ts` | A default-exported `async function check(): Promise<void>`. It imports `./expected.js`, provides layers and test implementations, runs the program, and asserts values and typed failures with `node:assert/strict`. |

For each positive case the runner checks that:

1. `Mechanics.generateEffectProgram` reports **no diagnostics**, not even
   warnings;
2. the output equals `expected.ts` after normalizing line endings and
   trailing whitespace;
3. `expected.ts` and `harness.ts` typecheck with this directory's
   `tsconfig.json`, and `expected.ts` contains no `any` escapes. It may not
   contain explicit `any` or `unknown`, type assertions other than
   `as const`, non-null assertions, `@ts-` directives, or any value
   expression whose inferred type is `any`;
4. the projected declarations package as a validated artifact
   (`packageArtifact`), so every IR node satisfies its payload contract;
5. the harness passes.

| Case | Covers |
| --- | --- |
| `crud-users` | Brands, enums, optional fields, tagged errors, a repository service with a Forma `Ref`-backed layer, CRUD operations, `match` on `Option`, `catch` |
| `multi-service-checkout` | Six services, layers that depend on services, operations called from layer methods (captured context), `layer-provide`/`layer-merge`, layer signatures, `provide` |
| `resource-scope` | `acquire-release`, `scoped`, `add-finalizer`, `ensuring`, a layer holding a scoped resource; release order on success and failure |
| `concurrent-workflow` | `all` over records and tuples, bounded `for-each`, `retry`, `race`, `timeout` and `TimeoutError`, `fork`/`join`, `sleep`, `Ref` |
| `typed-errors` | `catchTags`, catch-all, `map-error`, `or-else-succeed`, `option`, `result` matched as data, `or-die` |
| `schemas-and-decoding` | Tuples, unions, maps, annotations, tagged unions matched by tag, decoding JSON with `SchemaError` recovery |
| `config-and-logging` | `Config` reads with defaults, `ConfigError`, `log` |
| `pure-domain-logic` | `Schema.Class`, typed constants, pure functions, value-level `match`, collection and string functions |
| `stream-pipeline` | Stream construction, effectful mapping with concurrency, `take`, folds, `runForEach`, functions returning streams |
| `operational-effects` | The fixture shared with the OCaml engine (`../operational-effects`) |
| `edge-cases` | Regressions from adversarial testing: escaping, binder capture, prototype keys, shadowing, literal widening, literal and error matches, `provide` inside layer methods |

## Negative cases

A directory with `program.lisp` and `expected-diagnostics.json`:

```json
{
  "typescript": "rejects",
  "diagnostics": [
    {
      "phase": "check",
      "severity": "error",
      "code": "mechanics/undeclared-error",
      "message": "Operation lookup can fail with UserNotFound, but its signature declares no errors.",
      "line": 8,
      "column": 11,
      "endLine": 8,
      "endColumn": 34
    }
  ]
}
```

The program must produce exactly these diagnostics, with at least one error,
and every diagnostic must have a location. `typescript` records what
TypeScript says when the checker is bypassed and the projected declarations
are generated anyway:

- `rejects`: TypeScript would also reject the generated code; Forma reports
  the mistake earlier, against the Forma source;
- `accepts`: Forma is stricter than TypeScript here (for example truthiness,
  reference equality on records, or `Int` versus `Number`);
- `not-generated`: the generator cannot translate the program (for example
  an unknown name);
- `not-projected`: projection itself rejects the program (a malformed form).

## Adding a case

1. Create `cases/<name>/program.lisp`. Start it with a comment that says what
   the program exercises.
2. For a positive case, write `cases/<name>/harness.ts` that imports from
   `./expected.js`. For a negative case, create
   `cases/<name>/expected-diagnostics.json` containing `[]`.
3. Generate the goldens:

   ```sh
   cd packages/ts
   FORMA_UPDATE_GOLDEN=1 pnpm vitest run test/effect-typescript-conformance.test.ts
   ```

4. Read the new `expected.ts` or `expected-diagnostics.json` as carefully as
   you would read hand-written code. The golden is the specification.
5. Run the suite without `FORMA_UPDATE_GOLDEN` and run `pnpm typecheck`.
6. If both engines should project the program the same way, add it to
   `../engine-parity/cases.json` with the `effect-ir` pass.

Harnesses should test behaviour that only a correct translation produces:
error tags and payloads, resource release order, actual concurrency bounds,
requirements satisfied by the right layer. Checking that a call returns
something is not enough.
