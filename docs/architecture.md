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

## Engines

`@formalang/ts` is the embeddable TypeScript engine used by the browser demo and
the default host. `@formalang/ocaml` is the typed engine and compiler substrate,
building to native code, JavaScript, and WebAssembly. Cross-engine fixtures
define the portable semantic intersection.

Neither engine owns consumer concepts such as entities, endpoints, workflows,
or UI components. Those arrive as ordinary preludes plus descriptor and meta
hook registrations.

## Host boundary

`@formalang/host` presents one asynchronous ABI for parsing, inference, evaluation,
sessions, editor analysis, retained values, and host calls. Implementations
adapt the TypeScript engine, the native OCaml daemon, or the JavaScript OCaml
artifact to that contract.

The native daemon uses newline-delimited JSON. Long-lived sessions retain
loaded sources, generalized definitions, artifact caches, and suspended host
calls. One-shot requests remain available for simple compiler invocations.

`version().sourceLoadSemantics` makes a current difference explicit: the
TypeScript host parses and stores a loaded source, while the native OCaml host
also typechecks/evaluates forms that update the session before storing them.
The JavaScript OCaml adapter does not support persistent loading.
Call `typecheck` explicitly when the consumer needs a comparable validation
result from either engine.

## Effect projection parity

Both engines project operational effects into the shared declaration and body
shapes exercised by `conformance/operational-effects`. The TypeScript mechanics
runtime executes these declarations; the Effect TypeScript generator turns
supported body nodes into `Effect` programs. Generation throws for unsupported
nodes instead of producing placeholder code. The generated program is compiled
and executed against the shared operational-effects fixture in the TypeScript
suite. OCaml currently emits canonical IR; it does not emit Effect TypeScript.

The engines package declarations in different artifact envelopes. The
TypeScript package uses `language-ts-artifact/v1` and SHA-256 over canonical
payload JSON with sorted object keys; OCaml uses IR version `1` and MD5 over
serialized payloads. Both include module identities, provenance and type
summaries. Shared artifact fixtures check the canonical IR golden and the
58-source, 548-declaration corpus counts.

The TypeScript host exposes `emit`, `emitMany`, `emitBackends` and
`artifactSummary`. Registered validators check canonical domain payloads,
descriptor payload contracts and HTTP declarations before packaging immutable
validated declarations. `artifactSummary` returns validation failures or kind
counts and manifest metadata. OCaml also reports artifact cache telemetry and
can aggregate counts across failing sources. Module entries project authored
imports and exports; resolution and typechecking belong to the module stage.

Consumers can compare the normalized declarations and diagnostics.
The [engine parity runner](https://github.com/bjacobso/forma/blob/main/conformance/engine-parity/README.md) performs
that comparison and reports differences by JSON path. Its matrix records
intentional differences and missing surfaces.

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
