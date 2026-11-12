# RFC 0022: A programmable type system

| | |
| --- | --- |
| Status | Proposed; stage 0 (positioning) implemented |
| Created | 2026-11-04 |
| Amends | [RFC 0021](./0021-languages-as-libraries.md)'s non-goal "Forma does not attempt to typecheck existing Clojure, Common Lisp, or Racket programs", which becomes a later, gated stage; [Vision](../vision.md)'s description of Forma as a language for hosting DSLs |
| Depends on | [RFC 0021](./0021-languages-as-libraries.md) for syntax forms, hygiene, language declarations, and lexical profiles; [RFC 0008](./0008-typed-form-results.md) for checking form results once; [RFC 0017](./0017-diagnostic-catalog.md) for stable diagnostic codes |
| Scope | Positioning, the trusted kernel and its core terms, bidirectional elaborators, the language adapter protocol, language composition, a gradual boundary for existing Lisp code, backend capabilities, Lisp emitter targets, type-system profiles |
| Direction | Forma owns the semantics of types and elaboration. Surfaces and adapters own syntax; backends own runtimes. Extensions may propose terms and types; a small kernel decides what is well typed |

## Summary

Forma has described itself as a typed Lisp for domain languages. The
description is accurate but sells the wrong part. A Lisp with static types
already exists for every major dialect. What Forma has that they lack is a
checker that preludes extend: a `form` gets expected types for its holes,
binds names in scope, reports diagnostics at the author's syntax, and has its
output checked against a declared type. That is a programmable type system
with one surface attached.

This RFC makes that the identity of the project:

> **Forma is a programmable type system for the Lisp family.** It lets
> developers define what a well-typed program means for their domain, checks
> those definitions with one small kernel, and compiles the result to real
> runtimes.

The positioning commits the engine to five things:

1. **A small trusted kernel.** A kernel checks fully elaborated **core
   terms** without inference. Everything else, including Forma's own forms,
   proposes terms that the kernel accepts or rejects.
2. **Bidirectional elaborators.** Forms grow into elaborators: compile-time
   functions that receive an expected type, check or infer their subterms,
   and emit core terms and diagnostics.
3. **A language adapter protocol.** The interface a Lisp dialect implements
   to be checked by Forma: its reader profile, scope model, macro integration,
   special forms, host primitives, and backend capabilities.
4. **Languages as composable libraries.** A language declaration names an
   adapter, type libraries, elaborators, and a backend. A domain language
   extends a host language the way a package extends another.
5. **Profiles, not a monolith.** The kernel's type theory is chosen per
   language from named profiles. Today's profile is Hindley–Milner with rows,
   effects, and refinements. Richer profiles are separate RFCs.

It also settles the question that most affects the compiler's design.
**Forma makes new typed languages in a familiar Lisp syntax easy first, and
checks existing Lisp code second**, through an explicit gradual boundary and
only after the adapter protocol has a second dialect.

## Motivation

### Three possible identities

| Identity | Pitch | What it needs | Who already does it |
| --- | --- | --- | --- |
| A new Lisp | A better Lisp with static types | A runtime, a standard library, an ecosystem | Typed Racket, Coalton, Carp, Shen |
| A universal Lisp typechecker | TypeScript for the Lisp family | Each dialect's macros, standard library types, occurrence typing | Typed Clojure, Typed Racket |
| A programmable type system | Build typed languages on existing Lisps | A kernel, an elaborator API, adapters | Turnstile, for Racket only |

The first competes with mature languages on their own terms, and Forma's
[Vision](../vision.md) already says it is not trying to replace Clojure or
OCaml. The second is a large, mostly mechanical project whose value is
bounded by how well it imitates each dialect's existing semantics. The third
is what Forma's forms already approximate, and nothing else offers it across
dialects or with portable artifacts.

### Fixed typing rules are the gap

Typed Clojure and Typed Racket check programs against rules their authors
wrote. A domain language has rules of its own: a workflow step must exist and
receive the inputs it declares; a query predicate sees the fields of the
entity it selects; a rule may not touch a capability its lane forbids.
Expressed as macros, these rules fail inside the expansion or at runtime.
Expressed as a separate checker, each domain repeats parsing, scoping,
inference, diagnostics, and tooling.

