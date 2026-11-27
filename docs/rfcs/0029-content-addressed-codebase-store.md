# RFC 0029: Content-addressed codebase store, cached evidence, and transactional updates

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-11-27 |
| Related | [RFC 0002](./0002-modules-and-packages.md), [RFC 0010](./0010-live-sessions.md), [RFC 0015](./0015-tests-in-forma.md), [RFC 0020](./0020-packages.md), [RFC 0022](./0022-programmable-type-system.md), [RFC 0027](./0027-contract-evolution.md), [RFC 0028](./0028-bounded-verification.md) |
| Scope | Content-addressed definition identity, namespace snapshots, hash-keyed checking/test/verification evidence, semantic query and patch APIs, transactional commits with optimistic concurrency, enforceable project rules, and `.lisp` / Git projections |
| Direction | Keep `.lisp` files and Git as first-class projections; store resolved, checked definitions by content hash, key reusable evidence by definition and toolchain digest, and move codebases between checked states through explicit transactions |

## Summary

Today Forma checks, evaluates, elaborates, and emits Effect TypeScript from
file-based module graphs. Every worktree, editor session, agent sandbox, and CI
runner re-reads files, re-runs checking, and coordinates concurrent changes
through text diffs.

This RFC proposes an optional **content-addressed codebase store** layered
beneath `.lisp` source files and above Forma's checker, elaborator, and
backends:

1. **Content-addressed definitions.** Resolved definitions are stored once by a
   hash of their canonical structure, with every cross-definition reference
   replaced by its target hash and presentation metadata stored separately.
2. **Namespaces and lossless projections.** Names map to hashes inside
   immutable branch snapshots. `.lisp` files and `forma.json`/`forma.lock`
   remain supported projections for Git, editors, and external tools.
3. **Hash-keyed evidence.** Typecheck outcomes, deterministic test results
   ([RFC 0015](./0015-tests-in-forma.md)), bounded verification reports
   ([RFC 0028](./0028-bounded-verification.md)), and emitted artifacts (canonical
   IR, Effect TypeScript) are cached by `(defHash, kind, toolchainDigest,
   inputDigest)` and reused across workspaces and agents.
4. **Semantic queries and transactional commits.** Editors and coding agents
   query definitions, signatures, callers, and evidence directly, and submit
   structured transactions against a base snapshot. Commits move a branch from
   one checked state to the next under explicit project rules and optimistic
   concurrency.

This RFC does not change Forma's surface syntax, runtime semantics, or Effect
TypeScript output format.

## Motivation

Multi-agent and high-frequency development expose four structural costs in
file-and-text workflows:

- **Redundant verification.** Independent worktrees, sandboxes, and CI jobs
  repeatedly parse, typecheck, and re-test unchanged definitions. CI acts as
  end-of-line inspection because the repository is an untrusted bag of text.
- **Brittle text editing and context waste.** Agents read whole files and apply
  exact-text patches that fail on minor drift, instead of querying resolved
  facts and submitting checked semantic updates.
- **Parallel implementation without parallel delivery.** Concurrent edits that
  merge cleanly as text can still break types, effects, or contracts.
- **Architectural drift.** Conventions expressed only in prompts or docs are
  relitigated on every change.

Retrofitting Unison-style content addressing onto raw TypeScript is hard
because declaration merging, ambient globals, `node_modules` resolution,
unsound escapes, and side-effecting module initialization prevent definitions
from forming a clean local hash DAG. Forma avoids most of those obstacles while
still targeting the Effect/TypeScript ecosystem:

- Forma has no ambient globals, dynamic `eval`, or mutable module cells.
- Closed, operation-granular `Effect<A, E, R>` requirement sets make explicit
  authority visible in the type, distinguishing requirement-free checks from
  external-world I/O (subject to the host-provider caveat in
  [RFC 0015](./0015-tests-in-forma.md)).
- Preludes and `form` descriptors already encode domain vocabulary and checking
  rules in the compiler rather than in prompts.
- `generateEffectProgram` already compiles checked Forma definitions into
  Effect TypeScript, keeping npm and Effect intact without trying to
  content-address arbitrary legacy JavaScript.

