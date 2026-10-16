# Engine consolidation and performance

This is an engineering assessment of the current implementations, rather than
an adopted change to Forma's two-engine architecture. It records patterns worth
preserving if TypeScript becomes the authoritative engine and measurements that
should inform that decision.

## Patterns to preserve from OCaml

### Validated data at compiler boundaries

OCaml's `Artifact_validated_payload.t` and `Packageable_declaration.t` have
opaque interfaces. Packaging takes a validated payload instead of arbitrary
JSON. TypeScript's `PackageableDeclaration.payload` currently accepts
`JsonValue`; runtime contract validation occurs later.

Introduce privately constructed `ValidatedDeclaration` and `CheckedProgram`
types, with validation as the only supported way to create them. Packaging
should accept validated declarations, and target generation should accept a
checked program. Decode external data with schemas at host and artifact
boundaries; use typed representations within the compiler. A brand alone does
not validate data at runtime.

Keep these contracts extensible through descriptors and consumer-provided
validators. The language core should continue to work without knowing domain
nouns such as entities or workflows.

### Small, explicit module interfaces

OCaml `.mli` files expose operations, failures, and intentionally visible
representations. TypeScript already has public facades such as `Reader.ts`,
`Type.ts`, and `Evaluator.ts`. Strengthen those with explicit exported function
signatures, private implementation details, and import rules that keep
consumers on supported entry points.

The existing directory structure is a reasonable starting point:

| Modules | Responsibility |
| --- | --- |
| `reader`, `syntax`, `surface` | Authored syntax, identity, expansion and lowering |
| `type`, `elaboration` | Semantic checking and typed construction |
| `evaluator`, `vm` | Execution |
| `artifact`, `mechanics` | Validated output, mechanics checking and target generation |
| `session`, `engine` | State ownership, orchestration and public operations |

Share foundational source and diagnostic types without depending on the engine
orchestration module. Keep serialization and transport at adapters. Split files
when their responsibilities or dependencies diverge. OCaml's fixed line-count
limits and source-snippet gates are less useful than checking import direction,
cycles, and externally observable behavior.

### A coherent analysis snapshot

OCaml's `Typed_core.program` bundles a result type with annotations carrying
node identity, source spans, expressions, types, and symbol information.
TypeScript already has `CoreExpr`, `NodeTypeMap`, and symbol services. Assemble
those into one immutable result for a particular source/dependency revision.
Hover, diagnostics, generation, and the compiler explorer should consume that
result instead of reconstructing semantic facts independently.

Preserve distinct intermediate representations where stages need them. Record
explicit mappings between authored syntax, expanded forms, typed nodes, and
emitted payloads, including macro provenance.

### Expected errors and internal failures

OCaml's ABI catches unexpected exceptions as `internal/error`, while expected
authoring failures carry source diagnostics. TypeScript's
`diagnosticFromUnknown` currently recursively converts both Effect failures and
defects through the same path.

