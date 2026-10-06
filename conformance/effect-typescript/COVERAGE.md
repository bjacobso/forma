# Effect TypeScript coverage matrix

This matrix records which Effect 4 (`effect@4.0.0-rc.112`) constructs a Forma
program can express. The pipeline is `elaborateEffectProgram` /
`generateEffectProgram`: read, then `mechanicsPackageableDeclarations`, then
`checkMechanicsDeclarations`, then `generateMechanicsEffectTypeScriptModule`.

Status key:

- **supported**: the form elaborates and is checked. It generates idiomatic
  Effect TypeScript that typechecks under the strict suite `tsconfig`, and a
  conformance case runs it.
- **partial**: some of the construct works, or it works with a documented
  restriction.
- **missing**: Forma has no way to write it.

"Case" names the conformance case under `cases/` that exercises a row.

## Current status

### Data and schemas

| Effect construct | Forma surface | Status | Case |
| --- | --- | --- | --- |
| `Schema.Struct` + `typeof X.Type` | `(type N {:f T ...})` | supported | crud-users |
| Optional fields (`Schema.optionalKey`) | `(Option T)` in a field; `get` returns `(Option T)` | supported | crud-users |
| `Schema.Array`, `Schema.Record` | `(List T)`, `(Map String T)`; `get`/`assoc`/`dissoc`/`keys`/`vals` on maps | supported | crud-users, pure-domain-logic |
| `Schema.Literal(s)` | `(Union "a" "b")`, literal types | supported | crud-users |
| `Schema.Union`, `Schema.Tuple` | `(Union A B)`, `(Tuple A B)` | supported | schemas-and-decoding |
| Tagged unions | `(Tagged :tag tag (Ctor {...}) ...)`, matched by tag | supported | schemas-and-decoding, pure-domain-logic |
| Brands (`Schema.brand`, `.make`) | `(type Name (Brand T))`, `(Name value)` | supported | crud-users, schemas-and-decoding |
| Annotations | `(T :doc "...")`, `:identifier`, `:title`, `:pattern` | supported | schemas-and-decoding |
| `Schema.Class` | `(class N {...})`, `(N {...})` | supported | pure-domain-logic |
| `Schema.decodeUnknownEffect` | `(decode Schema value)`, fails with `SchemaError` | supported | schemas-and-decoding |
| `Option` | `(Option T)`, `Some`, `None`, `match`, `get-or-else`, `is-some` | supported | crud-users, pure-domain-logic |
| `Result` | `(Result A E)`, `(result eff)`, `match` on `Ok`/`Err` | supported | typed-errors, pure-domain-logic |
| Recursive schemas (`Schema.suspend`) | none | missing | rejected with a diagnostic (reject-recursive-schema) |
| `Schema.TaggedClass`, transformations, filters beyond `:pattern` | none | missing | |

### Errors

| Effect construct | Forma surface | Status | Case |
| --- | --- | --- | --- |
| `Schema.TaggedError` classes | `(error E {...})` | supported | all |
| `Effect.fail` | `(fail (E {...}))`, `(fail e)` | supported | crud-users |
| `Effect.catchTag` / `catchTags` | `(catch eff (E e) handler ...)` | supported | typed-errors |
| `Effect.catch` | `(catch eff (_ e) handler)` | supported | typed-errors |
| `mapError`, `orElseSucceed`, `orDie` | `map-error`, `or-else-succeed`, `or-die` | supported | typed-errors |
| `Effect.option`, `Effect.result` | `option`, `result` | supported | typed-errors |
| Effect's own errors | `TimeoutError`, `ConfigError`, `SchemaError` | supported | concurrent-workflow, config-and-logging, schemas-and-decoding |

### Services, layers and requirements

