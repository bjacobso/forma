# RFC 0029: Consumer-prelude verification and cold-start prelude caching

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-11-11 |
| Related | [RFC 0004](./0004-one-analysis-architecture.md), [RFC 0008](./0008-typed-form-results.md), [RFC 0017](./0017-diagnostic-catalog.md), [RFC 0025](./0025-single-npm-distribution.md) |
| Scope | Public consumer-prelude verification (`checkPrelude` and `forma prelude check`), diagnostic/example completeness checks, and content-addressed prelude snapshot caching for CLI and workspace cold start |

## Problem and current boundary

Forma has merged the core consumer-prelude foundations (`FX1`–`FX4`), the
`@forma-language/forma` distribution, `createLanguage`, and `describe`:

- [Diagnostic catalogs and fixes](../writing-a-form.md#checking-and-scope)
  (`FX1`, `@forma-language/forma/diagnostic`) let consumer preludes register
  diagnostic codes, explanations, and source-versioned `:fix` replacements.
- [Authored syntax and child introspection](../authoring.md#authored-syntax-in-an-embedded-compiler)
  (`FX2` and `FX4`, `bootstrapFromSources` over `ProgramSource[]`) preserve
  hole spans and named multi-file prelude stacks.
- [Schema generation](../authoring.md) (`FX3`, `forma schema`) emits data
  codecs, TypeScript types, and JSON Schema from explicit source bundles.
- [`createLanguage` and `describe`](../embedding.md) (`#156`, `#157`) expose an
  embedding facade and render forms, typed slots, checked examples, function
  signatures, and types as Markdown or JSON.

Two workflow and performance seams remain outside the existing RFC set:

1. **Repository-only prelude verification.** `pnpm check:preludes` runs
   [`scripts/check-prelude-docs.mjs`](../../scripts/check-prelude-docs.mjs),
   which hardcodes the repository's prelude list (`ontology`, `ui`, `viewspec`,
   `elm`, `email`, `http-api`, `rpc`) and imports VitePress helpers from
   [`docs/.vitepress/preludes.ts`](../../docs/.vitepress/preludes.ts). External
   teams authoring a domain prelude have no supported API or CLI command to run
   the same completeness checks (descriptor metachecks, required form docstrings,
   per-form `:examples` elaboration, optional target-linker verification, and
   diagnostic catalog coverage) without copying repository scripts.
2. **Repeated prelude bootstrap on cold start.** Every one-shot CLI invocation
   and fresh workspace parses, expands, metachecks, and evaluates its prelude
   stack from source. In the [runtime and latency measurements](../proposals/one-runtime.md),
   process startup is ~605 ms, a cold file check is ~1,137 ms, and initial
   ontology prelude analysis in [RFC 0004](./0004-one-analysis-architecture.md)
   takes ~600 ms before user source is checked. In-memory memoization helps
   long-lived editor sessions, not one-shot `forma check`, `forma test`, or CI
   runs.

## Proposal 1: Consumer-prelude verification (`checkPrelude` and `forma prelude check`)

Expose the repository's prelude verification contract as a public, UI-free
library operation and CLI subcommand so consumer preludes are held to the same
bar as built-in preludes.

### Verification steps

Given an ordered list of prelude `ProgramSource` inputs (and optional file-module
preludes, a `DiagnosticCatalog`, and an optional target linker):

1. **Bootstrap and descriptor metachecks.** Run `checkDescriptors` and
   `bootstrapFromSources` with reference checking enabled. Report any syntax,
   slot, hook-reference, payload-contract, or duplicate-declaration diagnostic
   at its authored span.
2. **Documentation completeness (domain mode).** Unless the prelude is marked as
   an exempt protocol/support layer, require every authored `form` declaration
   to carry a non-empty docstring and at least one `:examples` entry. Report
   missing items with proposed `prelude/missing-docstring` and
   `prelude/missing-examples` at the form declaration.
3. **Executable `:examples` verification.** Elaborate every `:examples` entry
   against the bootstrapped prelude stack with a deterministic synthetic
   `sourceId` (`<prelude>#<form>-example-<n>`). When a consumer supplies a
   target linker/generator callback (as Elm, email, HTTP API, and RPC do in
   `check-prelude-docs.mjs`), require the linker to succeed and return non-empty
   output. Report failing example diagnostics with the example's span mapped
   back to the prelude's `:examples` vector when possible.
4. **Diagnostic catalog audit (optional).** When a `DiagnosticCatalog` is
   supplied, inspect literal `:code` strings in `:check` hooks and report
   literal codes that are not registered in the catalog
   (`prelude/unregistered-diagnostic-code`), plus catalog entries unused by the
   prelude when `--strict-catalog` is requested. Dynamic code expressions are
   reported as unverified rather than guessed.
5. **Reference rendering parity.** Verify that `describe` (JSON and Markdown)
   extracts every declared form's docstring and preserves each example's parsed
   S-expression structure without dropping or rewriting examples.

### Proposed API and CLI surface

```ts
export interface CheckPreludeRequest {
  readonly sources: readonly ProgramSource[];
  readonly mode?: "domain" | "protocol";
  readonly catalog?: DiagnosticCatalog;
  readonly strictCatalog?: boolean;
  readonly verifyExample?: (
    exampleSource: string,
    context: { readonly formName: string; readonly exampleIndex: number; readonly sourceId: string; readonly prelude: BootstrappedPrelude },
  ) => { readonly ok: boolean; readonly diagnostics?: readonly Diagnostic[] };
}

export interface CheckPreludeResult {
  readonly ok: boolean;
  readonly formsChecked: number;
  readonly examplesChecked: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly referenceMarkdown?: string;
}
```

 CLI surface under `@forma-language/forma`:

```text
forma prelude check <prelude.lisp...> [--protocol] [--catalog <catalog.json>] [--emit-reference <path>] [--json]
```

`scripts/check-prelude-docs.mjs` becomes a thin caller over `checkPrelude` plus
the VitePress page assertion, eliminating duplicate verification logic between
the repository and external consumers.

## Proposal 2: Content-addressed prelude and interface snapshot caching

Reduce cold-start latency for `forma check`, `forma run`, `forma test`,
`forma describe`, and initial `FormaWorkspace` startup by caching the pure,
serializable artifacts of prelude bootstrapping and verified module interfaces.

### Cache key and trust boundary

A snapshot key is a SHA-256 digest over canonical inputs:

- `@forma-language/forma` package version and snapshot format version.
- Ordered prelude source digests (`sourceId` normalized to workspace-relative
  or canonical package identity plus SHA-256 of UTF-8 source bytes).
- For project module graphs, the verified `forma.lock` digest and compiler
  options affecting expansion or checking.

A cache hit is an optimization over deterministic pure passes, never an
authority bypass:

- Any digest mismatch, corrupt payload, or unknown snapshot version misses
  silently and rebuilds from source.
- `--no-cache` disables reading and writing snapshots.
- Host-supplied JavaScript closures (`HostedMetaBuiltinsFactory`, custom host
  capabilities, or in-memory `createLanguage` functions) are not serializable.
  The snapshot stores the pure data portion (`FormDescriptor` records,
  normalized slots, expanded hook ASTs, payload contracts, and inferred HM/module
  schemes) and rebinds host callbacks on load.

### What a prelude snapshot contains

| Component | Cached representation | Rebound at load |
| --- | --- | --- |
| Lossless read & expanded prelude forms | Canonical S-expression AST with source spans and expansion provenance | None |
| `FormDescriptor` & `ElaborationDescriptor` tables | Plain JSON-serializable descriptor records and `PayloadContracts` | `ElaborationRegistry` and `createMetaFnHook` wrappers |
| Prelude type environment & registries | Serialized `Scheme`, alias, ADT, record, and typeclass tables with fresh-variable watermarks | `SimpleSemanticEnvironment` and `HostedMetaBuiltinsFactory` |
| Checked module interfaces (`forma.lock` / vendor) | Exported schemes, compile-time form descriptors, and contract hashes | Runtime module evaluation (when `run` or `test` executes) |

### Stages and acceptance

1. **Library and CLI prelude checker (`checkPrelude`, `forma prelude check`).**
   Migrate `scripts/check-prelude-docs.mjs` to use the shared implementation.
   Add fixtures covering a valid external consumer prelude, a form missing a
   docstring, a form missing `:examples`, a failing example diagnostic, and an
   unregistered `:code` in a `:check` hook.
2. **In-memory and disk snapshot codec for `BootstrappedPrelude`.**
   Round-trip the bundled ontology, HTTP API, RPC, Elm, and email preludes.
   Acceptance requires byte-identical `describe`, `typecheck`, `elaborate`, and
   surface golden outputs between cold-bootstrapped and snapshot-hydrated
   preludes, plus negative tests for tampered/stale cache files.
3. **CLI and workspace integration with measured latency gate.**
   Wire optional snapshot caching into CLI file/prelude commands and
   `FormaWorkspace`. Measure with `pnpm bench:latency` and record cold vs.
   cached medians before enabling by default.

## Non-goals

- Caching arbitrary JavaScript callbacks or stateful host sessions across
  processes.
- Replacing `forma.lock` verification or accepting unverified cached interfaces
  when source files change.
- Proving `:check` or `:type` hook bodies sound via `checkPrelude`; static hook
  input typing belongs to [RFC 0008](./0008-typed-form-results.md) and
  independent core re-checking belongs to [RFC 0022](./0022-programmable-type-system.md).
