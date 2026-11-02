# RFC 0015: Tests in Forma

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-16 |
| Scope | A `test` declaration, assertions, exclusion from interfaces and artifacts, a host test operation, `forma test`, Effect program tests, stored test outcomes |
| Direction | Tests are module declarations that run in isolated, requirement-free evaluations and report structured results through the host |

## Summary

A module can declare tests next to the code they test:

```lisp
(: increment (-> Int Int))
(define increment [value] (+ value 1))

(test "increment adds one"
  (expect-equal (increment 41) 42))
```

`test` declarations can see the module's private definitions. They are not
exports and do not appear in interfaces, artifacts, or generated code unless
tests are requested. A new host operation, `runTests`, runs each test in its
own evaluation and returns one structured result per test. `forma test` prints
those results or emits them as JSON, and exits non-zero when a test fails.

A test in an Effect program is an Effect whose requirement set must be empty.
It supplies every service through `provide`, usually with the local providers
of [RFC 0014](./0014-local-providers.md). A test that would reach a real
service is therefore rejected by the checker before it runs.

## Motivation

The [Effect page](../effect.md) states that "Tests are TypeScript harnesses
written against the generated module. Forma has no way to write tests, test
layers, or property checks in Forma itself." Kernel programs have no test
facility either. Every Forma behavior is pinned from TypeScript test code, so a consumer writing a domain prelude has to leave the language to
check it.

Loon shows the alternative. Its `test` form lives in the module, assertions
are a handful of builtins, and effectful code is tested by swapping handlers
instead of using a mocking library. Its runner reports JSON for CI. Forma has
stronger contracts to offer: closed requirement sets make "this test touches
no real service" a type error rather than a convention.

Tests also give conformance a cheap surface. A conformance fixture that is a
Forma test can be run and its outcomes compared with stored expectations,
without writing a golden for every intermediate value.

## Current state

- **No test forms or assertions.** The default builtins
  (`packages/ts/src/builtins/index.ts`) and the preludes define no `test`, `assert`, or `expect`. The kernel has `fail`, which fails
  with `FailError` (`builtins/control.ts`), and `assert-valid`, which checks a
  value against a runtime schema (`builtins/schema.ts`).
- **An unimplemented `test` syntax already exists.**
  `examples/staffing/tests/staffing-smoke.test.md` uses
  `(test name (:arrange ...) (:assert ...))`, and `test.md` uses `test-suite`.
  Nothing runs them. The since-removed OCaml engine silently ignored
  top-level `test` and `test-suite`. The TypeScript elaborator reports
  `elaborate/unknown-form`,
  and the corpus tests filter that out (`test/elaborate-program.test.ts`,
  `test/ontology.test.ts`).
- **Prelude forms cannot run tests.** A `form` body is evaluated at compile
  time with pure builtins and a step limit (`surface/form.ts`). In file
  modules, non-syntax holes are evaluated, but `(Expr T)` holes are
  typechecked and kept as syntax, never run, and effects are never invoked
  (`modules/compile-time.ts`, [File modules](../modules.md)). A form can
  report `:check` diagnostics, but it cannot run a runtime entry point or
  produce a pass/fail report.
- **Module runtime.** `modules/runtime.ts` runs definitions on import and runs
  an entry module's bare expressions, returning the last value. Effect
  programs are rejected with `module/effect-runtime`. There is no notion of a
  declaration excluded from interfaces and artifacts.
- **Equality.** The kernel's `=` is structural over lists, vectors, maps, and
  tagged values (`kEquals` in `evaluator/types.ts`). Functions never compare
  equal. In
  Effect programs, the checker restricts `=` to primitives, enums, and brands
  (`mechanics/equality`), because generated TypeScript would compare records
  by reference.
- **Command line.** `packages/host/src/cli.ts` provides `forma request`,
  `daemon`, `version`, and `file <typecheck|evaluate|interface|declarations>`.
  [RFC 0002](./0002-modules-and-packages.md) lists `forma test` as a proposed
  command, and [RFC 0013](./0013-runnable-host.md) proposes `check`, `run`,
  `interface`, `repl`, and `attach`, but not `test`.