## Current state

- **File modules and lockfiles.** Projects are loaded from `.lisp` files,
  `forma.json`, and `forma.lock` (`packages/ts/src/modules/`). Updating a file
  re-instantiates that file and its dependents; there is no persistent
  per-definition store or cross-workspace evidence cache.
- **Contract identity precedent.**
  `packages/ts/src/artifact/contract-identity.ts` computes `irContractId`
  (SHA-256 over a root name and canonical reachable type definitions, including
  metadata) and `payloadConstraintsId` (SHA-256 over canonical JSON). As
  [RFC 0027](./0027-contract-evolution.md) notes, `irContractId` identifies a
  payload contract, not a function's behavior hash or an execution/checker
  version, and metadata edits change it.
- **File-level structural services.**
  [Language services](../language-services.md) already provide lossless syntax,
  node identity, observation, and edit scripts for individual documents, not a
  cross-module definition graph.
- **Related proposed RFCs (not implemented on `main`).**
  - [RFC 0010](./0010-live-sessions.md) proposes revisioned per-definition
    updates in a single live host session.
  - [RFC 0015](./0015-tests-in-forma.md) proposes requirement-free `test`
    declarations.
  - [RFC 0022](./0022-programmable-type-system.md) proposes an independent
    trusted kernel over core terms.
  - [RFC 0027](./0027-contract-evolution.md) proposes directional contract
    diffs and checked pure migrations.
  - [RFC 0028](./0028-bounded-verification.md) proposes finite-model workflow
    verification with explicit bounds and trust accounts.

## Proposal

### 1. Content-addressed definitions

The store keeps immutable **definition objects** keyed by `DefHash` (SHA-256
over canonical encoding, tagged by format version):

- **What is hashed (semantic identity):**
  - Declaration kind (`define`, `type`, `error`, `service`, `form`, `macro`,
    `test`, or elaborated domain declaration).
  - Canonicalized, name-resolved core/elaborated AST with local binders
    normalized (alpha-equivalent / de Bruijn indexed) so renaming a local
    parameter does not change the hash.
  - Every reference to another definition replaced by its `DefHash`.
  - Resolved type and effect signature (`Effect<A, E, R>`), language profile,
    and the `DefHash` of any macro or `form` descriptor that participated in
    expansion/elaboration.
- **What is stored separately (presentation metadata):**
  - Authored surface syntax (for lossless projection and source diagnostics),
    formatting, comments, docstrings, and display names.
  - Editing a docstring or renaming a definition updates metadata or namespace
    bindings without invalidating `DefHash` or downstream evidence.
- **Mutual recursion.** Strongly connected components (SCCs) are canonicalized
  and hashed as a single cycle group `sccHash`; each member's identity is
  derived deterministically as `(sccHash, memberIndex)`.
- **Opaque boundaries.** Host builtins, external Effect/npm imports, and native
  providers are represented as pinned external references carrying their
  declared Forma interface signature plus an explicit package/runtime digest.
  The store does not pretend to content-address arbitrary external JavaScript
  or native code.

### 2. Namespaces, snapshots, and `.lisp` projections

Names are mutable pointers separated from definition identity:

```text
BranchRef  ──▶ SnapshotHash
Snapshot   ──▶ { parent: SnapshotHash?,
                 bindings: Map<QualifiedName, DefHash>,
                 metadata: Map<DefHash, PresentationMeta>,
                 policies: PolicySetHash }
```

- **Constant-time renames.** Renaming a symbol updates `bindings` (and
  optionally presentation metadata) without rehashing callers.
- **Coexisting versions.** Two versions of a library or two competing shapes of
  a data model can exist simultaneously under distinct hashes; consolidating
  them is an explicit refactoring transaction rather than an immediate build
  failure.
- **Lossless file and Git projection.** A snapshot can be exported to standard
  `.lisp` modules (using stored authored syntax where unchanged, and formatted
  source where synthesized) for Git history, conventional editors, and external
  scanners. Importing edited `.lisp` files parses, resolves, diffs against the
  base snapshot, and submits the resulting delta through the same transaction
  gate.

