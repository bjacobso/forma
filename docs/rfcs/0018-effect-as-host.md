# RFC 0018: Effect as the host

| | |
| --- | --- |
| Status | Proposed; stage 1 (`extern` in single-file Effect programs) implemented |
| Created | 2026-10-26 |
| Scope | Project positioning, typed TypeScript imports, Effect vocabulary as library bindings, one checker for Effect programs, debugging generated code |
| Direction | Forma is a typed Lisp hosted on Effect, as Clojure is hosted on the JVM. Effect supplies the runtime and libraries. Forma supplies checked contracts, macros, and preludes. |

## Summary

Every Forma program that runs today runs as generated Effect TypeScript. This
RFC proposes making that the project's stated direction: Effect is Forma's
host platform, the way the JVM is Clojure's. A hosted language depends on its
interop, so the first stage adds `extern`, a typed import of existing
TypeScript exports:

```lisp
(extern "./payments.js"
  (error PaymentDeclined {:reason String})
  (service Payments
    (: charge (-> OrderId Int (Effect Receipt [PaymentDeclined]))))
  (: PaymentsLive (Layer [Payments]))
  (: format-cents (-> Int String)))
```

Forma checks every use of these declarations as if they were local. The
generator imports them instead of defining them, so TypeScript checks the
declarations against the real exports when it compiles the generated module.
Stage 1 is implemented for single-file programs. Later stages propose `extern`
in file modules, a `.d.ts` importer, Effect combinators as `extern`
bindings instead of compiler built-ins, one checker for editors, and source maps.

## Motivation

### Effect is already the host

The three consumer pages all generate Effect TypeScript:
[Forma for Effect](../effect.md), the [Foldkit prototype](../elm.md), which
targets Foldkit on Effect 4, and [email rules](../email.md). Their conformance
cases typecheck and run the output against `effect@4.0.3`. The ontology prelude's
JSON artifacts remain, but no runnable consumer uses them. The
[roadmap](../roadmap.md) still describes a general DSL engine whose output is
portable artifacts. It defers additional backends without a concrete consumer,
and Effect is the only backend with one.

Naming Effect as the host makes several open questions decidable. It decides
which runtime the REPL should run on, whether Effect concepts belong in the
compiler or in preludes, and what interop means.

### A hosted language lives on its interop

Clojure succeeded on the JVM because `(.method obj)` could call any Java
library with no ceremony. Forma had no equivalent. The trade-offs on the
Effect page said so: "Forma code cannot import TypeScript functions or types,
call an npm package, or write a JavaScript callback," and "an existing Effect
codebase has schemas and services in TypeScript. Forma cannot refer to them,
so today you would redeclare them." Every library call had to become a service
and a layer, and a team adopting Forma had to duplicate its schemas.