Use typed failures for expected compiler errors, collect independent
diagnostics where appropriate, and classify defects as internal failures at the
host boundary. Preserve interruption and cancellation separately. This agrees
with [Effect's expected-error model](https://effect.website/docs/v4/error-management/expected-errors).

Ordinary functions suit deterministic transformations. Effect services suit
host capabilities, resource lifetimes, cancellation, and state ownership.
Inference can keep locally mutable state behind a narrow operation; every
internal update does not need to be an independently yielded Effect.

Neither existing engine is uniformly pure or encapsulated. For example,
TypeScript's `type/infer-state.ts` stores inference state in module globals,
and OCaml's session signature exposes mutable tables. Preserve the useful
contracts while improving ownership and reentrancy.

### Behavioral fixtures and diagnostic provenance

Port the OCaml thesis-gate fixtures into shared conformance tests. They check
result types, descriptor annotations, and the actual authored text covered by
diagnostic spans, including errors inside expanded forms and nested slots.
Keep small reviewed goldens and complete consumer programs.

Prioritize these invariants:

- Diagnostics identify the authored expression that caused an error.
- Descriptor hooks participate in inference and checking.
- Invalid declarations cannot reach packaging or target generation.
- Editing, deleting, or replacing a definition does not retain stale bindings.
- An incremental result agrees with a fresh analysis of the same sources.
- Changes in public exports invalidate dependent analyses correctly.

Property tests are useful for substitution, unification, and source/edit round
trips. Avoid tests that depend on particular helper names or source snippets.

### Cache correctness and performance observability

OCaml's session tracks source hashes, prelude fingerprints, bindings, exports,
dependencies, and artifact caches. Its cache tests and benchmarks exercise
invalidation and separate cold load, warm summaries, and edits.

Port the invalidation scenarios first, then introduce caching with fresh-result
equivalence tests. Track startup, cold analysis, warm analysis, edit latency,
retained memory, and bundle size separately. Run timing budgets on controlled
hardware; use deterministic work/reuse counters for ordinary CI.

## Performance study

On this checkout, **native OCaml is substantially faster at typechecking and
generally faster at evaluation. OCaml compiled to JavaScript has a mixed
advantage: it checks the large synthetic definition programs faster, but is
slower at the larger parsing and collection-evaluation workloads.**

Focused TypeScript prototypes remove most of the large typechecking gap. The
measurements support optimizing the TypeScript implementation before treating
its current performance as an unavoidable cost of TypeScript or Effect.

### Environment and method

Measured on 2026-10-06 at revision `774cb1d`, in an Amazon Linux cloud VM with
an Intel Xeon processor at 2.90 GHz and eight logical CPUs. Versions: Node
24.14.1, OCaml 5.2.1, js_of_ocaml 6.2.0, and Effect 4.0.0-rc.112. OCaml uses
the repository's release profile and JavaScript `--effects=cps` configuration.
Production compiler source was unchanged for these measurements.

Each engine runs in a persistent process. Nine timed batches follow warmup;
batch size targets approximately 100 ms where individual calls are shorter.
Results below are median milliseconds per operation. Processes perform timed
work sequentially, and engine order rotates across workloads. Timers exclude
worker pipe round trips. Garbage collection inside a batch remains included.

TypeScript uses the public `Engine` operations. Native and JavaScript OCaml use
the public JSON ABI. This includes OCaml request decoding and response encoding;
TypeScript normally returns an object. These are useful embedding costs, but
the parse rows are not isolated parser-algorithm comparisons. A separate JSON
round-trip experiment below checks the impact of this asymmetry.

Other implementation costs differ too. TypeScript builds per-node type
annotations during summary inference; the OCaml summary operation does not
request its typed-core annotation output. TypeScript evaluation includes VM
compilation, step-budget bookkeeping, and source-trace support. The measurements
compare current public operations on the same source, rather than attributing
all differences to the implementation language or matching every internal task.

All benchmark cases must succeed. Evaluation checks known numeric results;
typechecking compares inferred types; parsing and expansion compare AST
structure, excluding spans. Expansion compares runtime forms because OCaml
retains macro declarations that TypeScript removes. Native and JavaScript
OCaml results also agree. `Str` is normalized to `String`; `Number` is
normalized to `Int` only for these integer-only benchmark results. This does
not assert general equivalence of their numeric type systems.

The workloads include arithmetic; 10, 100, and 500 independent definitions;
polymorphic calls; 100 macro invocations; map/reduce over literal vectors; real
preludes and checkout source; and the shared operational-effects contract.
The definitions end in a reference to their last binding. Collection programs
compute the sum of `x*x + 1` over integers from zero to `n-1`.

### Baseline results

| Workload | TypeScript / Effect | Native OCaml | OCaml JavaScript |
| --- | ---: | ---: | ---: |
| Parse 100 definitions | 0.414 ms | 1.525 ms | 8.057 ms |
| Check 10 definitions | 1.411 ms | 0.161 ms | 1.144 ms |
| Check 100 definitions | 87.915 ms | 3.938 ms | 33.488 ms |
| Check 500 definitions | 7,818.309 ms | 87.322 ms | 658.616 ms |
| Check 100 polymorphic uses | 143.723 ms | 6.847 ms | 63.459 ms |
| Expand 100 macro calls | 5.511 ms | 1.111 ms | 7.119 ms |
| Evaluate 100 definitions | 2.570 ms | 1.334 ms | 6.268 ms |
| Evaluate 500 definitions | 33.666 ms | 13.928 ms | 71.982 ms |
| Evaluate 1,000-element map/reduce | 9.710 ms | 3.169 ms | 22.367 ms |
| Parse ontology prelude | 7.441 ms | 27.575 ms | 112.932 ms |
| Parse checkout program | 0.451 ms | 1.799 ms | 8.041 ms |
| Check operational-effects contract | 1.691 ms | 0.312 ms | 2.507 ms |

Native OCaml checks 100 definitions about **22× faster** and 500 definitions
about **90× faster**. OCaml JavaScript is about **2.6×** and **12× faster** on
those same checks. The increasing gap indicates a scaling problem in the
current TypeScript implementation.

For the 1,000-element map/reduce program, native OCaml is about **3.1× faster**;
TypeScript is about **2.3× faster than OCaml JavaScript**. The small
operational-effects contract also checks faster in TypeScript than in OCaml
JavaScript. There is no single useful multiplier for an entire engine.

Adding request decoding and response JSON encoding to TypeScript's ontology
parse raises its median to **11.766 ms**. In that separate run native OCaml is
**26.518 ms** and OCaml JavaScript **108.013 ms**. Serialization explains some
of the original parsing difference, but TypeScript still wins this public
operation under the added JSON work.

The [complete baseline report](/benchmarks/2026-10-06-engines.json) contains all
23 workloads, batch sizes, samples, p95 batch averages, and correctness
summaries. The [JSON parse report](/benchmarks/2026-10-06-json-parse.json)
records the additional transport experiment.

### Startup and host lifetime

| Fresh process plus module import or version request | Median |
| --- | ---: |
| TypeScript Engine module in Node | 324.0 ms |
| Native OCaml version request | 2.7 ms |
| OCaml JavaScript version request in Node | 67.5 ms |

These measure process launch and initialization with warm filesystem caches,
including process exit. They are not browser download or browser startup
measurements. The TypeScript package uses its existing unbundled Node build;
the OCaml JavaScript artifact is one compiled file. Module loading and package
layout contribute to the difference.

`JsOcamlLanguageHost` currently spawns Node for each request. Using it repeatedly
incurs startup costs on every operation. The language server already loads the
same artifact once in a persistent bridge, and these warm benchmarks load it
once as well. A persistent worker or in-process adapter would remove repeated
startup from the generic JavaScript host.

The warm baseline calls do not reuse parsed syntax, compiled bytecode, inferred
types, or source artifact caches. They measure repeated uncached source
operations in a warm process. Actual editor sessions, dependency invalidation,
domain elaboration, artifact emission, host effects, browser execution, and
memory retention need separate workload studies. The study does not measure
generated Effect TypeScript applications or WebAssembly.

### What causes the TypeScript gaps?

A Node CPU profile of 120 checks of the 100-definition program attributes about
66% of samples directly to `applyScheme` and another 6% to the node-type map
update. This is one workload's profile, including initialization; it is not a
general attribution of compiler time.

`type/substitution.ts` currently copies all three substitution maps whenever
it applies a substitution to a scheme, even when the scheme binds no variables
that occur in those maps. `applyEnv` repeats this for every binding. As a
program grows, repeated environment walks multiply the cost of copying growing
substitution maps.

`type/context.ts` also copies the accumulated `NodeTypeMap` on each annotation
write. Its inference context is created per operation, making an owned mutable
builder a plausible alternative, with a stable read-only result published at
the boundary.

Separately, the VM uses `yield* Ref.updateAndGet` for its step counter on every
opcode. This is a concrete use of Effect in an execution hot loop. Keeping
Effect around the operation while doing local bookkeeping synchronously can
reduce dispatch cost. Interruptibility must remain an explicit part of that
design.

### Isolated optimization experiments

These experiments patch copies of emitted JavaScript under `.context/`.
Production compiler source is unchanged. Each variant uses nine timed samples.
Outputs match the baseline on six benchmark workloads and 36 shared
typechecking fixtures, including diagnostics and VM step counts. The
500-definition follow-up checks the expected result type and empty diagnostics.
This is evidence for follow-up changes, rather than full production validation.

The substitution prototype reuses a substitution map when none of a scheme's
bound variables occurs in it. It copies and removes entries only when required.
The node-map prototype additionally writes annotations into the inference
operation's owned map. The counter prototype separately replaces the VM's
Effect Ref updates with a local mutable counter shared by that execution.

| Typechecking workload | Baseline | Avoid unnecessary substitution copies | Also use owned node-type map |
| --- | ---: | ---: | ---: |
| 100 definitions | 92.344 ms | 20.517 ms | 15.912 ms |
| 250 definitions | 1,029.702 ms | 88.434 ms | 56.713 ms |
| 100 polymorphic uses | 138.279 ms | 34.277 ms | 21.499 ms |
| 500 definitions, follow-up | 7,818.309 ms | 337.691 ms | 188.749 ms |

The first three rows have a separate same-study baseline, so they differ
slightly from the main table. The 500-definition baseline is from the main
study. On that larger case, avoiding substitution copies alone gives about a
**23× improvement**. Adding the owned node map gives about **41× overall**.
The resulting **189 ms** is within about **2.2× of native OCaml** and about
**3.5× faster than baseline OCaml JavaScript** on the same source.

| Evaluation workload | Baseline | Local VM counter |
| --- | ---: | ---: |
| 1,000-element map/reduce, source to value | 10.251 ms | 6.563 ms |
| 1,000 arithmetic forms, source to value | 6.919 ms | 5.230 ms |
| Same arithmetic forms, precompiled execution | 0.979 ms | 0.060 ms |

The precompiled row excludes reading, expansion, and compilation in both
variants. It reuses one bytecode chunk and creates fresh runtime state for each
run. The roughly **16× dispatch improvement** becomes a **1.3× end-to-end
improvement** when the frontend remains included. The collection program
improves about **1.6×**. Phase separation matters when judging an optimization.

The [experiment report](/benchmarks/2026-10-06-ts-experiments.json) contains
samples and output-equivalence results. These are sequential experiments on
one VM, not statistical confidence intervals or guarantees for other programs.

### Recommended performance work

1. **Avoid unnecessary substitution-map copies.** Preserve quantified-variable
   exclusion and occurs-check behavior; verify with property tests and the
   existing inference/conformance suites. This has the strongest measured
   payoff and requires no language redesign.
2. **Use an owned annotation builder.** Publish a stable result after inference,
   and check snapshot ownership, concurrent operations, failure recovery, and
   source provenance before changing mutation policy.
3. **Reduce Effect bookkeeping per VM opcode.** Preserve exact step budgets,
   nested callback counts, observation, cancellation, and scheduling fairness.
   Batch interruption/yield checks explicitly; simply removing all per-step
   yielding could make long-running evaluations less responsive.
4. **Reuse frontend and analysis work.** Cache lossless syntax, expansion,
   bytecode, and typed analysis by source/dependency/prelude revisions. Keep
   host execution and effects out of caches whose semantics require freshness.
   Port the OCaml invalidation fixtures before relying on these caches.
5. **Measure startup independently.** Test a bundled TypeScript entry and
   narrower or deferred imports. Keep browser and language-server workers alive.
   Replace per-request process creation in the generic OCaml JavaScript adapter
   if that adapter remains supported.
6. **Profile again after each improvement.** Environment substitution,
   generalization, builtin dispatch, diagnostic construction, and allocation
   may become the next dominant costs. Benchmark representative consumer
   sessions before making a final engine decision.

The experiments support a TypeScript path with competitive performance, while
native OCaml still has a real advantage in current uncached analysis and
execution. Keeping the OCaml fixtures and temporary reference engine during
the optimization and language-server migration would make consolidation easier
to evaluate.

The reproducible harness is `scripts/bench-engines.mjs`, with a small native
timing executable in `packages/ocaml/bench/`. It compares persistent TypeScript,
native OCaml, and OCaml JavaScript processes, then measures process startup
separately. Successful outputs are checked before results enter the report.

```sh
pnpm install --frozen-lockfile
pnpm --filter @formalang/ts build
pnpm build:ocaml
cd packages/ocaml
opam exec -- dune build --profile release bench/engine_bench.exe
cd ../..
node scripts/bench-engines.mjs --report .context/engine-benchmark.json
# Optional: compare parsing with JSON work added to TypeScript.
node scripts/bench-engines.mjs --case prelude-ontology.lisp/parse \
  --wire-typescript --report .context/engine-benchmark-wire.json
# Optional: rerun the isolated TypeScript optimization prototypes.
node scripts/bench-ts-experiments.mjs
```

The OCaml prerequisites are pinned in `mise.toml`. Native and JavaScript targets
are sufficient for this study; WebAssembly is outside the comparison.

## Consolidation sequence

1. Make TypeScript authoritative for new semantic changes if consolidation is
   selected. Retain OCaml as a temporary migration reference.
2. Preserve diagnostic, descriptor, artifact, and invalidation fixtures.
3. Introduce validated artifact types and a coherent analysis snapshot.
4. Address measured TypeScript bottlenecks and compare again.
5. Move the language server to the TypeScript host, preserving diagnostics,
   hover, completion, cross-file behavior, and consumer preludes.
6. Remove OCaml from required builds only after the supported consumer workflows
   pass and their performance is acceptable.

Native deployment needs and measured latency should influence the final engine
choice alongside maintenance cost. Browser compatibility alone does not select
TypeScript: OCaml already builds to JavaScript through
[js_of_ocaml](https://ocsigen.org/js_of_ocaml/).