```lisp
;; Illustrative: a workflow whose steps have typed inputs and outputs
(workflow onboard-employee
  (collect personal-info)
  (verify identity :from personal-info)
  (complete i9 :from identity))
```

With elaborators, `verify` declares that `:from` must refer to a step whose
result is `PersonalInfo`, and `complete` that it needs a `Verification`. Moving
`complete` before `verify` is a type error at the moved form, not a runtime
failure in a workflow engine. Forma's `form` already does a version of this
for declarations (`(Refers X)`, `:scope`, `:check`); this RFC makes it a
general, checked mechanism.

### Correctness must stay small

Letting libraries define typing rules is only useful if a bad library cannot
make an ill-typed program pass. Lean 4's elaborator is extensible because its
kernel is not: elaborators produce terms that a small checker verifies
independently. Turnstile's typing rules are macros and are trusted. Forma
needs Lean's arrangement, because preludes are written by domain authors, not
type theorists, and its artifacts are consumed by other systems that rely on
their contracts.

## Current state

- **Forms are partial elaborators.** A form's `:types` give each hole a type,
  including `(Expr T)` checked against `T`, `(Declares X)`, and `(Refers X)`.
  `:scope` binds names while checking a hole, `:check` returns diagnostics
  attached to authored syntax, and `:type` supplies or computes the
  application's result type ([Writing a form](../writing-a-form.md)).
- **Some hook results are trusted.** `type/dsl-provider.ts` supplies result
  types and scope bindings (`getResultType`, `getTypeBindings`) that inference
  uses as given. A `:type` hook that returns the wrong type is believed. The
  projection, by contrast, is checked against the form's `:ir` type, and its
  contract identity (`payloadContractId`) is computed from that type.
- **There is no separate kernel.** Inference (`type/infer*.ts`) both
  reconstructs types and decides well-typedness. `type/lower-core.ts` lowers
  to a core expression, but nothing re-checks that core independently.
- **One surface, and stage 0 of a second.** Forma's surface is engine code in
  `surface/core.ts`. `preludes/modules/clojure.lisp` supplies Clojure spellings as
  macros over Forma semantics ([RFC 0021](./0021-languages-as-libraries.md),
  stage 0).
- **One type-system profile.** Hindley–Milner with records and rows
  ([RFC 0005](./0005-row-operations.md)), effect sets, typeclasses, and
  refined literals. The record-row roadmap excludes arbitrary type-level
  functions and value-dependent type computation.
- **Targets.** Typed IR artifacts (`application/vnd.forma.ir+json`), Effect
  TypeScript, and the TypeScript evaluator and VM. The engine is TypeScript.

## Proposal

### Kernel scope and evidence boundaries

Keep the independent checker separate from the HM/mechanics consolidation in
[RFC 0004](./0004-one-analysis-architecture.md). Today HM latent rows and
mechanics' closed error/requirement sets are distinct representations; sharing
mechanics analysis with host/editor paths does not mean there is one checker.
Consolidation reduces disagreement; independent re-checking reduces trust in
elaboration. Neither follows automatically from the other.

Do not set a speculative 1,000-line target or require solver refinements in the
first kernel. Start with an explicit supported HM/effect core, specify primitive
typing and operational assumptions, and reject unsupported constructs rather
than silently trusting them. Elaborator-supplied scope assumptions must be
justified by core binders/declared primitives, not accepted as arbitrary axioms.
Static hook input checking belongs to [RFC 0008](./0008-typed-form-results.md);
well-typed type-syntax manipulation alone does not establish a correct typing rule.

Kernel acceptance means a term satisfies the selected rules. It does not prove
that the interpreter, VM, emitter, native handlers or external world implement
those rules. Stage 1 must include corrupted-term rejection and independent
expected-value conformance for executed terms, not just agreement between two
potentially wrong backends. Preserve numeric overflow, evaluation order and
resource behavior at each supported runtime boundary. Stronger preservation
claims require their own semantics and evidence.

Finite workflow/evidence laws precede solver or dependent profiles under
[RFC 0028](./0028-bounded-verification.md). A finite-analysis prototype may use
trusted domain checks before the kernel exists, provided its report says so.
Do not market that prototype, or today's hooks, as proof-carrying execution.

### Principle: an extensible compiler, a small definition of correctness

Three parties contribute to a checked program:

