# RFC 0019: Effect-Go, a second Effect host

| | |
| --- | --- |
| Status | Proposed; a prototype exists and is not a supported target |
| Created | 2026-10-27 |
| Scope | A Go port of Effect's semantic core, a Forma → Go generator over the checked mechanics IR, conformance on two hosts, and the semantic decisions that a second host forces |
| Direction | One fiber per goroutine with an opcode interpreter; Go types carry the success type and Forma's checker carries the error and requirement sets; port the core, generate schemas, bind platform libraries |

## Summary

Forma's Effect pipeline already has a host-neutral middle. Source is read,
projected to mechanics IR, and checked; only the last step generates Effect
TypeScript. This RFC proposes a second consumer of the same checked IR that
generates Go for a Go port of Effect's semantics.

The port keeps Effect's *semantics* and drops its scheduler. Effect has a
fiber runtime because JavaScript is single-threaded. Go already has cheap,
preemptively scheduled goroutines, so each fiber is one goroutine that runs an
interpreter over an opcode tree. The runtime adds only what Go lacks: typed
exits with causes, interruption with uninterruptible regions, supervision,
scopes and finalizers, memoized layers, and fiber-local state.

Go's types cannot carry Effect's error channel `E` or requirement channel `R`.
Go has no union types, no type-level set subtraction for `provide`, and no
generic methods. Generated Go therefore has the type `effect.Effect[A]`;
errors are values in a cause and requirements are a runtime context. Forma's
checker already proves both sets closed before generation, so **Forma + an
Effect-Go runtime gives Go programs Effect's type discipline, which neither
Go nor a Go library can provide alone.**