- **Effect harnesses.** `conformance/effect-typescript/cases/*/harness.ts`
  imports each generated module and asserts with `node:assert/strict`.

## Proposal

### The `test` declaration

```lisp
(test "name" body)
(test "name" :tags [:slow] body)
```

`test` is a kernel declaration, not a prelude form, because it needs the
evaluator and the runner. Its name is a string literal that is unique within
the module, so a test is identified by module identity plus name. The body is
an expression checked in module scope after every definition. It can refer to
private bindings and imports.

Tests are excluded from:

- module interfaces and `moduleGraph` exports;
- artifacts, `emit`, and declaration counts;
- `generateEffectProgram` output, unless `{ tests: true }` is passed;
- imports: importing a module never runs or exposes its tests.

A module can consist only of tests, so tests can also live in a separate file
that imports the module under test. That file sees only exports.

### Assertions

| Form | Meaning |
| --- | --- |
| `(expect condition)` | Fails unless `condition` is `true`. The condition must be `Bool`. |
| `(expect-equal actual expected)` | Fails unless the values are structurally equal. Both have one type. |
| `(expect-match value pattern)` | Fails unless `value` matches `pattern`. Pattern bindings are not exported. |
| `(expect-failure expr)` | In kernel tests, fails unless evaluating `expr` fails. |

A failed assertion is a diagnostic with code `test/assertion`, the span of the
assertion, and `details` containing `actual` and `expected` value projections.
The first failed assertion ends the test. `expect-match` is a macro over
`match`; the others are builtins.

In Effect programs the same names are Effect operations:
`(expect-equal a b)` has type `(Effect Unit [TestAssertion])`, where
`TestAssertion` is an error declared by the test vocabulary. Structural
equality in generated TypeScript uses a generated deep-equality helper, not
`===`. The checker's `mechanics/equality` restriction on `=` is unchanged.

### Effect program tests

A test in an Effect program has a body of type `(Effect A [E ...] [])`. Any
error ends the test as a failure, and the requirement set must be empty:

```lisp
(test "save-user writes the name once"
  (do! [writes (ref-make (: [] (List String)))
        saved (provide (save-user "Bob")
                (implement Store
                  (define get [key] (succeed "Bob"))
                  (define set [key value]
                    (ref-update writes (fn [xs] (conj xs value))))))
        seen (ref-get writes)
        _ (expect-equal saved "Bob")]
    (expect-equal seen ["Bob"])))
```