| Effect construct | Forma surface | Status | Case |
| --- | --- | --- | --- |
| `Context.Service` classes | `service` | supported | all |
| Requirements | `[Service.method]` capabilities or `[Service]`, plus `Scope` | supported | all |
| `Layer.succeed` / `Layer.effect` | `(layer L :provides S :setup [...] (define ...))` | supported | crud-users, multi-service-checkout |
| Layer dependencies | services used by methods are captured; operations get `Effect.provideContext` | supported | multi-service-checkout |
| `Layer.mergeAll`, `Layer.provide`, `Layer.provideMerge` | `layer-merge`, `layer-provide`, `layer-provide-merge` | supported | multi-service-checkout |
| Layer types | `(: L (Layer [Provides] [Errors] [Requirements]))` | supported | multi-service-checkout |
| `Effect.provide` | `(provide eff Layer)` | supported | multi-service-checkout |
| Scoped layers | `acquire-release` in `:setup` | supported | resource-scope |

### Effect programs

| Effect construct | Forma surface | Status | Case |
| --- | --- | --- | --- |
| `Effect.gen` | `do!`, `let`, `<-` | supported | all |
| Branching | `if`, `when`, `unless`, `cond`, `match` (effect and value position) | supported | crud-users, pure-domain-logic |
| Zero-argument operations | `(-> (Effect ...))` | supported | crud-users |
| Pure functions and constants | `(: f (-> A B)) (define f (fn ...))`, `(: c T) (define c v)` | supported | pure-domain-logic |
| Pure value expressions | records, vectors, `get`, `assoc`, `str`, arithmetic, comparisons, collection and string functions | supported | pure-domain-logic |
| Generic operations/functions | none | missing | |
| `Effect.fn`, spans, tracing | none | missing | |

### Resources and scope

| Effect construct | Forma surface | Status | Case |
| --- | --- | --- | --- |
| `Effect.acquireRelease` | `(acquire-release acquire (fn [r] release))` | supported | resource-scope |
| `Effect.scoped` | `(scoped eff)` | supported | resource-scope |
| `Effect.ensuring`, `Effect.addFinalizer` | `ensuring`, `add-finalizer` | supported | resource-scope |

### Concurrency and state

| Effect construct | Forma surface | Status | Case |
| --- | --- | --- | --- |
| `Effect.all` (record, tuple, `concurrency`) | `(all {...} :concurrency n)`, `(all [...])` | supported | concurrent-workflow |
| `Effect.forEach` (`concurrency`) | `(for-each xs (fn [x] eff) :concurrency n)` | supported | concurrent-workflow |
| `Effect.race`, `forkChild`, `Fiber.join`, `Fiber.interrupt` | `race`, `fork`, `join`, `interrupt` | supported | concurrent-workflow |
| `Effect.sleep`, `Effect.timeout` | `sleep`, `timeout`, `millis`/`seconds` | supported | concurrent-workflow |
| `Effect.retry`, `Effect.repeat` | `(retry eff :times n :schedule s)`, `(repeat eff ...)` with `spaced`, `exponential`, `fixed`, `recurs`, `jittered` | partial | concurrent-workflow. Schedule composition and `while`/`until` predicates are missing. |
| `Ref` | `ref-make`, `ref-get`, `ref-set`, `ref-update`, `(Ref T)` | supported | crud-users, concurrent-workflow |
| `Queue`, `PubSub`, `Deferred`, `Semaphore`, `forkScoped` | none | missing | |

### Configuration, observability and streams

| Effect construct | Forma surface | Status | Case |
| --- | --- | --- | --- |
| `Config.string/int/number/boolean`, `withDefault` | `(config Type "NAME" :default v)` | supported | config-and-logging |
| `Effect.log` | `(log ...)` | supported | config-and-logging, multi-service-checkout |
| `Stream` | `stream-of`, `stream-range`, `stream-map`, `stream-filter`, `stream-take`, `stream-map-effect`, `stream-run-collect`, `stream-run-fold`, `stream-run-for-each`, `(Stream A [E] [R])` | partial | stream-pipeline. Sinks, chunking, merging, and Stream-specific error handling are missing. |

### Checking

