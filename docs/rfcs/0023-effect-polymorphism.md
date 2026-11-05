# RFC 0023: Effect-polymorphic signatures

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-11-05 |
| Resolves | [RFC 0003](./0003-direct-style-effects.md)'s open decision on the syntax and inference rules for open requirement and failure rows, for Effect programs; [RFC 0018](./0018-type-generics.md)'s "Effect integration" decision |
| Depends on | [RFC 0019](./0019-everyday-checker-gaps.md) section 10 (named callbacks) for stage 3 |
| Scope | Type variables in operation signatures, error-set and requirement-set variables, call-site instantiation, body checking, set subtraction, built-in combinators as signatures, Effect TypeScript lowering, IR, diagnostics, host profiles |
| Direction | A signature can name the errors and requirements it passes through. Variables live only inside signatures; every call site, artifact boundary, and generated operation still sees closed sets. Continuations stay out |

## Summary

An operation that takes an effectful callback can say that it passes the
callback's errors and requirements through, adding its own:

```lisp
(: with-audit (-> (-> Int (Effect a [e] [r])) Int
                  (Effect a [e AuditDown] [r Audit.log])))
(define with-audit [f n]
  (do! [v (f n)
        _ (Audit.log "called")]
    v))

;; charge        : Int -> (Effect String [Declined] [Stripe.charge])
;; lookup-cached : Int -> (Effect String)
(: charged (-> Int (Effect String [Declined AuditDown] [Stripe.charge Audit.log])))
(define charged [n] (with-audit charge n))

(: free (-> Int (Effect String [AuditDown] [Audit.log])))
(define free [n] (with-audit lookup-cached n))
```

`a` is an ordinary type variable. `e` is an **error-set variable** and `r` is
a **requirement-set variable**: a lowercase symbol inside an error or
requirement vector. Each call instantiates them afresh and solves them from the
arguments, so `charged` requires `Stripe.charge` and `free` does not. After the
call, both sets are closed again.

A later stage adds subtraction, so a user function can discharge a requirement
or handle an error the way `provide` and a tagged `catch` do today:

```lisp
(: with-declining-payments
  (-> (Effect a [e] [r]) (Effect a [e PaymentDeclined] [(without r Payments.charge)])))
```

Built-in combinators such as `for-each`, `retry`, `timeout`, and `race`
are then ordinary signatures instead of branches in the checker.

This RFC does not add `perform`, `resume`, continuation capture, multi-shot
handlers, or open sets at operation boundaries. Those remain out of scope, as
[RFC 0003](./0003-direct-style-effects.md) and
[RFC 0014](./0014-local-providers.md) record.

## Motivation

Forma's effect story rests on precise sets. A requirement set is what a host
grants under [RFC 0012](./0012-checked-evaluation.md), what a test must
provide under [RFC 0015](./0015-tests-in-forma.md), and what a reviewer reads
in a signature. Today those sets are precise only for code that calls services
directly or uses a built-in combinator. As soon as an author factors a pattern
into a higher-order operation, the sets become upper bounds that every caller
inherits:

- **Wrappers.** Auditing, tracing, metrics, rate limiting, idempotency keys,
  and retry policies are each a function of an effect. Written by a user, each
  must name one concrete callback type, so it can wrap only one kind of call.
  A second copy is needed for every callback with different effects.
- **Over-approximated capabilities.** A caller that passes an effect-free
  callback to a wrapper declared with `[Stripe.charge]` still requires
  `Stripe.charge`. Under RFC 0012, the host must grant a capability that the
  program never uses. Under RFC 0015, a test must provide a service it never
  calls. Both undermine the reason sets exist.
- **Reusable test doubles.** [RFC 0014](./0014-local-providers.md) makes
  `implement` local but deliberately not first class. A helper such as
  `with-declining-payments`, written once and applied to many programs, needs a
  signature that removes `Payments` from whatever its argument requires.
