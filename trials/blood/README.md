# Blood reference core

An isolated executable experiment, not a rename of Forma, a published API, a
native backend, or a claim of soundness. It tests the first semantic contracts
before choosing syntax or a storage model. Nothing here changes Forma programs.

## Run

From the repository root, with Node 24 and the frozen workspace install:

```sh
pnpm test:blood
```

This typechecks the experiment and runs its Node test suite. It also runs as
part of `pnpm check`. No generated files or sibling checkout are required.

`core.ts` exports `check(term, signatures)` and
`run(term, capabilities, grants, steps)`. Tests construct the explicit `Term`
union directly; there is intentionally no parser, inference, or elaborator.
An eventual elaborator must produce these terms and cannot supply the checker's
answer. `check` returns a type and a sorted set of possible effects, or throws
on rejection. `run` returns `rejected`, `completed`, or `failed`, with an
operation/cleanup trace. It checks the whole term and grants before execution.

## Implemented contract

- Strict left-to-right call-by-value evaluation, lexical scope, immutable
  bindings, functions, products, binary sums, and exhaustive sum elimination.
- Explicit predicative type/effect polymorphism: `poly` binds type names and
  row names, and `instantiate` supplies all arguments. `$e` denotes an effect
  row variable. Type arguments must be monomorphic and unrestricted. There is
  no implicit let-generalization or mutable cell, so a polymorphic-cell exploit
  is not expressible. Polymorphic abstraction requires a syntactic value.
- Function annotations specify an upper bound on latent effects. Calls preserve
  those effects through higher-order values. Rows are finite sets, not operation
  counts, commutativity proofs, or dynamically selected capability instances.
  Function argument types match exactly; there is no subtyping or row solver.
- Host operations have declared first-order data signatures and contribute
  their names to the effect set. All possible capability effects need grants,
  including operations in branches that will not execute. Host arguments/results
  are validated; exceptions and invalid results fail execution, not typed recovery.
- `fail` introduces a named `error:X` effect. `catch` removes only that label
  from the body's effects and retains all handler effects. Failures carry no
  payload yet. Runtime traps are distinct from recoverable errors.
- `using` opens a simulated handle in a fresh lexical region. Moving a handle
  consumes its binding, including inside products and sums. `read` is a temporary
  nonescaping read; `close` consumes ownership. Handles cannot escape their region
  or be captured by unrestricted closures. A noncapturing closure may leave it.
- Branch joins retain ownership only when both branches retain it. Error handlers
  cannot regain ownership consumed by the body. This is conservative: an unreachable
  handler is still checked, and moves anywhere in a body constrain its handler.
- The region closes its handle on return, recoverable failure, host failure,
  and evaluator budget exhaustion, even if ownership was moved to an inner
  binding. Nested regions clean up inside-out. An explicit close is not repeated.
  This is **region-owned cleanup with affine access**, not general RAII at every
  binding or a complete native memory model.
- `Int` currently means a JavaScript safe integer, checked at literals and host
  boundaries. This deliberately makes no decision about Blood's eventual machine
  integer widths, overflow rules, layout, or arithmetic performance.

Resource effects (`Resource.open`, `Resource.read`, `Resource.close`) are
reserved and also require grants. A read deterministically returns the simulated
handle's allocation index; it performs no filesystem I/O. Cleanup is an infallible
trace event in this model. Granting a host function does not sandbox its JavaScript.

## Reading an explicit program

This term recovers after a resource-scoped failure:

```ts
import { run, Int } from "./core.ts";

const result = run({
  tag: "catch", error: "Missing",
  body: {
    tag: "using", name: "file", region: "r",
    body: { tag: "fail", error: "Missing", result: Int },
  },
  handler: { tag: "int", value: 42 },
}, new Map(), ["Resource.open", "Resource.close"]);
```

The observable result is `status: "completed"`, `value: 42`, and
`trace: ["open:0", "close:0"]`. The suite pins this behavior, along with
unmatched failures, early close, moved aliases, branch joins, closure capture,
effect-polymorphic callbacks, rejected fabricated annotations, and foreign traps.

## Deliberately missing

- General borrowing/lifetime polymorphism, owned closures, heap reclamation,
  recursive types/functions, mutable state, and concurrency/scoped tasks.
- Resumable handlers or captured continuations. The initial choice is capability
  effects and typed failures, not an implementation of every algebraic effect.
- Compile-time execution, macro hygiene, deterministic build inputs, and compile
  budgets. Rejecting bad explicit terms is only the kernel side of metaprogramming.
- Native allocation/code generation, optimizer validation, performance claims,
  SQLite storage, persistent identities, worktrees, or merge semantics.
- A hardened input decoder or security boundary. The API takes in-process typed
  objects; checking itself has no budget. The evaluator's step budget does not
  interrupt host JavaScript, bound memory, or prevent JavaScript stack exhaustion.

The next semantic step is to specify actual ownership/borrowing and task lifetime
rules, then add paired accepted/rejected programs before expanding the core.