| Property | Status | Notes |
| --- | --- | --- |
| Located diagnostics | supported | Read, projection, and check diagnostics all carry a line and column span (`elaborateEffectProgram`). |
| Values match schemas | supported | Record fields, unknown and missing fields, `Int` versus `Number`, literals and enums, brands, and classes. |
| Error and requirement sets | supported | Each undeclared error or requirement is reported at the call that introduced it. |
| Exhaustive and reachable `match` | supported | Also covers matches on strings, numbers, booleans, and tagged-error unions. |
| TypeScript-representable programs | supported | Generated-name collisions, reserved names, unrepresentable numbers and keys, `Unit` in collections, and stray top-level forms are rejected. Literal widening follows TypeScript. |
| Impossible `catch`, failing finalizers | supported | |
| Layer completeness and signatures | supported | |
| Stricter than TypeScript | supported | `Bool` conditions, primitive-only `=`, `str` of primitives, `Int` versus `Number`, and `let` versus `do!`. See the `typescript` field of each rejection case. |
| Generated code typechecks without `any` | supported | Under `tsconfig.base.json`. |
| HM checker (`Type.inferSourceStr`) and language server | missing | They do not understand the new forms. The mechanics checker is authoritative for Effect programs. |
| Hosted runtime (`makeMechanicsRuntime`) | partial | Executes only the original body forms. |
| OCaml engine | partial | It projects identical mechanics IR for every positive case: `pnpm parity:engines` reports zero `effect-ir` differences. It has no checker or Effect TypeScript generator of its own; the TypeScript checker accepts its IR. Gaps are listed in `../engine-parity/matrix.json`. |

## Baseline: `main` at `30d7db4`

This is the inventory taken before the conformance suite existed. It was
verified by projecting and generating probe programs, then typechecking the
output with the TypeScript compiler API.

### Data and schemas

| Effect construct | Forma surface | Status | Notes |
| --- | --- | --- | --- |
| `Schema.Struct` | `(type N {:f T ...})` | partial | The Effect TS module emits a plain `interface` and no runtime schema. The separate Schema module emits `Schema.Struct`. The two modules are not linked. |
| Optional fields | `(Option T)` in a field | partial | The interface uses `readonly f?: T`. The Schema module uses `Schema.optional`, which is `T \| undefined` and does not match the interface under `exactOptionalPropertyTypes`. |
| `Schema.Array`, `Schema.Record` | `(List T)`, `(Map String T)` | supported | |
| Literal unions | `(Enum a b)`, `(Literal ...)` | partial | Types are correct. The Schema module emits Effect 3 `Schema.Literal("a", "b")`, which does not typecheck in Effect 4 (`Schema.Literals([...])`). |
| `Schema.Union` | `(Union A B)` | partial | Types are correct. The Schema module emits `Schema.Union(a, b)`, which does not typecheck in Effect 4 (`Schema.Union([a, b])`). |
| `Schema.Tuple` | `(Tuple A B)` | partial | Same Effect 3 call shape as `Union`. |
| Tagged unions | `(TaggedUnion tag [t S] ...)` | partial | The Effect TS module types it as `unknown`. The Schema module does not typecheck. |
| Brands | `(type Name (Brand T))` | partial | The TS module uses a hand-rolled `Brand` type that is incompatible with `Schema.brand`. There is no way to construct a branded value in a body. |
| Annotations | `(T :doc "...")` | partial | Annotated schemas are typed as `unknown` in the TS module. |
| `Schema.Class` / `Schema.TaggedClass` | none | missing | |
| Recursive schemas (`Schema.suspend`) | none | missing | |
| `Option` | `(Option T)` | partial | Lowered to `T \| undefined`, not `Option.Option<T>`. There are no `some`/`none` constructors and no way to match on an option in a body. |
| `Result` (Effect 3 `Either`) | none | missing | |
| Schema decoding (`Schema.decodeUnknownEffect`) | none | missing | |

### Errors

| Effect construct | Forma surface | Status | Notes |
| --- | --- | --- | --- |
| Tagged errors | `(error E {...})` | partial | Emitted as a structural `interface` with `_tag`, not a yieldable `Schema.TaggedError` class. Errors carry no stack and no schema. |
| `Effect.fail` | `(fail (E {...}))` | supported | Emits an object spread with `_tag`. |
| `Effect.catchTag` | `(catch body (E e) handler)` | supported | One tag per `catch`. A missing pattern silently becomes `"UnknownError"`. |
| `Effect.catchTags`, `Effect.catch`, `mapError`, `orElseSucceed`, `orDie` | none | missing | |
| `Effect.result` / `Effect.option` | none | missing | |
| Typed error sets in signatures | `(Effect A [E ...] [R ...])` | supported | |