The default backing storage is a single portable local file (e.g., SQLite) or
content-addressed object directory under `.forma/store/`, with explicit
export/import of snapshot bundles so CI and remote sandboxes can share objects
and evidence without requiring a central server.

### 3. Hash-keyed evidence

Verification and build outputs are stored as immutable **evidence records**
keyed by:

```text
EvidenceKey = (defHash, kind, toolchainDigest, inputDigest)
```

| `kind` | Payload | Cacheability & trust boundary |
| --- | --- | --- |
| `typecheck` | Resolved type/effect contract, diagnostics (empty on pass) | Reusable while `toolchainDigest` (checker/kernel version + profile) matches. |
| `artifact` | Canonical IR or generated Effect TypeScript slice | Reusable while emitter + target profile match. |
| `test` | Structured pass/fail outcome ([RFC 0015](./0015-tests-in-forma.md)) | Cacheable **only** when the test's requirement set is empty **and** it runs under a declared deterministic runner profile with pure/local providers. Tests that invoke external or non-deterministic providers are explicitly marked non-cacheable. |
| `verification` | Finite-model or solver report ([RFC 0028](./0028-bounded-verification.md)) | Stores explicit bounds, assumptions, and result (`holds-in-model`, `counterexample`, or `inconclusive`). Never cached as a general proof. |

Every evidence record includes an explicit **trust account** naming the
checker, kernel, runner, or solver version that produced it. Until
[RFC 0022](./0022-programmable-type-system.md)'s independent trusted kernel
exists, the current HM/Effect checker is part of the trusted computing base and
its digest is pinned in `toolchainDigest`. Upgrading the checker invalidates
cached `typecheck` evidence without rewriting historical definitions.

### 4. Semantic query and patch API

Exposed via the host ABI, language server, and `forma mcp` so agents and tools
can inspect and modify meaning without scraping files:

- **Read queries (against a `snapshotHash`):**
  - `getDefinition(name | hash)` → signature, requirements, errors, authored
    source, dependencies, and cached evidence summary.
  - `findDependents(hash, { transitive })` / `findDependencies(hash)`.
  - `queryBySignature(pattern)` / `queryByCapability(serviceOrOp)` /
    `queryByError(errorName)`.
  - `diffSnapshots(from, to)` → added/updated/renamed definitions, signature
    changes, and (when [RFC 0027](./0027-contract-evolution.md) is available)
    directional contract compatibility.
- **Write proposals:**
  - Structured transaction payloads naming `baseSnapshot`, a list of operations
    (`add`, `update`, `rename`, `remove`, `move`), and an explicit
    `operationClass` (`impl-edit` vs `requirement-edit`).

### 5. Transactional updates and optimistic concurrency

A transaction against `baseSnapshot` is atomic: either a new checked snapshot
is produced and committed, or the branch is unchanged and a structured failure
report is returned.

1. **Resolve and check.** Parse/elaborate proposed definitions against
   `baseSnapshot`, compute candidate `DefHash` values, and run the checker and
   project policies.
2. **Classify interface impact per updated name:**
   - **Same-interface update** (resolved type, error set, and requirement set
     are unchanged): dependents are rebound to the new `DefHash` without
     re-typechecking their bodies; affected deterministic tests and laws are
     evaluated (or reused from cache) according to branch policy.
   - **Interface-changing update:** cannot commit to a protected branch unless
     all affected dependents are updated and checked in the same transaction.
     Otherwise, the transaction fails with the exact list of affected dependent
     hashes/names, or—when requested—creates a staging branch or adds a new
     coexisting version under an add-only policy.
3. **Separate requirement changes from implementation changes.** Editing a
   `test`, refined contract, or verification law is classified as
   `requirement-edit`, distinct from `impl-edit`. Branch policy can reject
   transactions that delete or weaken requirements while attempting to satisfy
   an implementation task, requiring explicit human or policy approval.
