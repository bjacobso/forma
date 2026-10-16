# Retiring the OCaml engine

Forma had two engines: TypeScript/Effect (`packages/ts`, hosted by
`packages/host`) and OCaml (`packages/ocaml`, built natively and to JavaScript
and WebAssembly). **The OCaml engine has been removed. TypeScript is the only
implementation.** The TypeScript host's JSON CLI (the `forma` bin in
`@formalang/host`) replaces the native `forma_cli` and its JSON ABI daemon.

This page records the decision, the work that made it possible, what remains,
and the engine study of 2026-10-06 that informed it.

## Outcome

The study below found that native OCaml was faster at typechecking and
evaluation, but that most of the TypeScript typechecking gap came from
avoidable copying rather than from TypeScript or Effect. Before removal:

- The checker's substitution and annotation-map optimizations landed in #50
  (about 39× faster on the 500-definition check). See the
  [checker benchmark](https://github.com/bjacobso/forma/blob/main/scripts/benchmarks/README.md).
- Language services moved to one TypeScript analysis workspace (#52), and the
  language server stopped loading the OCaml JavaScript artifact.
- Native OCaml outputs were stored as reviewed goldens and checked against
  TypeScript in ordinary JavaScript CI (#60).
- OCaml-only capabilities were ported to TypeScript: host type policy, the JSON
  CLI and diagnostics (#62), validated artifact payloads and session emission
  (#63), atomic session load validation and the typed stateful REPL (#64),
  descriptor typing hooks and validation (#65), and prelude metachecks and
  session operations in the JSON ABI (#69).
- The TypeScript engine distinguishes `Int` and `Float` (#70, #71) and rejects
  the `Number` and `Num` aliases (#74).

Conformance now uses stored expectations. The
[surface goldens](https://github.com/bjacobso/forma/blob/main/conformance/surfaces/README.md)
were captured from native OCaml and are now maintained from TypeScript output.
When they were regenerated, the only changes were 22 reviewed numeric vocabulary
differences: OCaml displayed `Float` as `Number`, used 63-bit integers, and
accepted `Number` and `Num` annotations. Other stored goldens (canonical IR,
example corpus counts, module snapshots, thesis-gate, reader and typecheck corpora,
artifacts, and session loads) were also captured from OCaml and are now
checked and updated by TypeScript tests with reviewed diffs.

## Remaining follow-ups

- **Analysis reuse.** Per-form memoization, stage 5 of
  [RFC 0004](./rfcs/0004-one-analysis-architecture.md), is not implemented.
  Warm operations still repeat parsing, expansion, compilation, and inference.
- **VM bookkeeping.** The VM step counter still uses an Effect `Ref` update per
  opcode (`packages/ts/src/vm/vm.ts`). The experiment below suggests a large
  dispatch improvement from a local counter, provided step budgets and
  interruption remain explicit.
- **CLI startup.** `forma version` takes roughly 330–470 ms on the TypeScript
  CLI, compared with about 4 ms for the removed native CLI. Bundling or
  narrower imports have not been measured.
- **Native distribution.** There is no native binary. Embedders need Node.js or
  a JavaScript runtime.

The checker's remaining growth is roughly quadratic in environment application
and generalization; see the checker benchmark for its profile.

## Engine study, 2026-10-06

This section is a historical record. It describes both engines as they were at
revision `774cb1d`, before #50 and the later ports. Present-tense statements
about implementation details refer to that revision.

At that revision, **native OCaml was substantially faster at typechecking and
generally faster at evaluation. OCaml compiled to JavaScript had a mixed
advantage: it checked the large synthetic definition programs faster, but was
slower at the larger parsing and collection-evaluation workloads.**

Focused TypeScript prototypes removed most of the large typechecking gap. The
measurements supported optimizing the TypeScript implementation before treating
its performance as an unavoidable cost of TypeScript or Effect.

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

`JsOcamlLanguageHost` spawned Node for each request. Using it repeatedly
incurred startup costs on every operation. The language server then loaded the
same artifact once in a persistent bridge, and these warm benchmarks loaded it
once as well.

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

`type/substitution.ts` copied all three substitution maps whenever
it applied a substitution to a scheme, even when the scheme binds no variables
that occur in those maps. `applyEnv` repeated this for every binding. As a
program grows, repeated environment walks multiply the cost of copying growing
substitution maps.

`type/context.ts` also copied the accumulated `NodeTypeMap` on each annotation
write. Its inference context was created per operation, making an owned mutable
builder a plausible alternative, with a stable read-only result published at
the boundary. Both changes landed in #50.

Separately, the VM uses `yield* Ref.updateAndGet` for its step counter on every
opcode, which is still the case. This is a concrete use of Effect in an execution hot loop. Keeping
Effect around the operation while doing local bookkeeping synchronously can
reduce dispatch cost. Interruptibility must remain an explicit part of that
design.

### Isolated optimization experiments

These experiments patched copies of emitted JavaScript under `.context/`.
Production compiler source was unchanged. Each variant uses nine timed samples.
Outputs match the baseline on six benchmark workloads and 36 shared
typechecking fixtures, including diagnostics and VM step counts. The
500-definition follow-up checks the expected result type and empty diagnostics.
This was evidence for follow-up changes, rather than full production
validation; #50 later implemented the first two prototypes with its own tests
and benchmarks.

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

### Reproducing the study

The harness was `scripts/bench-engines.mjs` and `scripts/bench-ts-experiments.mjs`,
with a small native timing executable in `packages/ocaml/bench/`. They are
preserved in commit `7f26d9f` and were removed with the engine. To reproduce,
check out that commit, set up the OCaml 5.2 toolchain it pins in `mise.toml`,
and run:

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

That checkout includes #50 and later changes, so its results will differ from
the `774cb1d` figures above.

## Patterns carried over from OCaml

The study also listed OCaml design patterns worth keeping in TypeScript:

- **Validated data at compiler boundaries.** OCaml packaging accepted only an
  opaque validated payload. TypeScript now validates artifact payloads before
  packaging and session emission (#63). Decode external data with schemas at
  host and artifact boundaries, and keep these contracts extensible through
  descriptors rather than domain nouns in the core.
- **Small, explicit module interfaces.** Keep consumers on public facades such
  as `Reader.ts`, `Type.ts`, and `Evaluator.ts`. Check import direction, cycles,
  and observable behavior rather than line counts or source snippets.
- **A coherent analysis snapshot.** Language services share one TypeScript
  analysis workspace (#52). Hover, diagnostics, generation, and the compiler
  explorer should consume one immutable result per source and dependency
  revision, with explicit mappings between authored syntax, expanded forms,
  typed nodes, and emitted payloads.
- **Expected errors and internal failures.** Expected authoring failures carry
  source diagnostics; unexpected failures become `internal/error` at the host
  boundary. Keep interruption and cancellation separate, following
  [Effect's expected-error model](https://effect.website/docs/v4/error-management/expected-errors).
  Deterministic transformations can be ordinary functions with locally owned
  state; Effect services suit host capabilities, resources, and state ownership.
- **Behavioral fixtures and diagnostic provenance.** The thesis-gate fixtures
  are stored goldens checked by TypeScript tests. Diagnostics must identify the
  authored expression, descriptor hooks must participate in checking, invalid
  declarations must not reach packaging, and incremental results must agree
  with a fresh analysis.
- **Cache correctness and observability.** OCaml's session tracked source
  hashes, prelude fingerprints, exports, and dependencies, with invalidation
  tests. Port those scenarios before adding caches, and track startup, cold and
  warm analysis, edit latency, memory, and bundle size separately.
