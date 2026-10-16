# RFC 0017: A diagnostic catalog

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-16 |
| Scope | A shared registry of diagnostic codes, namespace ownership, evaluation codes, stability, generated documentation, `forma explain`, LSP code links, conformance checks |
| Direction | Every code the engine can report is listed once, owned by a namespace, and checked against the engine's sources and fixtures |

## Summary

Forma diagnostics already have codes such as `typecheck/arity` and
`module/effect-runtime`, but the codes are string literals scattered through
the engine, with no list of what exists or what each one means. This RFC
adds a catalog: one data file listing every engine-owned code with its phase,
a summary, its stability, and an optional explanation page. Checks fail when
an engine reports a code that is not in the catalog. The documentation site
publishes a page per stable code, `forma explain <code>` prints it, and the
language server links each diagnostic to it.

The catalog also replaces the TypeScript evaluator's class-name codes, such as
`FailError` and `StepLimitExceeded`, with namespaced `eval/*` and `limit/*`
codes.

## Motivation

Diagnostics are part of Forma's contract with authors, tools, and models.
[RFC 0012](./0012-checked-evaluation.md) asks for "a stable code" on every
rejection, so that a program repairing code can rely on it. The surface
goldens in `conformance/surfaces/` pin codes, as did the engine-parity runner
that compared them between engines before the OCaml engine was removed.
Fixtures pin about forty distinct codes. None
of that is useful without a definition of which codes exist and which are
stable.

Loon has numbered error codes (E01xx to E05xx) and `loon explain`, which shows
an interactive tutorial for an error. Rust has `rustc --explain` and a
published error index. Both make an error message the start of an
explanation, not the whole of it.

## Current state

- **Shape.** The TypeScript `Diagnostic`
  (`packages/ts/src/diagnostic/diagnostic.ts`) has `code`, `severity`,
  `message`, `phase`, `span`, and free-form `details`. The host type mirrors
  it. (The since-removed OCaml engine's `Diagnostic.t` also had `path`,
  `notes`, and `fixes`, which were always empty in practice.)
- **No registry.** Codes are string literals of the form
  `namespace/kebab-name`. Some are built from templates, such as
  `` `elm/${code}` `` and `` `http-api/${code}` ``. Preludes define their own
  in `:check` hooks, such as the `http/*` codes in `preludes/http-api.lisp`.
  A rough count is 270 distinct codes in TypeScript.
- **Class-name codes.** When an error has no code, `diagnosticFromUnknown`
  falls back to the error class tag. TypeScript evaluation failures are
  therefore reported as `FailError`, `KernelTypeError`, `ArityError`, or
  `StepLimitExceeded` (`diagnostic/errors.ts`). The OCaml engine reported
  `eval/arity`, `eval/not-callable`, and other `eval/*` codes for the same
  situations before it was removed.
  `diagnosticFromAbi` in the host invents `${phase}/diagnostic` when a code is
  missing.
- **Surface goldens.** `scripts/surfaces/compare.mjs` normalizes diagnostics
  to code, severity, phase, and span offsets, and drops messages. The goldens
  in `conformance/surfaces/goldens/` contain only a handful of diagnostics
  outside the row-operation cases, all in the typecheck phase. No
  evaluate-phase code is pinned there.
- **Fixtures.** Reader and typecheck fixtures, Effect TypeScript negative
  cases, thesis-gate expectations, descriptor metachecks, surface cases, and
  artifact cases all pin codes. The most frequently pinned are
  `typecheck/type-mismatch`, `typecheck/row-operation`, and
  `mechanics/type-mismatch`.
- **Tooling.** The language server sets `code` and `source: "forma"` on LSP
  diagnostics. It sets no `codeDescription` and has no code actions. There is
  no `explain` command. Form descriptors have an unused `commonErrors` field.
- **Documentation.** No page lists codes. A few appear incidentally in
  [File modules](../modules.md) and in RFCs.

## Proposal

### The catalog

`conformance/diagnostics/catalog.json` lists engine-owned codes:

```json
{
  "namespaces": {
    "typecheck": { "owner": "engine", "phase": "typecheck" },
    "http": { "owner": "prelude", "prelude": "preludes/http-api.lisp" }
  },
  "codes": [
    {
      "code": "typecheck/arity",
      "phase": "typecheck",
      "severity": "error",
      "stability": "stable",
      "summary": "A function is applied to the wrong number of arguments.",
      "explanation": "docs/diagnostics/typecheck/arity.md"
    },
    {
      "code": "mechanics/undeclared-requirement",
      "phase": "typecheck",
      "severity": "error",
      "stability": "unstable",
      "summary": "An operation uses a requirement its signature does not declare."
    }
  ]
}
```

- `stability` is `stable`, `unstable`, or `internal`. Stable codes need an
  explanation page. Internal codes, such as `internal/error`, indicate a defect
  rather than a mistake in the author's program.
- A template code such as `elm/<code>` is registered as a namespace owned by
  its producer. The catalog does not list codes in namespaces owned by a
  prelude or a consumer. Those are documented by their owner.
