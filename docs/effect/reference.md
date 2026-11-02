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
pipeline reads the source, projects mechanics declarations (the portable IR), checks them, and generates TypeScript only when
the check finds no errors. Every diagnostic has a line and column in your
source.

Canonical artifact emission and `validateDeclarations` run the same mechanics
semantic check before packaging declarations. Payload contracts and domain
validators remain additional checks. Selecting one module for emission checks
its resolved dependencies first; a bad dependency cannot be hidden by selection.

Host/CLI typechecking, host editor analysis, and the language-server analysis
workspace also use mechanics diagnostics for explicit Effect signatures,
services, layers, and their signed helpers. Unrelated kernel and descriptor
forms keep their existing checks. Hover uses recorded mechanics expression
types and declared signatures; definitions use the existing symbol index.

The [Effect TypeScript conformance suite](https://github.com/bjacobso/forma/tree/main/conformance/effect-typescript)
contains complete programs for each feature. For every one it records the
exact generated module, typechecks it, and runs it.

For multiple files, use the isolated [file-module workflow](/modules). It checks
each file separately and emits real relative imports and explicit exports.
Package resolution and compile-time library imports remain proposals.

## Declarations

| Forma | Effect TypeScript |
| --- | --- |
| `(type User {:id UserId :nick (Option String)})` | `Schema.Struct({ id: UserId, nick: Schema.optionalKey(Schema.String) })` and `export type User = typeof User.Type` |
| `(type UserId (Brand String))` | `Schema.String.pipe(Schema.brand("UserId"))`; construct with `(UserId "u-1")` |
| `(type Role (Union :admin :member))` | `Schema.Literals(["admin", "member"])` |
| `(Tuple A B)`, `(Union A B)`, `(List T)`, `(Map String T)` | tuple, union, array, and dictionary schemas |
| `(type Shape (Tagged :tag kind (Circle {:radius Float}) (Square {:side Float})))` | a union of records with a literal `kind` field |
| `(type Rule (Union {:kind "all" :rules (List Rule)} {:kind "not" :rule Rule}))` | `export type Rule = ...` and `export const Rule: Schema.Codec<Rule>`, with `Schema.suspend` for each recursive reference |
| `(Union String Null)` | `Schema.Union([Schema.String, Schema.Null])`. `Null` is JSON `null` for schemas; `nil` in bodies is still `Unit`, so bodies cannot construct a `Null` yet |
| `(String :pattern "^[a-z]+$" :min-length 1 :max-length 40)`, `(Int :min 0 :max 10)`, `(Float :finite true)`, `(List T :max-length 3)` | `.check(Schema.isPattern(...))`, `Schema.isFinite`, `Schema.isMinLength`, `Schema.isMaxLength`, `Schema.isGreaterThanOrEqualTo`, and `Schema.isLessThanOrEqualTo` |
| `(class Customer {:name String})` | `class Customer extends Schema.Class<Customer>("Customer")({...})`; construct with `(Customer {:name "Ada"})` |
| `(error NotFound {:id String})` | `class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {...})` |
| `(service Users (: find (-> String (Effect (Option User)))))` | `Context.Service` with a typed `find` method |
| `(: f (-> String String)) (define f [name] (str "Hello " name))` | an ordinary typed function |
| `(: rates (Map String Int)) (define rates {"standard" 10})` | a typed dictionary constant |
| `(: find-user (-> String (Effect User [NotFound] [Users.find]))) (define find-user [id] ...)` | an `Effect.gen` function |
| `(layer UsersLive :provides Users (define find [id] ...))` | a layer implementing service methods |
| `(layer AppLive (layer-provide A (layer-merge B C)))` | composition of layers |
| `(provide eff (implement Users (define find [id] ...)))` | `Layer.succeed(Users, Users.of({...}))` built where it is provided |

Signatures may appear anywhere in their module. An Effect type names its success
value and optional finite sets of errors and requirements: `(Effect User)`,
`(Effect User [NotFound])`, or `(Effect User [NotFound] [Users.find])`.

### Local providers

`implement` writes a service implementation inside `provide`, where its
methods can use local values. It is how a Forma program supplies a test double:

```lisp
(do! [writes (ref-make (: [] (List String)))
      _ (provide (save-user "Ada")
          (implement Store
            (define get [key] (succeed "Ada"))
            (define set [key value] (ref-update writes (fn [xs] (conj xs value))))))]
  (ref-get writes))
```

Members follow the layer rules: each matches its service signature, raises only
the errors the member declares, and cannot use its own service. An `implement`
defines every member unless it starts with `:delegate`, which forwards the
undefined members to the outer implementation of the service:
`(implement Payments :delegate (define charge [cents] (fail ...)))`. The
`provide` discharges the service from the effect's requirements and adds the
requirements of the methods, plus every forwarded member of a delegating
`implement`. `implement` is valid only as a layer argument of `provide`; it
cannot be bound with `let` or passed to `layer-merge`.

`provide` takes several layers, and each wraps the ones before it, so
`(provide eff A B)` is `(provide (provide eff A) B)`. A layer's methods get
their services from outside it, so list a dependency after the layers that use
it. Here the Store double records through the Audit double:

```lisp
(provide (save-user "Ada")
  (implement Store
    (define get [key] (succeed "Ada"))
    (define set [key value] (Audit.record (str key "=" value))))
  (implement Audit (define record [entry] (ref-update entries (fn [xs] (conj xs entry))))))
```

Listing Audit first is reported as `mechanics/provide-order`, at the call that
would reach past it.
Requirements name individual capabilities or whole services. `Scope` is the
requirement introduced by resources.

A zero-argument effect is a value: `(: ready (Effect Bool)) (define ready
(succeed true))`. Refer to it as `ready`. Layer signatures use
`(Layer [Provides...] [Errors...] [Requirements...])`.

Records require fields by default. `(Option T)` fields may be absent and generate
optional wire keys. Class and error types are nominal. Refer to other schemas
by their declared names. Schemas may refer to themselves, directly or through
each other, as long as the cycle does not pass through a brand or a class:
`Schema.Codec<T>` needs the decoded and encoded shapes to agree. `:pattern`
applies to `String`, `:min-length` and `:max-length` to `String` and `List`, and
`:min` and `:max` to `Int` and `Float`, and `:finite` to `Float`. In expressions, `(Ref T)` is an Effect reference, and
`(Option T)`, `(Result A E)`, `(Fiber A [E])`, `(Stream A [E] [R])`, and
`(-> A B)` are the corresponding value types.

## Effect bodies

| Forma | Effect TypeScript |
| --- | --- |
| `(do! [x eff] eff2 body)` | `const x = yield* eff; yield* eff2; ...` |
| `(do! [x eff :let [y value]] body)` | mixes effects with lexical pure bindings |
| `(let [x value] eff body)` | `const x = value; yield* eff; ...` (`let` binds values; running an effect needs `do!`) |
| `(do eff eff2 body)` | `yield* eff; yield* eff2; ...` |
| `(succeed v)`, a plain value | `return v` |
| `(fail (NotFound {:id id}))` | `yield* Effect.fail(new NotFound({ id }))` |
| `(Users.find id)`, `(other-op x)` | `users.find(id)`, `otherOp(x)` |
| `(if c a b)`, `(when c ...)`, `(unless c ...)`, `(cond c a ... :else z)` | `if` statements; conditions must be `Bool` |
| `(match opt (Some x) a None b)` | `Option.isSome` with the payload bound |
| `(match res (Ok v) a (Err e) b)` | `Result.isSuccess` |
| `(match shape (Shape.Circle c) a (Shape.Square s) b)` | `switch (shape.kind)` with narrowing |
| `(match code 200 a 404 b _ c)`, `(match flag true a false b)` | `switch` on the value; strings and numbers need a final `_` |
| `(match error (NotFound e) a (Forbidden f) b)` | `switch (error._tag)` over a union of tagged errors |
| `(catch eff (NotFound e) handler)` | `Effect.catchTag` |
| `(catch eff (A a) h1 (B b) h2)` | `Effect.catchTags` |
| `(catch eff error handler)` | `Effect.catch` |
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
| `(config Int "PORT" :default 8080)` | `Config.withDefault(Config.Int("PORT"), 8080)` (fails with `ConfigError`) |
| `(decode User input)` | `Schema.decodeUnknownEffect(User)(input)` (fails with `SchemaError`) |
| `(provide eff AppLive)`, `(provide eff (implement Svc ...) OtherLive)` | `Effect.provide`. Services used inside are resolved inside the provided effect. |
| `(log "message" value)` | `Effect.log` |

The body of `do!`, `let`, or `do` may hold several forms. Forms before the last
run in order for their effects, and the last form is the result, so an effect
whose result is unused needs no `_` binding.

Streams are values: `stream-of`, `stream-range`, `stream-map`,
`stream-filter`, `stream-take`, and `stream-map-effect` build them, and
`stream-run-collect`, `stream-run-fold`, and `stream-run-for-each` run them.

Values use ordinary Forma expressions:

- records `{:id id}` and vectors;
- `get` and `assoc` for fields, `Map` keys, and classes;
- `str`, `fn`, `if`, `cond`, `let`, `match`, and `Some`/`None`;
- arithmetic: `+ - * / quot mod max min abs round floor`;
- comparisons, `and`/`or`/`not`, and `=`/`!=`;
- collections: `map filter reduce find any? every? count empty? concat conj first sum`;
- maps: `keys vals dissoc has-key?`;
- strings: `join split trim upcase downcase starts-with? ends-with? includes? to-string`;
- options: `get-or-else is-some is-none`;
- durations: `millis seconds minutes`.

Getting an `(Option T)` field or a `Map` key produces `(Option T)`. Map
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
- an `implement` misses a member without `:delegate`, appears anywhere but as
  a layer argument of `provide`, or (as a warning) provides a service the
  effect does not use, delegates when it defines every member, or uses a
  service that is provided inside it;
- a service method declares a requirement (Effect service methods are
  requirement-free; give the layer the dependency instead);
- names, types, errors, or requirements are unknown, or definitions are
  duplicated, or a recursive schema passes through a brand or a class;
- two Forma names become the same TypeScript name (`foo-bar` and `fooBar`),
  or a declaration takes a name the module needs (`Effect`, `Math`);
- a value cannot be represented (`1e400`, integers beyond ±2^53, `__proto__`
  keys, duplicate keys, `Unit` stored in a collection, an error field named
  `_tag`);
- a function or constant calls a service;
- a top-level form is not part of an Effect program (an untyped `define`, a
  misspelled declaration head, a bare expression, or an orphan signature).

TypeScript would also reject most of these mistakes once the code is
generated. Forma reports them first, against the Forma source. Some checks
are stricter than TypeScript:

- conditions must be `Bool`, with no JavaScript truthiness;
- `=` and `includes?` compare only primitives, enums, and brands, because
  records would be compared by reference;
- `str` and `to-string` accept only primitives, not records;
- `Int` can flow into `Float` (`Number` and `Num` are rejected type names), so `(/ a b)` cannot flow into an `Int` (use
  `quot`);
- `let` cannot silently run an effect.

Whole-number literals such as `0` are `Int`; `0.0` is `Float`. Use `0.0` to
start a Float accumulator. Int results are checked against the safe integer range.

Each rejection case in the conformance suite records whether TypeScript would
also reject the code generated with the checker bypassed.

## What is not covered yet

- Recursion through brands, classes, and errors, `Schema.TaggedClass`, and
  schema transformations.
- Generic (type-parameterised) operations and functions.
- Schedule composition beyond `jittered` (`both`, `either`, `while`/`until`
  predicates), `Queue`, `PubSub`, `Deferred`, `Semaphore`, and scoped forks.
- JavaScript interop such as `Effect.promise`. Host code supplies that
  through services.
- The hosted mechanics runtime (`makeMechanicsRuntime`) still executes only
  the original body forms.
- The low-level HM API (`Type.inferSourceStr`) remains separate and does not
  understand every mechanics form. The shared path routes supported declarations
  to the mechanics checker; it does not merge the two type systems.
- Editor analysis does not infer missing Effect signatures or expose every
  mechanics type through the HM type environment. Service-member navigation
  remains limited by the symbol index. File import resolution in the
  language-server workspace remains unfinished; host/CLI module checking and
  linking use the resolved module graph. Effect module evaluation still rejects
  programs with `module/effect-runtime`.
