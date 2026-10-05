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

The engines still package declarations in different artifact envelopes. The
TypeScript package uses `language-ts-artifact/v0`, while the OCaml canonical
package uses IR version `1`. Consumers should compare the normalized
declarations and diagnostics, not assume the envelopes are interchangeable.
The [engine parity runner](https://github.com/bjacobso/forma/blob/main/conformance/engine-parity/README.md) performs
that comparison and reports differences by JSON path. Its matrix records
intentional differences and missing surfaces.

## Tooling

`@formalang/editor` provides syntax, structural editing, diagnostics, hover, and
React bindings. `@formalang/language-server` projects the OCaml editor ABI into
standard Language Server Protocol requests. It starts domain-neutral and loads
only preludes explicitly supplied by its consumer.

Structural editors build on a further set of host services: stable node ids,
per-expression observation, a symbol index, id-addressed edit scripts, an
outline codec, and slot affordances. [Language services](./language-services.md)
records their design.

The website executes the TypeScript compiler in a Web Worker. Every displayed
stage is computed from the editable source in the tab; preview-only target
artifacts are visibly distinguished from live compiler output.
