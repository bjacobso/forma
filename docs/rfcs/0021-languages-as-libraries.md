# RFC 0021: Languages as libraries

| | |
| --- | --- |
| Status | Proposed; stage 0 implemented |
| Created | 2026-11-04 |
| Amends | [RFC 0001](./0001-unified-syntax.md)'s single canonical surface and its three-form meta layer (`type`, `form`, `macro`); its one type language and one option syntax are unchanged |
| Depends on | [RFC 0008](./0008-typed-form-results.md) for checking declarative templates once; [RFC 0017](./0017-diagnostic-catalog.md) for stable codes on surface diagnostics |
| Scope | Syntax categories, code-producing syntax forms, full hygiene, language declarations, interposition points, reader lexical profiles, self-hosting Forma's surface, Lisp dialect surfaces, Lisp emitters, differential conformance |
| Direction | The engine owns one core: semantics, the type language, effects, IR, and contracts. Every surface, including Forma's own, is a library of typed syntax forms selected per project. Declarative surfaces are invertible, so a Lisp surface doubles as an emitter for that Lisp |

## Summary

Forma's surface syntax is hardcoded today. `surface/core.ts` desugars
`(define f [x] ...)`, destructuring parameters, destructuring `let`, macro
patterns, and type declarations before macro expansion runs, and it rejects
`def`, `defn`, `defmacro`, `lambda`, and `let*` outright, even when a library
macro with that name is in scope.

This RFC moves surface syntax out of the engine and into libraries:

1. **Syntax categories** (`Expr`, `(Expr t)`, `Pattern`, `Params`, `Decl`,
   `Type`, `(Declares X)`) are the types of syntax. Most already exist as form
   hole types.
2. **Syntax forms** are forms whose result is code in a category instead of an
   IR record. Their holes are checked where the author wrote them, and their
   completion, outline, formatting, and documentation derive from the same
   descriptor as forms do today.
3. **Full hygiene** covers every binder that an expansion introduces.
4. **A language** is a prelude that declares its exports, the core names it
   hides, its handling of applications and literals (interposition points),
   and a lexical profile chosen from a fixed set of reader switches.
5. **Forma's own surface becomes the first language**, `forma/core`, defined
   with syntax forms. Stored goldens must not change.
6. **Lisp dialects** such as `@forma/clojure` are further languages over
   Forma's semantics. They are not ports of the other language's semantics.
7. **Declarative syntax forms are invertible.** Running a Lisp surface
   backwards over core emits source in that Lisp. A small kernel port per
   target then makes the emitted code run, and the conformance corpus checks
   every target against the TypeScript VM.

The result is a typed pivot for Lisp DSLs: write in a familiar Lisp's syntax,
check with one type system, produce one contract, and run on the host the
consumer already has. Forma does not attempt to typecheck existing Clojure,
Common Lisp, or Racket programs.

## Motivation

**Agents write other Lisps' idioms.** Models carry habits from languages they
have seen often into ones they have not. Forma's syntax is close to Clojure's
(`fn`, `[...]` parameters, keywords, `~`/`~@`), so a model writes `defn`,
`(:key m)`, `when-let`, and `#{...}`. Today the first is a hard error, the
second a unification failure, and the last a read error. A library could
supply the first three, but the engine rejects `defn` before any library can
claim it. Measuring whether such a library reduces repair rounds requires
removing that block first.

**Macros are the weakest part of the "typed macros" claim.** Macro arguments
are untyped syntax. A bad call is reported inside the expansion, at best with
the author's span. Hygiene covers generated `fn` and `let` binders, and only for
the engine's own prelude macros (`docs/modules.md`, "Compile-time libraries";
`expander/expand.ts` gates `hygienicExpansion` on `__forma_` names). Forms
already solve the call-site problem for IR: holes have types, diagnostics point
at the hole, and tooling derives from the descriptor. Code-producing forms
would make the same guarantees for syntax.

**The surface is engine code.** [RFC 0001](./0001-unified-syntax.md) unified
four type languages and many spellings into one, which was right for the
contract: generated artifacts stay consistent. But it encoded the result in
TypeScript, so a prelude cannot add a declaration head, and a library cannot
remove a core one. Racket and Lean 4 show that a language's own surface can be
library code without losing tooling or diagnostics.

