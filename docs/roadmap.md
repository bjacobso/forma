# Roadmap

## Current foundation

- Lossless reader, formatter, macro expansion, evaluator, and TypeScript VM.
- Hindley–Milner inference with descriptor-aware typed core.
- Operational effect inference and portable effect artifacts.
- A JSON host ABI with a source-built `forma` JSON CLI and daemon.
- Editor analysis, language server, and conformance suites with stored goldens.
- Browser compiler explorer with live intermediate stages.
- Consumer-prelude foundations (FX1–FX4): diagnostic catalogs/help/fixes,
  authored syntax and named holes, multi-file preludes, and `forma schema`.
- Native unary RPC/group generation through the [RPC prelude](./effect/rpc.md).

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
5. Complete the consumer-prelude workflow on the merged FX1–FX4 foundations.
   Active-context typing hooks (PR #150) and validator scoping (PR #151) remain
   open; the standalone distribution proposal is RFC 0025 in PR #142.

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
typechecker, and Effect checker now share checked contracts and cross-pass
fixtures for `reverse`, `sqrt`, `reduce`, `conj`, list `concat`, and `quot`.
The builtin inventory records remaining pass-specific names and legacy gaps;
it does not claim complete builtin parity. Stage 2 is also implemented:
non-exhaustive closed-constructor matches are errors in both checkers (PR #141).
Local definitions and zero-argument functions still have gaps. Unannotated
arithmetic infers `Float`. The Effect checker loses constructor types,
rejects options for optional fields, requires literal callbacks, and accepts
out-of-range literals. The guides document today's workarounds. The fixes are
otherwise proposed, not implemented or scheduled.

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

## Effect polymorphism

[RFC 0023](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0023-effect-polymorphism.md)
proposes error-set and requirement-set variables in Effect signatures, so
that user-written higher-order operations, such as wrappers and reusable test
doubles, pass their callbacks' effects through without over-approximating
them. Built-in combinators would become signatures with the same notation.
It does not add continuations. The proposal is not implemented; its third
stage depends on the named-callback fix in
[RFC 0019](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0019-everyday-checker-gaps.md).

## Proposed next-level capabilities and ordering

The following is a dependency-aware proposal, not an implementation commitment:

1. Close remaining everyday contracts and workspace/module parity (RFCs 0019
   and 0004). Specify a small independently checked core under the programmable
   type system RFC; checker consolidation and independent re-checking are
   different tasks, and neither proves interpreter agreement.
2. Enable reusable composition: Effect signature polymorphism (RFC 0023), the
   record rollout above, and typed hook inputs/result templates (RFC 0008).
   The current raw `nil`/bare-value optional-hole ABI needs an explicit migration,
   not an assumed `Option` type.
3. Improve the authoring loop with
   [typed holes (0026)](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0026-typed-holes.md)
   and RFC 0015's proposed seeded properties/fault schedules. The first kernel
   test framework exists only in a local implementation, not shared main.
   Build generated Effect testing on that foundation, not a parallel runner.
4. Run the small
   [finite workflow/evidence experiment (0028)](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0028-bounded-verification.md)
   before SMT/Lean integration or general affine/dependent typing. This experiment
   can proceed independently of the kernel with an explicit trust account.
5. Demonstrate one checked schema → RPC/HTTP → native Effect → Foldkit path
   (RFC 0011), then a directional
   [contract diff/migration gate (0027)](https://github.com/bjacobso/forma/blob/main/docs/rfcs/0027-contract-evolution.md).
   Go/Rust and multi-dialect editing remain gated by their existing RFCs;
   no line-count target or “verified full-stack system” claim is implied.

Agent execution safety belongs to RFC 0012's existing checked-run/host boundary,
not a new sandbox language. Durable workflows belong to checked IR plus native
Effect activities and persistent recovery tests (RFC 0016), not a new execution
kernel. Contract hashes, static types and bounded laws do not authenticate
evidence or secure an in-process native host.

### Review baseline and corrected claims

This review used shared main
[`38b3da9`](https://github.com/bjacobso/forma/commit/38b3da9bdcca99cdbcbb2a88ab5f761b9d472316)
on 2026-11-11, not open PRs or another thread's local edits:

| Review claim | Verified disposition and owner |
| --- | --- |
| Two checker representations remain | Yes: `type/types.ts` and `mechanics/types.ts`; RFC 0004 owns convergence, while RFC 0022 owns independent checking. |
| Hooks can supply unjustified types/scope | Yes: `surface/form.ts` resolves hook-returned type syntax and scope; no independent core re-checker validates the claimed term. Projection IR is validated separately. RFC 0008 adds proposed static hook contracts. |
| Optional hook inputs are raw, not Options | Yes: the current hook ABI is documented in Writing a form; do not silently change it. |
| Numeric, generic-row and Effect-wrapper gaps remain | Numeric argument inference in `type/infer-core.ts` can widen unannotated arguments to Float; RFCs 0018/0019 own that choice. Existing open record inference is not RFC 0006's qualified operations. Mechanics operation signatures still use closed sets; RFC 0023 owns polymorphism. |
| LSP workspace parity is incomplete | Confirmed, but not absent Effect support: `analysis/workspace.ts` already consumes mechanics diagnostics/types; `language-server/src/workspace.ts` still lacks file/package graph resolution. |
| Standalone CLI and consumer SDK gaps | Partial: `host/package.json` has a source-built `forma` bin; `host/src/cli.ts` has file/schema/explain/package commands. FX1–FX4 are merged. Standalone distribution and the complete authoring workflow remain separate work. |
| Add typed-hole synthesis | Proposed, not shipped: captured syntax slots are implemented; unfinished-term goals are RFC 0026. |
| A hash proves wire compatibility or shared behavior | No: `artifact/contract-identity.ts` hashes root/reachable definitions, including metadata. Directional codec compatibility needs RFC 0027. |
| Signatures enumerate every fault path | No: they constrain shapes/sets, not call occurrences, scheduling, recovery or business laws. RFC 0015 requires explicit generators and postconditions. |
| Journals, multi-target lenses and an agent sandbox already work | No: RFCs 0016/0021/0012 remain proposals or partial foundations. Go/Rust are not shipped executable targets. RPC generation is merged, but a full-stack linker is not. |
| A tiny kernel guarantees runtime safety and refinements | Rejected: no arbitrary line budget; independent checking, execution conformance, native policy enforcement and solver trust are separate obligations. Brands are not authority boundaries. |

Direct probes against the built baseline confirm `square` infers `Float -> Float`,
an incomplete closed-constructor match fails with error severity, an optional
record field rejects an existing `Option String`, a let-bound tagged constructor
loses its nominal type, a named `for-each` callback is rejected, and an out-of-range
refined constant is accepted. Generic Effect-set signatures report unknown
error/requirement names; `?body` is an unbound symbol, not a goal. These observations
are a dated baseline, not promises that the gaps remain forever. Comparative
claims that other Lisps lack all capability mechanisms or that no other platform
can support these ideas are not established by this repository review.

The RFC directory has pre-existing duplicate 0022 and 0023 numbers. Keep those
filenames stable and use descriptive links. New proposals use unique 0026–0028;
0024 is occupied and 0025 is reserved by open PR #142. The existing qualified-row
and host-target designs are extended/referenced, not replaced by parallel RFCs.

## Deferred work

- General-purpose application-language positioning.
- A stable package or wire-format compatibility promise.
- Automatic registry publication or website deployment.
- Additional backends without a concrete consumer and conformance target.