`save-user` and `Store` are the declarations from the
[RFC 0014 example](./0014-local-providers.md#requirement-discharge).

A remaining requirement is reported as `test/requirement` at the call that
introduced it. This is the existing `mechanics/undeclared-requirement` check
with an empty declared set and a test-specific message. A test that needs a
real service has to say so. The proposal intentionally gives no way to say so
in this first version (see decisions).

With `{ tests: true }`, the generator appends:

```ts
export const __formaTests: ReadonlyArray<{
  readonly name: string;
  readonly span: { readonly startLine: number; readonly startColumn: number };
  readonly effect: Effect.Effect<unknown, unknown, never>;
}> = [ /* one entry per test */ ];
```

Because the requirement type is `never`, any Effect runner can run the tests.
A documented adapter runs them under Vitest or `node:test`. Generated test code
is never emitted into a module built for production.

### Running tests

```ts
interface RunTestsRequest {
  readonly sessionId: string;
  readonly entry: string;                 // module source id
  readonly filter?: string;               // substring of the test name
  readonly tags?: readonly string[];
  readonly stepLimit?: number;            // per test
}
interface TestResult {
  readonly module: string;
  readonly name: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly span: Span;
  readonly diagnostics: readonly Diagnostic[];
}
interface RunTestsResult {
  readonly results: readonly TestResult[];
  readonly diagnostics: readonly Diagnostic[];   // check failures; no test ran
}
```

`runTests` checks the module graph first. If checking fails, no test runs.
Each test then runs in a fresh evaluation, so one test cannot observe another,
with a per-test step limit. Host builtins are not in scope for tests. A test
that reaches one is rejected when the module is checked, with
`test/host-call`. [RFC 0016](./0016-host-call-journals.md) proposes replaying
recorded host calls, which would allow such tests.

Results are ordered by module and then source order. They contain no timing,
so the same program gives the same result on every run.
Hosts can measure duration themselves.

`forma test <entry> [--filter text] [--json]` calls `runTests` and prints one
line per test, then the failing diagnostics with source excerpts. With
`--json` it prints `RunTestsResult`. It exits 1 if any test fails or checking
fails, and 0 otherwise. Kernel tests run in the engine. In the first stage,
Effect program tests run through the generated module and the adapter, not
through `forma test`.

### Domain test vocabularies

The staffing example's `(test name (:arrange ...) (:assert ...))` is a domain
test vocabulary: queries, picks, and constraint checks over an ontology. This
RFC does not standardize it. Once core `test` exists, the example should use a
prelude form with a different name, for example `ontology-test`, that expands
or elaborates into core `test` declarations. Until then, the TypeScript
engine reports an explicit `test/legacy-syntax` diagnostic for that form, so
tests are never ignored without a report.

## Alternatives considered

- **A prelude `test` form.** Domain vocabulary belongs in preludes, but forms
  run only pure code at compile time and produce IR. A runner needs evaluation
  at run time and a result channel. Assertions could still move to a prelude
  once forms can declare runtime builtins.
- **Separate test files only.** Same-file tests can check private helpers,
  which most Forma modules have, and they keep a test next to the behavior it
  pins. Separate files remain possible.
- **Keep TypeScript harnesses.** They will still be needed for host
  integration. They cannot use Forma values or types directly, and each one
  restates the module's contract.
- **Property checks.** Generators for Forma types would follow naturally from
  types as schemas, but they need their own design for shrinking and seeds.

## Conformance

Kernel tests are portable. A new fixture, `conformance/tests/`, holds modules
whose expected outcomes are lists of `{name, status, code?, span?}`, stored as
reviewed goldens and compared with the normalized outcomes of `runTests`.
Effect program tests depend on the mechanics checker and generator. (As
proposed, both engines implemented kernel tests and the parity runner compared
their outcomes; the OCaml engine has since been removed.)

## Implementation stages and validation

1. **Kernel tests (TypeScript).** `test`, the assertions, exclusion from
   interfaces and artifacts, and `runTests`. Fixtures cover a passing test, an
   assertion failure with `actual` and `expected` details, a check failure
   that runs no test, a test that sees a private helper, an import that does
   not run the imported module's tests, and a test that reaches a host builtin.
2. **Command.** `forma test`, with exit codes and JSON output pinned by tests
   that run the binary.
3. **Effect program tests.** Test declarations in the mechanics pipeline, the
   empty-requirement rule, `{ tests: true }` generation, and the adapter. This
   depends on [RFC 0014](./0014-local-providers.md). A new
   `conformance/effect-typescript` case runs generated tests whose providers
   record calls. A negative case shows a test that still requires a service.
4. **OCaml parity.** Dropped: the OCaml engine was removed.
5. **Legacy syntax.** The engine reports `test/legacy-syntax` for the staffing
   form until the example is migrated.

## Decisions still required

- Whether tests may opt into host builtins or real services, for example with
  a `:requires` option and runner grants under
  [RFC 0012](./0012-checked-evaluation.md).
- Whether `forma test` should run Effect program tests directly, which needs a
  way to load generated TypeScript from the command.
- Whether tests can be parameterized over a list of cases.
- Whether conformance fixtures that pin values should migrate to Forma tests,
  and which fixtures must keep exact goldens.

## Related designs

Loon's [testing guide](https://loonlang.com/guide/testing) defines an
in-module `test` form, four assertions, and testing by swapping effect
handlers. Rust's `#[test]` functions and `cargo test` exclude tests from
normal builds and can test private items. Effect's `@effect/vitest` runs
Effect values as tests with services provided by layers.
