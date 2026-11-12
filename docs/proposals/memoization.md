# Per-form analysis reuse

Status: design only (A6d, ask 0001); RFC 0004 stage 5 remains proposed.
Scope: workspace-local reuse, then module checking. No persisted form cache,
solver replacement, or runtime evaluation caching is proposed here.
The original expansion/lowering/inference cutoff plan is at
`docs/rfcs/0004-one-analysis-architecture.md:126`, with stage status at line 155.

## Evidence and present state

Read the earlier report at
`/Users/benjacobson/Development/personal/worldvm-project/reports/forma/a6-memoization.md`.
Its `.context/a6-memoization/profile.mjs` is absent from the reported worktree.
That attempt correctly stopped before treating operation snapshots as form
snapshots. `git log --all --grep=A6b` and `git show 7df13d5` identify the later
optimization: scheme free-variable caching and cheaper environment substitution,
with reported warm-edit medians 153 → 114 ms. That is historical evidence,
not a measurement of this proposal.

Evidence is at revision `8a44902`. Implementation paths without a repository
prefix below are relative to `packages/ts/src/`.

| State | Ownership and behavior today |
| --- | --- |
| Environment | `packages/ts/src/type/infer-program.ts:131` owns the evolving name → scheme map; components apply substitutions, seed recursive names, generalize, and publish it (203–279). Generalization reads **all environment free variables**, not only referenced names (`type/scheme-ops.ts:16`). |
| Substitution and supply | `type/context.ts:105` owns substitution and fresh type/row/effect variables; `type/substitution.ts:25` has three maps. Snapshots preserve these and counters (`type/inference-snapshot.ts:8`). |
| Pending constraints | `type/context.ts:139` stores class obligations with origins; instantiation appends them (`type/scheme-ops.ts:139`), generalization moves eligible obligations into schemes (45), and program end discharges residuals (`type/infer-program.ts:325`). Row obligations currently live in row/effect substitutions and immediate unification (`type/unify.ts:264`), not a separate pending-row queue. Numeric applications currently check arguments and specialize callbacks inline (`type/infer-core.ts:771`, 807); there is no separate numeric-obligation queue on this branch. |
| Holes/effects | `type/context.ts:61`, 96, 107 stores each hole's expression, expected type, captured environment/global names and ambient effect state. Candidate search runs after inference and restores trial substitutions (`type/holes.ts:22`). A new unrelated binding can change hole candidates. |
| Type registries | `type/context.ts:124` holds aliases/parameters, nominal records, errors, ADTs, constructor ownership, classes and instances. `type/infer-state.ts:13` additionally holds the active DSL provider/raw expressions and staging maps for constructor/class/service schemes. |
| Descriptors/expansion | Scope carries macros, descriptor prelude and provider (`analysis/scope.ts:27`); local form declarations bootstrap/merge descriptors and typing hooks (`type/unified-form-provider.ts:28`). These affect expansion, lowering and checking, beyond HM schemes. |
| Module bindings | `modules/check.ts:86` constructs lexical import environments using resolved symbols, export identities and dependencies; class/instance scope resets per module, and imported type declarations inform lowering (145). This is separate from workspace analysis. |
| Results/locations | Context owns diagnostics, node types and hook nodes (`type/context.ts:115`). `lsp/hm-lsp.ts:269` combines recoverable errors and mechanics results; final substitution resolves typed nodes and source excerpts (295–323). Schemes also carry declaration/annotation spans (`type/infer-program.ts:267`). |

Only persistent solver state belongs in today's
`InferenceSnapshot`; it omits pending obligations, holes, ambient effects,
annotations, hooks, diagnostics, provider/staging state and the environment.
It cannot be replayed as a complete form result. Current workspace cache keys
invalidate the whole document on any text revision (`analysis/workspace.ts:178`).

## Proposed unit and contract

Use a dependency component: one ordinary form, or an entire strongly connected
component (SCC) of definitions within the existing contiguous definition run.
Preserve `definitionComponents` ordering and signature placeholders
(`type/infer-program.ts:58`, 193–218); never generalize members independently.
Recompute component membership after insert/delete/rename or reference changes.
Do not extend recursion across declaration barriers as part of caching.