- **Agent tooling.** A host that exposes model-written operations wraps them
  in approval, journaling ([RFC 0016](./0016-host-call-journals.md)), and
  limits. Those wrappers are higher-order by nature.

The built-in combinators already behave polymorphically, which shows the rule
is sound and the lowering works. The gap is that only the checker can write
such a rule.

## Current state

### The Effect checker

- **Representation.** `MType`'s `effect` variant in
  `packages/ts/src/mechanics/types.ts` holds `errors` and `requirements` as
  `Provenance` maps from names to spans. `applySubstitution` rewrites an
  effect's success type but leaves both sets unchanged, so a set can never
  contain a variable.
- **Operation signatures are monomorphic.** `checkTypeReferences` in
  `mechanics/check.ts` accepts lowercase type variables for `FunctionDef`
  signatures but not for `EffectDef` signatures. A generic operation is
  rejected with `mechanics/unknown-type`.
- **Set entries are names.** Error entries must be declared errors
  (`mechanics/unknown-error`). Requirement entries must be a service, a
  `Service.method`, or `Scope` (`mechanics/unknown-requirement`).
- **Calls.** `operationCall` checks the arguments against the declared
  parameters and returns the declared sets with the call's span. Nothing is
  instantiated.
- **Built-in combinators.** `for-each`, `all`, `race`, `fork`, `timeout`,
  `retry`, `repeat`, `map-error`, `or-else-succeed`, `provide`, and others are
  arms of the combinator switch in `effectInner`. Each passes its body's sets
  through by hand. `provide` removes every requirement whose service the layer
  provides.

Probes against `generateEffectProgram` on `main` (9fa159a), with
`Stripe.charge : Int → Effect String [Declined]` and
`Audit.log : String → Effect Unit [AuditDown]`:

| Program | Result |
| --- | --- |
| `for-each` with a callback that calls `Stripe.charge` | Accepted; the operation's type is `Effect<ReadonlyArray<string>, Declined, Stripe>` |
| A user operation whose callback parameter is `(-> Int (Effect String [Declined] [Stripe.charge]))`, called with a lambda or a named operation | Accepted |
| The same operation called with an effect-free named operation, from a caller that declares `[AuditDown] [Audit.log]` | `mechanics/undeclared-error: ... can fail with Declined` and `mechanics/undeclared-requirement: ... requires Stripe.charge` |
| `(Effect a [e AuditDown] [r Audit.log])` in an operation signature | `mechanics/unknown-type: Unknown type a`, `mechanics/unknown-error: Unknown error type e`, `mechanics/unknown-requirement: Unknown requirement r` |

The generator prints a callback parameter with its concrete type, for example
`f: (arg0: number) => Effect.Effect<string, Declined, Stripe>`.

### The kernel checker

The kernel (HM) checker already infers latent effect rows on function types.
`TFun` carries an `ERow` (`EEmpty`, `EVar`, `EExtend` in
`packages/ts/src/type/types.ts`), inference tracks an ambient row
(`type/effect-helpers.ts`), and `type/authority.ts` turns the inferred row of a
program into an authority manifest checked against grants
(`conformance/typed-authority`, including a higher-order call-site case). For
example, the kernel infers:

```text
(fn [f x] (f (f x)))      :: (t3 -{e4}-> t3) -> t3 -{e4}-> t3
(fn [f xs] (map f xs))    :: (t2 -> t3) -> List<t2> -> List<t3>
```

Kernel rows have no surface notation, and the built-in `map` scheme is pure,
as [RFC 0018](./0018-type-generics.md) notes. The kernel's `ErrorSet` and
`RequirementSet` types, used when it reads Effect signatures, are finite sets
without variables: `type/unify.ts` unifies their sorted members pairwise and
`type/assign.ts` checks inclusion by name. As [RFC 0014](./0014-local-providers.md)
records, `COVERAGE.md` makes the Effect checker authoritative for Effect
programs.

### History

