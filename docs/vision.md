# Vision

Forma is a small, homoiconic, macro-first programming language for hosting
domain-specific languages. Its purpose is to turn concise, reviewable source
into checked values and portable artifacts without baking any particular
domain into the compiler.

Three ideas define the project:

1. **Typed macros.** Extensions produce typed intermediate representation and
   diagnostics continue to point at author-written source.
2. **Operational effects.** Success values, typed failures, and required
   capabilities stay explicit through inference and lowering.
3. **Elaborator reflection.** Hosts register forms, descriptors, and hooks that
   teach the compiler new domain vocabulary without forking the language.

The combination is the bet. A Lisp gives DSL authors data and macros; static
inference keeps those abstractions accountable; elaboration lets programs
describe schemas, policies, interfaces, deployments, or other structured
artifacts rather than merely compute values.

Forma is not trying to replace Clojure, OCaml, or mainstream application
languages. It is for domains where source review, extensibility, diagnostics,
and generated contracts matter more than numeric throughput.

## Principles

- The engine owns syntax, types, evaluation, and elaboration—not domain nouns.
- Read, expand, infer, evaluate, elaborate, and emit remain explicit passes.
- Source spans survive every pass that can produce a diagnostic.
- Typed IR is the internal contract; JSON is a deliberate wire projection.
- Stored conformance goldens pin observable results; changing them is a reviewed decision.
- Generated output is inspectable evidence, not the primary review medium.

## Audience

Forma is designed for language-tool builders and teams maintaining
schema-heavy APIs, operational workflows, policy systems, configuration
languages, and other structured domains that benefit from a typed authoring
surface.