**DSLs need to run where their consumers are.** Forma's thesis is portable
artifacts: a policy, schema, or workflow written once and consumed elsewhere.
Today "elsewhere" means JSON artifacts or generated Effect TypeScript. Teams
with Clojure or Common Lisp services would embed the same DSL if Forma emitted
their language and ran its checked logic there. Clojure itself reaches the JVM,
JavaScript, the CLR, and Dart through `.cljc`, so one Clojure emitter reaches
four platforms.

## Current state

- **Surface desugaring precedes expansion.** `normalizeCoreProgram`
  (`packages/ts/src/surface/core.ts`) runs before the expansion loop in
  `expander/expand.ts` and again on each macro's result. It lowers
  `define`-with-parameters, destructuring `fn` and `let`, `macro` patterns with
  `...`, `type`/`class`/`error`/`typeclass` declarations, and dynamic `get`.
- **Retired spellings are global.** `surface/core.ts` maps `def`, `defn`,
  `defmacro`, `lambda`, and `let*` to their replacements and throws
  `Use define instead of defn` wherever the head appears, before macros are
  known. `type/lower-core.ts` and `evaluator/vm-bridge.ts` reject `def` and
  `defn` again after expansion, with longer messages. The VM rejects `def` and
  `defn` as runtime heads.
- **Some sugar is already a library.** `when`, `unless`, `cond`, `and`, `or`,
  `->`, and `->>` live in `preludes/kernel.forma`. In a file module, an
  unimported use fails with `module/unimported-sugar` (`modules/graph.ts`).
- **Projects already choose automatic imports.** `configureSession({ projects:
  [{ prelude }] })` gives each project's modules the exports of a selected
  prelude ([File modules](../modules.md)), which is most of Racket's module
  language. A project cannot hide the implicit module core.
- **Macros follow module scope.** Macro helper references keep their
  definition-site identity; caller syntax keeps caller bindings.
- **Expansion keeps provenance.** `markExpansion` and `tagExpandedExpr` attach
  author spans and the macro name to expanded code, so type errors in macro
  arguments are reported in author source.
- **Forms have typed holes but produce data.** A form's `:types` include
  `Syntax`, `(Expr Bool)`, `(Declares X)`, and `(Refers X)`, and its result is
  an `:ir` record. A form cannot produce code.
- **The reader is fixed.** The lexer recognizes `( ) [ ] { } ' \` ~ ~@ ;`,
  strings, numbers, symbols, and keywords. `#` is a read error. There are no
  reader macros.
- **Contracts are computed over IR.** `payloadContractId` and module
  `contractId` hash the reachable `:ir` type definitions, not surface syntax.
- **One executable target.** The TypeScript evaluator and VM run programs;
  `mechanics/effect-typescript.ts` and the Elm prototype generate TypeScript.
  `CodeGen.ts` already has an S-expression builder and pretty-printer for
  emitters.

## Proposal

### Principle: one core, many surfaces

RFC 0001 gave every DSL author one dialect so that generated contracts stay
consistent. This RFC keeps that goal and splits its means into two layers:

- **Core (engine-owned, one of each).** Evaluation semantics, the type
  language and inference, effects, the core expression and declaration heads,
  IR, artifacts, and contract identity.
- **Surface (library-owned, many).** Spellings, sugar, declaration heads that
  lower to core heads, literal syntax enabled by a lexical profile, and
  diagnostics phrased in the surface's terms.

Every surface lowers to the same core, and contracts are computed over core
IR, so two surfaces cannot produce different contracts for the same meaning.
That keeps what RFC 0001 protected while allowing more than one spelling at
the edge. The type language stays in the core: a surface may add type sugar
that lowers to core types, but it does not define a second type language.

### Syntax categories

A syntax category classifies syntax by what it can stand for:

| Category | Accepts |
| --- | --- |
| `Expr` | Any expression |
| `(Expr t)` | An expression checked against `t` at the call site |
| `Pattern` | A `match` pattern, including record and constructor patterns |
| `Params` | A parameter vector, with destructuring patterns |
| `Bindings` | A `let` binding vector of pattern/value pairs |
| `Decl` | A top-level declaration |
| `Type` | A type expression |
| `Symbol`, `(Declares X)`, `(Refers X)`, literals, refined literals | As in form holes today |

`Syntax` remains the escape hatch for syntax kept as data. A hole in a
category is parsed and checked as that category before expansion, so a
malformed `defn` parameter vector is reported at the vector, not inside the
generated `fn`.

### Syntax forms

A syntax form is declared like a form, with a category result instead of an
`:ir` type:

```lisp
(syntax (defn name doc? params body ...)
  "Define a function."
  :types {:name (Declares Value) :doc (Option String)
          :params Params :body (List Expr)}
  :produces Decl
  `(define ~name (fn ~params ~@body)))
```

There are two tiers:

- **Declarative syntax forms** have a quasiquote template as their body, use
  each hole at most once in the output, and produce a template headed by a core
  or surface head. They are checked once against their hole categories, in the
  sense of [RFC 0008](./0008-typed-form-results.md). They are hygienic,
  analyzable, documented from their descriptor, and invertible.
- **Procedural macros** (`macro`) keep running arbitrary compile-time Forma.
  They gain hygiene but not invertibility, and tooling treats their output as
  opaque.

`:check` works as it does for forms and adds diagnostics in surface terms.
Completion, outline rows, formatting, and generated reference pages derive
from the descriptor, as [Writing a form](../writing-a-form.md) describes for IR
forms.

### Hygiene

Expansion adopts sets-of-scopes hygiene for every binder an expansion
introduces (`fn` and `let` parameters, `match` pattern variables, `define`,
and local declarations), for every macro, not only `__forma_` prelude macros.
References in a template resolve at the definition site; references in holes
resolve at the use site. Macro-generating macros are defined and pinned by
fixtures. A language cannot be reliable without this: a user binding named
`fn` must not change what `defn` expands to.

### Interposition points

A language decides what three kinds of syntax mean:

- **Application with a non-symbol head**, such as `(:a m)`. Forma core rejects
  it; a Clojure surface lowers it to `(get m :a)`.
- **Literals and dispatch nodes**, such as `#{1 2}`, `#(+ % 1)`, and
  `#inst "..."`. Each node kind that the lexical profile enables names the
  syntax form that interprets it.
- **Unbound heads.** A language supplies the diagnostic for an unbound head,
  which replaces today's fixed retired-spelling table with surface-aware
  messages and fixes.

These correspond to Racket's `#%app`, `#%datum`, and `#%top`. They are fields
of a language declaration, not magic identifiers.

### Lexical profiles

Arbitrary reader macros are rejected: code that runs inside the reader breaks
the lossless reader, incremental parsing, the formatter, and structural
editing. Instead:

- The reader reads one fixed superset grammar. `#` followed by `{`, `(`, `'`,
  `_`, a symbol, or a string produces a generic dispatch node. `@x` and
  `^meta x` produce prefix nodes. All of them are lossless green-tree nodes.
- A **lexical profile** selects from a small set of switches: whether a comma
  is whitespace (Clojure) or unquote (Common Lisp, Scheme), whether brackets
  are vectors or parentheses (Racket), which dispatch node kinds are enabled,
  and whether symbols fold case. Disabled node kinds stay read errors.
- The default profile is today's grammar, so existing source reads exactly as
  it does now.

### Languages

A language is a prelude module containing a `language` declaration. The
declaration is itself a form; its IR is the data the engine consumes:

```lisp
(language clojure
  "Clojure-shaped surface over Forma semantics."
  :extends forma/core
  :lexical {:comma :whitespace :dispatch [:set :fn-literal :tagged :deref]}
  :exports [defn defn- if-let when-let when-not if-not comment -> ->>]
  :hides [define]
  :apply keyword-access
  :literals {:set set-literal :fn-literal fn-literal}
  :unbound clojure-unbound)
```

Projects select a language the way they select a prelude today, through
`configureSession` and the project configuration. Every module in the project
reads with the language's profile, receives its exports, and loses the hidden
core names. `:hides` affects names only; the hidden heads remain the targets
of expansion.