PR #25 replaced `define-effect`, `perform`, `handle`, and `->!` with
`Effect<A, E, R>` over closed sets. Its design notes say that "open effect
rows, dynamic handlers, and resumable continuations are not a live
implementation lane." This RFC revisits only the first item, and only in the
restricted form below: variables inside signatures, closed sets everywhere
else. Dynamic handlers and continuations stay excluded.
[RFC 0003](./0003-direct-style-effects.md) requires higher-order functions to
be polymorphic over their callbacks' effects and leaves the notation open.
[RFC 0018](./0018-type-generics.md) defers its effect notation to RFC 0003.

## Proposal

### 1. Generic operations

Operation signatures accept lowercase type variables, with the rules
`FunctionDef` signatures already follow: rank-one quantification over the
whole signature, fresh instantiation at each call, and inference of the
instantiation from the arguments and, as for built-ins today, from an expected
result type.

```lisp
(: load-each (-> (List a) (-> a (Effect b [NotFound] [Store.get])) (Effect (List b) [NotFound] [Store.get])))
```

Service members stay monomorphic. A generic service member would be a generic
method on an Effect `Context.Service` interface, a generic `async fn` on a Rust
trait (which is not object safe), and a generic method on a Go interface
(which Go does not allow). That is left as an open decision.

### 2. Set variables

Inside an error or requirement vector of an `Effect` or `Stream` type in an
operation or signed-function signature, a symbol matching the existing
type-variable pattern (`^[a-z][A-Za-z0-9_]*$`) is a set variable. Declared
errors and services are capitalized, and `Scope` is reserved, so the spelling
is unambiguous.

```lisp
(Effect a [e AuditDown] [r Audit.log])   ; e: error set, r: requirement set
(Effect a [e1 e2] [r1 r2])               ; the union of two callbacks
```

- A set denotes the union of its names and the solutions of its variables.
  Order and duplicates are irrelevant.
- A variable's kind is fixed by its first position. Using the same name in an
  error vector and a requirement vector is `mechanics/set-variable-kind`.
  Using a set variable as a value type, or a value type variable in a set, is
  the same error.
- Every set variable in the result must also appear in a parameter.
  Otherwise there is nothing to solve it from, and it is
  `mechanics/unbound-set-variable`. The diagnostic suggests a declared error or
  service when the variable matches one case-insensitively, so a mistyped
  `declined` is not silently a variable.
- Set variables may appear in the result and in the `Effect` or `Stream`
  result of a function-typed parameter, one level deep. A variable inside the
  parameters of a function-typed parameter would make that callback
  higher-rank; it is `mechanics/set-variable-position` and deferred.

### 3. Checking a call

At each call:

1. Every type and set variable in the callee's signature is renamed fresh.
2. Each argument is checked against its parameter type. Where an argument's
   effect type meets a parameter's effect type, each name and each closed
   variable in the argument's set becomes a lower bound of the parameter's
   variables. A parameter set with names and variables, such as `[e Declined]`,
   receives only the argument's entries that are not already listed.
3. Each variable is solved as the union of its lower bounds. A variable with no
   lower bounds is the empty set.
4. The result type is the signature's result with the solutions substituted.
   It is closed unless the call is itself inside a polymorphic body (below).

Set variables are solved from arguments only. An expected result type does not
solve them, because a precise set should never be widened to fit an
annotation. Inclusion against the expected type is checked afterwards, as for
any call, with the existing `mechanics/undeclared-error` and
`mechanics/undeclared-requirement` diagnostics.

Provenance follows the solution. An entry contributed by a callback keeps the
span where it entered the callback's type, so a caller's
`undeclared-requirement` diagnostic can point at the lambda or named operation
that introduced it, not only at the wrapper call.

### 4. Checking a polymorphic body

Inside the body of an operation with set variables, those variables are
rigid. Calling `f` of type `(-> Int (Effect a [e] [r]))` contributes `e` and
`r` to the body's sets as opaque members. The body's sets must be included in
the declared result sets, comparing names by name and variables by identity.
A body that lets `r` escape into a result declared without it is reported by
the existing `mechanics/undeclared-requirement`, naming the variable.

