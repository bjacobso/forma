# RFC 0003: Direct-style effects

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-06 |
| Scope | Effect inference, service operations, evaluation order, deferred computations, and target lowering |
| Direction | Ordinary Lisp calls and bindings, inferred effects, explicit capability contracts, and function-based deferral |

## Summary

Effectful functions use ordinary calls, `do`, and `let`. The compiler infers the
capabilities they require and the typed failures they may raise. Optional signatures
can constrain those effects. A call returns its ordinary result in the current
execution context; a function value can hold a computation for later execution.

The proposed default is to use the existing `(fn [] ...)` syntax for deferral.
A dedicated `suspend` form is unnecessary for this model. It could later be a
convenience macro if it improves readability, or belong to a separate abstraction
for first-class computation values.

This proposal builds on the [unified syntax](./0001-unified-syntax.md) and
[modules and packages](./0002-modules-and-packages.md) proposals. The
[Effect reference](../effect/reference.md) describes the implementation available
today. All new syntax and semantics below are proposed behavior.

## A complete example

```lisp
(import "./orders.forma" [OrderId Order])
(import "@forma/effect" [service])

(export Payments pay)

(service Payments
  (: charge (-> OrderId Int Unit)))

(define pay [order]
  (do
    (Payments.charge order.id order.total-cents)
    {:id order.id
     :total-cents order.total-cents
     :status :paid}))
```

The service declaration makes `Payments.charge` a capability operation. Its call
returns `Unit` and contributes `Payments.charge` to the caller's inferred
requirements. The surrounding function returns the record after charging succeeds.
It needs neither `do!` nor a discarded-result binding.

Inference determines the function's structural input and output types. It does not
invent the author's intended named domain type. An optional signature can require
the exact public contract:

```lisp
(: pay (-> Order Order :requires [Payments.charge]))
```

If charging can fail, the declaration and public contract can express that too:

```lisp
(error PaymentDeclined {:id OrderId})

(service Payments
  (: charge (-> OrderId Int Unit :throws [PaymentDeclined])))

(: pay
  (-> Order Order
      :requires [Payments.charge]
      :throws [PaymentDeclined]))
```

The return type is the normal successful value. Requirements and failures describe
evaluation of the function. Service interfaces still need signatures because they
have no bodies from which to infer their contracts.

## Calling now and deferring until later

Within an executing function, a call performs its operations and produces a result:

```lisp
(let [paid (pay order)]
  paid)
```

`paid` is the successful order. The charge has already happened before the body of
the `let` continues. The caller must provide the required capability or propagate
the requirement to its caller.

A zero-argument function defers that call:

```lisp
(let [payment-job (fn [] (pay order))]
  (payment-job))
```

Creating `payment-job` does not charge anything. Invoking it performs the call.
Every invocation evaluates its body again; this is not a memoized result or an
already-running task. Ordinary lexical capture applies: values computed outside
the function are captured, while expressions inside its body run on invocation.

### Running a deferred computation

Inside an executing Forma program, call the function normally:

```lisp
(let [job (fn [] (pay order))]
  (job))
```

`(job)` returns the successful paid order, or propagates the call's typed failure.
Its requirements become requirements of the caller. There is no separate source
`run` operation for deferred functions: ordinary application supplies that behavior.
If a provider is needed at that point, it can be installed while invoking the job:

```lisp
(provide job PaymentsLive)
```

The CLI or host runner starts the outer entry function with its configured providers.
Calling an exported generated TypeScript function follows the target's Effect API:
it creates an Effect value that the host executes through that target's runner.
Source-level application inside a running Forma program is compiled to the required
sequencing; it does not ask the author to run a second runtime manually.

This distinction is needed whenever an operation must control execution, for
example retrying, starting a child task, or installing a service provider before
calling a function. Those operations can accept ordinary functions:

```lisp
(retry (fn [] (load-order id)) :times 3)
(fork (fn [] (pay order)))
(provide (fn [] (pay order)) PaymentsLive)
```

These examples show proposed library APIs. `retry` invokes its argument for each
attempt. `fork` schedules its argument as a child task. `provide` installs the
provider while invoking its argument. Their own effect types describe the
requirements and failures that remain after each operation.

With ordinary eager argument evaluation, `(retry (load-order id) :times 3)` would
load the order before `retry` receives its argument. It would receive the result,
not a function it can invoke again. The higher-order API therefore requires a
function and rejects that call by type.

### Do we need `suspend`?

We need a way to represent execution that has not happened yet. Existing function
syntax already supplies that way:

| Expression | Proposed meaning |
| --- | --- |
| `(pay order)` | Call now in the current execution context |
| `(fn [] (pay order))` | Construct a function that calls when invoked |
| `(suspend (pay order))` | Possible convenience spelling, not required by this RFC |

If `suspend` merely expands hygienically to `(fn [] ...)`, it adds no new runtime
semantics. The initial design should use functions and avoid introducing another
construct for the same behavior.

A distinct first-class computation type could be useful for interoperability or
additional operations. That would need its own rules for construction, execution,
and capture. It must not be introduced by silently changing which ordinary calls
execute or by automatically unwrapping values according to their type.

## Evaluation and inference

Function arguments and record fields evaluate from left to right. `do` sequences
expressions. `let` evaluates bindings in order, making prior bindings available to
later ones. `if`, `match`, and boolean short-circuiting evaluate only the selected
path at runtime.