| Party | Owns | Trusted? |
| --- | --- | --- |
| **Adapter** (surface or dialect) | Reading, scope, macro integration, special forms, host primitives | No. Its output is elaborated and checked |
| **Elaborators** (forms, syntax forms, domain rules) | Expected types, constraints, diagnostics, core terms | No. Its output is checked by the kernel |
| **Kernel** | The definition of a well-typed core term under a profile | Yes. It is small, has no extension points, and has its own fixtures |

Diagnostics come from elaborators and are phrased in the author's terms. The
kernel's job is to make sure that no elaborator can turn an ill-typed program
into an accepted one. A kernel rejection after a successful elaboration is a
bug in the elaborator, reported as such (`kernel/rejected-elaboration`, naming
the form) at the author's span.

### Three representations

| Representation | Contains | Exists today as |
| --- | --- | --- |
| **Surface syntax** | Author forms, source spans, scope identities, macro phases | The lossless reader's green tree and expansion provenance |
| **Elaboration state** | Expected types, metavariables, unresolved constraints, elaborator results | Implicit in HM inference state |
| **Core terms** | Explicit terms with types, effects, checked boundaries, and casts | Partly: `type/lower-core.ts` output, without annotations |

Core terms are distinct from a form's artifact IR. Artifact IR is a domain
payload whose type a form declares; core terms are the program the kernel
checks, including the code that computes that payload. Backends lower core
terms. Contract identity stays computed over artifact IR types, so this RFC
does not change any `payloadContractId`.

### The kernel

The kernel checks a core term against a profile. It does not infer, expand,
resolve names, or run user code. Its inputs are fully annotated terms whose
binders carry types and whose applications of polymorphic values carry
explicit instantiations.

The first kernel implements today's profile and nothing more. Its acceptance
criterion is that every program the current checker accepts elaborates to a
core term the kernel accepts, and every program it rejects stays rejected.
That lets the kernel be introduced without changing behavior, and then makes
hook results that are trusted today (`:type`, `:scope`) checkable.

### Elaborators

An elaborator is the general form of a typed form. It runs at compile time,
is pure and deterministic like form hooks today, and has access to:

- `(check e T)`: elaborate `e` against expected type `T`.
- `(infer e)`: elaborate `e` and return its term and type.
- `(fresh)` and `(unify a b)`: create and constrain type metavariables.
- `(report diagnostic)`: attach a diagnostic to authored syntax, as `:check`
  does now.
- `(emit term)`: return a core term.

```lisp
;; Illustrative: `if` written as an elaborator rather than built in
(elaborator (if condition then else)
  "Choose between two expressions of the same type."
  (let [c (check condition Bool)
        t (infer then)
        e (check else (:type t))]
    (emit (core/if c (:term t) e))))
```

There are three tiers, from most to least analyzable:

1. **Syntax forms** ([RFC 0021](./0021-languages-as-libraries.md)): a
   declarative template from typed syntax to syntax. Invertible.
2. **Forms**: typed holes to artifact IR, with `:check`, `:scope`, and
   `:type` hooks. Defined in terms of elaborators, so their existing behavior
   becomes one use of the general API.
3. **Elaborators**: arbitrary bidirectional rules. Not invertible; tooling
   treats their internals as opaque but still sees their hole types when
   they declare them.

Procedural macros remain and run before elaboration. A macro that expands
into elaborated forms gets their checking; a macro that expands into raw core
gets only the kernel's.

### The language adapter protocol

An adapter is everything a Lisp dialect supplies so that Forma can elaborate
its source. It extends RFC 0021's `language` declaration.

| Component | Provides | Today's counterpart |
| --- | --- | --- |
| Lexical profile | Reader switches: comma, brackets, dispatch nodes, case folding | The fixed reader (RFC 0021 adds profiles) |
| Scope model | How namespaces, packages, or modules map onto Forma's module graph | File modules and project preludes |
| Macro integration | Which macros are syntax forms, which expand first, which are rejected | Module-scoped `macro` |
| Special forms | Elaborators for the dialect's primitive heads (`if`, `let`, `fn`, `loop`) | Core heads in `surface/core.ts` and inference |
| Host primitives | Typed declarations of the dialect's standard library and interop | Builtin schemes and host protocol preludes |
| Semantics notes | Truthiness, nil, numeric tower, mutation, multiple values | Forma's own: `Bool`, `Option`, `Int`/`Float` |
| Unsupported constructs | A diagnostic naming each construct the adapter cannot check | `dialect/unsupported` in RFC 0021 |
| Backend capabilities | Which runtimes the language can lower to and what they provide | Effect TypeScript, the VM |

