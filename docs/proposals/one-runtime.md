# T7: retain the VM as the kernel runtime

Status: proposal; no runtime implementation changed.

## Evidence and reproduction

```sh
pnpm surfaces
node docs/proposals/scripts/measure.mjs
pnpm bench:latency --out docs/proposals/scripts/latency.json
```

Revision `2cd1a2a`, Node 24.13.0, Apple M2 Max. Surfaces: **249 comparisons,
zero failures**. [evidence.json](./scripts/evidence.json) contains every input,
tree/VM result, differences and timing samples;
[latency.json](./scripts/latency.json) contains the separate public API benchmark.
The measurement script enumerates every `.lisp` under `conformance/`, surface
inline cases, ledger programs, and JSON `source`/`program` strings outside
expectations/goldens: **464 inputs**. It expands once with the shared frontend,
then calls the tree `evaluateCompileTimeExprs` and explicit
`compileProgram`/`runChunkWithStats`, with strict globals and a 10,000-step limit.
VM fallback is deliberately bypassed.

This is a whole-source-corpus sweep, **not full harness parity**. Multi-file,
session, descriptor and hosted service fixtures are attempted independently,
without their load sequences/implementations. JSON source fields are enumerated
mechanically; this is not a catalog of all executable strings in every fixture
format. Additional golden-suite passes do exercise their normal contexts.
Do not infer that two matching “unbound” errors prove a hosted program works.
Top-level functions normalize to `<function>`; values compare printed output,
errors compare tag/message, and steps are recorded but intentionally not
compared between different execution models. Structured ABI, error spans,
closure behavior and service traces need separate acceptance tests.

## Parity result

**28 frontend failures**, shared before runtime; **436 attempted by both**;
**421 exact agreements**, **15 differences**. Both produced values in 198 cases
(197 equal, one unequal). Four cases produced a value on only one path; ten
differed in error tag/message. Complete output is in `corpus.differences`.

Abbreviations: `T/` = `conformance/fixtures/typecheck/`, suffix `/source.lisp`;
`E/` = `conformance/effect-typescript/cases/`, suffix `/program.lisp`.

| Fixture | Tree | VM |
| --- | --- | --- |
| `T/adt-constructor-success` | `{:_tag "Red"}` | Cannot call object as function |
| `T/fn-arity-error` | fn expects 2+ arguments, got 1 | `<function>` |
| `T/if-arity-error` | if expects 2–3 arguments, got 4 | `1` |
| `T/let-binding-vector-error` | let bindings must be a vector | `nil` |
| `T/let-polymorphism-success` | `nil` | `42` |
| `T/arity-mismatch-curried-error` | lambda expects 1 arguments, got 3 | Same text, name `<lambda:1>` |
| `T/arity-mismatch-saturated-error` | lambda expects 2 arguments, got 3 | Same text, name `<lambda:1>` |
| `T/function-overapplication-error` | lambda expects 1 arguments, got 2 | Same text, name `<lambda:1>` |
| `T/partial-application-success` | lambda expects 2 arguments, got 1 | Same text, name `<lambda:1>` |
| `T/non-callable-error` | Cannot call Int as function | Cannot call number as function |
| `T/list-expected-error` | KernelTypeError: first: expected list, got Int | Error: same message |
| `T/nth-index-type-error` | KernelTypeError: nth: expected Int, got string | Error: same message |
| `T/typeclass-hkt-instance-direct-builtin-success` | instance method 'fmap' must evaluate to a function | Same, capitalized “Instance” |
| `E/http-api` | Unbound symbol: service | VM compiler cannot execute compile-time-only form 'handle' |
| `conformance/check-run/seeds/e3-reduce-builtin.lisp` | KernelTypeError: reduce: expected function, got function | Error: same message |

The invalid syntax fixtures are rejected by other language phases; these
results expose raw runtime validation differences, not proof the CLI accepts
them. The `let` value discrepancy is a direct positive-program disagreement.

## Performance and counter experiment

`evaluator/eval.ts:60–65,154–196` already makes ordinary execution VM-first;
`evaluator/vm-bridge.ts:11` limits fallback to unquote forms. Mechanics remains
a separate hosted IR interpreter (`mechanics/runtime.ts`), not a faster kernel
substitute. The tree remains necessary for expansion/compile-time evaluation.