Until stage 4, operations that remove entries treat a variable
conservatively:

- `provide` removes matching names, and leaves a variable in place.
- `catch` with tag patterns, such as `(catch eff (NotFound e) handler)`,
  removes the handled names, and leaves a variable in place.
- `catch` with a plain binder, `or-else-succeed`, and `or-die` remove every
  error, including error variables.

Leaving a variable in place over-approximates the result and is sound. Stage 4
makes it precise.

### 5. Subtraction

A set may contain `(without v Name ...)`, where `v` is a set variable of the
same kind:

```lisp
(: with-declining-payments
  (-> (Effect a [e] [r]) (Effect a [e PaymentDeclined] [(without r Payments.charge)])))
(define with-declining-payments [program]
  (provide program
    (implement Payments :delegate
      (define charge [customer cents]
        (fail (PaymentDeclined {:reason "card expired"}))))))
```

- In a requirement set, `(without r S)` is the solution of `r` with `S` and
  every `S.member` removed, which is the rule `provide` applies to names today.
  `(without r S.m)` removes only that member.
- In an error set, `(without e E)` is the solution of `e` with `E` removed.
- In a body, `provide` of a layer or a complete `implement` for `S` turns a
  variable `r` into `(without r S)`. A delegating `implement` removes only the
  members it defines, so the example above yields `(without r Payments.charge)`
  and still requires any other `Payments` member the program uses.
- A `catch` whose tag patterns handle `E` turns `e` into `(without e E)`.
- The inclusion check compares these forms structurally.

`implement` remains valid only inside `provide`, as RFC 0014 specifies. The
helper above is an ordinary operation that contains one, so it can be applied
to many programs without making `implement` first class.

### 6. Built-in combinators as signatures

Combinators whose behavior is a pass-through become entries in a signature
table with the same notation:

| Combinator | Signature |
| --- | --- |
| `for-each` | `(-> (List a) (-> a (Effect b [e] [r])) (Effect (List b) [e] [r]))` |
| `timeout` | `(-> (Effect a [e] [r]) Duration (Effect a [e TimeoutError] [r]))` |
| `retry`, `repeat` | `(-> (Effect a [e] [r]) (Effect a [e] [r]))`, with the policy options checked as today |
| `race` | `(-> (Effect a [e1] [r1]) (Effect a [e2] [r2]) (Effect a [e1 e2] [r1 r2]))` |

Keyword options (`:concurrency`, `:times`, `:schedule`) stay checker-validated
options. `map-error` stays a dedicated rule until its mapping function has a type over
an unknown error set (see decisions). Variadic `all`, `fork`/`join` (which change the carrier to `Fiber`),
and resource forms (`scoped`, `acquire-release`) keep their dedicated rules
until a notation for them exists. `provide` moves to the table in stage 4,
expressed with `without`.

Every diagnostic these combinators report today must be preserved, with the
same codes and spans. The stored goldens are the acceptance test: this stage
deletes checker branches without changing observable behavior.

### 7. Lowering

**Effect TypeScript.** Type variables and set variables become type
parameters. Error-set variables map to `E`-position parameters, requirement-set
variables to `R`-position parameters, and names to the unions printed today:

```ts
export const withAudit = <A, E, R>(
  f: (arg0: number) => Effect.Effect<A, E, R>,
  n: number,
): Effect.Effect<A, E | AuditDown, R | Audit> =>
  Effect.gen(function* () {
    const audit = yield* Audit;
    const v = yield* f(n);
    yield* audit.log("called");
    return v;
  });
```

`(without r S)` prints as `Exclude<R, S>` and `(without e X)` as
`Exclude<E, X>`, which are the types `Effect.provide` and
`Effect.catchTag` produce. Type-parameter names follow the host profile's
naming and collision rules. Call sites need no explicit type arguments.

