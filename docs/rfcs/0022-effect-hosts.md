# RFC 0022: Effect hosts: one lowering for TypeScript, Go, and Rust

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-11-04 |
| Builds on | The Effect-Go RFC and prototype (unmerged; see [Current state](#current-state)); [RFC 0021](./0021-languages-as-libraries.md)'s kernel ports and differential conformance |
| Scope | A host-neutral lowering between the mechanics checker and code generators, per-host profiles, a shared runtime kernel contract, data-driven conformance scenarios, host-keyed emit hooks and externs, and a Rust target that emits idiomatic async Rust |
| Direction | Check once, lower once, print per host. A host is a profile, a printer, and a kernel that passes the shared scenarios. Rust is the second host built this way and the first whose types carry Forma's error sets |

## Summary

The Effect pipeline checks a program once and then generates Effect
TypeScript. An unmerged prototype added a Go generator over the same checked
IR. The Go generator is a near method-for-method copy of the TypeScript
generator, with the same statement walker, binding analysis, match lowering,
service tracking, and layer ordering, rewritten for Go strings. A Rust target
written the same way would be a third copy.

This RFC proposes four shared pieces and a Rust target that uses them:

1. **A lowering pass** turns checked mechanics IR plus `CheckInfo` into a
   typed, statement-shaped program. In that program every decision that does
   not depend on the host has already been made. Generators become printers.
2. **Host profiles** hold naming rules, reserved words, the type mapping, and
   the set of supported constructs, as data plus one type function per host.
3. **A kernel contract** lists the runtime behaviour (Exit and Cause,
   interruption, scopes, layers, schedules, concurrency primitives) and the
   value semantics (Int range, strings, map order, number formatting) that
   every host must implement. The contract is pinned by shared tests.
4. **Data-driven conformance scenarios** describe a call, stubbed services,
   and the expected exit as JSON that every host's harness runs. No case needs
   a hand-written harness per host.

The Rust target maps Forma onto Rust more directly than Go allows. Closed
error sets become generated `enum`s in `Result<A, E>`. `do!` becomes an
`async fn` with `.await?`. Tagged unions become `enum`s with `match`.
Services become traits, and service-level requirements become trait bounds.
The hard part moves from the type mapping to the runtime: async Rust cancels
by dropping futures and has no async destructors. The proposal keeps
Effect's finalizer guarantees with a fiber-owned finalizer stack.

## Motivation

**The second generator was a copy.** `effect-typescript.ts` is about 1,900
lines and the prototype `effect-go.ts` is about 1,400. Their generator classes
have the same methods: `Names`, `schemaLines`, `serviceLines`,
`operationLines`, `layerLines`, `statements`, `bindingLines`,
`effectExpression`, `combinator`, `matchStatements`, `errorValue`,
`newError`, `servicesUsed`, `isEffectValue`, `value`, `application`, and
`special`. The Go generator imports `bindingSteps`, `letSteps`, `freeIn`, and
`referencedIn` from the TypeScript generator, because they encode decisions
about the program, not about TypeScript. Every checker change that adds an IR
node now needs one change per generator. A third host would make that cost
permanent.

**The decisions are already host-neutral.** The prototype found that the
hard questions a second host raises are about Forma, not Go. Examples: which
named type a record literal builds, map iteration order, string length, the
Int range, and number formatting. Each one is answered once in the lowering
or the kernel contract, so a host never answers it again.

**Rust carries what Go could not.** The Effect-Go RFC's central limit is that
Go's types carry only `A`, so the checker's error and requirement sets end up
in doc comments. Rust has sum types, `Result`, the `?` operator with `From`
conversion, traits, and generics. A Rust consumer gets Forma's closed error
sets as real types, which the Rust compiler then enforces in hand-written
code that calls generated code. Forma's tagged unions, `Option`, and `match`
map to native Rust constructs that the Go prototype had to leave
unimplemented.

**One idea in two places.** [RFC 0021](./0021-languages-as-libraries.md)
proposes Lisp targets as a resugared surface plus a kernel port plus
differential conformance. Effect hosts have the same shape: a printer, a
runtime kernel, and conformance against shared expectations. This RFC
defines that shape for effectful programs so that the two proposals share a
vocabulary and, where possible, the harness.

## Current state

Implemented on `main`:

- `elaborateEffectProgram` (`mechanics/elaborate.ts`) reads, projects
  (`artifact.ts`), and checks (`check.ts`, wrapped by `checked.ts`) an Effect
  program. `CheckInfo` records per-node value and effect types, resolved
  calls, match shapes, record targets for annotated literals, literal
  targets, and layer context calls.
- `generateMechanicsEffectTypeScriptModule` (`effect-typescript.ts`) is the
  only generator over checked IR. It targets `effect@4.1.1`. Naming lives in
  `naming.ts` and schema generation in `effect-schema.ts`. Both are TypeScript
  specific.
- `mechanics/runtime.ts` interprets mechanics IR directly in JavaScript for
  `invoke`. It does not read `CheckInfo`.
- `provide` accepts only the name of a layer declared with `layer`
  (`check.ts`, `mechanics/provide`), so every program's layer graph is known
  statically.
- Prelude forms have one `:emit` hook each, written with `ts/*` primitives
  (`preludes/http-api.lisp`, `elm.lisp`, `email.lisp`).
- `conformance/effect-typescript/` has thirteen positive Effect cases, each
  with a TypeScript golden and a hand-written `harness.ts`, plus negative
  cases with exact diagnostics.

On an unmerged prototype branch (the "Forma → Go" Conductor workspace, not
pushed to this repository):

- An Effect-Go RFC, numbered 0019 on that branch, which collides with
  [RFC 0019](./0019-everyday-checker-gaps.md) here. It proposes one fiber per
  goroutine with an opcode interpreter, `Gen`/`Await` with panic-based failure,
  a type mapping, `extern :go` with required `:cancel` modes, and two-host
  conformance.
- `mechanics/effect-go.ts`, a Go runtime prototype of about 2,600 lines with
  77 tests, and four conformance cases with Go harnesses: `crud-users`,
  `operational-effects`, `concurrent-workflow`, and `resource-scope`.
- Host-keyed `:emit {:ts … :go …}` hooks for `http-api`, a `go/*` primitive
  set, a host-neutral http-api link step, and a shared `wire-cases.json` run
  against both servers.
- Recorded cross-host differences: map key order, three string functions,
  and float formatting.

Not implemented anywhere: a lowering pass, host profiles, a kernel contract,
scenario-driven conformance, a Rust generator, or a Rust runtime.

## Proposal

### Pipeline

```
program.lisp ─ read ─ project ─ check ─ lower ─┬─ print TS   ── effect (Node, browsers)
                                               ├─ print Go   ── forma-effect-go (goroutines)
                                               └─ print Rust ── forma-effect (tokio)

conformance/effect/cases/<name>/
  program.lisp ── scenarios.json ──▶ one scenario runner per host
```

The checker and the lowering run once per program. A printer reads only the
lowered program and its host profile. A printer never reads `CheckInfo` and
never walks raw IR.

### 1. The lowered program

`lowerMechanicsProgram(checked, profile)` returns a `LoweredProgram`, a
closed, typed tree:

**Declarations, already ordered.** Schemas are in dependency order, with
recursive groups marked. Constants are ordered by their dependencies, and
layers by the services they need. Today each generator orders these itself
(`orderSchemaDeclarations`, `orderConstants`, `orderLayers`). The
declaration kinds are `Schema` (fields, brand, literal union, tagged union),
`Error` (fields and an optional status), `Service` (typed methods),
`Function` (pure), `Operation`, `Layer`, and `Constant`.

**Operations carry their full effect.** Each operation records its success
type, its closed error set, its requirements at service and method
granularity, and the services its body reads. Each host uses what its types
can express: TypeScript uses all of it, Rust uses the error set and service
bounds, and Go writes the sets into a doc comment.

**Bodies are blocks of statements.** The statement kinds are:

- `Bind`: a local bound from an effect;
- `Let`: a local bound from a pure value;
- `Discard`: an effect run for its effect only;
- `Return`: a value or an effect in tail position;
- `Fail`: a typed error value;
- `If` and `Match`, whose arms are blocks.

`Cond`, `When`, and `Unless` are lowered to `If`. Statement-versus-expression
mode (`"return"` and `"discard"` in both prototypes) is decided here.

**Locals are identities, not strings.** Each local has a unique id, its
Forma name as a hint, its type, and a use count, and each use is marked as the
last use or not. Hosts use these facts differently. TypeScript and Go turn
unused bindings into `_`, and Rust moves a value at its last use and clones
it earlier. Today `freeIn` and `referencedIn` recompute these facts per
generator.

**Matches are decisions.** A `Match` records which shape it matches on:
`Option`, `Result`, literals, or a tagged union with its discriminator.
The checker's `MatchShape` already records exactly these four kinds. The
lowering adds each arm's typed bindings and whether a catch-all is present.

**Records have a target.** Every record literal names the declared type it
builds, or a hoisted shape with a stable generated name. The Go prototype
matched literals to schemas by exact field set. This RFC moves that rule into
the checker, which already records `recordTargets` for annotated literals,
and makes an ambiguous literal a checker diagnostic at the literal's span.

**Effect expressions use a closed set of kinds:**

- `ServiceCall` and `OperationCall`;
- `Catch`, with tag handlers and an optional catch-all;
- one `Combinator` per kind that exists today: `scoped`, `ensuring`, `all`,
  `race`, `fork`, `join`, `interrupt`, `sleep`, `timeout`, `retry`, `repeat`,
  `option`, `result`, `provide`, `log`, `config`, and `decode`;
- the stream calls.

Each operand is typed. `provide` names a layer, never a layer expression.

**Values are typed and resolved:**

- literals carry their target type;
- arithmetic records whether it is `Int` or `Float`, and an `Int` operation
  is marked as checked;
- builtins carry their instantiated types;
- lambdas carry their parameter and result types;
- variables refer to local ids.

**Every node keeps its author span.** When a host cannot translate a node,
it reports `<host>/unsupported` at the author's form, through the lowering's
support check (see [profiles](#2-host-profiles)). The prototypes throw
instead. Generated output is never partial.

The lowering also carries what the TypeScript printer needs: context calls
inside layers (`contextCalls`), literal preservation, and service scopes.
These stay as plain flags on the nodes. Precedence, layout, and import
management stay in the printer.

### 2. Host profiles

A profile is data plus a few functions:

| Field | TypeScript | Go | Rust |
| --- | --- | --- | --- |
| Reserved words | JS reserved words and generated globals | Go keywords and predeclared names | Rust strict and reserved keywords; `r#` is not used |
| Type names | `PascalCase` | `PascalCase` (exported) | `PascalCase` |
| Values and operations | `camelCase`, `valid?` → `isValid` | `PascalCase` exported, `camelCase` locals | `snake_case`, `valid?` → `is_valid` |
| Fields | Exact Forma name as a property | `PascalCase` with a JSON tag | `snake_case` with `#[serde(rename)]` when the name changes |
| Collision rule | Suffix | Suffix (`DashboardOp`) | Not needed between types and functions, which live in separate namespaces |
| Overrides | — | `:go-name` | `:rust-name` |
| Type mapping | `typeTs` | `goType` | `rustType` |
| Supported nodes | All | The set the Go printer implements | The set the Rust printer implements |

The naming rules for each host are specified and pinned by tests, because
generated names are API. The support set is how the lowering reports
unsupported constructs before printing starts.

### 3. The kernel contract

A host is not only a printer. The generated code needs a runtime with
Effect's semantics and value helpers with Forma's semantics. This RFC
specifies both as a contract that is independent of any host:

**Runtime:**

- `Exit` and `Cause`, following the pinned Effect version: a flat list of
  `Fail`, `Die`, and `Interrupt` reasons in Effect 4;
- interruption rules, uninterruptible regions, and re-delivery when a region
  exits;
- supervision, where children are interrupted and awaited when their parent
  completes;
- `Scope`, finalizer order, and `acquireRelease`;
- layer construction with memoization;
- `Clock`, `TestClock`, and `Random`;
- `Schedule`;
- `Ref`, `Deferred`, `Queue`, `Semaphore`, and `PubSub`.

The Effect-Go prototype's runtime tests are the starting corpus. Ten of them
were ported directly from Effect's own suite. Each scenario becomes a
host-neutral description where possible, and a test with the same name in
each runtime where not.

**Values:**

- the checked Int range;
- string length, slicing, trimming, and case mapping;
- map iteration order;
- float-to-string formatting;
- structural equality;
- the JSON wire encoding of brands, options, tagged errors, and maps.

The Effect-Go RFC lists three open decisions here (string units, map order,
and the wire encoding). This RFC does not decide them. It requires each one
to be decided once, for every host, as a conformance case.

The TypeScript host's kernel is `effect` plus JavaScript's own value
behaviour, which is today's de facto specification. The Go and Rust kernels
are libraries.

### 4. Scenario-driven conformance

Today a positive case has a hand-written `harness.ts`. The Go prototype
mirrored four of them by hand. Instead, each case gains a `scenarios.json`:

```json
[
  {
    "name": "missing user fails with UserNotFound",
    "call": "get-user",
    "args": ["u-404"],
    "services": { "UserRepo": { "find": [{ "args": ["u-404"], "returns": { "None": null } }] } },
    "expect": { "fail": { "_tag": "UserNotFound", "id": "u-404" } }
  }
]
```

Each host has one scenario runner. The runner decodes arguments with the
kernel's wire encoding, builds stub services from the recorded calls,
provides them, runs the operation, and compares the exit. Stubs can return,
fail, sleep on the test clock, or block until interrupted. That covers the
timing cases in `concurrent-workflow`. `mechanics/runtime.ts` can run the same
scenarios as a third, interpreted oracle.

Hand-written harnesses remain for cases a scenario cannot express, such as
`stream-pipeline` and the browser cases. Negative cases need nothing per
host, because the checker rejects them before lowering.

### 5. Host-keyed emit hooks and externs

The Go prototype made `:emit` accept `{:ts (fn …) :go (fn …)}` and added
`go/*` primitives next to `ts/*`. This RFC keeps the host-keyed map. A plain
function still means `:ts`, so existing preludes are unchanged. It replaces
per-host primitive families with one family of host queries that every
profile answers:

- `host/type`, `host/name`, and `host/zero` for types, names, and zero
  values;
- `host/operation` and `host/children` for structure.

An emitter then writes only host syntax, never host type strings. A form
without a hook for the selected host is a located `<prelude>/emit` error.

`extern` (from the unmerged Effect-as-host proposal) gains a host key per
binding, with the same `:cancel` modes for every host:

| `:cancel` | Go | Rust |
| --- | --- | --- |
| `:context` | `func(ctx, …) (A, error)`, called on the fiber's goroutine | A cancel-safe `Future`, dropped on interruption |
| `:abandon` | Run on a helper goroutine and abandoned | Spawned as a detached task and abandoned |
| `:none` | Run uninterruptibly | Run in an uninterruptible region |

### 6. The Rust target

#### Type mapping

| Forma | Rust |
| --- | --- |
| `String` | `String` (UTF-8), with kernel helpers for the specified string semantics |
| `Int` | `i64`, with checked arithmetic in the specified range; a failed check is a defect |
| `Float` / `Bool` / `Unit` | `f64` / `bool` / `()` |
| `Duration` | `std::time::Duration` |
| `(Brand String)` | A newtype: `pub struct UserId(pub String);` |
| `(Union :admin :member)` | A fieldless `enum Role { Admin, Member }` with serde names |
| `{:id UserId ...}` schema | A struct; optional fields are `Option<T>` |
| Tagged union | An `enum` with one variant per tag |
| `(error E {...})` | A struct implementing `std::error::Error`, `Display`, and `tag()` |
| A closed error set `[A B]` | A generated `enum` with one variant per error and `From` impls; a single error is used directly; an empty set is `Infallible` |
| `(List T)` / `(Map String V)` / `(Tuple A B)` | `Vec<T>` / `IndexMap<String, V>` / `(A, B)` |
| `(Option T)` | `Option<T>` |
| `(Effect A [E...] [R...])` | `async fn … -> Result<A, E>`, or `-> A` when the error set is empty; service requirements become bounds on the context |
| `(-> A B)` | `fn(A) -> B` for top-level functions; `impl Fn(A) -> B` or `Arc<dyn Fn(A) -> B + Send + Sync>` for values |
| `(service S (: m ...))` | A trait with `async fn` methods, plus a `HasS` accessor trait |
| `(layer L :provides S ...)` | An async constructor that returns a value implementing `S` |
| `(Ref T)` / `(Fiber A E)` | `forma_effect::Ref<T>` / `forma_effect::Fiber<A, E>` |

Generated types derive `Clone`, `Debug`, `PartialEq`, and the serde traits.
Forma values are immutable, so cloning is always correct. The lowering's
last-use marks let the printer move instead of clone wherever possible.

#### Operations

`crud-users`'s `create-user` and `get-user` would generate:

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum CreateUserError {
    InvalidUser(InvalidUser),
    DuplicateEmail(DuplicateEmail),
}
impl From<InvalidUser> for CreateUserError { /* … */ }
impl From<DuplicateEmail> for CreateUserError { /* … */ }

/// Requires: UserRepo, Ids.
pub async fn create_user<Cx: HasUserRepo + HasIds>(cx: &Cx, input: NewUser) -> Result<User, CreateUserError> {
    let valid = validate(input).await?;
    let existing = cx.user_repo().find_by_email(valid.email.clone()).await;
    match existing {
        Some(_) => Err(DuplicateEmail { email: valid.email }.into()),
        None => {
            let id = cx.ids().next().await;
            let user = User { id, name: valid.name, email: valid.email, role: valid.role, nickname: None };
            cx.user_repo().save(user.clone()).await;
            Ok(user)
        }
    }
}

/// Requires: UserRepo.find.
pub async fn get_user<Cx: HasUserRepo>(cx: &Cx, id: UserId) -> Result<User, UserNotFound> {
    match cx.user_repo().find(id.clone()).await {
        Some(user) => Ok(user),
        None => Err(UserNotFound { id }),
    }
}
```

The example is a target sketch. No generator produces it yet. It shows the
choices this RFC proposes:

- **`do!` is `async fn`, and a failing bind is `?`.** This matches `yield*`
  exactly, with no panic signal: the rest of the body is abandoned, and the
  failure is converted into the enclosing error set by `From`. A defect is a
  Rust panic caught at the fiber boundary.
- **Error sets are named per operation** (`CreateUserError`). Two operations
  with the same set get two enums, so changing one operation's errors never
  changes another's type. Whether equal sets should share one enum is an open
  decision.
- **The checker still carries method-level requirements.** Rust bounds
  express "needs `UserRepo`" but not "needs only `UserRepo.find`". The doc
  comment keeps the finer set, as in Go.
- **Pure functions are plain `fn`s.** Generic functions become Rust generics
  with `Clone` bounds and the trait bounds their operations need.

#### Services, layers, and `provide`

A service is a trait with `async fn` methods. That gives static dispatch and
no boxing in generated code, and a test double is a struct with an `impl`.
Async trait methods are not `dyn`-compatible in stable Rust, so a dynamically
chosen implementation needs a boxed adapter, which the kernel supplies.

`provide` only accepts named layers, so the layer graph is static. The printer
generates one context struct per `provide` site. Its fields hold the provided
services, and a `build` function constructs the layers once each, in
dependency order. That is layer memoization by construction, with no runtime
memo map. Each layer's scope closes when the `provide` region exits, in
reverse construction order.

#### The runtime: `forma-effect` on tokio

Fibers are tokio tasks. The runtime adds only what the contract needs and
tokio does not provide.

**Interruption is dropping, at any `.await`.** Async Rust cancels a future by
dropping it, and the drop can happen only at an `.await`. That matches
Effect's rule that interruption is delivered at the next operation. It also
matches the `Gen`/`Await` interruption points from the Effect-Go design.
Recovery handlers (`catch`) are skipped on interruption, because the
dropped future never resumes.

**Finalizers live outside the future that is dropped.** Rust has no async
`Drop`, so an `ensuring` or `acquireRelease` finalizer cannot run from a
dropped future's destructor. Instead, each fiber owns a finalizer stack.
`scoped`, `ensuring`, and `acquireRelease` push async finalizers onto it and
pop them on normal exit. When the fiber's body completes or is dropped, the
fiber runs every remaining finalizer uninterruptibly, in reverse order,
before publishing its exit. That gives Effect's ordering on success,
failure, and interruption without relying on `Drop`.

**Uninterruptible regions.** An uninterruptible region runs as a shielded
child task. If the parent is interrupted while the region is running, the
region finishes first, and the interruption is delivered when it ends.

**Supervision.** Dropping a tokio `JoinHandle` detaches its task. So `fork`
registers the child in its parent fiber's child set. When the parent
completes, it interrupts its remaining children and awaits their finalizers.
`race`, `timeout`, and concurrent `all` are built on child fibers, so losers
are interrupted and awaited before the combinator returns, as in Effect.

**Effects are re-runnable descriptions.** A Rust future runs once.
Combinators that run an effect more than once (`retry`, `repeat`) take a
closure that makes the future, `|| create_user(cx, input.clone())`, and the
printer generates that closure. A context passed into a forked fiber must be
`Clone + Send + Sync + 'static`, so generated contexts hold services behind
`Arc`.

**Time and cancellation of foreign code.** `Clock` and `TestClock` follow the
contract. `TestClock` can be built on tokio's paused test time. The externs
table above defines how interruption reaches foreign futures.

This design must pass the same ported interruption and scope scenarios as the
Go runtime before anything else depends on it.

#### Output and formatting

The golden test in `pnpm check` must run without a Rust toolchain, so the
printer formats its own output to match `rustfmt`'s defaults, as the Go
printer did for `gofmt`. A separate CI job with Rust installed runs
`rustfmt --check`, `cargo clippy`, and the scenario runner.

The prototype lives in `prototypes/forma-rust/` as a Cargo workspace with
the `forma-effect` runtime, the `forma` value kernel, and generated
conformance crates. It is not part of `pnpm check`.

### What Go gains

The Go generator becomes a printer over the lowered program, with its goldens
unchanged except where the checker's record-target rule renames a hoisted
struct. It uses the shared scenarios instead of hand-written harnesses. Its
`go/*` primitives become `host/*` queries. Its runtime design is unchanged.

## Semantic decisions

Each decision applies to every host.

- **Interruption model.** As proposed: interruption at operation boundaries,
  with recovery skipped while it propagates and finalizers run
  uninterruptibly. Go delivers it at `Await`, and Rust delivers it when the
  future is dropped at an `.await`. Both are pinned by the shared scenarios.
- **Defects.** A Go panic or a Rust panic inside user code is a `Die` defect,
  caught at the fiber boundary with its message. The checked Int range fails
  as a defect on every host.
- **Error set identity.** In Rust, error enums are per operation, as proposed.
  Rust is the first host where the choice is visible in types.
- **Record targets** move into the checker, as described above.
- **Wire encoding** is specified once by the kernel contract. Scenario inputs
  and outputs use it, so every host runner decodes the same JSON.
- **Effect version.** All hosts pin the Effect version that the TypeScript
  target uses, which is 4.1.1 on `main`. The Go prototype ported 4.0.3. A
  version bump re-runs the shared runtime scenarios on every host.

## Alternatives considered

- **Keep one generator per host, sharing helpers ad hoc.** This is what the
  Go prototype did. It is the cheapest way to add a second host and the most
  expensive way to add a third. Every checker change still touches every
  generator.
- **Lower to a generic imperative IR, such as an SSA form or a C-like AST.**
  This would serve more hosts, but it loses structure that idiomatic output
  needs: `match` on tagged unions, `?` on error sets, and `Effect.gen`. The
  proposed lowering stays at the level of Effect programs.
- **Port Effect's opcode interpreter to Rust, as the Go prototype did.**
  That would keep runtime semantics closest to Effect. But generated code
  would build `Effect<A>` trees instead of `async fn`s that Rust users can
  read and call, and it would give up most of Rust's typing of errors. An
  interpreted core remains the fallback if the finalizer-stack design fails
  the interruption scenarios.
- **Cooperative interruption through a cancellation token.** Fibers check a
  token at each kernel call instead of being dropped. Async finalizers would
  then run in place, but foreign futures could not be interrupted unless they
  watched the token, and a missed check delays interruption without limit.
  Dropping is how Rust programs already cancel, and the fiber-owned
  finalizer stack keeps the guarantees that dropping would otherwise lose.
- **Services as structs of closures, as in Go.** This would work, but
  traits are what Rust users implement and mock. Structs of closures would
  also force boxing of every async method.
- **Rust without Effect semantics.** Generate plain `async` Rust and use
  tokio directly, with no kernel. Then `race`, `timeout`, and `fork` would
  have tokio's detach and drop behaviour instead of Effect's, and the same
  program would behave differently on Rust than on TypeScript. The shared
  conformance suite would fail, which is the point of having it.

## Related work

- The Effect-Go prototype: the first second host. Its RFC, runtime tests,
  and measured cross-host differences are the inputs to this proposal.
- [RFC 0021](./0021-languages-as-libraries.md): Lisp targets as resugared
  surfaces, kernel ports, and differential conformance against the
  TypeScript VM. The kernel contract and scenario runners here are the effectful
  counterpart.
- tokio's task and `JoinSet` APIs, `tokio-util`'s `CancellationToken`, and
  Rust's unstable async drop work frame the runtime constraints above.
- Effect's own test suite is the source of the runtime scenarios, as in the
  Go prototype.

## Implementation stages and validation

| Stage | Work | Gate |
| --- | --- | --- |
| 0 | Push the Go prototype branch, rebase it onto `main`, renumber its RFC, and bump its Effect pin to 4.1.1 | The Go prototype's goldens and Go tests pass on the rebased branch |
| 1 | `lowerMechanicsProgram` and the TypeScript printer over it | Every TypeScript golden in `conformance/effect-typescript/` and in the package tests is byte-identical; `pnpm check` passes |
| 2 | The Go printer over the lowered program; record targets in the checker | Go goldens unchanged except for reviewed hoisted-struct names; Go tests pass with `-race` |
| 3 | `scenarios.json` and runners for TypeScript, Go, and `mechanics/runtime.ts` | The four Go cases pass from scenarios on all three runners; their hand-written Go harnesses are deleted |
| 4 | `forma-effect` and `forma` for Rust, with the shared runtime scenarios | The ported interruption, scope, and layer scenarios pass on Rust |
| 5 | The Rust profile and printer | The same four cases pass from scenarios on Rust; then `pure-domain-logic` and `typed-errors`, which Go cannot yet generate, pass on Rust |
| 6 | `host/*` emit queries and `:rust` hooks for `http-api` | The shared `wire-cases.json` passes against TypeScript, Go, and Rust servers |
| 7 | `extern :rust` after the `extern` proposal lands | Negative cases for a missing `:cancel` and for an error outside the declared set |

Stages 1–3 are worth doing without Rust: they remove the duplicate generator
logic, and they let the existing Go prototype grow without a second copy of
every checker change. The roadmap rule still applies to stage 4 and later.
A Rust host needs a concrete consumer, which this RFC does not yet name.

## Decisions still required

- Whether a Rust consumer exists. That decides stages 4–7.
- Whether equal error sets share one generated Rust enum.
- Whether the Rust printer uses generic context bounds (proposed) or a
  concrete generated context type at each call site.
- Whether the lowering's support check reports `<host>/unsupported` or one
  shared `host/unsupported` code with the host in the message.
- Which prelude emit queries the `host/*` family needs beyond those the
  `http-api` prototype used.
- Where host kernels live once they are more than prototypes, and how they are
  versioned against the TypeScript package.
- The value semantics the Effect-Go RFC left open (string units, map order,
  and wire encoding), which every host inherits.

## Related designs

- [RFC 0003: Direct-style effects](./0003-direct-style-effects.md): the
  surface that `async fn` and `.await?` mirror in Rust.
- [RFC 0004: One analysis architecture](./0004-one-analysis-architecture.md):
  one check feeding many consumers.
- [RFC 0013: A runnable host](./0013-runnable-host.md) and
  [RFC 0016: Host-call journals](./0016-host-call-journals.md): host calls
  and replay, which externs on new hosts would follow.
- [RFC 0018: Type generics and collection inference](./0018-type-generics.md):
  generic function types, which the Rust printer would map to Rust generics.
- [RFC 0021: Languages as libraries](./0021-languages-as-libraries.md):
  kernel ports and differential conformance for Lisp targets.
- [Forma for Effect](../effect.md) and the [Effect reference](../effect/reference.md).
