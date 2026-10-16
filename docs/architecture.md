# Architecture

Forma separates language machinery from consumer-defined vocabulary.

```text
source
  → lossless read / parse
  → macro expansion
  → core lowering
  → type inference
  → evaluation or elaboration
  → typed artifact packaging
  → JSON ABI / target backend
```

## Engine

`@formalang/ts` is the TypeScript/Effect engine. It runs the browser demo, the
language server, the workbench, and the default host. It is the only
implementation: an OCaml engine with native, JavaScript, and WebAssembly builds
was removed (see [Retiring the OCaml engine](./engine-consolidation.md)).
Conformance fixtures and stored goldens pin its behavior.

The engine does not own consumer concepts such as entities, endpoints, workflows,
or UI components. Those arrive as ordinary preludes plus descriptor and meta
hook registrations.

## Host boundary

`@formalang/host` presents one asynchronous ABI for parsing, inference, evaluation,
sessions, editor analysis, retained values, and host calls. `TsLanguageHost`
adapts the TypeScript engine to that contract.

The host's `forma` JSON CLI accepts one-shot `request`s, a newline-delimited JSON
`daemon`, `version`, and `file <op> <entry>` for filesystem modules. Long-lived
sessions retain loaded sources, generalized definitions, and suspended host
calls. Artifact caching remains planned.

`version().sourceLoadSemantics` reports `validate-and-store` for the TypeScript
host: source loads validate surface grammar, descriptor application structure,
module directives, and duplicate global declaration identities. References and
expression types are checked during analysis. Prelude loads evaluate and infer
types before atomically committing their scope; replacing a prelude rebuilds
that scope so removed bindings do not survive. Prelude metachecks validate descriptor clauses, hook references, slot references,
artifact validators, summary requirements, and named payload contracts against
the complete bootstrapped prelude and evaluated environment. Descriptor typing
hooks run during application inference; hosted helpers retain their meta
evaluation contract. Kernel definitions continue through HM inference.

The TypeScript host's optional `replSubmit` operation checks each submission,
evaluates it, and commits its value environment, inferred schemes and type
registries, and source only on success. Results include a type projection.
Ordinary `evaluateInSession`
continues to evaluate snapshots; the workbench rebuilds its REPL context from
current declarations so document edits cannot leave stale bindings.

## Effect projection

The engine projects operational effects into the declaration and body
shapes exercised by `conformance/operational-effects`. The TypeScript mechanics
runtime executes these declarations; the Effect TypeScript generator turns
supported body nodes into `Effect` programs. Generation throws for unsupported
nodes instead of producing placeholder code. The generated program is compiled
and executed against the shared operational-effects fixture in the TypeScript
suite.

Artifacts use the `language-ts-artifact/v1` envelope and SHA-256 over canonical
payload JSON with sorted object keys. They include module identities,
provenance and type summaries. Artifact fixtures check the canonical IR golden
and the 58-source, 548-declaration corpus counts; both expectations were
captured from the retired OCaml engine, whose MD5 hashes and envelope metadata
are not compared.

The TypeScript host exposes `emit`, `emitMany`, `emitBackends` and
`artifactSummary`. Registered validators check canonical domain payloads,
descriptor payload contracts and HTTP declarations before packaging immutable
validated declarations. `artifactSummary` returns validation failures or kind
counts and manifest metadata. Module entries project authored
imports and exports; resolution and typechecking belong to the module stage.

The [surface golden check](https://github.com/bjacobso/forma/blob/main/conformance/surfaces/README.md)
compares normalized parse, expansion, typecheck, evaluation, and IR output with
stored goldens and reports differences by JSON path.

## Tooling

`@formalang/editor` provides syntax, structural editing, diagnostics, hover, and
React bindings. `@formalang/ts/analysis` is a workspace of preludes and
documents whose language services (diagnostics, hover, completion,
definitions, references, rename, document symbols, semantic tokens, and
formatting) are memoized queries. Documents are typed in the scope of their
preludes. `@formalang/language-server` projects those queries into standard
Language Server Protocol requests. It starts domain-neutral and loads only
preludes explicitly supplied by its consumer. Language services are
implemented by the TypeScript engine only; see
[RFC 0004](./rfcs/0004-one-analysis-architecture.md).

Structural editors build on a further set of host services: stable node ids,
per-expression observation, a symbol index, id-addressed edit scripts, an
outline codec, and slot affordances. [Language services](./language-services.md)
records their design.

The website executes the TypeScript compiler in a Web Worker. Every displayed
stage is computed from the editable source in the tab; preview-only target
artifacts are visibly distinguished from live compiler output.