Forma's sets remain authoritative. Generated operations acquire services at
entry and lambdas close over them, so TypeScript may infer a narrower `R` for
a callback than Forma solved. The narrower type is assignable to the declared
one, so generated code still typechecks under the suite's strict settings.

**Runtime.** `makeMechanicsRuntime` erases types and needs no change.

**Other hosts.** Under [RFC 0022](./0022-effect-hosts.md), host profiles gain
an "effect polymorphism" support flag. A host without it reports its
unsupported diagnostic before printing. For Rust, a requirement-set variable
is the generic context parameter that RFC 0022 already proposes for service
bounds. An error-set variable needs one of two encodings: a generic error
parameter `E` with `From` bounds for the names the operation adds, so callers
instantiate it with their own per-operation enum, or a generated generic enum
such as `WithAuditError<E> { Inner(E), AuditDown(AuditDown) }`. Go's `error`
interface and context interfaces erase both kinds.

### 8. IR and artifacts

The portable Effect type node gains explicit variables instead of relying on
spelling:

```ts
interface EffectTypeNode {
  readonly kind: "Effect";
  readonly success: TypeNode;
  readonly errors: readonly string[];
  readonly requirements: readonly string[];
  readonly errorVariables?: readonly SetVariable[];        // new
  readonly requirementVariables?: readonly SetVariable[];  // new
}

type SetVariable =
  | { readonly kind: "Var"; readonly name: string }
  | { readonly kind: "Without"; readonly name: string; readonly removed: readonly string[] };
```

Absent fields mean a closed set, so every existing artifact keeps its meaning.
`artifact/mechanics-payloads.ts` gains the contracts. Module interfaces keep
quantified set variables, as RFC 0018 requires for type variables, so an
imported wrapper is instantiated at each call in the importing module.

### 9. The kernel checker

The kernel already infers latent rows, so this RFC does not add effect
polymorphism to it. It adds parity, in the direction
[RFC 0019](./0019-everyday-checker-gaps.md) sets: the kernel's type parser
reads set variables and `without` in `ErrorSet` and `RequirementSet`, and its
unification and assignment treat them as the Effect checker does, so that a
signature one checker accepts is not rejected by the other. Merging the
kernel's `ERow` with the Effect checker's sets belongs to
[RFC 0004](./0004-one-analysis-architecture.md). The kernel rows are ordered
label rows over authority attributes, and the Effect checker's sets are
unordered unions of declared names. They should share a representation only
when one checker serves both.

## Diagnostics

New codes, registered in the catalog proposed by
[RFC 0017](./0017-diagnostic-catalog.md):

| Code | Reported when |
| --- | --- |
| `mechanics/set-variable-kind` | A variable is used as both an error set and a requirement set, or as both a set and a value type |
| `mechanics/unbound-set-variable` | A result set variable appears in no parameter; suggests a declared error or service with a matching name |
| `mechanics/set-variable-position` | A set variable appears inside the parameters of a function-typed parameter |
| `mechanics/without-kind` | `without` removes a name of the other kind, or wraps a name that is not a variable |

Escapes reuse `mechanics/undeclared-error` and
`mechanics/undeclared-requirement`, with the variable in the message.

## Non-goals

- Continuations, `perform`/`resume`, multi-shot handlers, generators, and
  backtracking.
- Open sets at operation boundaries. A generated operation's type, an
  artifact's operation, and every call result are closed after instantiation.
- Inferring signatures. Effect programs keep requiring `(: name Type)` for
  top-level definitions.
- Higher-rank callbacks and generic service members.
- Bounded set variables (`e` restricted to a subset of declared errors).
- Effect-polymorphic kernel built-ins such as `map`; RFC 0003 and RFC 0018 own
  those contracts.

## Alternatives considered

- **Keep adding checker branches.** Every new combinator, and every
  combinator a prelude wants, would be compiler work. Users could still not
  write their own.
- **Koka-style row unification.** Rows with duplicate labels and tail
  variables support scoped handlers that shadow one another. Forma's sets are
  idempotent and its handlers are layers, so set union with lower-bound
  solving is enough and keeps diagnostics in terms of names.