The difference from RFC 0021 is in the semantics row. An RFC 0021
**surface** is a spelling of Forma's semantics: `if` takes a `Bool`, and `nil`
is not `None`. An **adapter** may declare a dialect's own semantics, such as
Clojure truthiness or `Long` and `Double`, as host primitives and elaborators.
Surfaces come first because they need no host semantics; adapters are what
checking existing code requires.

### Languages as libraries

A language declaration composes an adapter with type libraries, elaborators,
a profile, and a backend:

```lisp
;; Illustrative syntax
(language forma/clojure
  "Clojure source over Forma's kernel."
  :adapter clojure/adapter
  :profile forma/hm-effects
  :types [forma/core forma/collections forma/effects]
  :elaborators [clojure/special-forms clojure/interop]
  :backend cljc)

(language example/workflow
  "Typed onboarding workflows."
  :extends forma/clojure
  :types [workflow/task workflow/event workflow/obligation]
  :elaborators [workflow/define workflow/await workflow/expire]
  :backend workflow/vm)
```

Languages are packaged and versioned like other packages
([RFC 0020](./0020-packages.md)), and their typing rules are tested with
ordinary fixtures ([RFC 0015](./0015-tests-in-forma.md)).

Composition is not unrestricted merging:

- Two components that define the same head are an error unless the
  extending language hides one or the declaration names a winner.
- A language may extend at most one adapter.
- Profiles compose only toward the more restrictive: an extension cannot
  enable a profile its base excludes.
- Effects and capabilities from all components are unioned and reported in
  the language's documentation.
- Backends must support every effect and primitive that the language's
  elaborators can emit; otherwise the language declaration is rejected.

### Existing Lisp code: a gradual boundary

Forma will check existing code only through declared boundaries, never by
promising to understand arbitrary programs.

```clojure
;; greet.clj, ordinary Clojure, unchanged
(defn greet [name]
  (str "Hello, " name))

(greet "Alice")
(greet 42)
```

```lisp
;; greet.lisp, a declaration file read alongside greet.clj (illustrative)
(: greet (-> String String))
```

Under the Clojure adapter, `(greet 42)` is a diagnostic. The boundary rules:

- Undeclared vars have type `Dynamic`. Using a `Dynamic` value where a static
  type is expected requires a cast, which the backend enforces at runtime or
  the author marks `unchecked`.
- Declared vars are checked against their declarations when their bodies use
  only supported constructs, and trusted with a warning otherwise.
- Macros known to the adapter elaborate; unknown macros expand first, and the
  checker reports their output in terms of the macro call, as Forma does today
  for macro provenance.
- Reflection, `eval`, and dynamic var rebinding are reported as unchecked
  boundaries rather than rejected, so that existing programs keep running.

The promise is that existing programs run without annotations and that
annotated, supported code is checked. It is not a promise that every program
can be verified.

### Backends and capabilities

Backends lower checked core terms. Each backend declares capabilities: an
effect runtime, integer width, host interop, concurrency. A language checks
portable code against the intersection of its backends' capabilities, so
Clojure code using Java interop is a diagnostic when the selected backends
include JavaScript, not a runtime surprise.

Effect TypeScript and artifact IR are the targets today. `.cljc` is the next
target ([RFC 0021](./0021-languages-as-libraries.md), stage 6). JVM, WASM,
SQL, and workflow runtimes are possible targets, and the roadmap rule still
applies to each: a back end needs a concrete consumer and a conformance
target.

### Lisp targets

Four Lisps are in scope, each as a surface ([RFC
0021](./0021-languages-as-libraries.md)) and later as an emitter target.
None of them is a backend today: Effect TypeScript, Effect Schema, and
artifact IR are the only targets, and `preludes/modules/clojure.lisp` is a macro
library, not a code generator.

A target needs three things (RFC 0021, "Targets"): **resugaring**, which
matches checked core terms against the surface's declarative templates;
a **kernel port**, which implements Forma's primitives in the target; and
**differential conformance**, which runs the conformance corpus through the
target and compares observable results with the TypeScript VM's stored
goldens. Macro phases do not appear in this list: Forma expands and
elaborates before a backend runs, so an emitted file contains definitions
and expressions only. Phases are an adapter problem (stage 5), not an
emitter problem.

