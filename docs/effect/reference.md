# Effect reference

This page is the reference for writing Effect programs in Forma. For why you
might, and what it costs, see [Forma for Effect](/effect).

Forma can author Effect TypeScript programs. You write schemas, errors,
services, operations, and layers in Forma; the compiler checks them and
generates an Effect 4 module that reads like hand-written Effect code:
`Schema` constants, `Schema.TaggedError` classes, `Context.Service` classes,
`Effect.gen` functions, and `Layer` values.

```ts
import { Mechanics } from "@formalang/ts";

const result = Mechanics.generateEffectProgram(source, { sourceId: "users.lisp" });
if (!result.ok) {
  for (const d of result.diagnostics) {
    console.error(`${d.span?.startLine}:${d.span?.startColumn} ${d.code} ${d.message}`);
  }
} else {
  writeFileSync("users.ts", result.code!);
}
```

`elaborateEffectProgram` runs the same pipeline without generating code. The
pipeline reads the source, projects mechanics declarations (the portable IR
that both engines produce), checks them, and generates TypeScript only when
the check finds no errors. Every diagnostic has a line and column in your
source.

The [Effect TypeScript conformance suite](https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript)
contains complete programs for each feature. For every one it records the
exact generated module, typechecks it, and runs it.

## Declarations

| Forma | Effect TypeScript |
| --- | --- |
| `(define-schema User (Struct (field id UserId) (field nick (Optional String))))` | `export const User = Schema.Struct({ id: UserId, nick: Schema.optionalKey(Schema.String) })` and `export type User = typeof User.Type` |
| `(define-schema UserId (Brand UserId String))` | `Schema.String.pipe(Schema.brand("UserId"))`; build values with `(UserId "u-1")` |
| `(define-schema Role (Enum admin member))` | `Schema.Literals(["admin", "member"])` |
| `(Tuple A B)`, `(Union A B)`, `(Array T)`, `(Map T)` | `Schema.Tuple([...])`, `Schema.Union([...])`, `Schema.Array`, `Schema.Record(Schema.String, ...)` |
| `(TaggedUnion kind [circle (Struct ...)] ...)` | a `Schema.Union` of structs with a literal `kind` field |
| `(define-class Customer (:fields (field name String)))` | `class Customer extends Schema.Class<Customer>("Customer")({...})`; build with `(Customer {...})` |
| `(define-error NotFound (:fields (field id String)))` | `class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {...})` |
| `(define-service Users (:methods (find [id String] (Effect (Option User) [] []))))` | `class Users extends Context.Service<Users, {...}>()("Users")` |
| `(: f (-> A B)) (define f (fn [a] ...))` | `export const f = (a: A): B => ...` |
| `(: rates (Map Int)) (define rates {...})` | `export const rates: { readonly [key: string]: number } = {...}` |
| `(: op (-> A (Effect S [E] [R]))) (define-operation op [a] ...)` | `export const op = (a: A): Effect.Effect<S, E, R> => Effect.gen(...)` |
| `(define-layer UsersLive (:provides Users) (:setup [...]) (:methods ...))` | `Layer.effect(Users, Effect.gen(...))`, or `Layer.succeed` when nothing runs at construction |
| `(define-layer AppLive (layer-provide A (layer-merge B C)))` | `Layer.provide(A, Layer.mergeAll(B, C))` |

Operation signatures name their success type, a set of errors, and a set of
requirements. A requirement can name a single capability (`Users.find`) or
a whole service (`Users`). `Scope` is the requirement added by resources. A
zero-argument operation is written `(-> (Effect ...))`. A layer can declare
its type with `(: AppLive (Layer [Provides...] [Errors...] [Requirements...]))`.

Inside `define-schema`, `(Ref Name)` refers to another schema. In signatures,
`(Ref T)` is an Effect `Ref`, and `(Option T)`, `(Result A E)`,
`(Fiber A [E])`, `(Stream A [E] [R])`, and `(-> A B)` are the corresponding
Effect and function types.