[VibeLang](https://vibelang.sh/) shows the same demand from another direction. It
gives Effect a TypeScript-like syntax, extends the TypeScript compiler, checks
`.vibe` and `.ts` files together, and calls npm packages directly. Forma
should not copy that design, because direct untyped calls would make its
signatures stop describing what code can do. But it needs an interop story
that keeps a team's existing schemas, errors, services, and layers usable.

### Interop must keep the contract

Forma's distinguishing property is that an operation's signature lists every
failure and every capability, down to single methods such as
`Payments.charge`. An interop form that admits untyped calls would quietly
widen what code can do, which is the failure the signature exists to prevent.
`extern` therefore requires a Forma type for every import, and a typed import
is checked like any other declaration.

## Current state

Before this RFC:

- Effect programs could use only Forma declarations and the combinators the
  mechanics compiler builds in (`docs/effect/reference.md`).
- `Effect.promise`, npm calls, and existing TypeScript schemas or services had
  to be wrapped as a service implemented in TypeScript and provided as a layer.
  Their schemas had to be redeclared in Forma, and the generator emitted a
  second copy.
- New `Effect.*` combinators required compiler changes. The Effect page
  calls this a contradiction of Forma's pitch that keywords are library code.
- The general HM checker that drives the language server does not understand
  layers, combinators, streams, or multi-clause `catch`, so editors show false
  errors on valid Effect programs.
- Stack traces and breakpoints point at generated TypeScript, and the hosted
  runtime (`makeMechanicsRuntime`) interprets only the original operation forms.

## Proposal

### 1. Positioning

Present Forma as a typed Lisp hosted on Effect: "Forma is a typed Lisp hosted
on Effect. Preludes turn it into domain languages, and the output is plain
Effect TypeScript." The JSON artifact pipeline, elaboration, and descriptor
machinery stay. They become the way preludes define vocabulary, not a second
product.

If this RFC is accepted, the README introduction, [vision](../vision.md), and
[roadmap](../roadmap.md) change to this framing. Until then they keep the
current wording. The comparison with Clojure has one important limit: Forma is
statically typed and checks effects, so its interop is typed and declared rather
than reflective.

### 2. `extern` (implemented)

`(extern "specifier" declaration...)` is a top-level form in Effect programs.
Its declarations are the existing declaration forms without implementations:

| Inside `extern` | Imports | Checked as |
| --- | --- | --- |
| `(type N T)`, `(class N {...})`, `(error N {...})` | the `Schema` constant or class | a local schema, class, or error |
| `(service N (: m Type) ...)` | the `Context.Service` class | a local service |
| `(: N (Layer [P] [E] [R]))` | a `Layer` value | a layer with exactly that signature |
| `(: f (-> A ... (Effect R [E] [Req])))`, `(: v (Effect R))` | an Effect function or value | an operation |
| `(: f (-> A ... B))` | a function | a pure function |
| `(: c T)` | a constant | a constant |

Semantics:

- **Checking.** Projection produces the same declaration kinds as local
  definitions, each carrying `extern: {module, export}` and no body,
  value, or layer implementation. The checker uses their types everywhere and
  skips body checks. Calls to imported operations contribute their declared
  errors and requirements at the call site, so undeclared failures are
  reported in Forma source.
- **Naming.** The TypeScript export is the generated name of the Forma name:
  `format-cents` becomes `formatCents`, and `Payments` stays `Payments`. A
  trailing `:export "name"` imports a different export under the generated
  name: `import { toSlug as slug }`.
- **Generation.** Imported declarations are not emitted. The generator writes
  one `import` per module, in declaration order, naming only the identifiers
  the generated code uses, so `noUnusedLocals` projects accept it. The
  specifier is emitted verbatim.
- **Trust boundary.** Forma trusts the declared types. TypeScript verifies
  them when it compiles the generated module against the real exports, so a
  mismatch is a TypeScript error in generated code rather than a silent
  runtime fault. The unit test `extern.test.ts` pins this with a declaration
  whose success type disagrees with the module.
- **Artifacts.** Imported declarations package under the
  `mechanics/extern-def/v0` payload contract. It requires `kind`, `name`, and
  `extern`, validates each kind's type fields, and rejects implementations.
- **Diagnostics.** `mechanics/extern` reports a missing or empty module
  specifier, an empty `extern`, a `define` or `layer` inside `extern`, an
  `:export` that is not a TypeScript identifier or not the last option, and a
  name imported twice. A local definition with an imported name is
  `mechanics/duplicate-name`.

Restrictions in stage 1:

- `generateEffectProgram`, `elaborateEffectProgram`, and
  `mechanicsPackageableDeclarations` support `extern`. File modules
  (`linkEffectModules`) and the HM checker do not, so module graphs report
  `extern` as an unbound name.
- The hosted runtime rejects imported operations with
  `mechanics/extern-operation`.
- Brand types that an imported schema refers to must themselves be declared,
  in the same `extern` or locally. Inline brands inside an imported schema are
  not hoisted.
- Tagged-union constructors on imported types lower to records, as they do in
  single-file programs. Linked modules would need the module to export a
  `NameConstructors` object.

### 3. Effect vocabulary as bindings (proposed)

When interop exists, built-in combinators become library bindings: `retry`,
`timeout`, and `for-each` are `extern` declarations of `Effect.retry` and its
siblings in an `effect` prelude, as `clojure.core` is mostly functions over
the JVM. Doing so needs signatures the checker cannot write today:

- type parameters on operations, not only on pure functions;
- error-set and requirement-set variables, so that `retry` can be typed as
  `(-> (Effect a e r) Schedule (Effect a e r))`;
- optional keyword arguments such as `:concurrency`.

Until then the built-ins stay. The prelude should arrive one combinator family
at a time, each pinned by the existing conformance cases, which must keep
generating byte-identical output.

### 4. One checker for Effect programs (proposed)

The language server should route Effect programs, meaning files containing
`service`, `layer`, `do!`, or `extern`, to the mechanics checker. It should
report its located diagnostics and serve go-to-definition for imported names
from their `extern` declaration. Convergence of the HM and mechanics checkers
remains the long-term goal. Routing removes the false errors now.

### 5. Running and debugging on the host (proposed)

- Source maps from generated TypeScript back to Forma spans. Every node already
  carries a span, so the generator can emit a v3 source map beside the module.
- A REPL that evaluates through generated code on the real Effect runtime, building
  on the [runnable host](./0013-runnable-host.md) protocol, instead of the
  hosted interpreter's subset.

## Alternatives considered

**Services only (status quo).** Services keep a clean capability boundary, but
they make every pure helper and schema a service or a duplicate. Pure functions
and schemas carry no authority, so a service adds ceremony without safety.
`extern` keeps services for effects and adds typed imports for everything else.

**An untyped escape hatch.** ClojureScript's `js*` and VibeLang's hatches admit
code the checker cannot see. In Forma that would let a body reach a capability
its signature does not list. Rejected.

**Read `.d.ts` files first.** Compiling Forma and TypeScript together, as
VibeLang does, avoids restating types. It would put the TypeScript compiler
inside an engine that also runs in browsers. It also needs a partial
translation from TypeScript types to Forma types, especially for
`Effect<A, E, R>` with conditional types. An importer that writes `extern`
blocks (stage 3) gets most of the benefit and keeps `extern` as the reviewed,
checked-in contract.

**An option on each declaration**, such as `(service Payments :from
"./payments.js" ...)`. This works for single declarations but scatters a
module's imports and has no form for signatures. The block reads like an
import statement and groups one module's surface.

## Implementation stages and validation

1. **`extern` in single-file programs (implemented).**
   `packages/ts/src/mechanics/extern.ts` flattens `extern` blocks.
   Projection, the checker, the generator, the hosted runtime, and the payload
   contracts handle imported declarations. Validation:
   - the `extern-interop` conformance case imports a hand-written `payments.ts`
     and checks the golden, strict typecheck, artifact packaging, and a harness
     that runs the real layer;
   - `reject-extern-forms` and `reject-extern-misuse` pin projection and
     check diagnostics, and the latter's `rejects` verdict confirms TypeScript
     would also reject the misuse;
   - `extern.test.ts` covers projection, import pruning, the TypeScript trust
     boundary, and the runtime refusal;
   - the surfaces golden `effect-typescript/extern-interop` pins the IR.
2. **`extern` in file modules.** The module graph binds `extern` names as
   module-local declarations with exportable identity. The HM checker reads
   their signatures, and `linkEffectModules` emits their imports. Gate:
   `modules-link.test.ts` links and runs a graph whose modules share an
   imported service.
3. **`.d.ts` importer.** A host command reads a TypeScript module and writes
   an `extern` block for the exports Forma can type. It reports the exports it
   skips and why. Gate: round-trip the `extern-interop` module.
4. **Effect-polymorphic signatures and an `effect` prelude.** Add set
   variables and operation type parameters, then move one combinator family at
   a time. Gate: every existing Effect conformance golden is unchanged.
5. **Editor routing and source maps.** Gate: no language-server diagnostics on
   positive Effect conformance cases, and a source-mapped stack trace in one
   harness.

## Decisions still required

- Whether to adopt the positioning in section 1, and which pages change with it.
- Whether specifiers stay verbatim or resolve relative to the generated file
  when file modules support `extern`.
- Whether `generateEffectProgram` should optionally typecheck the generated
  module against its imports at build time, reporting mismatches at the
  `extern` declaration instead of in generated code.
- How default exports and non-identifier export names are spelled.
- Whether imported services may declare method requirements, which local
  services forbid, when the TypeScript service genuinely has them.

## Related designs

- [RFC 0002: Modules and packages](./0002-modules-and-packages.md): stage 2
  extends its module graph.
- [RFC 0003: Direct-style effects](./0003-direct-style-effects.md):
  effect-polymorphic signatures overlap with its inferred capabilities.
- [RFC 0013: A runnable host](./0013-runnable-host.md): the REPL in section 5.
- [RFC 0014: Local providers](./0014-local-providers.md): test doubles for
  imported services.
