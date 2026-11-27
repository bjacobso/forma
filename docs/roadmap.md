# Roadmap

## Current foundation

- One public distribution, `@forma-language/forma`, prepared but not yet on npm.
  Use a source checkout or a tarball packed from `main`; see [Publishing](/publishing).
- One TypeScript engine: lossless reader, formatter, macros, Hindley–Milner
  inference, descriptor-aware checking, evaluation, and a VM.
- A human CLI: `check`, `run`, `test`, `fmt`, `repl`, `explain`, and `describe`;
  `forma mcp` exposes language tools to agents. JSON commands and the daemon
  remain available for automation.
- `createLanguage` is the embedding facade, with typed capabilities, `onHostCall`
  approval hooks with author spans, typed holes, and diagnostics that carry
  source spans, help, and repair information.
- `checkedRun` and `CapabilityManifest` inspect reachable typed capabilities and
  source/prelude SHA-256 digests before execution, paired with cooperative
  resource budgets (`steps`, `timeoutMs`, `hostCalls`, `maxExpansionSteps`,
  `maxResultBytes`) and `node:worker_threads` isolation recipes
  (`examples/worker-isolation/`, `examples/flagship/`).
- Host-call journals (`forma-journal/v1`, RFC 0016 stages 2–3) record live host
  calls to JSONL and deterministically replay them with zero live host calls,
  detecting program mismatches and call divergence.
- Operational Effect inference, Effect signature polymorphism (RFC 0023 stages
  1–3 and 5), `forma:effect` lowering (`class`, `layer`, `catch`), portable
  artifacts, editor services, a multi-file language server (resolving local
  imports, `forma:*` libraries, and `forma.json` packages), closed-SCC HM
  memoization per workspace document, and the browser playground. Conformance
  fixtures pin observable behavior.
- Native unary RPC/group generation through the [RPC prelude](./effect/rpc.md).
- Prototype Effect Cluster entities with in-memory state and checked delivery
  rules through the [cluster prelude](./effect/cluster.md).
- An output-neutral linker for the RPC, HTTP API, Cluster, and file-module form
  families, emitting one module and a [system graph](./effect/system.md) from a
  mixed program.

## Critical path

Forma's active roadmap focuses on one end-to-end path: **Forma → Effect
TypeScript + Content-Addressed Transactional Store + Verification/Contracts**.
Items below are proposed or in-progress work, not features already merged to
`main` or compatibility commitments.

### 1. Content-addressed store, contract evolution, workflow laws, and cacheable Effect tests

- **Content-addressed transactional store & CLI**
  ([RFC 0029](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0029-content-addressed-codebase-store.md),
  proposed; not merged to `main`): layer an optional content-addressed codebase
  store beneath `.lisp` projections with hash-keyed checking/test/verification
  evidence, optimistic-concurrency transactions, and CLI workflows.
- **Directional contract evolution**
  ([RFC 0027](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0027-contract-evolution.md),
  proposed; not merged to `main`): comparable contract snapshots, directional
  wire-compatibility diffs, and explicit pure payload migrations beyond raw
  contract hashes.
- **Finite workflow laws**
  ([RFC 0028](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0028-bounded-verification.md),
  proposed; not merged to `main`): validate domain workflow and evidence safety
  laws with bounded exploration and counterexamples before investing in
  solver-backed verification.
- **Cacheable Effect tests**
  ([RFC 0014](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0014-local-providers.md),
  [RFC 0015](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0015-tests-in-forma.md),
  [RFC 0023](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0023-effect-polymorphism.md)):
  build seeded property/fault-schedule Effect testing and reusable test doubles
  on top of `forma test` and shipped Effect polymorphism (RFC 0023 stages 1–3
  and 5 are implemented; RFCs 0014 and 0015 remain proposed).

### 2. Independent trusted core checker & live browser store demo

- **Independent trusted core checker**
  ([RFC 0022: programmable type system, Stage 1](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0022-programmable-type-system.md),
  proposed; not implemented): specify and implement a small independent checker
  that re-checks elaborated core programs, separating checking trust from the
  inference/elaboration pipeline.
- **Live browser store demo** (proposed; not implemented): demonstrate the
  content-addressed transactional store, cached evidence, and Effect TypeScript
  compilation directly in the browser playground.

### 3. Multi-agent Effect TypeScript benchmark (Gate 3) & npm publication