## Effect bodies

| Forma | Effect TypeScript |
| --- | --- |
| `(do! [x eff _ eff2] body)` | `const x = yield* eff; yield* eff2; ...` |
| `(let [x value] body)` | `const x = value` (`let` binds values; running an effect needs `do!`) |
| `(succeed v)`, a plain value | `return v` |
| `(fail (NotFound {:id id}))` | `yield* Effect.fail(new NotFound({ id }))` |
| `(Users.find id)`, `(other-op x)` | `users.find(id)`, `otherOp(x)` |
| `(if c a b)`, `(when c ...)`, `(unless c ...)`, `(cond c a ... :else z)` | `if` statements; conditions must be `Bool` |
| `(match opt (some x) a none b)` | `Option.isSome` with the payload bound |
| `(match res (success v) a (failure e) b)` | `Result.isSuccess` |
| `(match shape (circle c) a (square s) b)` | `switch (shape.kind)` with narrowing |
| `(match code 200 a 404 b _ c)`, `(match flag true a false b)` | `switch` on the value; strings and numbers need a final `_` |
| `(match error (NotFound e) a (Forbidden f) b)` | `switch (error._tag)` over a union of tagged errors |
| `(catch eff (NotFound e) handler)` | `Effect.catchTag` |
| `(catch eff (A a) h1 (B b) h2)` | `Effect.catchTags` |
| `(catch eff (_ e) handler)` | `Effect.catch` |
| `(map-error eff f)`, `(or-else-succeed eff v)`, `(or-die eff)` | `Effect.mapError`, `Effect.orElseSucceed`, `Effect.orDie` |
| `(option eff)`, `(result eff)` | `Effect.option`, `Effect.result` |
| `(acquire-release acquire (fn [r] release))`, `(scoped eff)` | `Effect.acquireRelease`, `Effect.scoped` |
| `(ensuring eff finalizer)`, `(add-finalizer eff)` | `Effect.ensuring`, `Effect.addFinalizer` |
| `(all {:a e1 :b e2} :concurrency :unbounded)`, `(all [e1 e2])` | `Effect.all` over a record or tuple |
| `(for-each xs (fn [x] eff) :concurrency 4)` | `Effect.forEach` |
| `(race a b)`, `(fork eff)`, `(join fiber)`, `(interrupt fiber)` | `Effect.race`, `Effect.forkChild`, `Fiber.join`, `Fiber.interrupt` |
| `(sleep 10)`, `(timeout eff 50)` | `Effect.sleep`, `Effect.timeout` (fails with `TimeoutError`) |
| `(retry eff :times 3 :schedule (exponential 10))`, `(repeat eff :schedule (spaced 100))` | `Effect.retry`, `Effect.repeat` with `Schedule.exponential`, `spaced`, `fixed`, `recurs`, `jittered` |
| `(ref-make v)`, `(ref-get r)`, `(ref-set r v)`, `(ref-update r f)` | `Ref.make`, `Ref.get`, `Ref.set`, `Ref.update` |
| `(config Int "PORT" :default 8080)` | `Config.withDefault(Config.int("PORT"), 8080)` (fails with `ConfigError`) |
| `(decode User input)` | `Schema.decodeUnknownEffect(User)(input)` (fails with `SchemaError`) |
| `(provide eff AppLive)` | `Effect.provide`. Services used inside are resolved inside the provided effect. |
| `(log "message" value)` | `Effect.log` |

Streams are values: `stream-of`, `stream-range`, `stream-map`,
`stream-filter`, `stream-take`, and `stream-map-effect` build them, and
`stream-run-collect`, `stream-run-fold`, and `stream-run-for-each` run them.

Values use ordinary Forma expressions:

