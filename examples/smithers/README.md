# Smithers workflows in Forma

This executable example defines a workflow language in an ordinary Forma
prelude, checks author programs, and lowers their IR to the actual Smithers
runtime. No workflow vocabulary is added to Forma's compiler.

Use Node.js 24 and the repository's pnpm version:

```sh
pnpm install --frozen-lockfile
pnpm --filter @formalang/ts build
pnpm --filter @formalang/example-smithers demo
pnpm --filter @formalang/example-smithers test
```

The demo proposes a patch, runs tests and review concurrently, parks for human
approval, records the fixture answer, publishes, polls deployment, and calls a
child flow. Its output is `Released: https://example.test/releases/patch-123`.
Each shared producer runs once, including across approval resumption. Model,
process, and publishing handlers are deterministic local fixtures; the demo
does not call models, modify repositories, or publish a release.

Open `/playground/custom?example=smithers` on the website to edit the same
`prelude.forma` and `example.forma`. The browser compiles to checked IR and shows
diagnostics and source maps. Execution happens in the Node example, not in the
browser. A saved playground contains both source files; its link is immutable.

## Files

| File | Responsibility |
| --- | --- |
| `prelude.forma` | Surface forms, portable IR, schema encoding, local dataflow and error checks |
| `example.forma` | Approval and release workflow |
| `patterns.forma` | Review loop and fixed-plan map/reduce as ordinary workflows |
| `compile.ts` | The same descriptor bootstrap and elaboration path used by the browser |
| `runtime.ts` | Schema-driven lowering to native actions, flows, nodes, waits, and polling |
| `node-host.ts` | Node cryptography service for the pinned runtime |
| `demo.ts` | Fixture handlers and an approval client using native run state and tokens |
| `workflow.test.ts` | Execution, rejection, ordering, concurrency, recovery, and integration tests |

## Language and execution

Actions declare record payloads, success/error types, recovery tiers, capability
ceilings, file effect envelopes, attempt budgets, timeouts, implementation
versions, and optional idempotency namespaces. Retrying an irreversible action
requires an explicit `:key`. The adapter includes the action payload in that key;
sealed actions also receive a payload-derived identity so repeated reads replay
within the execution. These are native Smithers policies, not ignored metadata.

Workflows declare their input/output/error types, authority, file effects, tier,
deadline, round budget, returned node, and local nodes. Nodes name earlier nodes
in the same workflow; this rules out cycles in one round. `input` names the
workflow payload. Handoffs provide bounded repetition across rounds.

| Form | Native meaning |
| --- | --- |
| `step` | Typed `Action.call` |
| `child` | `Flow.child`, with its own execution identity |
| `handoff` | `Flow.to`, bounded by the originating flow's round budget |
| `value` | Constant, result selection, or deferred pure computation |
| `all` | Concurrent collection with shared producers bound once |
| `sequence` | Success barriers, including for otherwise independent work |
| `branch` | Planned arms; only the selected arm executes |
| `race` | First settlement; interrupts remaining members |
| `any` | First success; interrupts remaining members |
| `quorum` | First requested number of successes, keyed by member |
| `recover` | Catch typed failures; defects and cancellation propagate |
| `fail` | Typed failure |
| `sleep` | Native timer, returning `Unit` |
| `wait` | Native deferred wait with schema-checked completion |
| `ask` | Native human task with a typed answer and a deadline |
| `poll` | Native bounded poll; action returns `{:done Bool :value T}` and cannot fail |
| `native-flow` | Host-supplied native declaration, used through `child` or `handoff` |

Expressions are data. `{:get ["patch" "revision"]}` selects a typed result;
`{:get ["input" "issue"]}` selects an input. Maps and lists assemble payloads.
`{:op "eq" :args [a b]}` compares JSON values structurally; `and`, `concat`, and
`add` operate on booleans, strings, and integers. Operators run after their
inputs resolve. No author JavaScript is evaluated.

Schemas support `String`, `Int`, `Float`, `Bool`, `Json`, `Unit`, `Never`, records,
`List`, `Option`, literal unions, and nonrecursive aliases. A tagged wire schema
preserves the distinction between `String` and the literal `"String"`.

The prelude checks local names, result paths, payloads, results, branch
conditions, operator arguments, quorum bounds, retry safety, and escaping typed
failures. Recovery removes the attempted graph's typed failures. System waits
and polling conservatively have `Json` errors. Capability checking in the
prelude accepts explicitly listed grants or `"*"`; it does not prove wildcard
pattern containment. Native Smithers intersects and enforces capability ceilings
on guarded host services. Arbitrary JavaScript handlers remain host code.

## Native integrations and persistence

`native-flow` connects existing Smithers patterns, queues, external jobs, or
prompt-backed flows without duplicating their implementations. Supply a binding
to `link(program, handlers, nativeFlows)`. The adapter checks native payload and
success schemas at linking; the declared error schema is enforced at the flow
boundary. Tests execute an actual `ExternalJob` lifecycle and an actual
`DurableQueue` worker through this seam.

`link(...).flows` exposes native execution, polling, interruption, and resumption.
`registrations()` returns the declaration/implementation layer without an engine.
`layer()` supplies Smithers' **volatile memory engine** for local examples.
Pass a compatible store-backed `FlowRuntime` layer to `layer(engine)` for durable
storage, supplying that engine's database and host requirements. The example
tests suspension/resumption within one process; it does not claim process-restart
durability or provision a production database.

Compensable actions require Smithers' workspace/Jj host. Real irreversible
providers must implement idempotent operations using the native action context;
a declared key alone cannot make a remote API exactly-once. File effects here
use Smithers' `expected` envelope mode, not a hard filesystem sandbox. Host
layers supply agent clients, process execution, secrets, sandboxing, queues, and
other services as appropriate.

## Compatibility and limits

The private example pins `@smthrs/flow`, `@smthrs/plan`, and `@smthrs/engine` to
`1.0.0-rc.16` and their required `effect@4.0.5`. The rest of Forma keeps its own
Effect version; only JSON crosses the compiler/adapter boundary.

This is a workflow frontend and native-runtime integration, not a replacement
for the Smithers product. Agent harnesses, models, build/toolchain rules,
repository automation, the web UI, and production operational infrastructure
remain external. It does not reproduce every Smithers helper, annotation,
schema refinement, placement or cache option, dynamic fanout, or advanced
time-travel API. Those can be supplied by native declarations or added to the
prelude/adapter explicitly. The browser remains an IR inspector rather than a
server-side workflow runner.
