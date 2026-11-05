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

[RFC 0005](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0005-row-operations.md) implements closed-shape `Pick`,
`Omit`, and disjoint `Merge`. Its follow-ups are proposals,
not implemented features or a committed delivery schedule:

1. [Qualified rows (0006)](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0006-qualified-rows.md): retain presence,
   absence, and disjointness obligations through generic functions and modules.
2. [Shared type normalization (0007)](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0007-type-normalization.md): make
   computed record types usable in contextual coercion, type values, and schemas.
   Closed-shape consumers can progress independently of open-row solving.
3. [Field/key indices (0009)](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0009-field-names-and-row-map.md): represent
   checked selections in generic signatures. Bounded row mapping is a later
   stage and does not block ontology migration.
4. [Typed form results (0008)](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0008-typed-form-results.md): expose validated
   declaration fields and check declarative result templates once. Migrate
   `query` only after old/new types and artifacts agree; retain `row-of` compatibility.

Each RFC specifies its own conformance gates. The full
bounded rollout still excludes arbitrary type-level functions and runtime
value-dependent type computation.

## Type generics exploration

[RFC 0018](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0018-type-generics.md) explores author-facing type generics
around existing Hindley–Milner inference: callback-driven collection results,
rigid checking of generic signatures, and consistent module and tooling contracts.
Its proposed changes are not implemented or scheduled.

## Everyday checker gaps

[RFC 0019](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0019-everyday-checker-gaps.md) collects gaps found while writing the
[SICP-style guide](./structure-and-interpretation.md) and the
[domain modeling guide](./domain-modeling.md). The evaluator, kernel
typechecker, and Effect checker disagree about some builtins, local
definitions, zero-argument functions, and match exhaustiveness. Unannotated
arithmetic infers `Float`. The Effect checker loses constructor types,
rejects options for optional fields, requires literal callbacks, and accepts
out-of-range literals. The guides document today's workarounds. The fixes are
proposed, not implemented or scheduled.

## Languages as libraries

[RFC 0021](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0021-languages-as-libraries.md)
proposes moving surface syntax out of the engine. Syntax forms would produce
code from typed holes, and a language would be a prelude that selects exports,
hidden core names, and a lexical profile. Forma's own surface would become the
first language, and Lisp dialects such as a Clojure-shaped surface would be
others. All of them would share one core, one type language, and one contract.
Declarative surfaces would be invertible, which makes Lisp emitters such as
`.cljc` possible. Stage 0 is implemented: a macro in scope may claim a
retired spelling such as `defn`, and `preludes/clojure.forma` supplies Clojure
spellings as an ordinary library, with a checked example, its diagnostics, and
its limits in [Clojure spellings](./clojure.md). Later stages wait on an agent benchmark and
are not implemented or scheduled.

The proposed emitter order is Clojure (`.cljc`, reaching the JVM and
ClojureScript), then Racket, then Scheme, then Common Lisp, whose separate
function namespace is a semantic difference rather than a spelling.
[RFC 0022](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0022-programmable-type-system.md)'s
"Lisp targets" records what each kernel port must emulate, the semantic gaps,
and the conformance gate for each. No emitter is implemented, and effectful
programs would stay TypeScript-only until a target has an effect runtime.

## A programmable type system

[RFC 0022](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0022-programmable-type-system.md)
positions Forma as a programmable type system for Lisp. It proposes a small
trusted kernel that re-checks elaborated programs, bidirectional elaborators
that generalize forms, a language adapter protocol for Lisp dialects, and a
gradual boundary for checking existing Clojure code after a second surface
exists. It also proposes backend capabilities, so that portable code would be
checked against the intersection of the backends a language selects, and it
records the Lisp target order and gates described above. Its first stage, the
positioning on this site, is done. The kernel, elaborators, adapters, and
backends are not implemented or scheduled.

## Effect hosts

[RFC 0022](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0022-effect-hosts.md)
proposes one host-neutral lowering between the Effect checker and its code
generators, so that each host is a naming and type profile, a printer, and a
runtime kernel that passes shared, data-driven conformance scenarios. It uses
that shape for a Rust target that emits async Rust, with closed error sets as
generated enums, and for the existing Go prototype. The proposal is not
implemented or scheduled, and a Rust host still needs a concrete consumer.

## Deferred

- General-purpose application-language positioning.
- A stable package or wire-format compatibility promise.
- Automatic registry publication or website deployment.
- Additional backends without a concrete consumer and conformance target.
