# RFC 0014: Local providers

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-16 |
| Scope | Expression-scoped service implementations, partial delegation, requirement discharge, Effect TypeScript lowering, effect IR projection |
| Direction | `provide` accepts an inline `implement` expression that captures lexical values; closed requirement sets and portable IR are unchanged |

## Summary

`provide` currently accepts only the name of a top-level `layer`. This RFC lets
its second argument be an `implement` expression: an anonymous implementation
of one service, written where it is used, whose methods can refer to local
bindings. An `implement` can also define only some members and delegate the
rest to the provider outside the expression.

```lisp
(provide (save-user "Bob")
  (implement Store
    (define get [key] (succeed "Bob"))
    (define set [key value] (ref-update writes (fn [xs] (conj xs value))))))
```

A local provider is a layer without a name. It is checked by the layer rules
that exist today, discharges requirements by the subtraction `provide` already
performs, and lowers to `Layer.succeed` or `Layer.effect` inside the
surrounding `Effect.gen`. It does not add `perform`, `resume`, continuation
capture, or open effect rows.

## Motivation

Loon, a Lisp with algebraic effects, shows how effects make tests cheap and
adapters easy to swap. A function names the operations it needs, and the
caller wraps it in a `handle` block that supplies them. In its documentation's
words, the program runs unchanged under production, test, or replay
"handler towers". Its own effect substrate (`src/eff/eff.oo` in
[ecto/loon](https://github.com/ecto/loon)) restricts every handler clause to
resume exactly once in tail position. Those are the handlers that compile to
evidence passing, which means passing the implementation as a hidden argument.

Forma already has that model under another name. A service is the operation
interface, a layer is the implementation, and `provide` installs it. The
missing piece is locality. Every implementation must be a top-level `layer`
declaration, so:

- A test double cannot capture a local `Ref`, fixture, or expected value.
  Each double becomes a top-level declaration, and recording calls requires a
  service whose only purpose is to carry the recorder.
- Overriding one member of a service for a single call, such as a failing
  `charge` for one scenario, requires a complete second layer.
- Adapters that depend on a value computed at run time, such as a decoded
  configuration, cannot be written as layers without making that value a
  service.

[RFC 0015](./0015-tests-in-forma.md) proposes tests written in Forma; local
providers are how those tests supply services.

## History and non-goals

Forma once had `define-effect`, `perform`, `handle`, and `->!`. Commit
`ab58982` ("Standardize Forma operational effect semantics", #25) replaced them
with `Effect<A, E, R>` over closed sets, service capabilities, and typed
`catch`. Its design notes say current workloads install service
implementations at the runtime boundary and do not require continuation
capture or row-polymorphic reuse, and that "open effect rows, dynamic
handlers, and resumable continuations are not a live implementation lane."
The engine still rejects the legacy forms by name: `type/lower-core.ts`
reports "Legacy algebraic effect form 'handle' is no longer supported". (The
since-removed OCaml engine reported `lower/legacy-effect`.)

This RFC stays inside that decision:

- No source form captures or resumes a continuation. A method body's result
  is the operation's result.
- Effect and requirement sets stay closed and finite. Nothing here needs a row
  variable.
- The IR adds an inline layer node. It does not add a handler stack.
- The name `handle` is not reused. It is a live form in
  `preludes/http-api.lisp`, and the legacy rejection messages refer to it.

Multi-shot resumption, generators, and backtracking handlers remain out of
scope, as [RFC 0003](./0003-direct-style-effects.md) already records.

## Current state

- **Services and layers.** `surface/effect.ts` normalizes `service` to
  `__service` and `layer` to `__layer`. The projector in
  `packages/ts/src/mechanics/artifact.ts` produces `ServiceDef` and `LayerDef`.
  A layer implementation is `{kind: "Service", service, setup, methods}` or a
  `Compose` tree of `LayerRef`, `LayerMerge`, `LayerProvide`, and
  `LayerProvideMerge`.
- **`provide` in IR.** `provide` is a generic `Combinator{name: "provide",
  args: [effect, Var]}`. The payload contracts in
  `artifact/mechanics-payloads.ts` check only that a combinator's name is a
  string.
- **Checking.** In `mechanics/check.ts`, `provide` requires its second
  argument to be a `Var` that names a declared layer, and otherwise reports
  `mechanics/provide`. The result's requirements are the body's requirements
  whose service the layer provides removed, plus the layer's own requirements.
  Its errors are the union of the body's and the layer's. `checkServiceLayer`
  requires every member to be implemented. A method may raise only the errors
  its member declares, and may not require `Scope` or its own service
  (`mechanics/layer-cycle`). The services a method uses become requirements of
  the layer. `layer-provide` warns `mechanics/unused-layer`.
- **Generation.** `mechanics/effect-typescript.ts` emits services as
  `Context.Service` classes and layers as `Layer.succeed` or
  `Layer.effect(Svc, Effect.gen(... Svc.of({...})))`. Layers whose methods
  use other services capture them with `Effect.context`. `provide` becomes
  `Effect.provide(body, Layer)`, re-yielding the body's services inside the
  provided effect.
- **Running.** `makeMechanicsRuntime` takes services as JavaScript functions
  from the host. It does not run `Combinator` nodes, so it does not run
  `provide`. The kernel rejects Effect programs with `module/effect-runtime`.
- **HM checker.** `COVERAGE.md` states that the HM checker does not understand
  layers, `provide`, or combinators; the mechanics checker is authoritative for
  Effect programs.
- **Stored effect IR.** `conformance/surfaces/cases.json` pins projected
  effect IR on its `effect-ir` surface, and `pnpm surfaces` checks the
  TypeScript projection against the stored goldens. The goldens were
  captured from the OCaml engine, which also projected `provide` and the
  catch forms, before it was removed.

## Proposal

### `implement`

`(implement Service member ...)` is an expression that denotes a layer
providing `Service`. Each member is a `define` with the syntax a `layer`
member uses today. It can appear wherever `provide` accepts a layer:

```lisp
(provide effect LayerName) ; today
(provide effect (implement Svc ...)) ; proposed
```

Methods are closures. They can refer to function parameters, `let` and `do!`
bindings, and other local values in scope at the `implement` expression. They
are checked with the existing layer rules:

- the member's parameter and result types must match the service declaration;
- a method may raise only errors the member declares;
- a method may not require `Scope` or `Service` itself;
- the services a method uses become requirements of the `implement`.

Missing members are an error unless the expression delegates them, as below.
Members that the service does not declare, and duplicate members, are errors.

`implement` is valid only as the layer argument of `provide`. It is not a
first-class value, so it cannot be stored or passed to a function. That keeps
lowering and requirement accounting local. Whether to allow it as an argument
of `layer-merge` and `layer-provide`, or to bind it with `let`, is left open
below.

### Requirement discharge

The rule `provide` uses today applies unchanged. A complete `implement` of
`Svc` removes every requirement on `Svc` and its members from the body. It
adds the requirements of its methods, and the errors the methods raise are
already among the declared errors of the members.

```lisp
(service Store
  (: get (-> String (Effect String)))
  (: set (-> String String (Effect Unit))))

(: save-user (-> String (Effect String [] [Store.get Store.set])))
(define save-user
  [name]
  (do! [_ (Store.set "user" name) saved (Store.get "user")] saved))

(: stored-writes (Effect (List String)))
(define stored-writes
  (do!
    [
      writes
      (ref-make [])
      _
      (provide (save-user "Bob")
        (implement Store
          (define get [key] (succeed "Bob"))
          (define set
            [key value]
            (ref-update writes (fn [xs] (conj xs value))))))
      seen
      (ref-get writes)]
    seen))
```

`stored-writes` requires nothing, so it can run without any host-supplied
service. The checker reports a located warning, `mechanics/unused-provider`,
when the body requires nothing from the implemented service. This mirrors
`mechanics/unused-layer`.

### Delegation

`(implement Svc :delegate member ...)` defines some members and forwards the
rest to the `Svc` provided outside the `provide` expression:

```lisp
(provide (Checkout.place request)
  (implement Payments
    :delegate
      (define charge
        [customer cents]
        (fail (PaymentDeclined {:reason "card expired"})))))
```

The result's requirements contain `Svc.m` for each delegated member `m` that
the body requires. A delegating `implement` that defines every member is
reported as `mechanics/unused-delegate`. Delegation is shallow: a defined
method that calls one of its own service's members is still rejected with
`mechanics/layer-cycle`. A method that wants the outer implementation of its
own member must receive it another way. That would need a separate design
(see decisions).

### Lowering

An `implement` becomes an inline layer in the generated `Effect.gen`:

```ts
// complete
yield* Effect.provide(saveUser("Bob"), Layer.succeed(Store, Store.of({
  get: (key) => Effect.succeed("Bob"),
  set: (key, value) => Ref.update(writes, (xs) => [...xs, value]),
})));
```

Methods that use other services capture them with `Effect.context`, as
service layers do today. A delegating `implement` reads the outer service
first and spreads it:

```ts
const outer = yield* Payments;
yield* Effect.provide(body,
  Layer.succeed(Payments, Payments.of({ ...outer, charge: (customer, cents) => ... })));
```

The exact Effect 4 calls are fixed by the generator golden, not by this RFC.
Lexical captures need no special IR. Method bodies refer to local bindings as
`Var` nodes, and the generated TypeScript closes over them.

### IR

The second argument of the `provide` combinator becomes either a `Var` naming
a layer or a new node:

```ts
interface InlineLayer {
  readonly kind: "InlineLayer";
  readonly service: string;
  readonly delegate: boolean;
  readonly methods: readonly { readonly name: string; readonly params: readonly Pattern[]; readonly body: EffectExpr; readonly span: Span }[];
  readonly span: Span;
}
```

`artifact/mechanics-payloads.ts` gains a contract for `provide` arguments.

### Relation to direct-style effects

Under [RFC 0003](./0003-direct-style-effects.md), `provide` takes a function
to invoke with the provider installed. `implement` is accepted there in the
same position:

```lisp
(provide (fn [] (pay order))
  (implement Payments (define charge [id cents] "charge:test")))
```

No other part of this RFC depends on RFC 0003.

## Alternatives considered

- **Reinstate `handle` with tail-resumptive clauses.** The semantics would be
  the same as a complete `implement`, but the syntax suggests continuations,
  `return` clauses, and handler stacks that Forma deliberately removed. It
  would also collide with the HTTP prelude's `handle` form.
- **Anonymous `layer`.** Allowing `(layer :provides Svc ...)` in expressions
  would overload a top-level declaration form by argument shape. `implement`
  is a separate name for a separate position.
- **Services as records of functions.** Passing implementations as ordinary
  arguments works today but loses requirement accounting. Callers would have
  to thread every dependency by hand, and generated code would not use Effect
  services.
- **Host-side test layers only.** The current workaround is to write
  TypeScript harnesses that supply layers. It keeps tests out of Forma and
  cannot capture Forma values.

## Conformance

The TypeScript projector, checker, and generator implement this. New positive
cases are added to the `effect-ir` surface in `conformance/surfaces/`, with
goldens written by `pnpm surfaces --update` and reviewed. Negative cases live
with the mechanics checker tests, as they do for layers today. The HM checker
gap recorded in `COVERAGE.md` extends to `implement`. (The earlier plan for an
OCaml projection of `InlineLayer` was dropped when the OCaml engine was
removed.)

## Implementation stages and validation

1. **Complete local providers.** Parsing, projection, checking, and
   generation of `implement` without `:delegate`. A positive
   `conformance/effect-typescript/cases/local-providers` case records a
   golden, typechecks it, and runs a harness. The harness asserts that a
   provided recorder captures every `set`, that a local value captured by a
   method is used, and that an inner `provide` overrides an outer one. Negative
   cases cover a missing member, an unknown member, an undeclared error, a
   method requiring its own service, `implement` outside `provide`, and the
   unused-provider warning.
2. **Delegation.** `:delegate`, with a golden for the outer-service spread and
   negative cases for `mechanics/unused-delegate` and a delegated self-call.
   The harness asserts that delegated members reach the outer implementation.
3. **OCaml projection.** Dropped: the OCaml engine was removed. The positive
   cases join the `effect-ir` surface in `conformance/surfaces/` with stage 1.
4. **Runtime support.** If [RFC 0015](./0015-tests-in-forma.md) runs Effect
   tests without generating TypeScript, `makeMechanicsRuntime` gains `provide`
   for named and inline layers. Otherwise this stage is not needed.

## Decisions still required

- Whether `implement` may appear under `layer-merge` and `layer-provide`, or be
  bound with `let` and reused.
- Whether a defined method may call the outer implementation of its own
  member, for wrappers that decorate a call. A dedicated binding such as
  `:outer prev` is one option.
- Whether a service-wide requirement such as `[Store]` should be discharged
  member by member when `:delegate` leaves some members to the outer provider.
- Whether `implement` should support a `:setup` block, as service layers do,
  or whether `do!` around the `provide` is enough.

## Related designs

Koka compiles tail-resumptive handlers to evidence passing. See
[Generalized Evidence Passing for Effect Handlers](https://www.microsoft.com/en-us/research/publication/generalized-evidence-passing-for-effect-handlers/).
Loon documents algebraic effects, multi-shot resume, and handler towers in its
[effects guide](https://loonlang.com/guide/effects). Its EIR compiles effects
to evidence passing. Effect provides scoped service implementations through
`Layer` and `Effect.provide`. This proposal adopts the local, swappable
implementations those designs share, without their continuation semantics.