Static inference accounts for every path that might execute. A function's effects
include those of its evaluated expressions and called functions. Creating a
function does not execute its body: the body's effects belong to its function type
and become relevant when that function is called. Asynchronous calls preserve the
same sequencing unless an explicit concurrency operation changes it.

Higher-order functions must be polymorphic over their callbacks' effects. For
example, `map` with a pure callback is pure, while a sequential `map` with an
effectful callback propagates its effects and preserves element order. Parallel
traversal remains an explicit library operation. The syntax for open effect rows
requires a separate decision; the compiler model must support them.

An absent function signature means infer its input types, result, requirements,
and failures. This applies to local and exported functions. An explicit signature
is checked as a contract: inferred effects must fit within its declared rows.
For the proposed closed signatures, omitted `:requires` and `:throws` options mean
empty rows. Authors who write `(-> Order Order)` therefore assert purity; they can
omit the signature entirely to request inference.

Pure helpers remain checked as pure when their signatures require it. A call to an
effectful function cannot enter a pure expression unnoticed. The language does not
require special binding syntax to maintain that property.

## Failures, providers, and execution contexts

Typed failure aborts the current normal evaluation path. A proposed direct-style
`raise` operation contributes its error type; `catch` handles selected errors and
removes the handled cases from the outgoing failure row. Handler code may introduce
new requirements or failures of its own.

```lisp
(catch (pay order)
  (PaymentDeclined error) {:status :declined :id error.id})
```

`catch` is a control construct: it establishes the handler before evaluating its
protected expression. Its result type must accept the results of both the normal
path and the handled path. Typed failures remain distinct from runtime defects and
task interruption.

Requirements carry resolved service and member identities across modules. A
provider discharges the requirements it implements and propagates any dependencies
needed by that implementation. Providers are resolved in the invocation context;
creating a deferred function does not implicitly freeze a provider environment.
Applications that need a fixed provider can explicitly invoke `provide` inside
their deferred function.

Module initialization is pure. It can construct functions and immutable data, but
cannot perform service operations merely because the module was imported. An
application exposes a zero-argument entry function:

```lisp
(export main)

(define main []
  (pay example))
```

The runner invokes `main` with the configured providers. Missing requirements are
diagnosed at the configured application boundary. Resource scopes, finalization,
child-task cancellation, and escaping resource values must retain explicit rules;
direct syntax does not remove their runtime semantics.

## Lowering and runtime scope

Effect TypeScript remains a target. The compiler can translate an effectful source
function into a TypeScript function returning an Effect computation. Source calls
inside an executing effectful body lower to sequencing of those computations;
pure calls remain ordinary calls. Deferred source functions lower to callable
factories, not prematurely evaluated results.

Services lower to Context services, providers to layers or provision operations,
typed failures to Effect failures, and structured concurrency to the target's
corresponding operations. Exported module interfaces retain effect rows so callers
can be checked and compiled without inspecting implementation bodies.

Both engines need a checked representation of effectful expressions and function
calls. Code generation and interpretation must follow that representation rather
than guessing from syntax heads or requiring an outer signature to classify every
function. Pure evaluation, asynchronous sequencing, interruption, and finalization
must agree across targets.

This initial direction covers service operations, typed failures, scoped resources,
and explicit concurrency. Full algebraic effect handlers with arbitrary continuation
capture or repeated resumption are a separate extension; they cannot be assumed
to follow from lowering calls into Effect TypeScript.

## Implementation stages and validation

1. Specify evaluation order, closed and open effect rows, service operation types,
   optional annotations, deferred functions, and the pure module boundary.
2. Extend both engines' typed representations and inference, including latent
   effects on function values and effect-polymorphic higher-order functions.
3. Implement direct-style lowering and execution for service calls and typed
   failures; preserve module identity, source spans, and diagnostics.
4. Integrate providers, resources, retry, and concurrency through typed function
   APIs, then migrate the current `do!` authoring surface and examples.

Acceptance coverage includes exactly-once sequencing, conditional evaluation,
failure short-circuiting, effect propagation, pure-signature rejection, and
cross-module calls. Deferred-function fixtures verify no work at construction,
fresh evaluation per invocation, provider scope, and retry attempts. Higher-order
fixtures distinguish callback construction from callback invocation. Integration
checks compare results, failures, operation traces, and cleanup across engines
and generated targets.

The [module RFC](./0002-modules-and-packages.md) uses the current Effect-value
surface in its examples. This proposal changes those examples to direct-style
calls and zero-argument entry functions when adopted. The existing implementation
remains as documented until this proposal is implemented.

## Decisions still required

- The exact syntax and inference rules for open requirement and failure rows.
- Whether `suspend` is useful enough to add as a convenience macro later.
- Whether a distinct first-class computation type is needed beyond function values.
- Library contracts for retry, providers, resources, and task operations.
- Resource escape rules and the boundary between typed failures, defects, and interruption.
- Scope and runtime support for any future general algebraic handlers.

## Related designs

Koka presents Hindley–Milner-style inference for types and row-polymorphic effects.
See [Koka: Programming with Row Polymorphic Effect Types](https://arxiv.org/abs/1406.2061).
Unison describes capability requirements on function types, ordinary expression
syntax for effectful programs, and ability handlers. See its
[abilities and ability handlers reference](https://www.unison-lang.org/docs/language-reference/abilities-and-ability-handlers/).
Those designs inform this proposal; the syntax and target restrictions here are
Forma-specific choices.