Key inputs:

- Authored content digest, attached signature digest, ordered form identity,
  resolved lexical bindings, and expansion/lowering/checker version and policy.
- Ordered prelude scope digest: source identities/content, macros, descriptors,
  typing hooks, host builtin provider and unbound-symbol policy. Host callbacks
  without stable fingerprints use workspace generation tokens.
- Canonical schemes of referenced bindings, including constraints, kinds,
  arity, numeric-operator/nullary/effect metadata; registry entries and macro
  bindings read, including failed lookups and shadowing. Initially use a coarse
  registry epoch when precise reads are unavailable.
- Imported identities, resolution/lock configuration and interface digests;
  imported macros/forms also require implementation digests.
- Ambient **free** environment variables and any incoming obligations that can
  affect the component. Referenced schemes alone do not justify generalization
  reuse. Initially require a closed environment and no escaping obligations;
  otherwise run the existing whole-document path.

Outputs are frozen expanded/lowered nodes, exported schemes, result type,
registry/binding deltas, typed-node/hook results, diagnostics, dependency reads
and provenance. A complete later replay contract also records constraint
additions/removals with origins, hole goals and captured scopes, effect state,
and substitutions on incoming free variables. These are data, not a restored
mutable context. Allocate component-local variables and alpha-rename every
type/row/effect reference on replay; never splice an old global substitution
or counter into a new analysis. Keep provider staging operation-local and drain
it before publishing a component.

First implementation caches successful, closed HM components only; programs
with holes, unresolved constraints, registry writes, descriptors/macros or
mechanics ownership use full analysis. Later stages broaden this contract.
Preserve current recovery behavior on misses; extraction must not silently
change today's partial rollback semantics (`type/infer-program.ts:228`, 309).

Store locations as source identity plus form/node-relative anchors. Reproject
all primary, related, fix, declaration and annotation spans into the current
document, recomputing offsets, lines/columns, excerpts, IDs and ordering.
Cross-form references point to current binding anchors. Unknown macro origins
force a miss. Equal content at two locations must remain two occurrences.
Never compare rendered type strings or emit solver/mangled names as interfaces.

## Invalidation and cutoff

An edit invalidates its expansion/lowering unit and rebuilt SCC, then traverses
reverse semantic dependencies. Adding/deleting/shadowing a name invalidates
resolution reads, including previously unbound references. Reordering forms
revalidates declaration barriers and scope. Holes additionally depend on the
visible candidate environment, not merely explicit references.

Stop propagation only when canonical exported schemes **and** registry,
constraint, validity/recovery and expansion-facing outputs are equal. A same-signature body edit
still refreshes local diagnostics/annotations; diagnostics and source positions
are projected independently of the semantic cutoff. Explicit signatures do not
license skipping the edited body. Changed signatures invalidate consumers even
if printed types happen to match.

Type/constructor/class/instance and `form` declarations invalidate their users,
pattern exhaustiveness, implicit metadata lookup, descriptor validation and
hook applications. Initially invalidate the affected suffix (or whole document
for globally collected forms); refine only with read tracking. Macro changes
invalidate expansion users even when the macro's type is unchanged.

Import edits rebuild resolution and affected interfaces first. A private body
edit with unchanged exported type metadata can cut off importer inference;
compile-time exports and imported-file diagnostics still refresh. Module
cycles retain the resolver's existing policy. Workspace file resolution is not
yet the module checker: do not claim this design completes LSP import parity.

The brief identifies open PRs #155/#158 for prelude snapshot caching; their
live status was not queried (offline task). Locally available refs contain
`fb266ae` (`feat/prelude-cache-and-check`) and `e18a772` (RFC 0029).
The former's `packages/ts/src/node/prelude-cache.ts:51` keys persisted snapshots
by build/Node/V8 identity. Compose by treating a validated prelude snapshot as
an upstream scope input; include ordered source and semantic scope digests,
not object identity or disk-cache hit status. Prelude changes invalidate scope
and downstream components; missing/corrupt snapshots fall back to source.
Disk snapshots must not serialize live form contexts or check tables.