4. **Optimistic concurrency (CAS on branch head).** If another transaction
   committed since `baseSnapshot`:
   - If the concurrent transactions touch disjoint names and neither invalidates
     any dependency hash read by the other, the store rebases the transaction
     onto the current head and commits.
   - If any dependency hash or target name collided, the transaction is rejected
     with the exact conflicting names, old/new hashes, and changed assumptions
     so the caller retries against the new snapshot.

### 6. Enforceable project rules

Branch policies are data in the snapshot (not prose in agent prompts) and are
checked inside every transaction:

- **Dependency boundaries:** permitted/forbidden edges between namespaces.
- **Capability budgets:** maximum allowed `Effect` requirement sets per
  namespace (e.g., pure domain namespaces may not require network or database
  services).
- **Evolution rules:** optional integration with
  [RFC 0027](./0027-contract-evolution.md) to enforce add-only or
  backward-compatible changes on published surfaces.
- **Evidence gates:** required evidence kinds before commit (e.g., all affected
  deterministic tests pass; `inconclusive` verification results do not silently
  pass).

## Honest limits and non-goals

- **Not a replacement for Git or integration CI.** External-system tests,
  benchmarks, security scanners, and runtime checks against real services still
  run on CI. This RFC eliminates *redundant* local/CI work for deterministic
  checks, not end-to-end validation.
- **Does not eliminate architectural coordination.** Add-only versioning and
  optimistic transactions prevent *broken shared states*, not *divergent
  designs*. When two agents invent incompatible domain models, a coordinator or
  human still has to consolidate them.
- **No soundness claims beyond the checker.** Cached `typecheck` evidence is
  only as strong as the checker pinned in `toolchainDigest`; independent kernel
  verification belongs to [RFC 0022](./0022-programmable-type-system.md).
- **No distributed consensus or real-time CRDT editing in initial stages.**
  Start with a local portable store and explicit snapshot/bundle sync.
- **No attempt to content-address raw TypeScript or npm internals.** Generated
  Effect TypeScript is an *output artifact* of checked Forma definitions, and
  external packages remain opaque pinned boundaries.

## Stages and acceptance

1. **Stage 0 — Canonical definition hashing and read-only index.**
   - Compute deterministic `DefHash` values over existing file modules
     (alpha-equivalent locals, sorted records/sets, SCC cycle hashing,
     presentation metadata excluded).
   - Verify that formatting, comment, docstring, and local-parameter renames do
     not change `DefHash`, while semantic, signature, or prelude/form changes
     do.
   - Expose read-only graph queries (`getDefinition`, `findDependents`,
     `queryByCapability`) over the in-memory index.
2. **Stage 1 — Local hash-keyed evidence cache.**
   - Persist `DefHash` objects and `typecheck` / `artifact` (canonical IR and
     Effect TypeScript) evidence in a local store keyed by `toolchainDigest`.
   - Demonstrate zero re-checking and zero re-emission for unchanged
     definitions across fresh processes and worktrees, and full invalidation
     when `toolchainDigest` changes.
   - Plug in deterministic `test` and `verification` evidence once
     [RFC 0015](./0015-tests-in-forma.md) and
     [RFC 0028](./0028-bounded-verification.md) land; reject caching for tests
     with non-empty requirements or non-deterministic runner profiles.
3. **Stage 2 — Transactional store and `.lisp` projections.**
   - Add mutable branch pointers over immutable snapshots, same-interface
     rebind without dependent re-typechecking, interface-change rejection with
     exact dependent lists, and optimistic CAS commits with disjoint auto-rebase
     and structured conflict reports.
   - Round-trip export/import to `.lisp` files without losing authored
     formatting or source spans on unchanged definitions.
4. **Stage 3 — Project policies, requirement-change separation, and agent API.**
   - Enforce namespace dependency rules, capability budgets, and
     `impl-edit` vs `requirement-edit` separation in transactions.
   - Wire optional [RFC 0027](./0027-contract-evolution.md) directional
     compatibility gates on marked published namespaces.
   - Expose query and transaction endpoints in `forma mcp` and the host ABI,
     with conformance fixtures covering concurrent agent transactions and
     stale-snapshot retries.