- **Tail syntax `[AuditDown | e]`.** It suggests an ordered row with one tail.
  Sets are unordered, and a signature may combine two callbacks (`[e1 e2]`).
- **Explicit quantifiers `(Forall [e r] ...)`.** Clearer scope and no case
  convention, at the cost of syntax that RFC 0018 has not adopted for type
  variables. The unbound-variable diagnostic covers the main hazard of the
  implicit form. Revisit together with RFC 0018's explicit-quantifier decision.
- **Solving from the expected type.** It would let an annotation widen a set
  silently, which defeats the purpose.
- **Reusing the kernel's `ERow` in the Effect checker now.** It couples this
  change to RFC 0004 and to the authority manifest's label model.

## Conformance

Positive cases join `conformance/effect-typescript/cases`. Each generates
TypeScript that passes the suite's strict settings and runs. A type-level test
file in the case asserts the instantiated operation types, for example that
`free` is assignable to `Effect<string, AuditDown, Audit>`:

- `effect-polymorphic-wrapper`: one wrapper called with an effectful and an
  effect-free callback, by lambda and by named operation.
- `effect-polymorphic-union`: a wrapper over two callbacks with `[e1 e2]`.
- `effect-polymorphic-provide` (stage 4): a reusable
  `with-declining-payments` applied to two programs whose requirements differ.

Rejection cases pin each new diagnostic at its span, and pin the escape of a
rigid variable through `undeclared-requirement`. The four probes in
[Current state](#the-effect-checker) become mechanics checker tests that fail
before stage 2 and pass after it.

## Implementation stages and validation

1. **Generic operations** (section 1). Type variables in operation signatures,
   with instantiation in `operationCall`. Fixtures for inference from
   arguments and from an expected result.
2. **Set variables** (sections 2–4, 7, 8). Representation, call-site solving,
   rigid body checking, the IR fields, and TypeScript lowering. The positive
   and rejection cases above.
3. **Combinators as signatures** (section 6). Requires RFC 0019 section 10, so
   that `(for-each xs check)` with a named operation is accepted before
   `for-each` moves to the table. Stored goldens must not change.
4. **Subtraction** (section 5). `without`, `provide` and tagged `catch` over
   variables, `provide` in the table, and the RFC 0014 helper case.
5. **Kernel parity** (section 9). The kernel parses and checks set variables in
   Effect signatures.
6. **Other hosts.** Rust and Go encodings under RFC 0022, gated on that RFC's
   consumer decision.

Run `pnpm check` for every stage. Stored goldens that change are reviewed
expectations. Record stages 1, 2, and 4 in changesets, since they change which
programs the checker accepts.

## Decisions still required

- Whether set variables are implicit by case, as proposed, or need an explicit
  quantifier, decided together with RFC 0018.
- The type of `map-error`'s mapping function when the input set contains a
  variable: a callback over the union of the variable's errors would need a
  type for an unknown error set, such as an opaque `(Errors e)`.
- Whether `without` is enough, or whether signatures need an inclusion
  constraint such as "`r` must contain `Payments`" to report a useless
  `with-declining-payments` call.
- Generic service members, given the Rust and Go restrictions above.
- The Rust encoding of error-set variables.
- Whether `all` gets a variadic notation or stays a dedicated rule.

## Related designs

Koka infers row-polymorphic effect types with Hindley–Milner-style inference;
see [Koka: Programming with Row Polymorphic Effect Types](https://arxiv.org/abs/1406.2061).
Unison writes ability-polymorphic signatures such as `(a ->{g} b) -> [a] ->{g} [b]`;
see its [abilities reference](https://www.unison-lang.org/docs/language-reference/abilities-and-ability-handlers/).
Effect TypeScript expresses the same pass-through with generic `E` and `R`
parameters and computes discharge with `Exclude`, which is the lowering
target here. This proposal adopts their polymorphism over effect sets
without their handlers or continuations.
