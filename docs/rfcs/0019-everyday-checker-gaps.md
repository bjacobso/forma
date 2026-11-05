# RFC 0019: Everyday checker gaps

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-11-03 |
| Scope | Builtin contract parity, numeric inference, local recursion, nullary functions, recursive generic aliases, Effect-name routing, match exhaustiveness, and four Effect checker gaps: constructor types, optional fields, callback references, and refinement literals |
| Direction | The evaluator, the kernel typechecker, and the Effect checker agree about ordinary programs; a program that one accepts is not silently rejected, retyped, or crashed by another |

## Summary

Writing [Structure and Interpretation of Forma Programs](../structure-and-interpretation.md)
and [Domain modeling in Forma](../domain-modeling.md) meant running about a
hundred small, conventional programs through the engine. Most worked. The ones
that didn't fail in a consistent way: a construct is accepted by one pass and
rejected or retyped by another, or a classic program needs a workaround that
the language guide does not mention.

This RFC records each gap with a reproduction, the current result, and the
behavior Forma should have. It groups the fixes into stages that can land
independently. None of them adds a new language feature. Each one either makes
two existing passes agree or makes the checker accept a program whose meaning
is already clear.

The guides document today's workarounds and link here. When a stage lands, its
workaround should be removed from the guides in the same change.

## Motivation

Forma's claim is that the checker tells you what a program will do. That
claim is weakest where it matters most for new users: the first programs they
write. A reader following SICP writes `square`, `reduce`, `reverse`, a local
helper, and a lazy stream in the first hour. Today, each of those hits a gap:

- `(define square [x] (* x x))` is inferred as `Float -> Float`, so integer
  code passed through an unannotated lambda comes back typed as `Float`.
- `reverse` typechecks and then fails at run time as an unbound symbol.
  `reduce` runs and is rejected by the typechecker.
- A helper defined inside a function body runs, but the typechecker reports
  it as unbound.
- `(-> (Flow a))` is not a type, and `(fn [] 42)` is typed as `Int`.

A reader following *Domain Modeling Made Functional* writes stage records with
optional fields, builds event lists, and passes named steps to `for-each`.
Each of those needs a rewrite to satisfy the Effect checker, and refined types
such as `(Int :min 0)` accept `-5`.

Each workaround is small, but together they teach that the checker is
arbitrary. Each one is also the kind of disagreement between passes that
[RFC 0012](./0012-checked-evaluation.md) needs to rule out before a host can
treat "it typechecks" as a promise about what will run.

## Current state