### Forma's surface as the first language

`forma/core` re-expresses `normalizeCoreProgram`'s sugar as syntax forms and
procedural macros where needed: `define` with parameters, destructuring `fn`
and `let`, `macro` patterns with `...`, `type` declarations (with `:check` for
the type-syntax rules), `class`, `error`, `typeclass`, and dynamic `get`.
The retired-spelling table moves to `forma/core`'s `:unbound` handler.

This is the validation of the whole design. If Forma's own surface cannot be
written this way with byte-identical goldens, a dialect surface cannot either.

### Dialects

A dialect is a surface over Forma's semantics. Clojure comes first because the
reader is already close to it.

| Clojure syntax | `@forma/clojure` |
| --- | --- |
| `defn`, `defn-`, `def`, `fn`, destructuring `let` | Lowered to core |
| `->`, `->>`, `cond->`, `some->` | Syntax forms |
| `if-let`, `when-let` | Lowered to `match` on `Option` |
| `(:k m)`, `(get m :k)` | `:apply` lowers to core `get` |
| `#{...}`, `#(...)` | Enabled dispatch nodes, lowered to core sets and `fn` |
| Truthiness of `nil` and `false` in `if` | Not lowered silently; `if` accepts `Bool` and reports other types with a fix |
| Atoms, dynamic vars, laziness, protocols, Java interop, `eval` | Rejected with a `dialect/unsupported` diagnostic naming the construct |
| `defmacro` that calls `clojure.core` at expansion | Rejected; `macro` and `syntax` are available |

Code that looks like Clojure but behaves like Forma (Int and Float, `Option`
instead of nil punning) is the main risk of this design. Dialect diagnostics
must name the difference rather than produce a generic type mismatch.

Scheme and Racket subsets follow; Racket's bracket profile and `#t`/`#f` are
lexical switches. Common Lisp comes last, because its separate function
namespace (`#'f`, `funcall`) is a semantic difference, not a spelling.

### Diagnostics and resugaring

Expanded code already carries author spans. Syntax forms add the surface
form's name and hole to each diagnostic that arises inside an expansion, so a
type error in a `defn` body says `defn`, not `fn`. Declarative forms are
invertible, so tools can show core terms in the author's surface
(resugaring). The Foldworks outline can show a module in another surface that
shares its core, which is a projection, not a translation.

### Targets

For a Lisp target, a surface run backwards is most of an emitter:

1. **Resugar.** Match core terms against the surface's declarative templates,
   most specific first, and fall back to the core spelling, which the target's
   kernel port defines.
2. **Kernel port.** Implement Forma's core primitives in the target: tagged
   values, `match`, `Option`, records, sets, and Forma's numeric and string
   semantics, including the checked Int range.
3. **Differential conformance.** Run the conformance corpus through the
   target and compare observable results with the TypeScript VM's stored
   goldens. A difference is a back-end bug or a semantic gap to document.

The first target is `.cljc` for Clojure (JVM) and ClojureScript. Effectful
programs stay TypeScript-only until a target has an effect runtime. The
roadmap's rule still applies: a back end needs a concrete consumer and a
conformance target.

### What does not change

Artifacts, `payloadContractId`, module `contractId`, the type language, the
effect system, the host ABI, and the default lexical profile do not change.
Source written today means the same thing under `forma/core`.

## Alternatives considered

- **Keep retired spellings and add fixes.** Diagnostics with machine-applicable
  fixes for `defn` and similar spellings would cut agent repair rounds without
  any of this design, and RFC 0017 should add them regardless. They do not let
  a library define a surface, and they keep Forma's own surface in TypeScript.
- **Reader macros.** Racket and Common Lisp allow code in the reader. It is the
  most general option and the one that breaks lossless reading, formatting, and
  structural edits. Fixed node kinds plus profiles cover the dialects in scope.
- **Typechecking existing Clojure, Common Lisp, or Racket.** This requires
  running the other language's macros, typing its whole standard library, and
  occurrence typing for idiomatic dynamic code. Typed Racket and Typed Clojure
  show the cost; clj-kondo shows that an unsound linter with per-library macro
  hooks is what users adopted. Forma's dialects stay inside Forma's semantics.
