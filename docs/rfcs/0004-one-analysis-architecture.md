# RFC 0004: One analysis architecture

| | |
| --- | --- |
| Status | Accepted; stages 1–4 implemented, stages 5–8 proposed |
| Created | 2026-10-07 |
| Scope | Engine roles, language services, the TypeScript compiler's internal structure |
| Direction | Language services live in one TypeScript analysis workspace; OCaml is the native backend and conformance oracle |

## Summary

Forma has two engines. Every editor-facing consumer (the website, the
workbench, the CodeMirror editor, and the default host) already ran on the
TypeScript engine; the language server was the only exception. It spawned the
OCaml engine compiled to JavaScript in a child process, and the OCaml editor
operations it called were weaker than the TypeScript services the rest of the
tooling used.

This RFC makes the TypeScript engine the single home of language services and
sets a target structure for it: a workspace of memoized queries over
preludes and documents, with one syntax tree, one way to define forms, one
runtime, one IR schema, and one diagnostic type. The OCaml engine keeps its
role as the native, JavaScript, and WebAssembly compiler and as the second
implementation that conformance fixtures hold both engines to.

## Where the engines stood

### OCaml

The OCaml engine is not the cleaner reference implementation it is sometimes
assumed to be.

- **Strengths worth copying.** Phases return `result` rather than raising
  (about 1,080 uses against 22 raises). Syntax, core expressions, types, and
  values are closed variants matched exhaustively. Every syntax node carries
  a span with its source id. Artifact types are abstract behind `.mli`
  interfaces with smart constructors. Host calls suspend through an explicit
  `step` continuation.
- **Weaknesses not worth copying.** There is no separate AST
  (`Ast.expr = Cst.expr`) and no typed tree: `Typed_core` is a side table of
  span-to-type annotations produced by re-running inference on every subtree.
  Requests are decoded into a flat record of optional fields by a substring
  scanner, and dispatched on an `op` string. There are about nine diagnostic
  types, global fresh-id counters, a session of fourteen mutable hash tables
  with heuristic invalidation, and an `incremental` module that only records
  per-form digests.
- **Editor operations.** Completion was a fixed list of forty names plus
  top-level definitions; go-to-definition matched top-level names in the
  current document only. References and macro-introduced definitions already
  fell back to the TypeScript symbol index.

### TypeScript

- **Duplicated subsystems.** Four ways to define forms (`descriptor/`,
  `elaboration/`, `form/`, and source `form` declarations), two type checkers
  (Hindley–Milner and the mechanics checker), four interpreters (the
  evaluator, the VM, the mechanics runtime, and the authority walk), and an IR
  whose shape is restated in four places.
- **Error handling.** About 345 `throw` sites alongside Effect failures and
  result records, and about fifteen diagnostic types.
- **No reuse between requests.** A typecheck could parse and expand the same
  source three or more times, and nothing was cached across edits.
- **Layering.** Lower layers imported `Diagnostic` and `Span` from the engine
  facade, and the type layer imported the evaluator.

## Decisions

1. **The TypeScript engine owns language services.** The language server,
   editors, workbench, and website use one implementation. The OCaml editor
   operations remain in the OCaml ABI but have no JavaScript consumer; the
   parity matrix records this as `editor-services`.
2. **OCaml is the native backend and the conformance oracle.** Parsing,
   expansion, typing, evaluation, effect IR, and canonical IR stay compared
   across engines. New language services are built only in TypeScript.
3. **Borrow OCaml's discipline, not its shortcuts.** Phases return their
   diagnostics instead of throwing; spans live on nodes; IR is a closed,
   schema-defined union; stage boundaries are explicit modules.

## Target architecture

```text
inputs    sourceText(id), preludes (ordered), host builtins, type policy
queries   parse(id)            lossless tree and errors; never fails
          scope(id)            macros, types, and forms of earlier preludes
          analysis(id)         typed spans, result type, diagnostics
          symbols()            definitions and references across sources
          hover, completions, definition, references, rename,
          documentSymbols, semanticTokens, format
```

