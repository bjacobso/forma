# Effect TypeScript coverage matrix

This matrix records which Effect 4 (`effect@4.0.0-rc.112`) constructs a Forma
program can express through the mechanics path today. The path is
`mechanicsPackageableDeclarations` → `generateMechanicsEffectTypeScriptModule`
(and `generateMechanicsEffectSchemaModule`).

Status key:

- **supported**: the form elaborates, generates idiomatic Effect TypeScript
  that typechecks under the strict package `tsconfig`, and runs.
- **partial**: some of the construct works, but generation is lossy, does not
  typecheck, or does not cover common uses.
- **missing**: Forma has no way to write it.

## Baseline: `main` at `30d7db4`

This is the inventory taken before the conformance suite existed. It was
verified by projecting and generating probe programs, then typechecking the
output with the TypeScript compiler API.

### Data and schemas

| Effect construct | Forma surface | Status | Notes |
| --- | --- | --- | --- |
| `Schema.Struct` | `(define-schema N (Struct [f T] ...))` | partial | The Effect TS module emits a plain `interface` and no runtime schema. The separate Schema module emits `Schema.Struct`. The two modules are not linked. |
| Optional fields | `(Optional T)` in a field | partial | The interface uses `readonly f?: T`. The Schema module uses `Schema.optional`, which is `T \| undefined` and does not match the interface under `exactOptionalPropertyTypes`. |
| `Schema.Array`, `Schema.Record` | `(Array T)`, `(Map T)` | supported | |
| Literal unions | `(Enum a b)`, `(Literal ...)` | partial | Types are correct. The Schema module emits Effect 3 `Schema.Literal("a", "b")`, which does not typecheck in Effect 4 (`Schema.Literals([...])`). |
| `Schema.Union` | `(Union A B)` | partial | Types are correct. The Schema module emits `Schema.Union(a, b)`, which does not typecheck in Effect 4 (`Schema.Union([a, b])`). |
| `Schema.Tuple` | `(Tuple A B)` | partial | Same Effect 3 call shape as `Union`. |
| Tagged unions | `(TaggedUnion tag [t S] ...)` | partial | The Effect TS module types it as `unknown`. The Schema module does not typecheck. |
| Brands | `(Brand Name T)` | partial | The TS module uses a hand-rolled `Brand` type that is incompatible with `Schema.brand`. There is no way to construct a branded value in a body. |
| Annotations | `(T :doc "...")` | partial | Annotated schemas are typed as `unknown` in the TS module. |
| `Schema.Class` / `Schema.TaggedClass` | none | missing | |
| Recursive schemas (`Schema.suspend`) | none | missing | |
| `Option` | `(Option T)` | partial | Lowered to `T \| undefined`, not `Option.Option<T>`. There are no `some`/`none` constructors and no way to match on an option in a body. |
| `Result` (Effect 3 `Either`) | none | missing | |
| Schema decoding (`Schema.decodeUnknownEffect`) | none | missing | |

### Errors

| Effect construct | Forma surface | Status | Notes |
| --- | --- | --- | --- |
| Tagged errors | `(define-error E (:fields ...))` | partial | Emitted as a structural `interface` with `_tag`, not a yieldable `Schema.TaggedError` class. Errors carry no stack and no schema. |
| `Effect.fail` | `(fail (E {...}))` | supported | Emits an object spread with `_tag`. |
| `Effect.catchTag` | `(catch body (E e) handler)` | supported | One tag per `catch`. A missing pattern silently becomes `"UnknownError"`. |
| `Effect.catchTags`, `Effect.catch`, `mapError`, `orElseSucceed`, `orDie` | none | missing | |
| `Effect.result` / `Effect.option` | none | missing | |
| Typed error sets in signatures | `(Effect A [E ...] [R ...])` | supported | |

### Services, layers and requirements

| Effect construct | Forma surface | Status | Notes |
| --- | --- | --- | --- |
| `Context.Service` class | `(define-service S (:methods ...))` | supported | |
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