- **One TypeScript front end per dialect.** Faster to start and impossible for
  a user or prelude author to extend. It repeats today's problem per dialect.
- **Procedural macros only.** Simpler, but nothing would be invertible, so
  resugaring, projection, and emitters would each need hand-written inverses.

## Implementation stages and validation

| Stage | Work | Gate |
| --- | --- | --- |
| 0 | Retired spellings are rejected after expansion instead of before, so a macro in scope may use the name. A `preludes/clojure.forma` library supplies `defn` and related spellings as ordinary macros. | Fixtures: an imported `defn` expands and typechecks; an unbound `defn` still reports `Use define instead of defn` at the author's form. An agent benchmark compares repair rounds with and without the library before later stages start. |
| 1 | Sets-of-scopes hygiene for all binders and all macros. | Capture fixtures, including macro-generating macros, pass in evaluation and typechecking. |
| 2 | Syntax categories and `syntax` forms; descriptor-derived tooling. | Call-site diagnostics for malformed holes; generated reference pages for syntax forms. |
| 3 | `forma/core` replaces `normalizeCoreProgram`'s sugar. | All stored goldens byte-identical; `pnpm check` passes; analysis latency within an agreed budget. |
| 4 | `language` declarations, interposition points, lexical profiles, and project selection. | Two languages in one module graph; default profile reads every existing fixture unchanged. |
| 5 | `@forma/clojure`. | A pinned typed subset passes its fixtures; unsupported constructs report `dialect/unsupported`. |
| 6 | Resugaring, then the `.cljc` emitter and kernel port. | Round trip Forma ↔ Clojure surface; the conformance corpus matches TypeScript goldens on the JVM and in ClojureScript. |

Stage 0 is deliberately small. If the benchmark shows no reduction in repair
rounds, later stages should be reconsidered before Stage 1 starts.

## Decisions still required

- Whether code-producing forms use a new `syntax` head or `form` with a
  `:produces` category in place of `:ir`.
- Whether a module may select a language in source (a header form) or only
  through project configuration.
- Whether `:hides` may hide core heads entirely, so that `define` is unbound in
  a strict Clojure module, or only remove them from completion.
- The exact kernel primitive set that a target port must implement, and
  whether Forma's checked Int range is emulated on targets with wider integers.
- Whether surface diagnostics get their own code namespace per language
  (`clojure/...`) or share `surface/*` and `dialect/*`.
- How a multi-surface project formats files: always in the file's own
  language, or optionally projected.

## Implemented payload-validator ownership

Bundled domain payload checks now use the existing named-validator extension:
ontology forms declare
`:extensions {:artifact {:validators ["domain-payload"]}}`. Kind spelling
alone no longer invokes those checks. This also isolates a consumer's `Entity`
or `Document` when both preludes are loaded together; the consumer's own IR
contract remains checked. Direct declaration producers opt in with their
`validators` list. This is the payload-boundary slice of library ownership,
not the language/profile or elaborator stages proposed above.

## Related designs

Racket's `#lang`, module languages, and the `#%app`, `#%datum`, and `#%top`
interposition points are the closest model for languages as libraries.
Culpepper's `syntax-parse` syntax classes correspond to syntax categories.
Flatt's "Binding as Sets of Scopes" (POPL 2016) defines the hygiene model.
Rhombus puts a new surface over Racket's core and libraries. Lean 4 defines
much of its own surface with syntax categories, `macro_rules`, and elaborators
(Ullrich and de Moura, "Beyond Notations", IJCAR 2020). Pombrio and
Krishnamurthi's resugaring work (PLDI 2014, ICFP 2015) shows core evaluation
in surface terms. Shen ports a typed Lisp to many hosts through a small kernel,
KLambda. Pandoc converts between many document formats through one AST and is
lossless only over their shared subset. Clojure's `.cljc` reader conditionals
target several platforms from one source. clj-kondo's hooks describe library
macros to an unsound analyzer; Typed Clojure and Coalton add static types to
Clojure and Common Lisp in different ways.