| Target | Surface | Emitter | Kernel port must supply | Order |
| --- | --- | --- | --- | --- |
| **Clojure** (`.cljc`) | Spellings shipped as a macro library (RFC 0021 stage 0); a checked surface is RFC 0021 stage 5 | Proposed, RFC 0021 stage 6 | Tagged values, `match` dispatch (`clojure.core` has no pattern matcher), `Option`, records, the `Int` range under both JVM `long` and JavaScript numbers, integer division. Vectors, maps, and sets are native | 1 |
| **Racket** | Proposed; brackets and `#t`/`#f` are lexical switches | Proposed | The `Int` range over unbounded exact integers, `Float` as flonum, Forma's division. `match`, `struct`, immutable hashes, and `racket/set` are in the standard library | 2 |
| **Scheme** (R7RS) | Proposed; the same lexical switches | Proposed | The same, plus a declared set of SRFIs for hash tables, sets, and pattern matching, which R7RS-small does not define. `define-record-type` is standard | 3 |
| **Common Lisp** | Proposed, last | Proposed, last | All of the above, plus a mapping from Forma's single namespace onto `funcall` and `#'`, a symbol-case and package scheme, `defstruct` records, and hand-written dispatch: the standard has no immutable map, set, or pattern matcher | 4 |

**Clojure** is first because the reader is already close to it, because
RFC 0021 stage 0 shipped its spellings, and because one `.cljc` file reaches
both the JVM and JavaScript. Clojure's other implementations read `.cljc`
as well, which is how Clojure also reaches the CLR and Dart, but only the JVM
and ClojureScript are gated. Gate: RFC 0021 stage 6 — a round trip between
Forma and the Clojure surface, and the conformance corpus matching the
TypeScript VM's goldens on the JVM and in ClojureScript.

**Racket** is second because it is one implementation whose standard library
already supplies everything the port needs, so the work is the semantic gaps
rather than a portability matrix. Gate: the pure conformance corpus, emitted
to Racket, matches the TypeScript VM's goldens. Because the emitter inverts a
Racket surface, stage 6's bar applies to that surface as well: it needs no
kernel change.

**Scheme** is third because the same emitted file must run on more than one
implementation, and R7RS-small leaves out the data structures the port needs.
Gate: the corpus passes on two independent R7RS implementations from one
emitted file, with every SRFI it relies on declared in the backend's
capabilities.

**Common Lisp** is last because its separate function and value namespaces
are a semantic difference rather than a spelling, and because its reader
folds symbol case. Gate: the corpus passes on one ANSI implementation, with
the namespace mapping, the case and package scheme, and the implementation's
recursion depth limit pinned by fixtures.

Effectful programs stay TypeScript-only on every one of these until a target
has an effect runtime, and the roadmap rule applies to each: a back end needs
a concrete consumer and a conformance target before it is built.

The semantic gaps are the same short list at each target. Forma's semantics
decide what a program means; the target's defaults do not. Where they differ,
the port emits explicit code rather than relying on the host.

| Difference | Clojure | Racket | Scheme (R7RS) | Common Lisp |
| --- | --- | --- | --- | --- |
| **Falsity** | `nil` and `false`; everything else is true | `#f` only | `#f` only; `'()` is true | `nil` only, and `nil` is also the empty list |
| **Numbers** | JVM `long` and `double`; ClojureScript has JavaScript numbers only, and `/` on two integers differs between the two | Full tower: exact rationals, bignums, flonums | Tower partly optional; an implementation may support only a limited range of exact numbers | Full tower: bignums, ratios, complex |
| **Namespaces** | Lisp-1 | Lisp-1 | Lisp-1 | Lisp-2: `#'f`, `funcall`, `flet` |
| **Macro phases** | `.cljc` macros are Clojure code loaded at compile time | Phase levels and `for-syntax` | `syntax-rules` at expansion | `defmacro` with `eval-when` |
| **Mutation** | Atoms, refs, vars | `set!`, boxes, mutable vectors | `set!`, mutable strings and vectors | `setf` everywhere; conses and slots are mutable |
| **Multiple values** | None | `values`, `define-values` | `values`, `call-with-values` | `values`; used throughout the standard library |
| **Tail calls** | Self and `loop` only, through `recur`; the JVM has no general tail-call elimination | Proper tail calls required | Proper tail calls required | Not required by ANSI; implementation-dependent |
| **Continuations** | None | `call/cc` and delimited continuations | `call/cc` | Escape only: `block`, `return-from`, `catch`, `throw` |