### Services, layers and requirements

| Effect construct | Forma surface | Status | Notes |
| --- | --- | --- | --- |
| `Context.Service` class | `(service S (: m Type) ...)` | supported | |
| Service method calls | `(S.method args)` | supported | |
| Zero-argument methods | `(m [] (Effect ...))` | supported | |
| Requirements in signatures | `[S.method ...]` | supported | Capability-granular. They collapse to service tags in TypeScript. |
| `Layer.succeed` / `Layer.effect` | none | missing | Implementations can only be supplied by the host. |
| `Layer.merge` / `Layer.provide` | none | missing | |
| `Effect.provide` | none | missing | |
| Service dependencies between layers | none | missing | |

### Effect programs

| Effect construct | Forma surface | Status | Notes |
| --- | --- | --- | --- |
| `Effect.gen` pipelines | `(do! [x eff ...] body)`, `(let ...)`, `<-` | supported | |
| Operation calls | `(op args)` | supported | |
| Zero-argument operations | `(-> (Effect ...))` | missing | The signature parser needs at least one input type. |
| Branching | `if` / `when` / `unless` / `cond` | partial | Conditions always go through a `formaTruthy` helper. `cond` falls through to `return null`. |
| `match` | `(match v (Con x) body ...)` | missing | Projected to IR, but generation throws `unsupported effect body kind Match`. |
| Pure value expressions | `(+ a 1)`, `(get u :name)`, `(str ...)` | missing | Any application in value position is generated as an array literal (`[get, user, ":id"]`), so the output does not typecheck. |
| Lambdas (`fn`) | none in bodies | missing | |
| Pure helper functions | `(define f (fn ...))` | missing | Not projected or generated. |
| `nil` / `Unit` | `nil` | partial | Generated as `null` where `void` is expected. |

### Resources and scope

| Effect construct | Forma surface | Status | Notes |
| --- | --- | --- | --- |
| `Effect.acquireRelease` | none | missing | |
| `Effect.scoped` / `Scope` requirement | none | missing | |
| `Effect.ensuring` / `addFinalizer` | none | missing | |

### Concurrency and state

| Effect construct | Forma surface | Status | Notes |
| --- | --- | --- | --- |
| `Effect.all` (with `concurrency`) | none | missing | |
| `Effect.forEach` (with `concurrency`) | none | missing | |
| `Effect.race`, `Effect.forkChild`, `Fiber.join` | none | missing | |
| `Effect.sleep`, `Effect.timeout`, `Effect.retry` | none | missing | |
| `Ref` | none | missing | |

### Configuration, observability and streams

| Effect construct | Forma surface | Status | Notes |
| --- | --- | --- | --- |
| `Config.string` / `Config.int` / `withDefault` | none | missing | |
| `Effect.log` | none | missing | |
| `Stream` | none | missing | |

### Checking

| Property | Status | Notes |
| --- | --- | --- |
| Located diagnostics from projection | partial | Projection diagnostics carry spans. Malformed bodies (for example `if` without `else`, or `catch` without a pattern) are accepted silently or crash the generator. |
| Type checking of bodies | partial | The HM checker (`Type.inferSourceStr`) is separate from projection, so projection does not consult it. It rejects undeclared errors and requirements with poor messages ("Type application arity mismatch"). It is stricter than TypeScript for over-declared errors ("Type mismatch: A vs B"). It rejects `Int` arithmetic (`Number vs Int`) and has no `str`, `assoc` or `reduce`. |
| Generated code typechecks | partial | This holds only for the `operational-effects` fixture. |
| OCaml engine | partial | It produces the same mechanics IR (`effect-ir` parity pass) for the forms above. It has no Effect TypeScript generator. |
