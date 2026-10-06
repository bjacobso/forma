# TypeScript checker benchmark

The focused runner imports the built `Engine.mjs` and times the complete public
`Engine.typecheck({ source, sourceId: 'benchmark' })` call, including parsing,
lowering, inference, and result projection. It uses the independent-definition
and polymorphic-identity sources from the performance handoff, validates `Int`
and zero diagnostics on every call, and consumes the results outside timing.
Each workload gets three warmup calls and nine timed samples in a persistent
process. Reports retain every sample and its median.

```sh
pnpm install --frozen-lockfile
pnpm --filter @formalang/ts build
node scripts/benchmark-typecheck.mjs --output .context/typecheck-current.json
```

To reproduce paired before/after measurements, build the baseline before making
the source changes, preserve its entire emitted directory, then build the final
implementation. The baseline artifact must keep its supporting modules; copying
just `Engine.mjs` would use the wrong implementation.

```sh
mkdir -p .context/typecheck-baseline
cp -a packages/ts/dist .context/typecheck-baseline/dist
node scripts/benchmark-typecheck.mjs \
  --engine .context/typecheck-baseline/dist/Engine.mjs --label baseline \
  --output .context/typecheck-baseline.json

# Apply the checker changes, then rebuild.
pnpm --filter @formalang/ts build
node scripts/benchmark-typecheck.mjs \
  --baseline .context/typecheck-baseline/dist/Engine.mjs --label optimized \
  --output .context/typecheck-paired.json
```

The paired mode warms both engines, then alternates their order for each timed
sample. `--samples N` and `--warmup N` override the defaults. Import duration and
the first 10-definition check are recorded separately from warm measurements.
Paired import timings share dependency and filesystem caches, so use separate
process runs when inspecting startup; neither is a robust startup benchmark.

## Measurements on this workspace

Baseline source: `bdc817dd9450430ead8f02445a8545bcdc5df2de`. The baseline report
was saved before modifying production source; its dirty flag reflects the new
benchmark and tests. Final reports use that revision plus the production diff.
Machine: Amazon Linux 2023, Intel Xeon 2.90 GHz, eight logical CPUs, Node
24.14.1, Effect 4.0.0-rc.112. Default release package builds, no timing thresholds
in CI. Timed benchmark runs did not overlap OCaml compilation or broader checks.

Paired medians from [typecheck-paired.json](./typecheck-paired.json):

| Workload | Baseline (ms) | Optimized (ms) | Speedup |
| --- | ---: | ---: | ---: |
| 10 definitions | 1.871 | 1.601 | 1.2× |
| 100 definitions | 85.571 | 15.532 | 5.5× |
| 250 definitions | 1,006.236 | 56.994 | 17.7× |
| 500 definitions | 7,615.841 | 194.088 | 39.2× |
| 100 polymorphic uses | 142.105 | 22.623 | 6.3× |

Additional separate process reports preserve the initial
[baseline](./typecheck-baseline.json),
[substitution-only](./typecheck-substitution.json), and
[final](./typecheck-optimized.json) runs. Their 500-definition medians were
7,893.367 ms, 367.969 ms, and 197.185 ms respectively (40.0× baseline/final).
The paired results are the primary comparison; the separate runs show ordinary
process, allocation, GC, and VM timing variation. Small workloads are especially
sensitive to warmup and noise. The original 774cb1d prototype and OCaml timings
are contextual measurements from another checkout and machine, not paired
comparisons with this implementation.

## Ownership and remaining cost

`applyScheme` shares each read-only substitution map when none of that scheme's
quantified variables occur in it. When variables intersect, it copies only that
map and removes all quantified keys. Recursive application and existing
constraint handling stay the same, and the input substitution is never edited.

`inferSource`, `inferSourceAll`, and HM LSP analysis use an internal owned
annotation builder. A fresh map is allocated each time their Effect executes.
Source inference publishes one map copy at the result boundary; LSP analysis
projects stable typed spans without publishing the builder. Failed operations
discard the builder. The exported `makeInferContext` retains copy-on-write maps
so callers holding earlier `Ref.get(nodeTypes)` results keep their snapshots.
Module graph checking also owns its annotation builder for the whole graph;
annotations are neither returned nor used for the lexical registry snapshots
between modules. Form validation and semantic-expression checks likewise keep
their builders private. All substitution/registry snapshot behavior is unchanged.

The module-level DSL provider/raw expressions and declaration-scheme staging
maps in `infer-state.ts` are existing shared state. Program inference restores
providers in `finally` and clears/drains the staging maps around their matching
declarations. This change does not place annotations in that shared state or
alter those lifetimes. Existing synchronous/reentrancy limitations remain
outside this optimization.

Remaining growth is still roughly quadratic: environment application traverses
and rebuilds schemes, generalization scans environments, and unification retains
substitution copies for snapshots and rollback. An exploratory final CPU profile
over these five workloads attributed 24.1% of samples directly to `applyEnv`,
8.3% to `applyType`, and 8.5% to GC. This supports further environment work as a
separate task; it does not justify mutating the other inference maps.

```sh
node --cpu-prof --cpu-prof-dir=.context \
  --cpu-prof-name=typecheck-optimized.cpuprofile \
  scripts/benchmark-typecheck.mjs --label profiled \
  --output .context/typecheck-profiled.json
```

## Correctness validation

`packages/ts/test/inference-state.test.ts` covers all eight combinations of
type/row/effect quantifier intersections, recursive substitutions through free
variables, input ownership, constraint preservation, polymorphic functions and
records, resolved annotations, substitution rollback, public context snapshots,
distinct contexts, repeated Effect executions, failed checks, and LSP recovery.

An additional comparison of the saved baseline and final builds exercised all
84 shared typecheck fixtures through Engine summary/per-expression checking,
`inferSource`, `inferSourceAll`, and HM LSP analysis. All 420 comparisons matched,
including complete annotations, diagnostics, error details, and source origins.

Validation commands:

```sh
pnpm check
pnpm --filter @formalang/ts test
pnpm --filter @formalang/ts typecheck
pnpm build:ocaml
pnpm parity:engines
pnpm --filter @formalang/ocaml typecheck-corpus
FORMA_REQUIRE_NATIVE_MODULES=1 pnpm --filter @formalang/host exec vitest run test/modules.test.ts
```

The final TypeScript suite passed 423 tests, including 22 focused regression
cases. The repository check passed branding, workspace typechecking, JavaScript
tests, and documentation builds; its host suite ran all 80 tests with the native
CLI available. Engine parity passed 136 comparisons with zero engine or golden
differences. Native OCaml 5.2.1 (Dune 3.20.2) passed all 84 typecheck fixtures
(50 successes, seven warnings, 27 errors), and the explicit native module suite
passed all 16 tests. The repository check's two OCaml JavaScript language-server
smoke callbacks returned early because the optional `js_of_ocaml` artifact was
not built; TypeScript HM LSP annotations were
covered by the focused tests and the 84-fixture baseline comparison.