A prototype on this branch runs four existing conformance programs
(`crud-users`, `operational-effects`, `concurrent-workflow`, and
`resource-scope`) as generated Go. Go harnesses make the same assertions as
the TypeScript harnesses. The prototype is described in
[Prototype results](#prototype-results).

The recommendation is to **continue as an experiment with a conformance gate**,
not to adopt Go as a supported target yet. Stage 1 below is the decision
point.

## Motivation

**A concrete consumer.** The [roadmap](../roadmap.md) defers "additional
backends without a concrete consumer and conformance target." This proposal
supplies both. The conformance target is the existing Effect suite in
`conformance/effect-typescript/`, run on a second host with harnesses that
assert identical behaviour. The consumer is a Go service team that wants
Effect's checked errors, requirements, and resource safety without moving
to TypeScript. Whether such a team exists outside this project is the open
question in [Decisions still required](#decisions-still-required). Without
one, this RFC recommends stopping after stage 1.

**The ClojureScript move.** Clojure became portable by keeping one language
and treating each host (JVM, JavaScript) as a platform with its own interop.
Forma can do the same with Effect semantics as the shared core: a typed Lisp
whose first host is Effect-TS and whose second is Effect-Go. The same
programs, checked once, would run on both, and the conformance suite would
measure the differences instead of leaving them to documentation.

**Go supplies the hard part.** The expensive part of Effect-TS is its fiber
scheduler: cooperative yielding, a run queue, and async boundaries. Go's
runtime already schedules, preempts, parks, and wakes goroutines. JVM
libraries show the same shift after Loom: [Ox](https://ox.softwaremill.com/)
builds direct-style structured concurrency on virtual threads without its
own scheduler. A Go port can be small. The prototype runtime is about 2,600
lines of Go.

**Forma supplies what Go cannot.** A Go library can port Effect's runtime,
but its users would still write `Effect[A]` with untracked errors and
requirements. [IBM/fp-go](https://github.com/IBM/fp-go) has the same limit:
its `ReaderIOEither[A]` uses `context.Context` as the environment and Go's
`error` as the failure type. Forma's checker already tracks closed error
sets and per-method requirements such as `Payments.charge`, and rejects
`provide` that leaves a requirement unmet. Generated Go keeps those facts;
the generator writes them into each operation's doc comment, because Go's
type cannot carry them.

## Current state

Implemented on `main`:

- `elaborateEffectProgram` in `packages/ts/src/mechanics/elaborate.ts`
  reads, projects (`artifact.ts`), and checks (`check.ts`) an Effect program.
  The checker records per-node value and effect types, resolved calls, match
  shapes, record targets, and layer context needs in `CheckInfo`.
- `generateMechanicsEffectTypeScriptModule` (`effect-typescript.ts`) is the
  only consumer of that checked IR. It targets `effect@4.0.3`.
- `conformance/effect-typescript/` pins positive Effect programs with exact
  TypeScript goldens and harnesses, plus negative cases with exact
  diagnostics. Thirteen positive cases use the core Effect generator; the
  Elm, email, and HTTP API cases use their own generators. The
  [language reference](../effect/reference.md) and [trade-offs](../effect.md)
  describe the supported subset.
- Isolated prototype generators exist for [Elm-style apps](../elm.md) and
  [email rules](../email.md), each with its own package entry point.

Added on this branch, as a prototype:

- `packages/ts/src/mechanics/effect-go.ts`, exposed as the isolated entry point
  `@formalang/ts/effect-go`. It generates Go from the checked IR and reports
  unsupported constructs as `effect-go/unsupported`.
- `prototypes/effect-go/`, a separate Go module: the runtime (`effect/`),
  value helpers (`forma/`), generated goldens with Go harnesses
  (`conformance/`), benchmarks (`bench/`), and an end-to-end demo
  (`pnpm effect-go:demo`). It is not part of `pnpm check`.
- `packages/ts/test/effect-go.test.ts`, which pins the generated Go as
  goldens in `pnpm check`. It does not need a Go toolchain.

Not implemented: Go `extern` blocks, decoders, streams, tagged unions,
platform bindings, and any supported or published Go package.

## Proposal

### Pipeline

```
program.lisp ─ read ─ project ─ check ─┬─ Effect TypeScript ── effect@4 (Node, browsers)
                                       └─ Go ─────────────── effect-go runtime (goroutines)
```

Both generators read the same `CheckInfo`. The Go generator does not
re-check: it throws on any construct it cannot translate and never emits a
placeholder, as the TypeScript generator does.

### Runtime architecture

**Effects are opcode trees.** `Effect[A]` wraps an untyped node. The
interpreter is monomorphic over `any` values, and the typed API wraps and
unwraps at the edges. Hot opcodes such as `flatMap`, `map`, `sync`, and
`gen` are generic structs that implement small interfaces, so the typed
API allocates no wrapper closure per operation. An effect is a description:
running it twice runs it twice. That property makes `retry` and `repeat`
correct.

**One fiber per goroutine.** `Fork` starts a goroutine that runs the run loop
to completion. Go schedules it, preempts it in CPU loops, and parks it on
channels and timers. The runtime has no run queue, no yielding, and no
`async` boundary. A blocking Go call simply blocks that fiber's goroutine.

**Interruption follows Effect 4's rules** (`internal/effect.ts` and
`internal/core.ts` in effect@4.0.3):

- An interrupt request is delivered at the fiber's next operation while the
  fiber is interruptible, or at once when it is parked in an interruptible
  wait (sleep, join, deferred, queue).
- While an interruption propagates, recovery handlers (`catch`,
  `matchCause`) are skipped and typed failures are dropped from the cause.
- Finalizers (`onExit`, `ensuring`, scope close, release) run
  uninterruptibly.
- Leaving an uninterruptible region re-delivers a pending interruption.
- `Interrupt` from inside a fiber is an ordinary interrupt cause, as in
  Effect 4. It does not mark the fiber interrupted.

**Supervision.** `Fork` creates a child of the current fiber (Effect's
`forkChild`). When a fiber completes, it interrupts its remaining children
and waits for them, including their finalizers, before publishing its exit.
`ForkDaemon` opts out. `Race`, `Timeout`, and concurrent `ForEach` interrupt
and await their losers before they return.

**`Effect.gen` without generators.** `Gen(func(f *Fiber) A)` runs a body on
the fiber's goroutine. `Await(f, e)` runs a sub-effect synchronously, in a
nested run loop, and returns its value. Every `Await` is an interruption
point. Plain Go code between `Await`s is not, just as code between `yield*`s
is not. Go has no goroutine-local storage, so the fiber is passed
explicitly.

**Failure propagation: panic inside a body, values everywhere else.** This
was the main design choice. A failing `Await` panics with a private signal.
The enclosing `Gen` recovers it and its effect fails with the same cause.
This matches `yield*`: a failure abandons the rest of the generator, and
deferred calls run as `finally` blocks do. The alternatives:

| | `Await` panics (chosen) | `Await` returns `(A, error)` |
| --- | --- | --- |
| Generated code | `x := effect.Await(f, e)`; one line per bind | `if err != nil { return zero, err }` after every bind |
| Semantics | Abandons the body like `yield*`; defects and interruptions cannot be swallowed | A body can drop an interruption by ignoring `err` |
| Cost on success | None | A branch per bind |
| Cost on failure | A Go panic and recover (measured below) | A return |
| Hand-written Go | Use `Try`, which returns typed failures as `error` and still unwinds on defects and interruptions | Native |

Generated code uses `Await`. Hand-written Go, such as harnesses and
adapters, can use `Try`. The panic never crosses a goroutine and never
escapes the runtime.

**Panics are defects.** An unrecovered panic on any goroutine kills the
process. Every call into user code (`sync` thunks, continuations, handlers,
finalizers, `Gen` bodies) recovers panics as `Die` with the goroutine stack,
and every fiber goroutine has an outer recover boundary.

**Exit and Cause.** `Exit[A]` is a value or a `*Cause`. Effect 4 represents a
cause as a flat list of reasons (`Fail`, `Die`, `Interrupt`) rather than
Effect 3's tree with `Sequential` and `Parallel` nodes. The prototype
follows 4.0.3, the version Forma generates against. Reasons keep their order,
and combinations such as a body failure followed by a finalizer failure
append. This is the first example of [tracking upstream](#tracking-upstream-effect).

**Context, layers, and scopes.** `Tag[S]` keys a service in an immutable
`Context` stored in a fiber-local reference. `Provide(e, layer)` builds the
layer with a fresh memo map, so a layer referenced twice in a graph is built
once. It runs `e` with the services and closes the layer's `Scope` when `e`
exits, on success, failure, or interruption. `Scoped`, `AcquireRelease`,
`AddFinalizer`, and `AcquireUseRelease` follow Effect. `AcquireRelease`
acquires uninterruptibly and releases with the services captured at
acquisition. A missing service is a defect, which the checker makes
unreachable in generated code.

**Fiber-local state.** `FiberRef[A]` is copy-on-write per fiber. A fork
inherits its parent's values, and `Locally` restores the previous value on
exit. The current context, clock, random source, and logger are fiber refs.

**Time.** `Sleep`, `Timeout`, and schedules read the fiber's `Clock`.
`TestClock` follows Effect's API: time moves only on `Adjust`, which wakes
due sleepers in deadline order. Go 1.25's `testing/synctest` supplies what
Effect's `TestClock` has to emulate: inside a bubble, the *live* clock runs
on virtual time and `synctest.Wait` blocks until every goroutine is
parked. The prototype's clock tests use both.

**Cancellation reaches Go code through `context.Context`.** `Fiber.Context()`
is cancelled when the fiber is interrupted, and `RunExit(ctx, e)` interrupts
the root fiber when `ctx` is cancelled. A blocking foreign call can be bound
in two ways:

- `Blocking(func(ctx) (A, error))` runs on the fiber's goroutine. A call that
  honours `ctx` returns early. A call that ignores it delays the interruption
  until it returns. Inside an uninterruptible region the call gets an
  uncancelled context.
- `Detached(func(ctx) (A, error))` runs on a helper goroutine. On
  interruption the fiber stops waiting at once and abandons the call. This
  matches how Effect abandons a pending promise, at the cost of a goroutine
  that can outlive the fiber.

**Also ported:** `Schedule` (`Recurs`, `Spaced`, `Exponential`, `Both`,
`Either`) with `Retry` and `Repeat`, `Race`, `RaceAll`, `RaceFirst`,
`Timeout`, `TimeoutOption`, `ForEach` and `All` with bounded concurrency,
`Ref`, `Deferred`, a bounded `Queue`, `Semaphore`, `PubSub`, `Log`, and a
seeded `Random`.

### Type mapping

| Forma | Effect TypeScript | Go |
| --- | --- | --- |
| `String` | `string` (UTF-16) | `string` (UTF-8), with JavaScript-compatible helpers |
| `Int` | `number`, checked to ±(2^53 − 1) | `int64`, checked to ±(2^53 − 1) |
| `Float` | `number` | `float64` |
| `Bool` / `Unit` | `boolean` / `void` | `bool` / `effect.Unit` (`struct{}`) |
| `Duration` | `Duration.Duration` | `time.Duration` |
| `(Brand String)` | `Schema.brand` | a defined type: `type UserId string` |
| `(Union :admin :member)` | `Schema.Literals` | `type Role string` plus constants |
| `{:id UserId ...}` schema | `Schema.Struct` | a struct type; optional fields are `effect.Option[T]` |
| an undeclared record shape | an object type | a hoisted unexported struct (`partsRecord`) |
| `(error E {...})` | `Schema.TaggedError` class | a struct implementing `error` and `Tag()` |
| `(List T)` | `ReadonlyArray<T>` | `[]T` |
| `(Map String V)` | an object record | `forma.Map[V]`: immutable, JavaScript key order |
| `(Tuple A B)` | `readonly [A, B]` | `effect.Tuple2[A, B]` |
| `(Option T)` | `Option.Option<T>` | `effect.Option[T]` |
| `(Effect A [E...] [R...])` | `Effect.Effect<A, E, R>` | `effect.Effect[A]`; E and R in the doc comment |
| `(-> A B)` | `(a: A) => B` | `func(A) B` |
| `(Ref T)` / `(Fiber A E)` | `Ref.Ref<T>` / `Fiber.Fiber<A, E>` | `*effect.Ref[T]` / `*effect.Handle[A]` |
| `(service S (: m ...))` | `Context.Service` class | `type S struct { M func(...) effect.Effect[...] }` plus `STag` |
| `(layer L :provides S ...)` | `Layer.Layer<S, E, R>` | `*effect.Layer` |
| tagged union | `Schema.Union` of tagged structs | proposed: a sealed interface (unexported marker method) with one struct per tag |

Operations become functions returning `effect.Gen(...)`. Services become
structs of functions, the shape of `Service.of({...})`, so a test double is a
struct literal. Catching by tag is `effect.CatchTag(eff, func(e UserNotFound) ...)`;
Go infers the error type from the handler, and `errors.As` performs the tag
test. Go would still compile a handler for an error the effect cannot raise;
Forma's checker rejects it (`reject-impossible-catch`).

### Ported, generated, and bound

| Ported to Go (the runtime) | Generated per program | Bound per host (`extern`) |
| --- | --- | --- |
| Effect opcodes, interpreter, `Gen`/`Await` | schema types, brands, enums | `net/http` clients and servers |
| fibers, `Exit`/`Cause`, interruption, supervision | error types with `Error()` and `Tag()` | `database/sql` |
| `Scope`, finalizers, acquire/release | service structs and tags | queues, caches, cloud SDKs |
| `Context`, `Layer`, `Provide`, memoization | pure functions as plain Go | the `Clock` and `Random` live implementations |
| `Clock`, `TestClock`, `Random`, `Schedule` | operations as `Gen` bodies | |
| `Ref`, `Deferred`, `Queue`, `Semaphore`, `PubSub` | layers | |
| a `Stream` subset on `iter.Seq` and channels (proposed) | decoders (proposed) | |

**Not ported:**

- **Schema.** Forma's `type`, `class`, and `error` declarations are the
  schema. Generating Go types and, later, decoders from them is smaller and
  more idiomatic than porting `Schema`'s combinators, which exist to recover
  types that Go and Forma already have.
- **Platform packages** (`@effect/platform-*`). Go's standard library is the
  platform. Programs bind it through host-specific `extern` blocks.
- **STM.** Out of scope.
- **`Stream`.** Only a subset should be ported, on `iter.Seq` with channels
  for concurrent stages. The prototype does not port it.

### `extern` for Go

[RFC 0018](#related-designs) proposes `extern` for typed imports of
TypeScript exports, such as
`(extern "./payments.js" (service Payments ...) (: f (-> A B) :export "tsName"))`.
That RFC is on an unmerged branch. A Go host would add a host key and Go's
export rules:

```lisp
(extern :go "github.com/acme/payments"
  (service Payments
    (: charge (-> Cents (Effect ChargeId [CardDeclined] [])) :export "Charge" :cancel :context))
  (: luhn-valid? (-> String Bool) :export "LuhnValid"))
```

- `:go "module/path"` names the Go import path. An `extern` without a host
  key stays TypeScript-only. A program that needs a host's binding cannot be
  generated for another host, and the error points at the `extern`.
- `:export` names a capitalized Go identifier, because only exported Go
  names are importable.
- A pure function binds a plain Go function. An effectful member binds
  `func(ctx context.Context, args...) (A, error)`. The generator wraps it in
  `effect.Blocking` or `effect.Detached` according to `:cancel`, and maps the
  returned `error` to the declared errors with `errors.As`. An error outside
  the declared set is a defect.
- `:cancel :context` declares that the call honours `ctx`. `:cancel :abandon`
  declares that it does not, so the fiber abandons it on interruption.
  `:cancel :none` makes the call uninterruptible. **Every effectful Go extern
  must declare one of these.** Go cannot interrupt a goroutine, so this is
  the only way interruption reaches foreign code.

### Semantic decisions

Each decision below is one a second host forces. The recommendation favours
one observable behaviour across hosts, pinned by conformance, over native
behaviour on each.

#### Int range

Forma `Int` is the JavaScript safe-integer range today. The TypeScript
target raises a `RangeError` defect outside it. **Recommendation:** Go uses
`int64` with the same ±(2^53 − 1) checks (`forma.IntAdd`, `IntMul`, ...), so
overflow is the same defect on both hosts. A wider Go-only `Int` would make
programs that pass on Go fail on TypeScript. Revisit if the TypeScript target
moves to `bigint`. In the pure benchmark below, the generated function,
with these checks and a closure call per element in `reduce`, is 3.7× slower
than an unchecked hand-written loop.

#### Strings

JavaScript strings are UTF-16 and Go strings are UTF-8, so `count` (length),
slicing, `trim`, and case mapping differ. The prototype found three concrete
differences. `len("a😀")` is 5 bytes in Go and 3 code units in JavaScript.
`String.prototype.trim` strips U+FEFF but not U+0085, and Go's
`strings.TrimSpace` does the reverse. `"straße".toUpperCase()` is `STRASSE`,
and Go's `strings.ToUpper` leaves `ß`. **Recommendation:** specify Forma
strings as sequences of Unicode scalar values with lengths and indices in
code points. Until that change, the Go helpers reproduce JavaScript
(`forma.Length`, `Trim`, `Upcase`). Unit tests in
`prototypes/effect-go/forma` pin each difference; conformance cases should
pin them on both hosts. Number formatting is a related difference: `String(1e20)` is
`100000000000000000000` and Go's `%g` gives `1e+20`, so `forma.FormatFloat`
implements JavaScript's algorithm.

#### Map order

`keys` and `vals` follow JavaScript property order, and Go map iteration is
random. The prototype found that the TypeScript target's order is not
insertion order: maps are plain objects, so array-index keys come first in
numeric order. `Object.keys({b: 1, "2": 2, "1": 3, a: 4})` is
`["1", "2", "b", "a"]`. **Recommendation:** define Forma map order as
insertion order and change the TypeScript target to preserve it, through a
`Map` or by rejecting array-index keys. Until that change, `forma.Map`
reproduces JavaScript property order exactly so that `crud-users` behaves
identically. Its `adminNames` result depends on iteration order.

#### Interruption of foreign code

A Go goroutine blocked in a syscall or a CPU loop cannot be stopped from
outside; only its own code can observe `ctx`. **Recommendation:** every
effectful Go `extern` declares `:cancel` (above). Generated code is
interruptible at every `Await`. Pure Forma functions compile to plain Go
and are not interruptible. This matches TypeScript, where a synchronous loop
also cannot be interrupted.

#### Panics

**Recommendation:** as implemented. Every entry into user code recovers
panics as `Die` with a stack, and every fiber has an outer recover boundary.
A panic in a non-fiber goroutine that user code starts is outside the
runtime's reach. A future vet check could flag `go` statements in bound
code.

#### Performance

The interpreter allocates per operation: an opcode node, any closure, and a
boxed value. **Recommendation:** compile pure Forma functions to plain Go,
which the IR already separates from operations, and keep the interpreter for
effect structure. The benchmarks below show why: the same fold interpreted
as one effect per element is about 100× slower than the generated pure
function. Further optimizations such as fusing `Gen` bodies or pooling frames
are possible but were not needed to evaluate the design.

#### Records are structural; Go types are nominal

The prototype surfaced this decision. In Forma,
`{:id id :name n :email e :role r}` is a record that fits `User`. Go needs a
named type. **Recommendation, as prototyped:** a record literal takes the
declared schema whose fields it has exactly, with optional fields allowed to
be absent. An unmatched shape becomes a hoisted unexported struct. If more
than one schema matches, the generator stops and asks for an annotation such
as `(: {...} User)`. A checker-level rule would be better: the checker already records
`recordTargets` for annotated literals, and could record the target for every
literal that flows into a named type.

#### Naming

Go exports capitalized names and has one namespace per package.
`find-by-email` becomes `FindByEmail`, `id` becomes `Id` (not the idiomatic
`ID`), and an operation that collides with a type gets a suffix:
`dashboard` beside `Dashboard` becomes `DashboardOp`. **Recommendation:**
keep the mechanical mapping and allow `:go-name` overrides on declarations.
The suffix rule should be specified, because generated names are API.

#### Tracking upstream Effect

The runtime ports behaviour from a pinned Effect version, now 4.0.3.
Effect 4 already differs from Effect 3 in ways the port must choose between:
causes are flat lists of reasons, `fork` is `forkChild`, and `Effect.interrupt`
does not mark the fiber interrupted. **Recommendation:**

1. Pin the runtime to the same Effect version as the TypeScript target, and
   bump both together.
2. Port Effect's own tests for the runtime core (interruption, scope, layer,
   schedule) and record the Effect commit they came from, as the prototype's
   `effect4_port_test.go` does. A version bump diffs those test files.
3. Let the shared Forma conformance suite catch the remaining drift, because
   both hosts run it.

### DSL preludes on a second host

Prelude vocabularies such as `http-api`, the Elm-style app prelude, the email
prelude, and a future RPC prelude must reach Go without each becoming a
separate Go project. A prelude `form` already has three layers:

1. **Syntax, `:types`, and `:ir` are host-neutral.** `HttpEndpointIR` is
   data: a method, a path, and `Type` holes. It packages as a portable
   artifact.
2. **Linker checks are host-neutral.** `artifact/http-validator.ts` checks
   each handler's request, success type, and error set against its endpoint
   using the mechanics `CheckInfo`. Every host gets these checks.
3. **Emission is TypeScript-only.** One unkeyed `:emit` hook returns
   quasiquoted TypeScript built from `ts/*` primitives, and each prelude's
   linker (`HttpApi.ts`, `Elm.ts`, `Email.ts`) calls the TypeScript generator
   directly.

Only the third layer needs to change.

**Host-keyed emit hooks.** `:emit` accepts either a function, which stays the
TypeScript hook, or a map from host to function, in the manner of
ClojureScript's reader conditionals:

```lisp
(form (endpoint name method path {:keys [params payload success errors]})
  ...
  :emit {:ts (fn [ir] ...)
         :go (fn [ir]
               `(httpapi.Endpoint ~(keyword/name (get ir :method)) ~(get ir :name) ~(get ir :path)
                  ~@(map (fn [error] `(httpapi.Error ~(go/zero error) ~(go/annotation error "httpApiStatus")))
                         (or (get ir :errors) []))))}
  ...)
```

Existing preludes keep working unchanged. When a program uses a form with no
emitter for the host being generated, the generator reports a located
diagnostic on that form. This is the same rule as an `extern` without that
host's key.

**`go/*` primitives** mirror `ts/*` and are resolved by the Go generator. A
template therefore never spells a Go type or name as a string:

| Primitive | Result |
| --- | --- |
| `go/ref` | A Go identifier, validated. |
| `go/declaration` | The Go name of a Forma declaration, for example `Shop`. |
| `go/operation` | The Go function for an operation, after collision suffixes: `create-user` beside the `CreateUser` type becomes `CreateUserOp`. |
| `go/type` | The Go type for a `Type` hole, through the generator's type mapping. |
| `go/zero` | A zero value of a `Type` hole (`UserNotFound{}`), so generic Go functions can infer type arguments from values. |
| `go/annotation` | A schema annotation such as `:status`, or `nil`. |
| `go/children` | Nested forms, emitted with their own `:go` hooks. |
| `go/method`, `go/code` | A method call; compiler-produced code. |

Lists render as calls. Vectors and maps have no Go rendering, because Go
literals need a type; emitters construct values with calls instead.

**Linkers split into a check and a backend.** The prelude linker becomes a
host-neutral pass that elaborates the domain forms, checks the mechanics
program, and runs the linker checks. It returns the domain IR and
`CheckInfo`. A backend then generates the mechanics module for its host and
appends the emitted domain declarations.

**A small runtime library per protocol on each host.** This is not a port of
the platform packages. The runtime implements the protocol's semantics
(routing, request decoding, error-to-status mapping) and binds Go's standard
library underneath. For `http-api`, the Go runtime is `httpapi`, built on
`net/http`. A handler is a generic `httpapi.Handler[Req, Res]` whose type
arguments Go infers from the generated operation. Each request runs as a
fiber whose `context.Context` is the request's, so a client that disconnects
interrupts the handler and runs its finalizers.

**A specified wire encoding.** Two hosts can only talk if Forma, not each
host, defines how values are encoded. For JSON:

- A record is an object keyed by Forma field names. An absent optional field
  is omitted, and extra fields are ignored on decode.
- A brand or enum encodes as its base value. `Int` is a JSON number in the
  safe range. A map is an object, and a list is an array.
- An error is its record plus `"_tag"`. Its HTTP status comes from `:status`
  and defaults to 500.
- A value that does not decode, for example `{"id": 42}` for `{:id String}`
  or a missing required field, is a 400 response with an empty body.
- An unknown route, or a known path with the wrong method, is a 404 with an
  empty body.

These rules are what Effect 4's `HttpApi` does today, measured against the
`http-api` conformance case. The Go runtime must match them, including where
Go's defaults differ: `encoding/json` accepts missing fields, and
`http.ServeMux` answers a wrong method with 405.

**Cross-host conformance.** A prelude case gains two checks beyond a single
host:

- A **differential test** sends the same requests to the TypeScript server
  and to the Go server, both generated from one program, and compares
  statuses and bodies.
- A **cross-host client test** calls the Go server through
  `HttpApiClient`, derived from the generated TypeScript `Shop`.

**RPC** follows the same pattern. An `rpc` prelude would declare procedures
with payload, success, and error schemas, plus a streaming flag. Its `:ts`
emitter targets Effect's RPC modules, and its `:go` emitter targets a Go
`rpc` runtime. The decision specific to RPC is the protocol. Implementing
Effect RPC's own message format in Go lets Effect clients call Go servers,
but makes the Go runtime track another upstream protocol. A Forma-owned
format is cheaper but gives up that interoperability. Streaming RPC also
depends on the `Stream` subset.

### Conformance on two hosts

Each positive case in `conformance/effect-typescript/` keeps its TypeScript
golden and harness. A case that the Go generator supports adds:

- `program.go`: the Go golden, compared byte for byte in `pnpm check`;
- `harness_test.go`: the Go twin of `harness.ts`, with the same calls and
  assertions;
- a CI job with Go that builds the golden, checks that it is gofmt-formatted,
  and runs the harness with `-race`.

Negative cases need no Go: the checker rejects them before either generator
runs. A Go-specific rejection, such as an `extern` without `:cancel`, would be
a new negative case with an `effect-go/` diagnostic code.

## Prototype results

Everything in this section describes the prototype on this branch, which is
not a supported target.

### What was built

| Part | Size | Validation |
| --- | --- | --- |
| Runtime (`prototypes/effect-go/effect`) | about 2,600 lines of Go | 77 tests with `-race`: 10 direct ports of Effect 4 tests, 26 further interruption scenarios, 11 scope and layer tests, and `synctest`-based clock tests |
| Value helpers (`forma`) | about 340 lines | 6 tests against JavaScript behaviour |
| Generator (`effect-go.ts`) | about 1,500 lines of TypeScript | 7 vitest tests, including byte-for-byte goldens |
| Two-host conformance | 4 programs | Go harnesses mirroring `harness.ts`, all passing with `-race` |

Ten tests are direct ports from Effect 4's own suite
(`packages/effect/test/Effect.test.ts` in Effect-TS/effect at commit
`1e73219`), under Effect's test names: "skipped handlers drop
failures and keep defects when interrupted", "uninterruptible handlers
observe the interruption after skipped handlers", "handlers inside an
uninterruptible region recover with interruption pending", "catch + ensuring
+ interrupt", "run of interruptible", "alternating interruptibility", "sync
forever is interruptible", "acquireUseRelease release runs when use is
interrupted", "closing scope is uninterruptible", and "finalizer errors
merged". All pass. The only adaptation is waiting on a latch where Effect
forks with `startImmediately`. The other interruption scenarios were written for the
prototype. They cover interruptible `sleep`, uninterruptible acquisition,
finalizers that observe interruption, catch handlers skipped while
interruptible, interrupting a race, supervision of children and
grandchildren, daemon fibers, `Blocking` versus `Detached`, and `Await` as
the interruption point. Finalizer-ordering tests cover reverse release on
success, failure, and interruption. They also cover every finalizer running
when one fails, release with the services from acquisition, and a layer's
resource living exactly as long as `Provide`.

### Coverage of the Effect conformance suite

| Positive case | Go |
| --- | --- |
| `crud-users`, `operational-effects`, `concurrent-workflow`, `resource-scope` | generated, builds, Go harness passes |
| `multi-service-checkout`, `ontology-actions` | generated and builds; no Go harness yet |
| `pure-domain-logic`, `schemas-and-decoding`, `edge-cases`, `surface-review` | not generated: tagged and structural unions |
| `typed-errors` | not generated: `result` and catch-all arms |
| `config-and-logging` | not generated: `config` |
| `stream-pipeline` | not generated: streams |

The Elm, email, and HTTP API cases use their own generators and were not
attempted.

### Benchmarks

Measured on the sandbox this RFC was written in: a 4-vCPU Intel Xeon at
2.5 GHz with a CPU quota of two cores (`GOMAXPROCS=2`), Go 1.25.12, and
Node 24.22.1 with effect@4.0.3. Go figures are medians of five runs of
`go test -bench . -benchmem ./bench/`. Effect-TS figures are medians of three
runs of `node bench/effect-ts.mjs`, which implements the same workloads. Each
workload has 1,000 steps, and the table reports cost per step. The machine
is noisy, with up to ±20% variation between runs, so read these figures as
orders of magnitude.

| Workload, per step | Plain Go | Effect-Go prototype | Effect-TS 4.0.3 |
| --- | --- | --- | --- |
| Sequential chain of `flatMap`s over `sync` | 1.9 ns (a non-inlined call) | 191 ns, 2.8 allocations | 90 ns |
| Sequential chain in a `Gen` body, `Await` per step | | 124 ns, 2.8 allocations | 165 ns (`Effect.gen`) |
| Fan-out: fork a task, then join each | 0.79 µs (goroutine + `WaitGroup`) | 3.3 µs | 1.7 µs |
| Fan-out: `ForEach`, unbounded | | 3.3 µs (a goroutine per item) | 0.32 µs (no parallelism) |
| Fan-out: `ForEach`, concurrency 16 | | 0.47 µs | 0.31 µs |
| Pure fold (sum of squares) | 0.50 ns, hand-written loop | 1.9 ns as generated Go; 181 ns interpreted as one effect per element | 1.0 ns, plain loop |
| Typed failure raised and caught | 79 ns (`errors.As`) | 717 ns via `Await` in `Gen` + `CatchTag`; 250 ns via `CatchTag` without a `Gen` body; 94 ns via `Try` + `errors.As` | 12.8 µs (`Effect.gen` + `catchTag`) |

Reading the table:

- **Interpretation costs about 100–200 ns per operation**, two orders of
  magnitude above a Go call. Allocation dominates. A CPU profile put about
  60% of the time in `mallocgc`, from opcode nodes, closures, and boxing
  values into `any`. One optimization pass, generic opcode structs and
  slimmer stack frames, cut the chain costs by 20–27% and allocations per
  step from 3.75 to 2.75. Effect-TS's `flatMap` chain is about twice as fast,
  probably because V8's young-generation allocation is cheaper; this was not
  profiled. The direct-style `Gen` path is faster
  than `Effect.gen`.
- **A fiber costs about four goroutines.** Each fiber has two channels, a
  supervision entry, and an exit record. `ForEach` with bounded concurrency
  reuses workers and is close to Effect-TS. Unbounded `ForEach` starts a
  goroutine per item where Effect-TS runs everything on one thread, so the
  comparison is not like for like: the Go version runs in parallel.
- **Pure code must not be interpreted.** The generated pure function is
  3.7× slower than a hand-written loop, because of the closure call per
  element in `forma.Reduce` and the safe-range checks. That is about 100×
  faster than interpreting the same fold as effects. Calling it from an
  effect adds one `Gen` (0.4 µs).
- **Failure through `Await` costs a panic.** About 0.7 µs per failure,
  versus 0.25 µs when the failure stays inside the interpreter. That is
  acceptable on error paths. Effect-TS failures are far more expensive here,
  probably because each tagged error captures a JavaScript stack trace; this
  was not profiled either.

### What worked

- **Reusing the checker.** The Go generator needed no checker changes. The
  only TypeScript changes outside it export seven helpers and one type from
  `effect-typescript.ts`. `CheckInfo` had every type the generator needed,
  including instantiated generic builtins and lambda parameter types.
- **Goroutine fibers.** Interruption, supervision, and finalizer ordering
  passed Effect's scenarios with a run loop of about 150 lines, because
  parking, waking, and preemption are Go's job.
- **`Gen`/`Await`.** Generated operations read like the `Effect.gen` that the
  TypeScript target emits, one line per bind, and are faster than
  `Effect.gen` on Node in the chain benchmark.
- **`synctest`.** Virtual time for the live clock made timeout and schedule
  tests deterministic and instant. `TestClock` is still useful as a value
  that a program can be given.
- **Typed catch.** `CatchTag` with a handler-inferred error type replaces
  `catchTag`'s string tag with a checked Go type.

### What did not, or not yet

- **Cross-host differences were real.** Writing the Go value helpers against
  the TypeScript target's behaviour found the map key-order difference, three
  string differences, and number formatting. None was documented before, and
  none of the four programs happens to exercise them. This is the strongest
  argument for two-host conformance, and it is a cost: each difference needs a
  decision.
- **gofmt without Go.** The golden test runs where Go is not installed, so the
  generator formats its own output. Most of that formatting was easy, but
  gofmt's spacing of `+` inside multi-argument calls needed a small
  depth-tracking pass. A CI job with Go would remove that risk.
- **A generator bug the harnesses missed.** `Error()` on generated error
  structs first formatted itself with `%+v`, which recursed until the stack
  overflowed. Only the demo printed an error, which exposed it. It is fixed,
  and the crud-users harness now asserts the message.
- **Per-operation overhead.** About 100–200 ns per interpreted operation, and
  about four times the cost of a bare goroutine per forked fiber. That is
  acceptable for I/O-bound services, which is Effect's domain. It is why pure
  code must compile to plain Go.
- **Unported surface.** Tagged unions, decoders, streams, `config`, and
  generic functions block seven of the thirteen positive cases.

## Alternatives considered

- **A thin direct-style runtime only.** Represent `Effect[A]` as
  `func(*Fiber) (A, error)` with no opcode tree. This is simpler, and plain
  closures would be faster than the interpreter. However, every combinator
  that inspects or restructures effects would then be hand-written for
  closures, including interruption masking, `onExit` frames, and
  `matchCause` that skips while interrupted. That takes the port away from
  Effect's semantics and their test suite. The prototype keeps the opcode
  tree and uses direct style where it is free, inside `Gen` bodies and inside
  combinators such as `Retry` and `Scope.Close`.
- **A faithful port of Effect's scheduler.** Run many fibers on one goroutine
  with Effect's cooperative yielding. This would match Effect-TS scheduling
  exactly but discard Go's preemptive, multi-core scheduler and its blocking
  integration. It would also make every blocking Go call stall unrelated
  fibers. No conformance program depends on scheduling order, and the four
  Go harnesses pass without one.
- **A pure Go library without Forma.** Publish the runtime alone. Users would
  get fibers, scopes, and layers, but `Effect[A]` with untracked errors and
  requirements, which is where fp-go is today. Static analysis is the other
  route: [effectgo](https://github.com/effectgo/effectgo) infers
  Effect-style signatures for plain Go at `go vet` time. A library is a
  useful by-product of this proposal, but it is not the point. The checked
  error and requirement sets come from Forma.
- **Not targeting Go.** Keep one host and spend the effort on the TypeScript
  target, specification, and tooling. This remains reasonable and is the
  default if stage 1 does not find a consumer. Two-host conformance has value
  even then: the differences found above affect the TypeScript target's
  specification regardless of Go.
- **Services as Go interfaces.** Interfaces are more idiomatic, but generated
  layers close over setup values, so each layer would need a generated struct
  type with methods. Structs of functions mirror `Service.of({...})` and make
  test doubles literal values. This choice is open; see the decisions below.

## Related work

- **[IBM/fp-go](https://github.com/IBM/fp-go):** fp-ts-style types for Go,
  including `ReaderIOEither` over `context.Context` with `error` as the
  failure type. It has no fiber
  runtime, interruption model, or typed error sets.
- **[Effect-TS/tsgo](https://github.com/Effect-TS/tsgo):** Effect's
  language service, built as a wrapper around
  [typescript-go](https://github.com/microsoft/typescript-go), the Go port of
  the TypeScript compiler. It is tooling written in Go, not a runtime for Go
  programs.
- **[effectgo](https://github.com/effectgo/effectgo):** infers
  `Effect<A, E, R>`-style signatures for ordinary Go code and enforces
  declared contracts at `go vet` time. It is the inverse of this proposal:
  it infers effects from Go, while Forma checks them before generating Go.
- **[sourcegraph/conc](https://github.com/sourcegraph/conc)** and
  `errgroup`: structured concurrency for Go, with scoped goroutine groups,
  panic propagation, and context cancellation. They provide no typed
  failures, finalizers, or layers.
- **ZIO and Cats Effect:** Scala effect runtimes; Effect-TS began as a port
  of ZIO. Both keep their own fiber schedulers on the JVM.
  **[Ox](https://ox.softwaremill.com/):** direct-style structured concurrency
  for Scala on Java virtual threads, with `supervised` scopes whose forks are
  interrupted when the scope ends. It is the closest design to
  goroutine-backed fibers. **[Kyo](https://github.com/getkyo/kyo):** an
  algebraic-effect library whose `A < S` type tracks pending effects as a
  type-level set, which is what Forma's checker does outside the host
  language.

## Implementation stages and validation

1. **Decide on a consumer (now).** Find a Go service whose team would use
   generated Go. Without one, keep the prototype isolated as it is and fold
   its findings (map order, strings, number formatting) into the TypeScript
   target's specification. *Validation:* a written use case with the services
   it needs bound.
2. **Two-host CI.** A Go job runs `go test -race ./...` in
   `prototypes/effect-go` and checks that the goldens build. The pinned cases
   grow to the six that generate today. *Validation:* the job is required on
   pull requests touching `packages/ts/src/mechanics/`.
3. **Close the gaps.** Add tagged unions as sealed interfaces with type-switch
   matching, `result`, catch-all arms, generic pure functions, and `config`.
   *Validation:* every positive Effect conformance case except streams
   generates and passes a Go harness.
4. **`extern :go`** after RFC 0018 lands, with `:cancel` required and
   negative cases for a missing `:cancel` and for an error outside the
   declared set.
5. **Preludes on Go.** Host-keyed `:emit`, the `go/*` primitives, the
   check/backend split for prelude linkers, and the `httpapi` runtime.
   *Validation:* the `http-api` case passes a Go harness, the differential
   test against the TypeScript server, and the `HttpApiClient` test.
6. **Decoders and a `Stream` subset.** Generate decoders from schemas with the
   same failure shape as `SchemaError`, and port `Stream` on `iter.Seq`.
   *Validation:* `schemas-and-decoding` and `stream-pipeline` on both hosts.
7. **Publish** the runtime as a versioned module only once stages 2–6 hold
   and a consumer depends on it.

## Decisions still required

- Whether a Go consumer exists (stage 1). This decides everything else.
- String semantics: code points as proposed, or JavaScript's UTF-16 on every
  host.
- Map order: change the TypeScript target to insertion order, or specify
  JavaScript property order.
- Services as structs of functions (prototyped) or Go interfaces.
- Whether record targets move into the checker, so that generators never
  match shapes.
- The `:go-name` override and the collision suffix rule.
- Where the Go module lives once it is more than a prototype, and its import
  path.
- Whether `TestClock` stays alongside `synctest`, or tests use `synctest`
  only.
- Where the wire encoding is specified, so that it binds both hosts and
  their conformance cases.
- For RPC: Effect RPC's message format, or a Forma-owned protocol.

## Related designs

- [RFC 0003: Direct-style effects](./0003-direct-style-effects.md): the
  direct-style surface that `Gen`/`Await` mirrors.
- [RFC 0013: A runnable host](./0013-runnable-host.md): host calls,
  concurrency, and cancellation for the TypeScript host.
- [RFC 0014: Local providers](./0014-local-providers.md): `implement` would
  lower to `effect.LayerSucceed` or `LayerEffect` in Go.
- [RFC 0016: Host-call journals](./0016-host-call-journals.md): replaying host
  calls would apply to Go externs.
- RFC 0018: Effect as the host. Proposes `extern` for typed TypeScript
  imports; under review on an unmerged branch, not yet in this repository.
- [Forma for Effect](../effect.md) and the [Effect reference](../effect/reference.md).