- records `{:id id}` and vectors;
- `get` and `assoc` for fields, `Map` keys, and classes;
- `str`, `fn`, `if`, `cond`, `let`, `match`, and `some`/`none`;
- arithmetic: `+ - * / quot mod max min abs round floor`;
- comparisons, `and`/`or`/`not`, and `=`/`!=`;
- collections: `map filter reduce find any? every? count empty? concat conj first sum`;
- maps: `keys vals dissoc has-key?`;
- strings: `join split trim upcase downcase starts-with? ends-with? includes? to-string`;
- options: `get-or-else is-some is-none`;
- durations: `millis seconds minutes`.

Getting an `(Optional T)` field or a `Map` key produces `(Option T)`. Map
functions use Effect's `Record` module, which only sees own keys. A builtin
with one signature can be passed as a function, as in `(map upcase names)`.

### Literal types

As in TypeScript, a record or array literal with no target type widens its
literals: `{:role "member"}` has `:role String`. To build a value of a schema
with enum or tag fields, construct it, as in `(Member {:name n :role
"member"})`, or pass it where the schema is expected. When a value that Forma
types against an enum or tag ends up somewhere TypeScript has no contextual
type (a generator `return`, `Effect.succeed`, a `forEach` body, or a `const`),
the generator keeps the literal type: records of a schema get
`{...} satisfies Member` and other literals get `as const`.

## Checking

The checker runs over the portable IR, so it checks what the generator
consumes. It rejects a program when:

- a value does not match its schema (missing or unknown record fields, wrong
  field types, or a fractional value where an `Int` is required);
- an operation can fail with an error, or uses a requirement, that its
  signature does not declare (the diagnostic points at the call that
  introduced it);
- a `match` misses a case, names a case that does not exist, or has an
  unreachable arm;
- a `catch` handles an error the effect cannot raise;
- a release action or finalizer can fail;
- a layer does not implement every method of its service, a method can fail
  with an error the service does not declare, or a layer's declared type does
  not match what it provides and requires;
- a service method declares a requirement (Effect service methods are
  requirement-free; give the layer the dependency instead);
- names, types, errors, or requirements are unknown, or definitions are
  duplicated, or schemas are recursive (`Schema.suspend` is not generated yet);
- two Forma names become the same TypeScript name (`foo-bar` and `fooBar`),
  or a declaration takes a name the module needs (`Effect`, `Math`);
- a value cannot be represented (`1e400`, integers beyond ±2^53, `__proto__`
  keys, duplicate keys, `Unit` stored in a collection, an error field named
  `_tag`);
- a function or constant calls a service;
- a top-level form is not part of an Effect program (an untyped `define`, a
  misspelled `define-...`, a bare expression, or an orphan signature).

TypeScript would also reject most of these mistakes once the code is
generated. Forma reports them first, against the Forma source. Some checks
are stricter than TypeScript:

- conditions must be `Bool`, with no JavaScript truthiness;
- `=` and `includes?` compare only primitives, enums, and brands, because
  records would be compared by reference;
- `str` and `to-string` accept only primitives, not records;
- `Int` is a subtype of `Number`, so `(/ a b)` cannot flow into an `Int` (use
  `quot`);
- `let` cannot silently run an effect.

Integral literals such as `0` are `Int`. To start a `Number` accumulator from
`0`, write `(: 0 Number)`.

Each rejection case in the conformance suite records whether TypeScript would
also reject the code generated with the checker bypassed.

## What is not covered yet

- Recursive schemas (`Schema.suspend`), `Schema.TaggedClass`, and schema
  transformations.
- Generic (type-parameterised) operations and functions.
- Schedule composition beyond `jittered` (`both`, `either`, `while`/`until`
  predicates), `Queue`, `PubSub`, `Deferred`, `Semaphore`, and scoped forks.
- JavaScript interop such as `Effect.promise`. Host code supplies that
  through services.
- The hosted mechanics runtime (`makeMechanicsRuntime`) still executes only
  the original body forms.
- The general HM typechecker (`Type.inferSourceStr`), which drives the
  language server, does not yet understand layers, combinators, streams, or
  multi-clause `catch`. For Effect programs, use the mechanics checker.