- **Multi-agent Effect TypeScript benchmark (Gate 3)**: target agent repair on
  the hard tier of **at least 7 of 8 tasks**, with a **median of at most 2
  repair rounds**. These are acceptance targets, not reported results. Typed
  holes ([RFC 0026](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0026-typed-holes.md)),
  located diagnostics ([RFC 0017](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0017-diagnostic-catalog.md)),
  `forma test`, and MCP provide the repair loop; the benchmark must measure
  whether that loop works.
- **`@forma-language/forma` npm publication**
  ([RFC 0025](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0025-single-npm-distribution.md),
  accepted; implementation in progress): validate the single package in a clean
  consumer, stabilize the host ABI and artifact schema around end-to-end
  consumer examples, and prepare its first npm publication.

Agent execution safety belongs to
[RFC 0012](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0012-checked-evaluation.md)'s
existing checked-run/host boundary, not a new sandbox language. Durable
workflows belong to checked IR plus native Effect activities and persistent
recovery tests
([RFC 0016](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0016-host-call-journals.md)),
not a new execution kernel. Contract hashes, static types, and bounded laws do
not authenticate evidence or secure an in-process native host.

## Active supporting work

### Trust work in progress

Shared data-type relations, numeric branch-join coercion, and VM fallback
retirement have landed, while remaining raw throw boundaries and full checker
convergence are active work. They are not claims of a verified language.
The independent trusted kernel and elaborator protocol remain proposed.
Cross-file persistent caching remains future work beyond per-document SCC
memoization; a VS Code extension is on hold.

### Everyday checker gaps

