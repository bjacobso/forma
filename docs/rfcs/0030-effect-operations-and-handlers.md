# RFC 0030: Effect operations and handlers

| | |
| --- | --- |
| Status | Draft; not implemented. Decision 1 (one kernel-inferred row) taken 2026-11-23 |
| Created | 2026-11-19 |
| Direction | Ben Jacobson, 2026-11-19: language semantics from Koka, the TypeScript embedding idea from Kyo, execution machinery from Effect |
| Revises | [RFC 0023](./0023-effect-polymorphism.md) (stages 3–6), [RFC 0003](./0003-direct-style-effects.md) (contract notation), the effect half of [RFC 0004](./0004-one-analysis-architecture.md) and [the T5 proposal](../proposals/one-checker.md), [RFC 0022](./0022-effect-hosts.md)'s profile table |
| Builds on | The kernel's latent effect rows, the Effect checker's provenance sets, `forma:effect` (RFC 0029 stages 1–2, PRs #178 and #179), [RFC 0014](./0014-local-providers.md), [RFC 0016](./0016-host-call-journals.md), [RFC 0027](./0027-contract-evolution.md) |
| Scope | Operation declarations, row inference through ordinary calls, handlers that resume at most once, lowering rows to Effect's `E` and `R`, and a compiled, Schema-backed durable plan with checkpoints and stable step identities |
| Direction | The operation and its handler are the authoring primitive. An effect row says what a function may do; a durable plan says where a routine pauses and how it resumes. They are separate artifacts |

## Summary

Authors declare domain operations, call them like functions, and discharge
them with handlers. The checker infers which operations a function may
perform, through ordinary calls, and tracks which still need a handler:

```lisp
(effect Review
  (: await-review (-> Employee Decision)))

(effect Payroll
  (: write-payroll (-> Employee Decision Receipt)))

(define complete-onboarding [employee]
  (let [review (await-review employee)]
    (write-payroll employee review)))
;; inferred: (-> Employee Receipt ! [Payroll Review])
```

A test handles both operations in memory:

```lisp
(handle (complete-onboarding alice)
  (Review  (await-review [employee] {:approved true :by "fixture"}))
  (Payroll (write-payroll [employee review] {:payroll-id "test-1"})))
;; : Receipt, with an empty row
```

In production, a host handles the residual row: a durable host can handle
`Review` with an event wait that survives a deploy, and `Payroll` with an
Effect-backed integration. Schema describes every value that crosses those
boundaries.

The semantics come from Koka: effect rows on function types, inferred, and
handlers that interpret operations and decide whether execution resumes. The
embedding comes from Kyo: a row is "an `A` with effects `S` still pending",
and inside TypeScript that is `Effect.Effect<A, E, R>`. The execution
machinery is Effect's: services, layers, typed failures, fibers, scopes.

Two restrictions keep the first version small and every host able to run it:

1. **Handlers resume at most once.** A clause either returns a value, which
   resumes the computation once, or aborts, which does not resume it. No
   continuation is captured, copied, or stored.
2. **An effect row is not a durable plan.** `[Review Payroll]` says what a
   function may do. It does not say where a run paused or how to resume it
   after a deploy. Routines a host must resume are compiled, in addition, to
   a plan with explicit checkpoints, serializable state, and stable step
   identities.

This revises the earlier suggestion to author Schema-backed plans directly.
The operation and its handler are what people write; the plan is a compiled
representation, produced only for routines that need inspection, simulation,
or durable execution.

## Motivation

- **Effects are domain vocabulary.** "Wait for a review" and "write payroll"
  are the things a reviewer and a test author reason about. Today they must
  be spelled as Effect services, with a hand-written signature on every
  operation that names each method, and they run only under the Effect
  checker.
- **Inference stops at the signature.** The Effect checker requires
  `(: name Type)` on every top-level definition and rejects direct-style
  `let` over an effect (probes below). The kernel checker infers rows for
  every function, but nothing in the surface language puts a label in one.
  The inference Ben asks for exists in one checker and the vocabulary in the
  other.
- **Tests and production differ only in handlers.** A fixture, an in-memory
  recorder, a live integration, and a durable wait are four handlers for the
  same operations. The checker should say which operations remain unhandled
  at each point, so a test that forgets one fails to check, not at run time.
- **Durability needs more than a type.** Resuming a routine after a deploy
  needs a stored position and stored state in a format the new code can read.
  No effect type carries that, and Effect fibers cannot be serialized
  (RFC 0016, "Current state").

## Current state

Probes on `main` (`b38a8c1`), run through `generateEffectProgram` and the
kernel's `inferSourceAll`. The Effect programs share these declarations:

```lisp
(import "forma:effect" [do bind pure])
(type Employee {:id String :name String})
(type Decision {:approved Bool :by String})
(type Receipt {:payroll-id String})
(error Rejected {:id String})
(service Review (: await-review (-> Employee (Effect Decision))))
(service Payroll (: write (-> Employee Decision (Effect Receipt [Rejected] []))))
```

| Program | Result |
| --- | --- |
| `complete-onboarding` as `(do (bind review (Review.await-review employee)) (Payroll.write employee review))` with signature `(-> Employee (Effect Receipt [Rejected] [Review.await-review Payroll.write]))` | Accepted; generates `(employee: Employee): Effect.Effect<Receipt, Rejected, Payroll \| Review>` |
| The same without a signature | `mechanics/top-level-form`: "define complete-onboarding needs a (: complete-onboarding Type) signature in an Effect program." |
| The same with `[Review.await-review]` only | `mechanics/undeclared-requirement`: "Operation complete-onboarding requires Payroll.write, but its signature declares only [Review.await-review]." |
| Direct style: `(let [review (Review.await-review employee)] (Payroll.write employee review))` | `mechanics/let-effect`: "let binds values; use do! to run Review.await-review and bind its result." |
| Test layers `ReviewFixture` and `PayrollMemory`, merged and `provide`d around the call | Accepted; generates `onboardInTest = (employee: Employee): Effect.Effect<Receipt, Rejected>` |
| `(Effect a [e] [r])` in an operation signature (RFC 0023) | `mechanics/unknown-type` for `a`, `mechanics/unknown-error` for `e`, `mechanics/unknown-requirement` for `r` |
| `(perform Review.await-review employee)` | `mechanics/unbound-name: Unknown function perform.` |
| Kernel: `(fn [f x] (f (f x)))` | `(t1 -{e3}-> t1) -> t1 -{e3}-> t1` |
| Kernel: Ben's body with `await-review` and `write-payroll` as parameters | `(t2 -{e5}-> t3) -> (t2 -{e5}-> t3 -{e5}-> t5) -> t2 -{e5}-> t5` |
| Kernel: `(: f (-> Int Int ! [Review]))` | `Expected type syntax` |
| Kernel: `(: f (->! Int Int))` | "Legacy algebraic effect function type '->!' is no longer supported; use (Effect Success [Errors...] [Requirements...])." |

### The kernel checker's rows

- `TFun` and `TVariadic` carry an optional `ERow` (`EEmpty`, `EVar`,
  `EExtend`) in `packages/ts/src/type/types.ts`. Schemes quantify `evars`
  alongside type and record-row variables.
- Every application emits the callee's row into an ambient row
  (`emitAmbientEffect`, `type/effect-helpers.ts`), and `openAmbientEffect`
  opens a closed row with a fresh tail before unifying it, so a function with
  fewer effects can be used where more are expected.
- `unifyERows` in `type/unify.ts` compares label sets, not label order
  (`flattenERow` collects a `Set`; `buildERow` sorts), with one tail
  variable per row.
- **No surface source of labels.** `->!` and `perform` report their legacy
  errors (`type/type-parser.ts`, `type/lower-core.ts`).
  `attachEffectToOperationType` (`type/infer-core.ts`) and
  `removeHandledEffects` (`type/effect-helpers.ts`) have no callers outside
  themselves. Host builtins carry an effect name
  (`handler: {kind: "host-effect", effect}`), but their type schemes become
  rowless kernel types (`engine/operations.ts`); the name is used only at
  run time, on `HostCall.effect`. The one labeled row the kernel builds is the
  authority manifest (`type/authority.ts`), which is computed by an abstract
  walk and checked against grants.

So the kernel already has Koka-shaped inference over rows with set semantics.
It has no way to declare an operation and no way to handle one.

### The Effect checker's sets

- `MType`'s `effect` variant (`mechanics/types.ts`) holds `errors` and
  `requirements` as `Provenance` maps from names to spans. Error entries are
  declared errors; requirement entries are a service, a `Service.method`, or
  `Scope`. Sets are closed: `applySubstitution` does not touch them.
- Every top-level definition needs a signature, and `let` cannot run an
  effect. The checker infers a body's sets and checks them against the
  signature, reporting `undeclared-error` and `undeclared-requirement` at the
  call that introduced the entry.
- `provide` removes the requirements a layer provides; tagged `catch`
  removes the handled errors. Combinators pass sets through by hand in
  `effectInner`.
- Requirements are tracked per method, but the generated `R` names services:
  `[Review.await-review Payroll.write]` prints as `Payroll | Review`.

### The kernel's runtime already resumes once

A kernel host call pauses the evaluation as a `HostCall` and waits for one
`resumeHostCall` (`packages/host/src/ts-host.ts`, through `Effect.callback`).
A host answers with a value (resume once) or a failure (no resume). That is
the operational shape of a handler that resumes at most once, implemented
today for host builtins only.

### History

PR #25 replaced `define-effect`, `perform`, `handle`, and `->!` with
`Effect<A, E, R>` over closed sets, recording that "open effect rows, dynamic
handlers, and resumable continuations are not a live implementation lane."
RFC 0023 reopened only the first, inside signatures. This RFC deliberately
reopens declared operations and handlers, and keeps continuations out:
handlers resume at most once, and no continuation is ever a value.

## Proposal

### 1. Declaring operations

An `effect` declaration names a group of operations and gives each a
signature. The signature is the operation's value type; the effect it adds
is its own label.

```lisp
(effect Review
  (: await-review (-> Employee Decision)))

(effect Payroll
  (: write-payroll (-> Employee Decision Receipt))
  (: void-payroll  (-> Receipt Unit)))
```

- An operation's type is `(-> Employee Decision ! [Review])`: calling it
  performs `Review`.
- Operation signatures may be generic, with RFC 0023 stage 1's rules:
  lowercase type variables, rank-one, instantiated at each call.
- An operation may itself require other effects; `(: lookup (-> Id Row ! [Db]))`
  says every handler of this operation may use `Db`. This is how a durable or
  live handler's own needs show up in the handled row (section 4).
- Operations are in scope by their short name and qualified by their effect,
  `Review.await-review`, matching service members today.

An `error` declaration is an effect with one operation that never resumes:

```lisp
(error Rejected {:id String})
;; (fail (Rejected {...})) : (-> ... Nothing ! [Rejected])
```

So one row carries both kinds of label. `catch` is a handler whose clauses
never resume. The split into `E` and `R` happens only when lowering
(section 5).

### 2. Inference through ordinary calls

A function's row is the union of the rows of what it calls, inferred by the
kernel's existing row unification. Direct-style `let`, `if`, `match`, and
function application sequence effects in evaluation order, as
[RFC 0003](./0003-direct-style-effects.md) proposed:

```lisp
(define complete-onboarding [employee]
  (let [review (await-review employee)]
    (if (get review :approved)
      (write-payroll employee review)
      (fail (Rejected {:id (get employee :id)})))))
;; inferred: (-> Employee Receipt ! [Payroll Rejected Review])
```

Higher-order functions are row-polymorphic without annotation, as the kernel
already infers for `(fn [f x] (f (f x)))`. A wrapper's own effects join its
callback's:

```lisp
(define with-audit [f x]
  (let [v (f x)]
    (audit-log "called")
    v))
;; inferred: (-> (-> a b ! [e]) a b ! [Audit e])
```

`with-audit` called with `write-payroll` performs `[Audit Payroll]`; called
with a pure function it performs `[Audit]`. This is RFC 0023's motivating
case, solved by inference instead of a signature.

**Signature notation.** A row follows `!` at the end of an arrow:

```lisp
(: complete-onboarding (-> Employee Receipt ! [Payroll Rejected Review]))
(: with-audit (-> (-> a b ! [e]) a b ! [Audit e]))
```

Lowercase names in a row are row variables, by the rule RFC 0023 stage 2
already adopted for set variables (implicit by case). A row has at most one
variable, as kernel rows do. A combinator over two callbacks, such as
`race`, gives both the same variable: each argument's closed row is opened
with a fresh tail before unification, so the variable is solved to the union
of both callbacks' rows, the result RFC 0023 gets from `[e1 e2]`. An arrow
with no `!` is pure in a signature and inferred in an unannotated
definition.

`(Effect A [E...] [R...])` stays valid as the type of a first-class effect
value, so existing Effect programs and goldens do not change. A function
returning `(Effect B [E] [R])` is equivalent to one whose arrow ends in
`B ! [E R]`.

**Closed boundaries.** RFC 0023's rule stays: a row may be open inside a
module, but every exported definition, generated operation, artifact entry,
and host entry point has a closed row after instantiation. The closed row at
an entry point is exactly what the host must handle, and it is the authority
manifest of RFC 0012 (`type/authority.ts` already turns a row into one).

**Granularity.** A row label is an effect name. Diagnostics and the authority
manifest keep per-operation provenance under each label, as the Effect
checker's `Provenance` maps do today, so a grant can still name
`Payroll.write-payroll`.

### 3. Handlers

`handle` runs an expression with handlers for some of its effects:

```lisp
(handle body
  (Label (operation [params ...] clause-body) ...)
  ...
  :return [x] result-body)          ; optional
```

**Typing.** If `body : a ! [L1 ... Ln | ρ]` and the clauses for `Li` have
rows `ρi`, then the `handle` expression has type `b ! [ρ ρ1 ... ρn]`, where
`b` is `a` without a `:return` clause or the `:return` body's type with it.
A clause body has the operation's result type when it resumes. This is the
row-tail form of discharge: no `without` operator is needed, because the
handled labels are exactly those removed from the body's row.

**Resume at most once.** A clause does one of two things:

- **Resume once:** the clause body's value becomes the result of the
  operation call, and the body continues. This is the default and covers
  fixtures, recorders, and live integrations.
- **Abort:** `(abort value)` in a clause ends the whole `handle` expression
  with `value` (of type `b`) without resuming. Finalizers in the body run,
  as they do for a typed failure. `catch` clauses always abort.

No clause can resume twice, store the continuation, or run code after the
resumed computation returns. The checker enforces this syntactically: there
is no `resume` value in stage 1. A general one-shot `resume` in non-tail
position (Koka's `ctl` with linear use) is a later stage and a decision
below.

**Handlers are values that capture lexical scope**, as RFC 0014's
`implement` inside `provide` already proposes. A clause may refer to
variables in scope at the `handle`, which is how a test builds a recorder:

```lisp
(test "onboarding writes one payroll record"
  (let [writes (ref-make [])
        receipt (handle (complete-onboarding alice)
                  (Review (await-review [e] {:approved true :by "fixture"}))
                  (Payroll (write-payroll [e r]
                             (ref-update writes (fn [w] (conj w (get e :id))))
                             {:payroll-id "test-1"})))]
    (expect (= (ref-get writes) ["alice"]))))
```

The `ref` operations are themselves an effect (`State`) that the test
runner handles. Whether the first version has a handler-local state form
instead is left open.

**Unhandled operations are type errors where a row must be closed.** A test
whose `handle` omits `Payroll` has residual row `[Payroll]`; a test body must
have an empty row (RFC 0015), so it is rejected at the `handle`, naming
`write-payroll` and the call that introduced it.

### 4. Hosts handle the residual row

An entry point's closed row lists what the host must handle. A host supplies
a handler per label, written in the host language:

- **In-process (Effect TypeScript).** A label is a `Context.Service`; a
  handler is a `Layer` or `Effect.provideService`. This is what `service`
  and `layer` generate today.
- **Kernel evaluation.** A label is a host effect; each operation call is a
  `HostCall` resumed once, as host builtins are today.
- **Durable.** A label whose handler may suspend the routine across process
  lifetimes. The routine needs a plan (section 6), and only the host may
  handle a durable label: a `handle` inside the routine for a durable effect
  is `plan/local-durable-handler` in stage 1, because the handler itself would
  need to be restored.

### 5. Lowering a row to Effect's `E` and `R`

Each label lowers by its declaration:

| Row content | Effect TypeScript |
| --- | --- |
| A label declared by `error` | A member of `E` (the tagged error class, as today) |
| A label declared by `effect` | A member of `R`: one `Context.Service` per effect, one method per operation returning `Effect.Effect<Result, OpErrors, never>` |
| `Scope` | `R`, as today |
| A row variable `ρ` | Two type parameters, `Eρ` and `Rρ` |
| `handle` of effect labels | `Effect.provide(layer)` or `Effect.provideService`; the type is `Exclude<R, L>` |
| `catch` of error labels | `Effect.catchTag`; the type is `Exclude<E, X>` |
| `(abort v)` in a clause | `Effect.fail(new Abort_k(v))` with a private tag, caught by `Effect.catchTag("Abort_k", ...)` at the `handle`; the tag never escapes |

Ben's example lowers to the code the Effect checker generates today for the
service spelling (first probe above). There `Payroll.write` can fail with
`Rejected`; in the summary's declarations it cannot, and `E` is `never`.

```ts
export const completeOnboarding = (
  employee: Employee,
): Effect.Effect<Receipt, Rejected, Payroll | Review> =>
  Effect.gen(function* () {
    const payroll = yield* Payroll;
    const review = yield* Review;
    const review2 = yield* review.awaitReview(employee);
    return yield* payroll.write(employee, review2);
  });
```

`with-audit` lowers to RFC 0023's target, with one row variable split in two:

```ts
export const withAudit = <A, B, E, R>(
  f: (a: A) => Effect.Effect<B, E, R>,
  x: A,
): Effect.Effect<B, E, R | Audit> => ...
```

Two rules make the lowering total. A resuming clause becomes a service
method body; an operation with no failing clause has `never` errors. An
aborting clause is a failure inside the handled region only, so `E` outside
the `handle` is unchanged. Because no clause captures a continuation, every
handler is an ordinary function from arguments to `Effect`, which is why this
lowers to Effect, Rust (`Result` and `?`), and Go (`error`) alike.

### 6. Durable plans

A plan is a compiled, Schema-defined description of one routine: its steps,
the state live at each step, and how to continue. A host that must resume a
routine across restarts and deploys runs the plan; every other consumer
ignores it.

**Which routines get a plan.** An effect declared `:durable` may suspend:

```lisp
(effect Review :durable
  (: await-review (-> Employee Decision)))
```

A function whose closed row contains a durable label and that is exported as
an entry point is compiled to Effect TypeScript, as any function is, and also
to a plan. A function with a durable label that is not an entry point is
inlined into its caller's plan.

**Steps.** Within a plan routine, every operation call is a step, durable or
not. A durable step may suspend; an ordinary step runs and its result is
journaled, so a crash after `write-payroll` does not repeat it. Code between
steps is pure and reruns from the checkpoint. A step's journal key is the run
id plus its step-occurrence id, which is also the idempotency key handed to
the handler, as RFC 0016's durability section requires.

**Stable step identities.** A step's id is `routine/name`:

- When an operation occurs once in a routine, `name` defaults to the
  operation's qualified name: `complete-onboarding/Review.await-review`.
- When it occurs more than once, each occurrence needs an authored name,
  `(step "second-review" (await-review employee))`; otherwise
  `plan/ambiguous-step` at each occurrence.
- Inside `for-each` over a list, the occurrence id appends the element's
  index path: `complete-onboarding/Review.await-review[2]`.
- Ids never depend on line numbers, spans, or gensyms.

**Checkpoints and serializable state.** At each step the compiler records the
locals that are live after the step, using the lowered program's local
identities and use counts from RFC 0022. Each live local must have a Schema:
records, tagged unions, brands, `List`, `Map`, `Option`, and declared errors
already generate one (`effect-schema.ts`). A live function, `Ref`, `Fiber`,
`Stream`, or `Scope` is `plan/unserializable-state` at its binding, naming the
step it is live across. The operation's arguments and result must also have
Schemas, since they cross to the host.

**Representation.** For `complete-onboarding`:

```text
plan complete-onboarding  version sha256:…
  input   {employee: Employee}
  step complete-onboarding/Review.await-review       durable
    call  Review.await-review(employee)       result Decision
    state {employee: Employee}
  step complete-onboarding/Payroll.write-payroll
    call  Payroll.write-payroll(employee, review)  result Receipt
    state {}
  return  Receipt
```

The plan is data defined by Schema and stored as a canonical JSON artifact
next to the module's other artifacts. Its version is the SHA-256 of that
canonical form. Each step also names a segment: a generated Effect function
from the checkpoint state and the step's decoded result to the next step
request or the final value. The plan says where to pause; Effect still runs
every segment.

**Inspection and simulation.** Because the plan is data, a tool can list
where a routine waits and on what, and a simulator can drive it step by step
with fixture handlers, suspending and resuming through serialized state.
Simulation checks the same thing a durable host relies on: that state
round-trips through its Schema at every checkpoint.

**Resuming after a deploy.** A paused run stores the plan version, the step
occurrence it waits at, and its encoded state. When a new plan is installed,
a check compares it with every version that has paused runs:

- the step id still exists;
- the old state decodes under the new state Schema, using RFC 0027's
  directional compatibility; and
- the operation's argument and result Schemas are compatible.

Otherwise the check reports `plan/incompatible-resume` for that step, and
the host either keeps the old version running until its paused runs drain or
refuses the deploy (a decision below).

**Stage 1 restrictions.** Steps may not occur inside a lambda passed to an
unknown higher-order function, inside recursion, or inside `fork`, `race`,
or `all`. Each is `plan/unsupported-step` at the call. `for-each` with a
literal callback is supported.

## How this changes existing work

### RFC 0023: effect-polymorphic signatures

RFC 0023 is proposed on `main` but not implemented there. Its section 9 keeps
the kernel's latent rows out deliberately: "Merging the kernel's `ERow` with
the Effect checker's sets belongs to RFC 0004," and its alternatives reject
"Koka-style row unification" and "Reusing the kernel's `ERow` in the Effect
checker now."

- **Kept:** stage 1 (generic operations) unchanged. Implicit-by-case
  variables, as decided on 2026-11-18. Fresh instantiation per call, rigid
  variables in a checked body, closed rows at boundaries, provenance on every
  entry, the generic `<A, E, R>` TypeScript lowering, and the
  `effect-polymorphic-wrapper` and `effect-polymorphic-union` conformance
  cases as acceptance tests.
- **Replaced:** two variable kinds (`e` for errors, `r` for requirements)
  become one row variable, split only when lowering. The lower-bound set
  solver becomes the kernel's row unification once the checkers converge.
  Stage 4's `without` is replaced by handler typing: a handler removes its
  labels from the body's row tail. Stage 5 (kernel parity) reverses
  direction: the kernel is where rows live, and the Effect checker converges
  to it.
- **Reordered:** stages 3 (combinators as signatures) and 4 wait for this
  RFC's stage 3 and are rewritten in row notation. Stage 6 (other hosts)
  becomes this RFC's lowering per host.

### RFC 0023 stages 1 and 2 as implemented (not on GitHub)

Stages 1 and 2 are reported as two local commits on
`wp/ep12-effect-polymorphism` (ask 0036; Amp thread
`T-01a1ddc8-27d8-731a-98c8-72fdd4167ee1`). That thread could not be opened
while this draft was written, so this section compares against the scope in
ask 0036 and RFC 0023, not against the code:

- **Keep them and land them.** They are confined to `mechanics/`, change no
  existing golden, and their user-visible results (one wrapper, precise sets
  per caller, generic `E`/`R` in TypeScript) are the results this RFC wants.
  Stage 2's set variables become the Effect checker's spelling of a row
  variable for programs that still use `(Effect A [E] [R])`.
- **Revisit before building on them:** stage 2's IR fields
  (`errorVariables`, `requirementVariables` on `EffectTypeNode`) record two
  kinds. A row-based IR has one `rowVariable` and derives both. Keeping the
  two fields as a derived view avoids an artifact break.

### The kernel's latent effect rows

They become the representation of effects. `effect` declarations are the
missing source of labels: an operation's scheme gets
`EExtend(label, EEmpty)`, the shape `attachEffectToOperationType` already
builds. `handle` uses `removeHandledEffects` for its result row, with
the row-tail rule in section 3. Signatures gain the `!` notation in
`type/type-parser.ts`, and display changes from `-{e5}->` to `! [e5]`. The
unifier needs no new rule: it already treats rows as label sets with one
tail. Labels must carry declaration identity, not just a string, so two
modules' `Review` effects do not unify.

### The Effect checker's error and requirement sets

They become the closed instance of a row: `errors` are the row's `error`
labels and `requirements` its `effect` labels, each with the same
`Provenance` maps. Every current diagnostic keeps its code and span. Until
the checkers converge, the Effect checker reads `effect` declarations as
services (an effect is a service whose layer is a handler), keeps requiring
signatures, and gains direct-style `let` over effects by elaborating it to
`do!` steps. `mechanics/let-effect` then reports only lets it cannot sequence.

### RFC 0004 and the T5 proposal (one checker)

T5 recommends converging one boundary at a time and rejects replacing either
solver wholesale, on a measured matrix (2 accept/accept, 63 accept/reject,
13 reject/accept, 71 reject/reject over 149 fixtures). This RFC keeps that
method and gives the effect family a target: **the merged checker infers
effects with the kernel's rows, extended with the Effect checker's nominal
errors, services, and provenance.** It is not the Effect checker extended
with inference, because only the kernel infers unannotated definitions.
Concretely, T5's stage 4 ("solver retirement, one construct family at a
time") takes effects as a family, after this RFC's stage 1 gives the kernel
labels and handlers. The Effect checker stays authoritative for programs it
accepts until that family's contracts pass in both.

### `forma:effect`: `do`, `bind`, `pure`, `service`, `error`

RFC 0029's thesis, that Effect's surface is a library over a small core,
holds, and this RFC extends it.

- **`do`/`bind`/`pure`** stay as the explicit Effect spelling, for code that
  handles an effect as a first-class value (passing it to `retry` or
  `timeout`, for instance). Direct style becomes the recommended spelling
  for sequencing: `let` runs operations in order, and both lower to the same
  `do!`. The 14-case byte-identical gate from PR #178 is extended to the
  direct-style rewrite.
- **`service`/`error`** stay. `effect` is added to the same library and,
  for the Effect TypeScript target, lowers to `__service` the way `service`
  does, with each operation's result wrapped in `Effect`. `service` becomes
  the name for an effect handled only in-process; whether to keep both
  spellings is a decision below.
- **Handlers** (`handle`, clauses, `abort`) need checker rules and are not
  library macros, though their lowering to `provide` and `catch` is.

### The RFC 0029 draft (not in `docs/rfcs`)

The draft is a document attached to thread
`T-01a1ddc8-27d8-731a-98c8-72fdd4167ee1`, which could not be read while this
draft was written. What is known comes from PRs #178 and #179: stage 1 moved
`do`/`bind`/`pure` into `forma:effect`, stage 2 moved `service`/`error`, and
`type`/`class` as library forms and the ~15 engine sites that recognize
`service` by name were left for later. Against that:

- **Kept:** the library-first direction, macro decline, `syntax-error` with
  author spans, and the byte-identical golden gate.
- **Reordered:** `effect` declarations (this RFC's stage 1) come before
  `type`/`class` as library forms, which no consumer needs yet.
- **Unknown:** any later stage in the draft that adds operations, handlers,
  or effect syntax of its own must be reconciled with this RFC before either
  lands. The draft should be saved under `docs/rfcs/0029-…` with a name that
  does not collide with closed PR #158.

### RFC 0022: effect hosts

- The lowered program gains `Handle`, `Abort`, and `OperationCall` nodes,
  and operations carry a row instead of separate error and requirement sets.
  Each host profile states how it splits a row: TypeScript into `E` and `R`,
  Rust into a `Result` error enum and trait bounds, Go into `error` and an
  interface.
- At-most-once handlers are why every host can run this: a clause is an
  ordinary function returning the host's effect type, and an abort is an
  early return. No host needs continuations.
- The profile table's "Effect polymorphism" row becomes "Row variables", with
  the same entries.
- Plans are not a host printer. They are a second artifact computed from the
  same lowered program, whose local identities and use counts give each
  checkpoint's live state.

## Diagnostics

| Code | Reported when |
| --- | --- |
| `type/unhandled-effect` | A row that must be closed (test body, entry point with no host handler, exported definition) still contains a label; names the operations and the calls that introduced them |
| `type/handler-clause` | A clause names an operation the effect does not declare, has the wrong arity, or returns the wrong type |
| `type/row-variable-kind` | A row variable is used as a value type, or a value type variable in a row |
| `plan/ambiguous-step` | An operation occurs more than once in a plan routine without authored step names |
| `plan/unserializable-state` | A value without a Schema is live across a step |
| `plan/local-durable-handler` | A routine handles a durable effect itself |
| `plan/unsupported-step` | A step occurs where stage 1 plans cannot place a checkpoint |
| `plan/incompatible-resume` | A new plan cannot resume runs paused under an installed version |

## Non-goals

- Multi-shot handlers, backtracking, generators built from handlers, and
  continuations as values.
- `mask` and duplicate labels in a row. Rows are sets; a nested handler for
  the same label handles the innermost occurrence, and there is no way to
  skip it.
- Effect polymorphism in kernel built-ins such as `map`, beyond what
  inference gives user functions; RFC 0003 and RFC 0018 own those schemes.
- A general workflow engine. A plan describes one routine for a host; the
  durable runtime, its storage, and its scheduling belong to the host.

## Alternatives considered

- **Continue RFC 0023 to stage 6 without rows.** Precise sets, but every
  wrapper and handler pattern needs a signature, inference stays in the
  kernel only, and `without` reimplements handler typing in a second
  notation.
- **Separate error and requirement rows.** Mirrors `E` and `R` directly, but
  doubles every variable. Koka keeps exceptions in the same row as every
  other effect, and the split is mechanical at lowering.
- **Durability by replay** (RFC 0016's journal, Temporal-style). Needs no
  serialized state, but resumes only on the same code: a deploy that changes
  any code before the wait diverges the replay. Explicit checkpoints with
  Schema state survive any change that keeps the step id and a compatible
  state Schema. Replay remains useful for debugging.
- **Durability as a property of the row.** A row says what may happen, not
  where a run stopped, so it cannot carry state or a resume point.
- **Authored plans.** The earlier suggestion. Plans are easier to inspect but
  harder to write and test than ordinary functions with handlers, and two
  authoring models would diverge.
- **Lower plans to Effect's workflow modules.** A host may do so, but the
  plan stays the contract: Effect's workflow APIs are unstable in the 4.1.1
  dependency (RFC 0016).

## Implementation stages and validation

1. **Kernel operations and handlers.** `effect` declarations, row labels with
   declaration identity, the `!` signature notation and display, `handle`
   with resuming and aborting clauses, and kernel evaluation through host
   calls. Validation: `complete-onboarding` infers
   `(-> Employee Receipt ! [Payroll Review])` with no signature; the test
   handler empties the row; omitting a clause reports
   `type/unhandled-effect` at the `handle`; `with-audit` gets different rows
   for different callbacks.
2. **Effect TypeScript lowering.** `effect` through `forma:effect` to
   `__service`, handlers to layers and `provideService`, aborts to private
   tags, rows to `E` and `R`, row variables to type parameters. Validation:
   every existing Effect golden is byte-identical; RFC 0023's two
   polymorphic cases produce the same TypeScript from row-typed sources;
   a new conformance case runs `complete-onboarding` under fixture and
   recorder handlers.
3. **Effect checker convergence.** Direct-style `let` over effects in the
   Effect checker, `effect` declarations read as services, and the effect
   family of T5's stage 4. Validation: T5's matrix, rerun, moves only in the
   effect family and every original rejection still rejects.
4. **Plans.** Step identities, checkpoint liveness, state Schemas, the plan
   artifact, its version hash, and a simulator. Validation: the plan for
   `complete-onboarding` round-trips its state through Schema at each step;
   each `plan/*` diagnostic is pinned at its span.
5. **Durable host contract.** Resume checks across plan versions and the
   journal and idempotency-key contract. Validation, per RFC 0016: a
   persistent charge, wait, and mail routine killed and restarted on both
   sides of the provider/journal commit gap, a no-deduplication control, and
   a run paused under one plan version and resumed under the next.
6. **One-shot `resume` in any position.** Only when a consumer needs code
   after resumption that a finalizer cannot express.

`pnpm check` for every stage, with a changeset for stages 1–4.

## Decisions taken

- **One row, inferred by the kernel, as the representation both checkers
  converge on** (Ben, 2026-11-23). Errors and operations share one row,
  split into `E` and `R` only when lowering. This supersedes RFC 0023
  stages 3–6 and its `without`, and makes effects the first family of T5's
  solver retirement. RFC 0023 stages 1–2 land as implemented. Every decision
  below assumes it.

## Decisions still required

1. **Row label granularity:** an effect name (Koka; proposed) or each
   operation, as Effect checker requirements and authority grants are today.
2. **The declaration keyword:** `effect` (proposed; Koka), `ability`
   (Unison), or reusing `service` with operations in it. And whether
   `service` remains a separate spelling for in-process-only effects.
3. **The signature notation:** `(-> A B ! [L e])` (proposed), keyword
   contracts as in RFC 0003 (`:requires`/`:throws`), or `(Effect B [E] [R])`
   everywhere.
4. **Resumption:** stage 1 with resuming and aborting clauses only
   (proposed), or a linear `resume` usable in any position from the start.
5. **Handler-local state** for recorders: a `Ref` handled by the test
   runner (proposed), or a state form on `handle`.
6. **`do`/`bind`:** kept as a peer spelling (proposed) or deprecated in favor
   of direct style once the Effect checker accepts it.
7. **What marks a durable routine:** `:durable` on the effect (proposed) or a
   marker on the routine.
8. **Step names:** derived for single occurrences with authored names when
   ambiguous (proposed), or authored names on every durable step.
9. **Incompatible deploys:** keep old plan versions running until their
   paused runs drain, or refuse the deploy.
10. **Who executes a plan:** a Forma-specified plan interpreter in each host,
    or a lowering to a host's workflow engine with the plan as its contract.

## Related designs

- Koka: [Programming with Row Polymorphic Effect Types](https://arxiv.org/abs/1406.2061)
  and the [Koka book](https://koka-lang.github.io/koka/doc/book.html), for
  rows, inference, handlers, and the `fun`/`ctl` distinction between
  tail-resumptive and general clauses.
- Kyo: `A < S`, a value of `A` with pending effects `S`, embedded in Scala.
  Effect TypeScript's `Effect<A, E, R>` is the TypeScript analogue this RFC
  lowers to.
- Effect and ZIO: typed failures and environment requirements, layers as
  handlers, and finalizer semantics for early exits.
- Unison abilities: handlers over declared operations, written in
  ordinary signatures such as `(a ->{g} b) -> [a] ->{g} [b]`.
- Temporal and Effect's workflow modules: durable execution by replay, the
  alternative to explicit checkpoints above.
