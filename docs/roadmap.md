# Roadmap

## Current foundation

- Lossless reader, formatter, macro expansion, evaluator, and TypeScript VM.
- Hindley–Milner inference with descriptor-aware typed core.
- Operational effect inference and portable effect artifacts.
- A JSON host ABI with a source-built `forma` JSON CLI and daemon.
- Editor analysis, language server, and conformance suites with stored goldens.
- Browser compiler explorer with live intermediate stages.

## Elm-style application prototype

The [Foldkit prelude prototype](/elm) generates Effect / Foldkit TypeScript with
exhaustive message updates, typed command recovery, and pure Hiccup views. It has a strict golden and headless conformance harness.
Command arguments, subscriptions, richer views, editor/worker integration, and
shared HttpApi server/client declarations remain proposed work. There is no
production-readiness claim.

## Effect as the host

[RFC 0018](./rfcs/0018-effect-as-host.md) proposes treating Effect as Forma's
host platform. Its first stage is implemented: `extern` imports existing
TypeScript schemas, errors, services, layers, functions, constants, and
operations into single-file Effect programs under checked Forma types. `extern`
in file modules, a `.d.ts` importer, Effect combinators as library bindings,
editor routing to the Effect checker, and source maps remain proposals.

## Next

1. Tighten the language specification around observable behavior and turn
   remaining untested assumptions into fixtures.
2. Stabilize the host ABI and artifact schema around a small set of end-to-end
   consumer examples.
3. Improve incremental analysis, package caching, and editor latency without
   weakening source provenance.
4. Reduce TypeScript CLI and engine startup cost, and define the distribution
   model for the eventual public packages.
5. Add a supported consumer-prelude SDK and document how to build a complete
   typed domain language.

## Record row rollout

[RFC 0005](./rfcs/0005-row-operations.md) implements closed-shape `Pick`,
`Omit`, and disjoint `Merge`. Its follow-ups are proposals,
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

Each RFC specifies its own conformance gates. The full
bounded rollout still excludes arbitrary type-level functions and runtime
value-dependent type computation.

## Deferred

- General-purpose application-language positioning.
- A stable package or wire-format compatibility promise.
- Automatic registry publication or website deployment.
- Additional backends without a concrete consumer and conformance target.