[RFC 0019](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0019-everyday-checker-gaps.md)
collects gaps found while writing the
[SICP-style guide](./structure-and-interpretation.md) and the
[domain modeling guide](./domain-modeling.md). The evaluator and the unified
Hindley–Milner typechecker (which now checks pure, DSL, and Effect programs)
share checked contracts and cross-pass fixtures for `reverse`, `sqrt`,
`reduce`, `conj`, list `concat`, and `quot`. The builtin inventory records
remaining pass-specific names and legacy gaps; it does not claim complete
builtin parity. Stage 2 is also implemented: non-exhaustive closed-constructor
matches are errors across pure and Effect code (PR #141). Stage 3 preserves
qualified constructor types through local bindings and collection joins, and
lets optional record fields accept existing options. Named callbacks and
compile-time literal refinement checks are now implemented in the unified
checker, and the legacy `mechanics/check.ts` solver has been retired. Local
definitions and zero-argument functions still have gaps, and unannotated
arithmetic infers `Float`. The guides document today's workarounds. The
remaining fixes are otherwise proposed, not implemented or scheduled.

### Effect polymorphism

[RFC 0023](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0023-effect-polymorphism.md)
adds error-set and requirement-set variables in Effect signatures, so that
user-written higher-order operations, such as wrappers and reusable test
doubles, pass their callbacks' effects through without over-approximating them.
Stages 1–3 and Stage 5 (single HM checker parity) are implemented. Stages 4 and
6 remain proposed. It does not add continuations.

### Elm-style application prototype

The [Foldkit prelude prototype](/elm) generates Effect / Foldkit TypeScript with
exhaustive message updates, typed command recovery, and pure Hiccup views. It
has a strict golden and headless conformance harness. Command arguments,
subscriptions, richer views, editor/worker integration, and shared HttpApi
server/client declarations remain proposed work. There is no
production-readiness claim.

## Deferred sidequests

The following RFCs are **Deferred (off critical path)** while Forma focuses on
the critical path above. Already-shipped prerequisites (such as closed-shape
row operations in
[RFC 0005](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0005-row-operations.md),
FX2 authored-syntax retention, and stage 0 [Clojure spellings](./clojure.md))
remain supported as-is; the remaining proposal work is parked.

| RFC | Topic | Shipped baseline | Deferral reason |
| --- | --- | --- | --- |
| [RFC 0003](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0003-direct-style-effects.md) | Direct-style effects | None | Explicit `Effect`/`do!` is the shipped foundation. |
| [RFC 0006](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0006-qualified-rows.md) | Qualified rows and generic record programs | Closed-shape `Pick`/`Omit`/`Merge` ([RFC 0005](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0005-row-operations.md)) | Parked until after Milestones A–C. |
| [RFC 0007](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0007-type-normalization.md) | Shared type normalization for record consumers | None | Parked until after Milestones A–C. |
| [RFC 0008](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0008-typed-form-results.md) | Typed declaration reflection and form result templates | FX2 authored-syntax retention | Typed result templates parked until after Milestones A–C. |
| [RFC 0009](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0009-field-names-and-row-map.md) | Bounded field names, key sets, and row mapping | None | Parked until after Milestones A–C. |
| [RFC 0018](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0018-type-generics.md) | Type generics and collection inference | Built-in HM polymorphism | Author-facing contract expansion parked until after Milestones A–C. |
| [RFC 0021](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0021-languages-as-libraries.md) | Languages as libraries | Stage 0 [Clojure spellings](./clojure.md) (`preludes/modules/clojure.lisp`) | Multi-dialect surfaces and `.cljc`/Racket/Scheme/Common Lisp emitters deferred. |
| [RFC 0022 (effect hosts)](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0022-effect-hosts.md) | Effect hosts (TypeScript, Go, Rust) | Effect TypeScript only | Go/Rust Effect hosts deferred while owning Effect TypeScript completely first. |
| [RFC 0024](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0024-inspectable-grammar-descriptions.md) | Inspectable grammar descriptions | None | Evaluation-only grammar descriptions deferred. |

Other deferred work:

- General-purpose application-language positioning.
- A stable package or wire-format compatibility promise.
- Automatic registry publication or website deployment.
- Additional backends without a concrete consumer and conformance target.

## Review baseline and corrected claims

This review used shared main
[`38b3da9`](https://github.com/bjacobso/forma/commit/38b3da9bdcca99cdbcbb2a88ab5f761b9d472316)
on 2026-11-11, not open PRs or another thread's local edits:

| Review claim | Verified disposition and owner |
| --- | --- |
| Two checker representations remain | Resolved for solving: pure, DSL, and Effect programs now check through the single HM checker (`packages/ts/src/type/`), and `mechanics/check.ts` is retired. `mechanics/types.ts` remains only as the IR/codegen projection representation; RFC 0022 owns independent core re-checking. |
| Hooks can supply unjustified types/scope | Yes: `surface/form.ts` resolves hook-returned type syntax and scope; no independent core re-checker validates the claimed term. Projection IR is validated separately. RFC 0008 adds proposed static hook contracts. |
| Optional hook inputs are raw, not Options | Yes: the current hook ABI is documented in Writing a form; do not silently change it. |
| Numeric, generic-row and Effect-wrapper gaps remain | Numeric argument inference in `type/infer-core.ts` can widen unannotated arguments to Float; RFCs 0018/0019 own that choice. Existing open record inference is not RFC 0006's qualified operations. Mechanics operation signatures still use closed sets; RFC 0023 owns polymorphism. |
| LSP workspace parity is incomplete | Confirmed, but not absent Effect support: `analysis/workspace.ts` already consumes mechanics diagnostics/types; `language-server/src/workspace.ts` still lacks file/package graph resolution. |
| Standalone CLI and consumer SDK | The single package contains the human CLI, MCP and `createLanguage`; first npm publication and remaining consumer workflow work are separate gates. |
| Typed holes | Named `?name` holes and their goals ship; broader synthesis remains separate work. |
| A hash proves wire compatibility or shared behavior | No: `artifact/contract-identity.ts` hashes root/reachable definitions, including metadata. Directional codec compatibility needs RFC 0027. |
| Signatures enumerate every fault path | No: they constrain shapes/sets, not call occurrences, scheduling, recovery or business laws. RFC 0015 requires explicit generators and postconditions. |
| Journals, multi-target lenses and an agent sandbox already work | No: RFCs 0016/0021/0012 remain proposals or partial foundations. Go/Rust are not shipped executable targets. RPC generation is merged, but a full-stack linker is not. |
| A tiny kernel guarantees runtime safety and refinements | Rejected: no arbitrary line budget; independent checking, execution conformance, native policy enforcement and solver trust are separate obligations. Brands are not authority boundaries. |

Direct probes against the built baseline confirm `square` infers `Float -> Float`,
an incomplete closed-constructor match fails with error severity, an optional
record field rejects an existing `Option String`, a let-bound tagged constructor
loses its nominal type, a named `for-each` callback is rejected, and an out-of-range
refined constant is accepted. Generic Effect-set signatures report unknown
error/requirement names; `?body` is an unbound symbol, not a goal. These observations
are a dated baseline, not promises that the gaps remain forever. Comparative
claims that other Lisps lack all capability mechanisms or that no other platform
can support these ideas are not established by this repository review.

The RFC directory has pre-existing duplicate 0022 and 0023 numbers. Keep those
filenames stable and use descriptive links. Newer proposals use unique 0026–0029;
0024 is occupied (deferred) and 0025 is accepted with amendments; implementation
is in progress. The existing qualified-row and host-target designs are
extended/referenced, not replaced by parallel RFCs.
