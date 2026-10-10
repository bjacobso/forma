# Roadmap

## Current foundation

- Lossless reader, formatter, macro expansion, evaluator, and TypeScript VM.
- Hindley–Milner inference with descriptor-aware typed core.
- Operational effect inference and portable effect artifacts.
- Native, JavaScript, and WebAssembly OCaml builds behind a shared JSON ABI.
- Cross-engine host, editor analysis, language server, and conformance suites.
- Browser compiler explorer with live intermediate stages.

## Next

1. Tighten the shared language specification around observable cross-engine
   behavior and turn remaining parity assumptions into fixtures.
2. Stabilize the host ABI and artifact schema around a small set of end-to-end
   consumer examples.
3. Improve incremental analysis, package caching, and editor latency without
   weakening source provenance.
4. Define the JavaScript/Wasm distribution model for the OCaml engine and the
   eventual public `@forma` packages.
5. Add a supported consumer-prelude SDK and document how to build a complete
   typed domain language. [Library preludes (0014)](./rfcs/0014-library-preludes.md)
   proposes how Effect, Foldkit, and other libraries would become preludes with
   their own compile targets.

## Record row rollout

[RFC 0005](./rfcs/0005-row-operations.md) implements closed-shape `Pick`,
`Omit`, and disjoint `Merge` in both engines. Its follow-ups are proposals,
not implemented features or a committed delivery schedule:

1. [Qualified rows (0006)](./rfcs/0006-qualified-rows.md): retain presence,
   absence, and disjointness obligations through generic functions and modules.
2. [Shared type normalization (0007)](./rfcs/0007-type-normalization.md): make
   computed record types usable in contextual coercion, type values, and schemas.
   Closed-shape consumers can progress independently of open-row solving.
3. [Field/key indices (0009)](./rfcs/0009-field-names-and-row-map.md): represent
   checked selections in generic signatures. Bounded row mapping is a later
   stage and does not block ontology migration.
4. [Typed form results (0008)](./rfcs/0008-typed-form-results.md): expose validated
   declaration fields and check declarative result templates once. Migrate
   `query` only after old/new types and artifacts agree; retain `row-of` compatibility.

Each RFC specifies its own engine parity and conformance gates. The full
bounded rollout still excludes arbitrary type-level functions and runtime
value-dependent type computation.

## Deferred

- General-purpose application-language positioning.
- A stable package or wire-format compatibility promise.
- Automatic registry publication or website deployment.
- Additional backends without a concrete consumer and conformance target.