- Renaming a code keeps the old code as an alias entry, `{"code": ...,
  "renamedTo": ...}`, for one release once packages are published.

The catalog lives under `conformance/` because the engine, its tests, and the
surface runner read it. It is data, not code. (As proposed, it also had an
`engines` field listing which of the two engines could report each code; that
was dropped when the OCaml engine was removed.)

### Checks

- **Static scan.** `pnpm check:diagnostics` scans the engine's sources for
  string literals that look like `namespace/name` codes in engine-owned
  namespaces. It fails on any code missing from the catalog, and warns on
  catalog entries no source mentions. The scan is approximate by design.
  Template codes are covered by namespace entries.
- **Runtime assertion.** In test builds, the engine checks every reported
  diagnostic against the catalog and fail the test on an unknown engine-owned
  code. This catches codes the scan misses.
- **Fixtures.** Every code that a fixture pins must be in the catalog.
- **Prelude codes.** Descriptor metachecks require a code in a `:check` hook
  to use a namespace other than the engine-owned namespaces. A prelude cannot
  report `typecheck/*`.

### Evaluation codes

Evaluation failures get namespaced codes:

| Today | Proposed |
| --- | --- |
| `FailError` | `eval/fail` |
| `ArityError` | `eval/arity` |
| `KernelTypeError` | `eval/type`, plus specific codes such as `eval/expected-list` |
| `StepLimitExceeded` | `limit/steps`, as in RFC 0012 |

The `eval/*` names follow the codes the since-removed OCaml engine reported.
The engine reports the specific `eval/expected-*` codes where it can tell the
cases apart, and `eval/type` otherwise. The class tag stays
in `details.errorTag` for one transition period. `diagnosticFromAbi` stops
inventing `${phase}/diagnostic` and uses `internal/missing-code`, which a test
build treats as a failure. The surface cases gain evaluate-phase cases so
these codes are pinned by stored goldens.

### Explanations

An explanation page is Markdown under `docs/diagnostics/<namespace>/<name>.md`
with a fixed outline: what the diagnostic means, a minimal program that
reports it, and how to fix it. The example program is checked: a test runs it
and expects the code at the marked span.

The documentation build generates `/diagnostics` from the catalog. It lists
every stable and unstable code with its summary and phase, and
links to explanation pages. This uses the existing VitePress build and adds no
framework.

### `forma explain` and the host

`forma explain <code>` prints the summary and the explanation page as text.
The host ABI gains `explainDiagnostic {code}`, which returns
`{code, summary, phase, stability, markdown?}` or `abi/unknown-code`. The
catalog and explanations ship as data in `@formalang/host`, so the command
works offline.

### LSP

The language server sets `codeDescription.href` to the published page for
codes that have one. The `commonErrors` descriptor field is removed or
redefined as a list of prelude-owned codes with summaries, so the language
server can explain prelude codes the same way.

## Alternatives considered

- **Numbered codes.** Codes such as `E0412` are compact and easy to search for,
  but Forma's namespaced codes already appear in fixtures, docs, and RFCs, and
  they say where a diagnostic came from. Renumbering would break every pinned
  fixture for no gain in clarity.
- **Codes as a TypeScript enum.** An enum would give the TypeScript engine
  exhaustiveness, but it would not cover preludes, fixtures, or the surface
  runner. The engine can generate types from the catalog later.
- **Explanations in messages.** Longer messages make every diagnostic harder
  to read and are not stable. A short message plus a stable code and page
  keeps both.

## Implementation stages and validation

1. **Catalog and scan.** Generate a first catalog from the current sources and
   fixtures, mark every code `unstable`, and add `pnpm check:diagnostics` to
   `pnpm check`. The check fails on a new unregistered code.
2. **Runtime assertion and fixtures.** Test-build assertions and the fixture
   rule.
3. **Evaluation codes.** Shared `eval/*` and `limit/*` codes, the
   `details.errorTag` transition, `internal/missing-code`, and evaluate-phase
   surface cases.
4. **Explanations.** Pages for the most frequently pinned codes, the generated
   `/diagnostics` index, checked examples, and `stable` status for documented
   codes.
5. **Tools.** `forma explain`, `explainDiagnostic`, and LSP `codeDescription`.

## Decisions still required

- Whether `stable` is a compatibility promise before packages are published,
  or only after, as the [design decisions](../design-decisions.md) suggest for
  wire formats.
- Whether TypeScript's `details` should gain structured notes and fixes
  (fields the OCaml diagnostic had) as one structured field that
  explanations and code actions can rely on.
- Whether severity belongs in the catalog or stays per report, given that
  some codes are errors in one context and warnings in another.
- Whether preludes should publish catalogs in the same format so that tools
  can explain prelude codes.

## Related designs

Loon's [roadmap](https://loonlang.com/roadmap) lists error codes E01xx to
E05xx and interactive error tutorials through `loon explain`. Rust publishes
its [error code index](https://doc.rust-lang.org/error_codes/error-index.html)
and supports `rustc --explain`. TypeScript's numbered diagnostics are
generated from one message catalog. The LSP specification defines
`Diagnostic.codeDescription` for links to documentation.