Most rows are one-way, and that is the point of emitting from a checked core.
Forma has no mutation, no multiple values, and no first-class continuations,
so an emitter never needs the target's version of them, and Forma's `nil` is
an ordinary `Unit` value rather than falsity or absence. An emitter needs only
to avoid depending on the target's defaults: it tests `Bool` values explicitly
instead of relying on truthiness, and represents `Option` as a tagged value so
that `None` is never the host's `nil`, `#f`, or empty list.

Three rows are real work.

- **The numeric tower.** Forma has `Int` and `Float` and checks `Int`
  arithmetic against the JavaScript safe-integer range. That range fits in a
  JVM `long`, in a double, and in every target's exact integers, so no port
  needs bignums. The gap runs the other way: Racket, Scheme, and Common Lisp
  accept integers Forma rejects, so the port must keep the range check where
  Forma's semantics require an error. Division is the second trap, because
  `/` on two integers is a ratio in Racket, Common Lisp, and Clojure on the
  JVM, and a float in ClojureScript. RFC 0021 leaves open whether the checked
  range is emulated on wider targets; under this RFC that choice is a
  declared backend capability (integer width), and portable code is checked
  against the intersection of the selected backends.
- **Lisp-1 against Lisp-2.** A Forma value of function type is one name in
  one namespace. In Common Lisp the emitter must decide, for every
  occurrence, whether a name appears in operator position, as `#'name`, or
  under `funcall`, and a Common Lisp *surface* must reject source that
  relies on a symbol having both a function and a value binding. This is a
  translation the other three targets do not need, and it is why Common Lisp
  is last.
- **Tail calls.** The TypeScript VM reuses frames for tail calls, so
  unbounded tail recursion is part of the reference behavior the conformance
  corpus pins. Racket and Scheme guarantee it. Clojure does not: the port has
  to emit `recur` for self tail calls and a trampoline for mutual recursion.
  ANSI Common Lisp does not require it at all, so a Common Lisp backend
  documents the depth it was conformance-tested at on a named implementation
  instead of claiming the guarantee.

Mutation and multiple values stay inside a port. A kernel port may use local
mutation or a host function that returns several values to implement a
primitive; neither becomes visible in a Forma program, and neither is a
capability a language can request.

### Profiles

A profile is a named set of kernel rules. Every language selects one.

| Profile | Rules | Status |
| --- | --- | --- |
| `forma/hm-effects` | HM, records and rows, effect sets, typeclasses, refined literals | Implemented by the current checker |
| `forma/refined` | Refinement predicates on values, discharged by a solver | Proposal |
| `forma/dependent` | Types that depend on values | Research |

The kernel's core terms should not make richer profiles impossible. Forma
types are already ordinary S-expressions that form hooks reflect as data
(`type-definition`), so a later profile can treat them as terms. Committing the kernel to dependent type theory
now is not proposed. Inference, decidability, gradual boundaries, mutation,
and host interop are each harder under dependent types, and no consumer needs
them yet. A profile beyond `forma/hm-effects` needs its own RFC and consumer.

### Positioning and claims

Public pages may describe the direction as long as each claim is labeled with
its status:

| Claim | May be stated as shipped when |
| --- | --- |
| Preludes define typed forms that take part in checking | Now |
| Errors point at authored syntax, including inside forms and macros | Now |
| Clojure spellings over Forma semantics | Now, as a library (RFC 0021 stage 0) |
| A small kernel checks every elaborated program | Stage 1 |
| Typed elaborators with expected types | Stage 2 |
| Several Lisp surfaces | RFC 0021 stage 5 |
| Checks existing Clojure code | Stage 5 of this RFC |
| One kernel, many Lisps | Stage 6 of this RFC |
| Compiles to several runtimes | A second executable backend with conformance |
| Emits Clojure, Racket, Scheme, or Common Lisp source | That target's differential conformance passes on a named implementation |

## Alternatives considered

- **Stay a typed Lisp.** Accurate and modest, but it competes with mature
  typed Lisps on their strengths and hides the part of Forma that is new.