Following `scripts/benchmark-typecheck.mjs`, the script uses three warmups,
nine samples, alternating order, medians, and output validation outside timing.
Parsing/expansion/compilation are outside the evaluation-only timer. VM globals
are freshly copied per run; tree environment setup remains inside its call.
This estimates the execute boundary, not end-to-end latency.

| Workload | Tree ms | VM Ref ms | VM local-cell ms |
| --- | ---: | ---: | ---: |
| 10 definitions | 0.070 | 0.052 | 0.016 |
| 100 definitions | 0.584 | 0.415 | 0.097 |
| 250 definitions | 1.221 | 0.347 | 0.041 |
| 500 definitions | 1.777 | 0.579 | 0.045 |
| map square, 250 callbacks | 1.318 | 0.538 | 0.246 |

`vm/vm.ts:332,537` allocates a Ref per run and yields `Ref.updateAndGet`
per instruction; line 1068 subtracts observer bookkeeping instructions.
The experiment patches **only a temporary built module**, replacing Ref with
a runtime-owned `{value: 0}` cell, incrementing/decrementing synchronously.
The cell is shared across nested callback executions; a counter local to each
`executeVM` invocation would incorrectly reset their budget.
The script asserts that each patch matches exactly once and cleans up its copy.
Across the same **464 inputs**, the patched VM has **zero value/error/step
differences** from baseline. This does not cover cancellation, observation,
all async builtin behavior or every step-limit boundary.

Public API medians from `pnpm bench:latency`: version process **604.603 ms**,
cold file check/500 definitions **1137.300 ms**, warm engine check **177.646 ms**,
workspace edit **729.069 ms**. These measure different operations, not runtime
speedups. Shared-machine load and JIT warmup are substantial confounders: the
250/500 local-cell non-monotonic times preclude extrapolating a universal ratio.

## Options and recommendation

**Keep tree, remove VM:** must intentionally change or repair the five
value/acceptance discrepancies and ten error differences above. Gives up the
measured VM execution advantage; no hosted mechanics replacement follows.
Preludes using expansion still work, but runtime golden compatibility needs
revalidation. Candidate-wide breakage counts are unmeasured.

**Keep VM kernel, retain tree for compile time (recommended):** matches the
shipped facade and timings. Fix constructor and raw validation contracts before
removing fallback. Keep shared value/builtin semantics. Existing 249 surface
comparisons already pass with VM-first execution; no golden changes are needed
for this proposal. Local-cell prototype changes zero measured outcomes.

**Route everything through mechanics:** requires compiling general kernel code
and compile-time macros into hosted IR. The 149-case checker matrix in
[one-checker.md](./one-checker.md) demonstrates incompatible input domains.
There is no measured executable replacement; do not call its breakage count
zero. Retain mechanics as an orchestration adapter for services/Effect semantics.

## Mergeable stages and acceptance

1. **Parity contracts PR:** independently expected results for all 15 cases,
   plus normal session/module/service harnesses. Acceptance: classify intentional
   domain errors; pin constructor, lexical scope and malformed-form behavior;
   no broad golden update.
2. **Counter PR:** replace Ref with shared per-run state. Acceptance: identical
   values/steps at limits 0/1/exact/exceeded; recursive and builtin callbacks,
   simultaneous runs, failures, cancellation and observer instructions; rerun
   paired evaluation timing and surfaces. No output golden changes expected.
3. **Kernel parity PR:** fix constructor/validation/diagnostic contracts and
   resolve the `let` discrepancy against intended lexical semantics. Acceptance:
   all five value/acceptance discrepancies resolved, source spans retained,
   each intentional diagnostic golden change individually reviewed.
4. **Retirement PR:** remove runtime fallback only after quoted/unquoted syntax,
   modules and normal prelude loading pass. Acceptance: facade executes runtime
   code through VM only; expansion still works through compile-time tree;
   mechanics service harnesses, all surfaces and `pnpm check` pass.

## Risks

Macro expansion still needs the tree; deleting its directory is not a viable
first step. Hosted async/suspension semantics differ from VM opcode execution.
Optimization must preserve shared budgets, reentrancy and observation. Printed
corpus equality and baseline golden success are necessary evidence, not proof
that a runtime or hosted adapter can already be deleted.