## Numeric semantics and one checker

The in-progress numeric work moves solving after callback inference. Do not
freeze a numeric result at the first operator visit. Its new obligations,
origins, numeric policy and solver version must enter the replay contract;
publish only after the callback/SCC solve-and-generalize boundary. Until then,
any residual numeric obligation disables reuse. Add tests for named/aliased
operators, Int/Float widening, reducer accumulators and callback rejection.

Follow [one-checker.md](./one-checker.md): keep HM schemes private to inference,
expose located displays through the analysis adapter, and retain mechanics
authority for its declarations. Cache ownership must record the checker and
version. Mechanics IR and WeakMap tables are one result
(`mechanics/checked.ts:1`); retain them together or recheck, never clone tables
onto new nodes. Initial HM caching leaves mechanics documents on full analysis.

## Measurement and mergeable stages

Reproduction (no dependencies added):

```sh
pnpm --filter @formalang/ts build && pnpm --filter @formalang/host build
pnpm bench:latency --out docs/proposals/scripts/memo-latency.json
node docs/proposals/scripts/memo-profile.mjs
pnpm --filter @formalang/ts test test/analysis-equivalence.test.ts
pnpm docs:build
```

Results are recorded in [memo-latency.json](./scripts/memo-latency.json) and
[memo-profile.json](./scripts/memo-profile.json). On Node 24.13.0 / Apple M2 Max,
latency medians were **108.18 ms warm workspace edit**, 115.91 ms warm engine
check and 511.21 ms cold file check. The separate profiler measured 115.37 ms
uninstrumented versus 116.32 ms instrumented warm edits; unchanged SCCs cost
91.28 ms median, versus 0.16 ms for the edited SCC. Across all thirty samples,
**78.36% of instrumented warm-edit elapsed time** was inside unchanged SCCs.
The scratch profiler instruments
only a disposable dist copy, alternates instrumented/uninstrumented checks,
warms three edits and measures thirty. It attributes elapsed SCC time including
environment application/generalization; excludes parse/lower, graph construction
and final projection. GC inside a component is charged to it. The unchanged
final expression is excluded, so this is a conservative attribution of repeated
analysis work, not a predicted speedup. This workload has 499 unchanged
independent definitions and one edited definition; it does not model dependents,
preludes or mechanics. Machine contention and timer overhead limit precision.

Every implementation PR must pass the equivalence harness
(`analysis-equivalence.test.ts:78`, fixed seed 6004), extended with its boundary
cases and `FORMA_PROPERTY_SCALE=5`; preserve surfaces and conformance. Latency
targets below use paired `pnpm bench:latency` medians on the same quiet machine,
relative to its post-A6b baseline B; no CI wall-clock assertions.

| PR | Acceptance and latency target |
| --- | --- |
| 1: Extract component transactions, caching disabled | Replay-free equivalence, registry/error rollback and fresh-variable isolation tests; warm edit ≤1.05B, other latency metrics ≤1.10 baseline. |
| 2: Closed HM SCC reuse and span projection | Body/signature/insert/delete/rename, shifted related/fix spans, SCC split/merge; counters show only edited SCC inferred for independent-500. Warm edit ≤0.50B; cold/engine ≤1.10 baseline. |
| 3: Deferred obligations and registry/expansion reuse | Numeric callbacks, rows/effects, holes/candidate changes, ADTs, instances and macro/form edits match cold analysis; warm edit ≤0.35B on independent-500, plus dependent-chain counters and unchanged-signature cutoff. |
| 4: Module/prelude integration | Unsaved imports, imported errors, export/private-body edits and prelude replacement match CLI/embedding/LSP contracts where supported; snapshot on/off parity. Retain ≤0.35B warm edit, cold ≤1.10 baseline; separately benchmark prelude-heavy/import workloads. |

Main risks: hidden provider reads, whole-environment generalization, obligations
escaping components, stale locations, identity-sensitive tables, quadratic
environment replay, and retained cache memory. Bound entries per document and
release removed sources; counters and a long-edit memory test must prove reuse
does not merely move full analysis into replay. Fail closed to full analysis
when dependency tracking or provenance is incomplete.