- **Universal typechecker first.** "TypeScript for Clojure" is a clearer pitch
  and the larger audience. It needs a typed `clojure.core`, occurrence typing
  for nil punning, and Clojure macro semantics before it checks anything
  useful, and it would shape the kernel around one dialect. Typed Clojure and
  clj-kondo show both the cost and what users adopted. It remains the adoption
  path, after the kernel and protocol exist.
- **Trusted typing rules, as in Turnstile.** Simpler and very expressive, but
  a prelude bug becomes a soundness bug in every artifact built with it.
- **Dependent types in the first kernel.** One foundation from structural
  typing to proofs is attractive. It front-loads the hardest problems before
  any consumer needs them and makes the first kernel larger than the checker
  it replaces.
- **One checker per dialect.** Faster to start, and it proves nothing about
  reuse. A second dialect that needs kernel changes is the signal that the
  core is secretly specific to the first.

## Implementation stages and validation

| Stage | Work | Gate |
| --- | --- | --- |
| 0 | Positioning: the homepage, Vision, and `docs/agents.md` describe Forma as a programmable type system, with every claim labeled by status. | Pages pass `pnpm check`; no planned feature is described as shipped. |
| 1 | Annotated core terms and a kernel for `forma/hm-effects`. Elaboration emits core terms; the kernel re-checks them. | Every conformance fixture's elaboration is accepted by the kernel; corrupted elaborations in a dedicated fixture set are rejected; analysis latency within an agreed budget. |
| 2 | The elaborator API (`check`, `infer`, `fresh`, `unify`, `report`, `emit`). Forms are reimplemented on it, and `:type` and `:scope` results are kernel-checked. | Stored goldens byte-identical; a fixture where a lying `:type` hook is rejected with `kernel/rejected-elaboration`. |
| 3 | The adapter protocol, with Forma's own surface as the first adapter (RFC 0021 stages 3 and 4). | Two languages in one module graph; RFC 0021's golden gates. |
| 4 | A Clojure surface over Forma semantics (RFC 0021 stage 5) and a typed domain language that extends it. | A workflow-style example language with typed steps, its own diagnostics, and generated reference pages. |
| 5 | A Clojure adapter for existing code: declaration files, `Dynamic`, casts, and a typed subset of `clojure.core`. | A pinned corpus of real open-source namespaces is read, with every unsupported construct reported by name and no false errors in declared, supported code. |
| 6 | A second dialect adapter (Racket or Scheme). | No kernel changes. Any kernel change it needs is recorded as a defect in stage 1. |
| 7 | Further profiles and executable backends, each with its own RFC, in the order under "Lisp targets". | A concrete consumer and a conformance target per profile and backend. |

## Decisions still required

- Whether core terms carry explicit type applications or a kernel-only
  inference for instantiations.
- The kernel's implementation language and whether it is a separate package
  that other engines could reuse.
- Whether `elaborator` is a new head or `form` with a bidirectional hook.
- Whether declaration files are separate `.lisp` files, annotations inside
  dialect source, or both.
- The casting semantics of `Dynamic` at each backend, and whether casts are
  checked by contracts (as in Typed Racket) or by generated validators.
- Which dialect is second, and which subset of it the stage 6 gate covers.
  "Lisp targets" proposes Racket.
- How a Common Lisp surface maps Forma's single namespace: mangled names,
  `funcall` at every call site, or a rejection of higher-order code it cannot
  resolve.
- Whether a language may select more than one backend at once.

## Related designs

Lean 4 separates an extensible elaborator from a small kernel (de Moura and
Ullrich, "The Lean 4 Theorem Prover and Programming Language", CADE 2021);
the LCF tradition and the de Bruijn criterion are the reason to keep the
kernel small. Turnstile builds typed languages by embedding typing rules in
Racket macros (Chang, Knauth, and Greenman, "Type Systems as Macros", POPL
2017). Typed Racket, Typed Clojure, and Coalton add static types to Racket,
Clojure, and Common Lisp in different ways; Malli describes Clojure data with
runtime schemas. Siek and Taha's gradual typing (2006) and Typed Racket's
contracts define the boundary between checked and unchecked code.
TypeScript's declaration files are the model for typing code without
rewriting it. Racket's `#lang` and Rhombus show languages as libraries over
one core; MLIR shows one infrastructure shared by many languages through
dialects.