- **A workspace of queries.** Every service is a function of inputs, memoized
  by the revisions it reads. Editing one document re-analyzes that document;
  the prelude scope and unchanged documents are reused. Editors, the language
  server, the workbench, and the CLI share one workspace instead of
  re-parsing per request.
- **Per-form granularity next.** Lisp top-level forms are natural units of
  incremental work, and node identity already survives edits. The next step
  memoizes expansion, lowering, and inference per form, with early cutoff
  when a form's type does not change.
- **One syntax tree.** The lossless green/red tree is the only syntax
  structure. S-expressions are a view over it that carries node ids and spans,
  so provenance cannot be lost in a rewrite.
- **A typed tree.** Inference uses union-find type variables with levels,
  mutable inside one query and frozen after it, and annotates the core tree
  in place. Hover reads a field; the per-call map copies in `recordType` and
  unification disappear.
- **One of each.** Descriptors define forms. The VM is the runtime, macros
  included. The IR is defined once with Effect Schema, which derives its
  types, validator, and JSON Schema; the mechanics checker checks that typed
  IR. Every phase reports the rich `Diagnostic` from `@formalang/ts/diagnostic`.
- **Effect at the edges.** Hosts, sessions, the language server, and I/O use
  Effect. Inference, expansion, and the VM's inner loop are plain synchronous
  code; today every macro call enters and leaves an Effect runtime.
- **Recovery everywhere.** A form that does not parse, lower, or type is
  reported, and the forms around it are still analyzed.

## Stages

| Stage | Change | Status |
| --- | --- | --- |
| 1 | `@formalang/ts/analysis`: a prelude-aware workspace of memoized language-service queries | Implemented |
| 2 | Language server on the workspace; OCaml bridge and bundled artifact removed; rename, document symbols, semantic tokens, and slot completion added | Implemented |
| 3 | Remove the `elaboration/` and `form/` frameworks, the registry type-provider bridge, and unused reader combinators | Implemented |
| 4 | `Diagnostic` and `Span` in `diagnostic/`; symbol indexing reuses unchanged documents and prelude expansion | Implemented |
| 5 | Per-form memoization of expansion, lowering, and inference with early cutoff | Proposed |
| 6 | Spans and origins on syntax nodes; remove the provenance `WeakMap`s and the global node-id counter | Proposed |
| 7 | IR defined with Effect Schema; one combinator table; mechanics checker over the typed IR | Proposed |
| 8 | Union-find inference with levels producing a typed core tree | Proposed |

### What stages 1–4 changed

- `analyzeLsp` accepts a scope: the type environment, macro environment, and
  form provider of earlier preludes. Documents see prelude macros expand,
  prelude definitions keep their inferred types (previously session bindings
  were typed `any`), and descriptor forms are typed as declarations.
- Lowering recovers per form, keeping the document's own macros, and a
  document with a syntax error is still typed by blanking only its broken
  top-level forms, which preserves every offset.
- The symbol index records macro call heads as references to their macro,
  so hover, go-to-definition, and highlighting work on macro calls.
- With the bundled ontology preludes loaded, re-analyzing a document after an
  edit takes about 3 ms and re-indexing symbols about 26 ms (previously about
  150 ms). Analyzing the preludes themselves takes about 600 ms, once per
  prelude change.
- The language server no longer ships the JavaScript OCaml artifact, which
  made up most of the published package's 4.6 MB unpacked size, or starts a
  child process.

## Open questions

- **Typeclasses across preludes.** The prelude scope carries the type and
  macro environments but not typeclass and instance registries, which live
  in the inference context.
- **The mechanics checker.** Effect programs (`define-layer`, combinators,
  streams) are checked by the mechanics checker, not Hindley–Milner, so the
  language server reports false errors on them. Stage 7 should decide whether
  the two checkers converge or the workspace routes forms to the right one.
- **OCaml editor operations.** Whether to delete them or keep them as a
  native-only surface.