All results below come from the TypeScript engine at commit `f43b679`, through
the host's `typecheck` and `evaluate` operations and
`Mechanics.generateEffectProgram`. Each will become a fixture (see
[Implementation stages](#implementation-stages-and-validation)).

### Kernel: evaluator and typechecker disagree

| ID | Source | Typechecker | Evaluator |
| --- | --- | --- | --- |
| K1 | `(reverse [1 2 3])` | `List<Int>` | `Unbound symbol: reverse` |
| K2 | `(sqrt 2.0)` | `Float` | `Unbound symbol: sqrt` |
| K3 | `(reduce (fn [acc x] (+ acc x)) 0 [1 2 3])` | `Unbound variable: reduce` | `6` |
| K4 | `(conj [1 2] 3)` | `Unbound variable: conj` | `(1 2 3)` |
| K5 | `(concat [1] [2 3])` | `Cannot unify List<Int> with String` | `(1 2 3)` |
| K6 | a body containing `(define helper [k] (+ k k))` before `(helper n)` | `Unbound variable: helper` | `6` |
| K7 | `(define k (fn [] 42))` | `k : Int` | `k` is a function; `(use k)` with `use : (-> (-> Unit Int) Int)` fails both passes |
| K8 | a `match` on a two-constructor type that handles one | warning: `Non-exhaustive match` | `No pattern matched the value` at run time |

The builtin lists live in three places that are not checked against each
other: the evaluator and VM builtins (`packages/ts/src/builtins/`), the HM
schemes (`packages/ts/src/type/builtin-schemes.ts`), and the Effect checker's
builtins (`packages/ts/src/mechanics/builtins.ts`). `quot`, for example, exists
only in the Effect checker, so kernel code needs `(floor (/ n d))` for integer
division.

### Kernel: the typechecker rejects or mistypes clear programs

| ID | Source | Result |
| --- | --- | --- |
| K9 | `(define square [x] (* x x))` | `Float -> Float` |
| K10 | `(map (fn [x] (* x x)) [1 2 3])` | `List<Float>`, value `(1 4 9)` |
| K11 | `(fold (fn [x total] (+ x total)) 0 ints)`, with `fold : (-> (-> a b b) b (List a) b)` | `Float`; a caller declared to return `Int` is rejected with `Float vs Int` |
| K12 | `(let [loop (fn [k] (if (= k 0) 0 (loop (- k 1))))] (loop n))` | `Unbound variable: loop` in both passes; no local recursion form exists |
| K13 | `(type Thunk (-> Int))` | `(-> ...) requires at least 2 type arguments` |
| K14 | `(type (Flow a) {:head a :tail (-> Unit (Flow a))})`, used in a signature | `typecheck/kind-mismatch: Flow expects 1 type arguments` |
| K15 | `(type (Stream a) (Tagged Done (Cell {...})))` | Effect checker diagnostics such as `artifact/schema: type expects a schema name` mixed into a kernel program |

K9 to K11 have one cause. The schemes for `+`, `-`, `*`, `min`, and `max` are
`Float -> Float -> Float`. An annotation can make a use `Int`, but an
unannotated parameter is fixed to `Float` as soon as it meets arithmetic. The
runtime keeps Ints, so the inferred type and the value disagree.

K14 affects only generic record aliases. A monomorphic recursive alias
(`{:head Int :tail (-> Unit IntFlow)}`) and a recursive generic `Tagged` type
both work. The arity check in `type/infer-core.ts` runs before the recursive
occurrence is recognized.

K15 happens because Effect analysis is selected by syntax:
`effectType` in `mechanics/analysis.ts` treats any signature whose head is
`Effect`, `Stream`, or `Layer` as an Effect signature, whether or not the name
refers to the built-in type.

### Effect checker

| ID | Source | Result |
| --- | --- | --- |
| E1 | `(let [p (Ev.Placed {:id id})] [p])` checked against `(List Ev)` | `Expected Ev, but this is {:_tag String :id String}` |
| E2 | `(concat [(Ev.Placed ...) (Ev.Billed ...)] (if acked [(Ev.Acked ...)] []))` | six diagnostics, ending with `Expected (Array Ev), but this is (Array {:_tag String :to String})` |
| E3 | `{:note (get a :note) :n 1}` checked against `{:note (Option String) :n Int}` | `Expected String, but this is (Option String)`; `(Some s)` and `None` are rejected the same way |
| E4 | `(for-each xs check)`, where `check` is a declared operation | `artifact/effect-body: for-each expects (fn [params...] effect) here` |
| E5 | `(define neg -5)` with `(: neg (Int :min 0))`, and `(Bags 0)` with `Bags = (Brand (Int :min 1 :max 200))` | accepted; the generated `Bags.make(0)` throws at run time |

E1 and E2 contradict the language guide, which says constructors belong to
their type. The Effect checker types a qualified constructor application as
its structural record. It recovers the union only when an expected type is
already present. E3 contradicts the guide's rule that "an existing `Option`
stays an `Option`" in a record checked against an expected type; the kernel
already implements that rule. E4 is inconsistent with `map`, which accepts a
named function (`(map shout xs)`). E5 is inconsistent with forms, where "a
literal in a refined hole is checked where the author wrote it."

## Proposal

### 1. One builtin contract (K1 to K5)

Every builtin name gets one entry in a single table that records:

- its runtime implementation, if any, for the evaluator and VM;
- its HM scheme, if the kernel typechecker accepts it;
- its Effect checker signature and TypeScript lowering, if supported there;
- and, when a name is deliberately present in only some passes, the reason:
  for example, `sexpr-items` is expansion-time only.

A test fails when a name appears in one registry without an entry, or when
its entry claims support that a pass lacks. This turns K1 to K5 into test
failures instead of reader discoveries. Then, close the listed gaps:

| Name | Proposed contract | Notes |
| --- | --- | --- |
| `reverse` | `(-> (List a) (List a))` | Add the runtime builtin; the scheme exists |
| `sqrt` | `(-> Float Float)` | Add the runtime builtin, or remove the scheme |
| `reduce` | `(-> (-> b a b) b (List a) b)` | Same argument order as the runtime and the Effect checker |
| `conj` | `(-> (List a) a (List a))` | Gives typed code a way to build lists |
| `concat` | `(-> (List a) (List a) (List a))` | Matches the runtime and the Effect checker; strings use `str` |
| `quot` | `(-> Int Int Int)` | Matches the Effect checker; zero divisor fails like `mod` |

Changing `concat`'s kernel scheme from strings to lists is a behavior change.
Before it lands, audit preludes, examples, and conformance fixtures for string
uses. [RFC 0018](./0018-type-generics.md) owns the general contract for
generic collection signatures and `flat-map`; this stage only makes existing
names agree.

### 2. Numeric inference (K9 to K11)

Arithmetic should constrain its operands to numeric types instead of fixing
them to `Float`. Replace the `Float` schemes of `+`, `-`, `*`, `min`, `max`,
and `abs` with a numeric constraint solved by the existing typeclass
machinery (`type/typeclass.ts`), with instances for `Int` and `Float` and the
existing rule that `Int` is accepted where `Float` is expected. `/` keeps
returning `Float`, and `mod` and `quot` keep requiring `Int`.

When a binding is generalized, an unresolved numeric variable is either:

- **generalized with its constraint**, so `square` works at both `Int` and
  `Float`; or
- **defaulted to `Int`**, so `square` is `Int -> Int` and Float callers need a
  signature.

The first is more expressive and needs a way to display, and perhaps write,
the constraint in signatures. The second is a smaller change and matches how
the guides already annotate. Either one fixes K10 and K11, where the operand
types are known from the call. The choice is listed under
[Decisions still required](#decisions-still-required).

Inference order is part of the fix. In K11, the callback is checked before the
collection, so the collection's `Int` arrives too late. RFC 0018 requires that
"a callback written before the collection must still receive information from
the collection." Implement this stage with RFC 0018's stage 1 fixtures, so the
two don't diverge.

### 3. Local recursive definitions (K6, K12)

A function body may begin with `define` forms, as the evaluator already
allows, optionally with signatures:

```lisp
(: square-root (-> Float Float))
(define square-root [x]
  (: improve (-> Float Float))
  (define improve [guess] (/ (+ guess (/ x guess)) 2))
  (: good-enough? (-> Float Bool))
  (define good-enough? [guess] (< (abs (- (* guess guess) x)) 0.001))
  (: try (-> Float Float))
  (define try [guess] (if (good-enough? guess) guess (try (improve guess))))
  (try 1.0))
```

The leading definitions form one mutually recursive group, scoped to the body,
and are typed like a top-level recursive group: monomorphic recursive
references while checking, then generalized. This is Scheme's internal
`define`, which is also what SICP's block structure uses. `let` stays
non-recursive. The VM and the evaluator must agree on the group semantics. A
`define` after an expression in a body is an error in both passes.

No `letrec` form is added; one construct is enough.

### 4. Nullary functions (K7, K13)

`(-> T)` is the type of a function that takes no arguments and returns `T`.
`(fn [] body)` has that type, and `(f)` calls it. The typechecker stops
treating a zero-parameter `fn` as its body's value. This makes thunks (delayed
tails, retries, and callbacks with no input) ordinary values. Generated
TypeScript uses `() => T`.

Programs that currently rely on `(fn [] body)` typechecking as `body` are
typechecking something different from what runs, so this change fixes
programs rather than breaking them. Audit fixtures before landing.

### 5. Recursive generic record aliases (K14)

A generic alias may refer to itself with the same parameters in the same
order, as a regular recursive type:

```lisp
(type (Flow a) {:head a :tail (-> Unit (Flow a))})
```

Non-regular recursion, such as `(type (Nest a) {:inner (Nest (List a))})`,
stays an error with a diagnostic that names the rule. Schema generation keeps
its existing recursion limits; the Effect reference already documents that
recursion cannot pass through a brand or class. RFC 0018 explicitly leaves
recursive alias policy to a separate proposal; this section is that proposal.

### 6. Route Effect analysis by binding, not by spelling (K15)

Decide whether a signature is an Effect signature from the resolved name, not
from the head symbol's text. A module that declares its own `Stream`, `Layer`,
or `Effect` type uses its own type.

If resolving names during routing is too large a change for the first step,
the interim behavior is a single declaration-site diagnostic: `Stream is the
name of a built-in type; choose another name`. A cascade of unrelated
Effect-checker errors is not acceptable in either case.

### 7. Exhaustive matches are errors in both checkers (K8)

A `match` that misses a constructor of a closed type is an error in the kernel
typechecker, as it already is in the Effect checker. `_` remains the explicit
way to accept the rest. A match that can fail at run time with
`No pattern matched the value` should not pass the checker with only a
warning.

This is a behavior change. Before it lands, run the conformance suites,
preludes, and examples, and list every program that changes from a warning to
an error in the change description.

### 8. Effect checker: constructor applications have their type (E1, E2)

A qualified constructor application, such as `(Ev.Placed {...})`, has the
tagged type `Ev`, with or without an expected type. A bare constructor still
resolves from the expected type, as the language guide describes. Bare record
and vector literals keep the documented widening rules. The generator keeps
literal tags in `const` bindings with `satisfies Ev`, as it does today for
records of a schema type.

`concat`, `if`, and vector literals join element types through the declared
union instead of the first branch they see.

### 9. Effect checker: optional fields accept options (E3)

When a record is checked against a type with an `(Option T)` field, the field
may be supplied as a plain `T` value, which is wrapped as today, or as an
`(Option T)` value, which is kept as an option. This includes `(Some x)`,
`None`, and `(get record :optional-field)`, matching the kernel rule. The
generator emits the key only when the option is present, which is required
under `exactOptionalPropertyTypes`:

```ts
{ n: 1, ...(Option.isSome(note) ? { note: note.value } : {}) }
```

### 10. Effect checker: named callbacks (E4)

Wherever an Effect combinator's argument is declared as a lambda (today
`for-each` and the release function of `acquire-release`, in the combinator
table in `mechanics/artifact.ts`), accept a reference to
a declared operation or a signed function with the same arity and a compatible
type. The generator passes the reference, or eta-expands it if the TypeScript
shape differs. The diagnostic for an incompatible reference reports the
expected and actual function types instead of asking for a literal `fn`.

[RFC 0023](./0023-effect-polymorphism.md) moves `for-each` and other
pass-through combinators into a signature table in its stage 3. This section
must land first, so that moving a combinator does not change which programs
are accepted. Named operations are already accepted as arguments to user
operations whose parameter is a function type.

### 11. Refinements check literals (E5)

When a literal is checked against a refined type, whether directly, through a
brand constructor, or as a record field, check its value against the
refinements at compile time in both checkers. Forms already do this for
refined holes. `(define neg -5)` against `(Int :min 0)` and `(Bags 0)` become
compile-time errors at the literal.

Values computed at run time are unchanged: they are checked by `decode`, or by
the brand's generated `make`, which throws. This RFC does not propose static
proofs for computed values. The Effect reference and the domain modeling guide
should continue to say so plainly.

## Documentation

The guides currently document the workarounds:

- The SICP guide names `Int` helpers instead of using arithmetic lambdas (K9
  to K11), defines its own `Chain` type because lists can't be built in typed
  code (K4, K5), keeps recursive helpers at top level (K6, K12), uses
  `(-> Unit T)` thunks and a single-constructor `Tagged` stream (K7, K13,
  K14), names its stream type `Flow` (K15), and uses `(floor (/ n g))` for
  integer division (`quot`).
- The domain modeling guide builds events inside each branch (E1, E2), keeps
  optional fields out of later stages (E3), wraps named steps in `fn` (E4),
  and explains that refinements are checked at decode time (E5).

Each implementation stage removes the corresponding workaround from the guides
and the corresponding entry from their limitation lists. To keep the guides
honest after that, add a test that extracts the guides' `lisp` blocks and
checks each program's typecheck result, evaluated values, and quoted
diagnostics. [RFC 0015](./0015-tests-in-forma.md) may later replace this
harness with tests written in Forma.

## Alternatives considered

- **Document the gaps and change nothing.** The guides already do this. It
  leaves the passes disagreeing, which is the problem RFC 0012 needs solved,
  and it costs every new reader the same hour.
- **Make the evaluator refuse everything the typechecker rejects.** This would
  remove K3 to K6 by refusing to run them, not by supporting them. It is the
  right policy for checked evaluation under RFC 0012, but it is not a
  substitute for supporting programs whose meaning is clear.
- **`letrec` instead of internal `define`.** Two ways to write the same thing,
  and the evaluator already implements internal `define`.
- **Default all arithmetic to `Float`.** This is today's behavior, and the
  guides show what it costs.

## Implementation stages and validation

Each stage is independent and lands with fixtures that fail before the change
and pass after it.

1. **Builtin registry and parity test** (section 1). Add the table and the
   test, then close the listed gaps, with K1 to K5 fixtures in
   `conformance/fixtures/typecheck` and evaluator tests.
2. **Exhaustiveness** (section 7). Make the kernel diagnostic an error. Audit
   and record every affected program.
3. **Effect checker constructor types and optional fields** (sections 8 and 9).
   Add positive and rejection cases to `conformance/effect-typescript`. Each
   positive case must generate TypeScript that passes the suite's strict
   settings and runs.
4. **Named callbacks and refinement literals** (sections 10 and 11). Same
   suite; rejection cases pin the literal diagnostics at their spans.
5. **Nullary functions and recursive generic aliases** (sections 4 and 5).
   Typecheck, evaluation, and Effect generation fixtures.
6. **Local recursive definitions** (section 3). Typecheck and evaluation
   fixtures, including mutual recursion, signatures, and the
   definition-after-expression error.
7. **Numeric inference** (section 2), together with RFC 0018 stage 1. This is
   the largest change and the one most likely to move stored goldens. Review
   each golden diff.
8. **Name-based Effect routing** (section 6), or its interim diagnostic.

Run `pnpm check` for every stage. Stored goldens that change are reviewed
expectations: explain each diff in the change description. Record behavior
changes (sections 1, 2, 4, and 7) in a changeset.

## Decisions still required

- **Numeric generalization.** Generalize unresolved numeric variables with a
  constraint, or default them to `Int`? If constrained, how does a signature
  write the constraint, and how does it relate to the constraint notation proposed in RFC 0006?
- **`concat` on strings.** Keep a string overload, or move all string
  concatenation to `str`? The audit in stage 1 decides how much code is
  affected.
- **Exhaustiveness opt-out.** Is `_` enough, or do generated programs need a
  marker for an intentionally partial match?
- **Reserved names.** If section 6 starts with the interim diagnostic, which
  names are reserved: only `Effect`, `Stream`, and `Layer`, or every built-in
  type constructor?

## Related designs

- [RFC 0018: Type generics and collection inference](./0018-type-generics.md):
  generic signatures, callback inference order, and collection contracts.
  Section 2 here depends on its inference-order work.
- [RFC 0012: Checked evaluation](./0012-checked-evaluation.md): needs the
  passes to agree before "it typechecks" can be a promise to a host.
- [RFC 0007: Shared type normalization](./0007-type-normalization.md):
  contextual wrapping of optional fields in computed record types, related to
  section 9.
- [RFC 0015: Tests in Forma](./0015-tests-in-forma.md): a possible future home
  for the guide-example checks.
- [RFC 0017: Diagnostic catalog](./0017-diagnostic-catalog.md): codes for any
  new diagnostics introduced here.
