# Consumer-prelude upgrade from `1317204`

This note covers consumer-visible changes from `1317204` through the merged
RPC work in PR #145 and FX1. It is a source-upgrade guide, not a claim that
these pending changesets have been published. WorldVM's repository was not
changed or used as a test fixture.

## Diagnostics: replace message matching

Previously a consumer extracted names and alternatives from message text:

```ts
const unknown = diagnostic.message.match(/^Unknown form '(.+)'/);
```

Now use the public diagnostic code and typed details:

```ts
import { hasDiagnosticCode, DiagnosticCatalog } from "@formalang/ts/diagnostic";

if (hasDiagnosticCode(diagnostic, "elaborate/unknown-form")) {
  const { name, candidates } = diagnostic.details!;
  // Offer candidates without parsing diagnostic.message.
}
const catalog = new DiagnosticCatalog();
catalog.register({
  code: "world/unknown-role",
  summary: "The role is not declared.",
  explanation: "Declare the role before referring to it.",
  stability: "stable",
});
const explanation = catalog.get(diagnostic.code);
```

`elaborate/hole-type` carries `form`, `hole`, and, where relevant, `name`,
`candidates`, `expected` and `actual`. Enum candidates keep their authored
spellings; unknown type diagnostics include primitive and in-scope type
names. Unknown top-level form candidates come from the descriptor registry
(which also includes registered type descriptors). Reference diagnostics
retain the referenced name and expected/actual contract. Optional fields
are absent when the check has no such information; do not infer them from
messages. Consumer code types can extend `DiagnosticDetailsMap` by module
augmentation. Other legacy codes retain their existing detail records.

`help` is optional author advice; `fix` is an optional list of `{span, newText}`
edits. Present fixes for review and apply all edits to the unchanged source,
not to text already modified by an earlier edit. Form checks may return
`:details`, `:help` and `:fix` records; see [Writing a form](./writing-a-form.md).
Existing `bootstrapFromSources`, `elaborateSources`, `SimpleSemanticEnvironment`,
`lowerProgram`, `parse`, `toSExprMany` and `/mechanics` calls need no signature
changes for FX1. Existing codes, including legacy evaluator class-name codes,
are retained. The source-built CLI adds `forma explain <code>`.

## Repairs to make before re-vendoring

- **Diagnostic sets grow.** File-module checking now reports every failing
  form application, not just the first. Update snapshots and do not assume
  one error per module. Hook failures use `elaborate/hook-failed`, retain
  author locations and identify the hook/check context. Diagnostics include
  lines/columns and author names rather than resolved internal identities.
- **`concat` checks lists only** in HM and Effect generation (PR #132).
  Replace string concatenation with `str`; audit WorldVM's reported 18 uses
  rather than changing list concatenation. Runtime variadic extensions do
  not imply a checked contract.
- **Incomplete kernel matches are errors** (PR #141), matching the Effect
  checker. Cover every constructor of a closed tagged type or add `_`.
  Duplicate and unreachable-arm diagnostics remain warnings.
- **CLI evaluation checks first.** `forma file evaluate` rejects ill-typed
  source before running it. Use `--unchecked` deliberately. File commands
  exit 1 when `ok` is false; `file declarations` now includes each elaborated
  `FormApplication` IR entry.
- **Content identities change.** Source hashes and session prelude fingerprints
  now use SHA-256 rather than FNV-1a. Regenerate caches and stored fingerprints.
  `gensym` is scoped per expansion/evaluation, not process-global.
- **Package discovery is offline and explicit.** Forma imports use
  `forma.json`, verified `forma.lock` and vendored or relative sources, not
  npm package discovery. Consumers using file packages must migrate their
  manifests and package tables; embedding source strings needs no package setup.

## Other observable additions and fixes

- Bundled preludes were rewritten for readability with docstrings and checked
  examples. Forms expose `examples` as source strings. Use descriptor APIs,
  not source-text layout assumptions, when inspecting bundled vocabulary.
- Form-local literal `:extensions` replaces out-of-line metadata attachment;
  `:descriptor-name` remains a deprecated compatibility path. UI/ViewSpec
  preludes use `named-map` projections; unused ViewSpec registry hints were
  removed, while the seven settings read by the registry remain.
- Imported `:ir` types and their reachable definitions participate in form
  checking. Module declaration data gains `contractId`; artifact declarations
  gain `payloadContractId`, hashing the payload type closure independently of
  layout and record-field order. Treat these as content identities, not spans.
- Generic top-level functions generalize in dependency order. Imported record
  types support implicit Option filling and field access. Immediately applied
  functions type like `let`; keyword comparisons widen unresolved variables
  without discarding explicit enum/literal contracts. Numeric errors blame
  the argument, and missing record fields include nearby-key suggestions.
- Form checks can call imported helpers that are filled after hook creation.
  Host-call failures retain the host's first code and every original report
  in `details.hostDiagnostics`; keyword/symbol/string map keys and retained
  function values survive host projection and decoding.
- Libraries may claim retired spellings after macro expansion. The bundled
  Clojure macro prelude is opt-in; unclaimed spellings still fail. Imported
  macro/form names no longer rewrite type annotations such as `->`.
- Checked `reduce` and `conj`, runtime `reverse`, `sqrt` and `quot`, and Effect
  translations for `reverse`/`sqrt` are available. `reduce` is accumulator-first,
  `conj` appends, `reverse` does not mutate, and `quot` truncates toward zero.
- Workspace search finds forms/definitions by name, docs, produced IR and
  type. The language server exposes it through `workspace/symbol`.
- `/rpc` adds native Effect unary RPC generation; existing mechanics entry
  points remain. Formatting uses conventional Lisp layouts and reader quotation
  shorthand. The shared CodeMirror theme changed, without editing semantics.

Review the pending changesets for release versions. FX1 does not implement
authored-hole reflection, schema CLI generation, new typing hooks, validator
scoping or incremental elaboration; those remain separate SDK packages.
