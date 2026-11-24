# Embedding Forma

The **experimental** `createLanguage` facade in `@forma-language/forma` checks and
runs source through the TypeScript language host. It needs no Effect imports
or session management. Its API may change before Forma stabilizes.

```ts
import { createLanguage } from "@forma-language/forma";
const lang = await createLanguage({
  preludes: [{ id: "app.lisp", source: "(define greeting \"Hello\")" }],
  capabilities: {
    echo: {
      arity: 1,
      typeScheme: {
        kind: "function",
        params: [{ kind: "type", name: "String" }],
        result: { kind: "type", name: "String" },
      },
      handler: async (name) => ({ ok: true, value: String(name) }),
    },
  },
});
try {
  const source = "(echo greeting)";
  console.log((await lang.check(source, { sourceId: "main.lisp" })).type);
  // { kind: "named", display: "String", name: "Str" }
  console.log((await lang.check("(echo 42)")).ok); // false; handler is not called
  console.log(await lang.run(source, { limits: { steps: 100_000, timeoutMs: 2_000 } }));
} finally { await lang.close(); }
```

`check` returns `{ ok, type?, diagnostics }` without evaluating the checked
source. `run` checks first and returns `{ ok, value?, printed?, type?, diagnostics }`.
A failed check prevents evaluation and capability calls. Each operation uses the
loaded preludes; program definitions are not retained between runs. Prelude
initialization itself validates and evaluates declarations with `kind: "prelude"`.
Invalid preludes reject creation with `LanguageInitializationError`, whose
`diagnostics` explain the failure; the session is released.

See the [runnable Node example](https://github.com/bjacobso/forma/tree/main/examples/embed-node)
for a prelude with a checked form, one granted capability, and `node:test` tests.
For installation before publication, follow [Authoring](./authoring.md#setup).

## File modules as vocabulary

Use `modules` for ordinary exported file modules; `preludes` remains available
for legacy shared-scope sources. Module IDs are bundle-relative `.lisp` paths; supply imported files
in the same array. Every supplied module's exports become automatic imports into
checked and run programs, under the normal import collision rules. Private names
remain private. A program's explicit `sourceId` must differ from loaded module IDs;
the default program ID avoids collisions automatically. The facade builds a reexport barrel and selects it through the
engine's existing project-prelude mechanism. A failed module check rejects
creation with `LanguageInitializationError`.

```ts
const lang = await createLanguage({
  modules: [{
    id: "policy.lisp",
    source: `(export allowed?)
             (: allowed? (-> Int Bool))
             (define allowed? [amount] (<= amount 7500))`,
  }],
});
try {
  console.log(await lang.run("(allowed? 5000)")); // value: true
  console.log(lang.describe().functions); // allowed?, with its signature
} finally { await lang.close(); }
```

Legacy preludes retain their shared declaration scope. With `modules` configured,
programs use the isolated file-module core and explicit or automatic module imports;
they do not inherit legacy prelude bindings. The facade is browser-safe and does not read filesystem paths;
Node applications can read their own source strings before creating it.

## Capabilities and values

A capability declares its `arity` and a synchronous or asynchronous `handler`.
Only configured names become host builtins. A call to an ungranted name fails
checking with an unbound-symbol diagnostic. Any unexpected suspended call without
a handler also fails with `host-effect/failed` instead of waiting indefinitely.
A capability may supply the host's `typeScheme`; otherwise its parameters and
result use the host's permissive `{ kind: "any" }` scheme, with its declared arity. A check then reports
the call's result type as `Unknown` (`{"kind":"display","display":"Unknown"}`), and
any argument is accepted. Use an explicit scheme, as in the example at the top of
this page, for stronger checks. Handlers must honor that scheme; returned JSON is not checked against it.

Handlers receive the existing plain-JSON value projection. Nil becomes `null`,
lists and vectors become arrays, and maps become objects. Keywords keep their
colon; symbols become strings. Map key kinds and collection distinctions are
lost, nonfinite numbers project to `null`, and functions and opaque values project
to descriptive records rather than callable JavaScript values.

Return `{ ok: true, value }`, where `value` is JSON: null, booleans, finite
numbers, strings, arrays, or plain objects. Safe integral numbers become Forma
Int, other numbers become Float, arrays become vectors, and object keys become
string map keys. Invalid values produce `host-effect/failed`. The run's `value`
uses the same plain-JSON projection; `printed` preserves Forma's printed syntax.

For a handler failure return `{ ok: false, diagnostics: [...] }` with at least
one error diagnostic containing a `code`, `severity: "error"`, and `message`.
The host preserves these diagnostics. A thrown exception or rejected promise
becomes a generic `host-effect/failed` diagnostic, without exposing exception
text. An empty failure list also produces `host-effect/failed`.

## Limits and lifecycle

`limits.steps` maps directly to the host evaluation step limit. `timeoutMs` is
a deadline from 0 to 2147483647 milliseconds, starting after checking. The
engine checks it inside the VM loop, so a pure computation that never calls a
capability stops with `limit/time`. While waiting for a capability it races the
handler, calls `abortEvaluation` with the suspended evaluation ID, and returns
`evaluation/aborted`. The handler itself is not canceled and may still finish or
perform side effects. A result finishing after its deadline is reported as
aborted. Limits do not apply to prelude initialization or checking.

`lang.describe()` returns `{ forms, functions, types, diagnostics }`, the same
projection as the host's `describe` operation (JSON request: `{ op: "describe",
sessionId }`). Forms include identifiers, typed slots with required/many flags,
result strategy, IR type, docstring, and checked example source. Functions include
explicit or inferred signatures and preceding documentation comments; types include
their authored declarations. Metadata comes from the descriptor registry and the
same source extractor used by the prelude reference pages. Module descriptions
follow exports, including reexports; private helpers are omitted. Module examples
are checked in their defining module's scope, and invalid examples reject language
initialization. Legacy prelude examples are validated when the prelude loads.

Use `forma describe entry.lisp --format md` for an agent-readable reference, or
`--format json` for the same data. The default format is Markdown, ordered as
forms, functions, then types. For legacy preludes use
`forma describe --prelude app.lisp`; repeat `--prelude` for an ordered stack.
`await lang.emit(source, { sourceId: "main.lisp" })` delegates to host emit,
returning validated canonical IR artifacts with elaborated declarations and
diagnostics. It does not run the program.

Await active operations before `await lang.close()`. Closing is idempotent and
releases the session; operations after close reject with an error. Invalid
`timeoutMs` options reject with `RangeError`.

## Resource budgets

`checkedRun` (host operation and JSON ABI) runs accepted source under budgets.
Each applies when `limits` omits it:

| Limit | Default | Failure code | Meaning |
| --- | --- | --- | --- |
| `steps` | 50,000 | `limit/steps` | VM instructions |
| `timeoutMs` | 5,000 | `limit/time` | Wall clock from the start of the run, covering checking-time expansion and evaluation. Time paused on a host call is not counted. |
| `maxExpansionSteps` | 10,000 | `limit/expansion` | Compile-time evaluation steps summed across all macro calls and macro definitions in the source |
| `maxResultBytes` | 1,048,576 | `limit/result-size` | UTF-8 bytes of the printed result and of its projection |
| `hostCalls` | 1,000 | `limit/host-calls` | Capability calls; the run fails at the call that would exceed it, before the host sees it. A grant's `maxCalls` bounds one capability. |

A limit failure is `{ status: "failed", stage: "limit" }` with the coded
diagnostic first; `details.limit` records the configured value. A run stopped by
`abortEvaluation` is `{ status: "failed", stage: "aborted" }` with
`evaluation/aborted`.

The deadline and abort flag are checked every 64 VM steps, and the VM yields to
the event loop every 4,096 steps, so an `abortEvaluation` request that arrives
while a pure loop runs is delivered. Pass your own `evaluationId` to `checkedRun`
to know which evaluation to abort before it pauses:

```ts
const running = host.checkedRun({ sessionId, source, grants: [], evaluationId: "job-7" });
// elsewhere, in the same JavaScript thread:
await host.abortEvaluation({ sessionId, evaluationId: "job-7", reason: "user cancelled" });
console.log(await running); // { status: "failed", stage: "aborted", ... }
```

`evaluateInSession` and `replSubmit` take the same `timeoutMs`,
`maxExpansionSteps` and `maxResultBytes`, but have no defaults for them. Macro
expansion and the result projection are bounded; the type checker is not, and
neither is memory. Those need the isolation below.

## Isolating untrusted source

> [!WARNING]
> The TypeScript engine is an interpreter inside your JavaScript realm. Grants,
> the type check and budgets stop mistakes and runaway loops; they do not contain
> hostile code. A defect in the reader, expander, evaluator or a builtin could
> expose host objects or crash the process. Allocation is not bounded: a program
> can build large values within its step limit and exhaust memory. Cooperative
> budgets also cannot interrupt a hung host builtin or a defect that never reaches
> the VM loop.

For input you do not trust, run the engine somewhere you can kill it, and treat
the boundary as a message channel. Whatever you place in the isolate, the
capability handlers that answer host calls stay the trust boundary: validate their
arguments and enforce policy (for example, confine paths to a directory).

### `node:worker_threads`

[`examples/worker-isolation`](https://github.com/bjacobso/forma/tree/main/examples/worker-isolation)
runs `checkedRun` inside a Worker and ships a self-contained `node --test` suite.
The parent posts `{ source, limits }`; the worker owns the session, answers each
`host-call` itself, and posts back the final `CheckedRunState`.

```ts
const worker = new Worker(new URL("worker.mjs", import.meta.url), {
  resourceLimits: { maxOldGenerationSizeMb: 128 },
});
const backstop = setTimeout(() => worker.terminate(), 10_000);
```

Use all three layers. Budgets give a precise, coded failure for ordinary
runaways. `worker.terminate()` after your own deadline stops a worker that
ignores them. `resourceLimits` turns a memory bomb into a worker crash instead of
a parent crash. Create a fresh worker per untrusted job, or per tenant, and
terminate it afterward; a worker shares the process, so this limits blast radius
and does not provide a security boundary against engine defects. For that, use a
child process with operating-system limits.

### Cloudflare Workers

Run each untrusted job in its own isolate. In a Worker, bind the Forma host in a
separate Worker (or Durable Object) and call it through a service binding, so the
caller keeps its secrets and bindings out of the isolate that runs untrusted
source:

```ts
// runner Worker: owns the engine, has no bindings besides what it must answer
export default {
  async fetch(request: Request): Promise<Response> {
    const { source, limits } = await request.json();
    const host = createDefaultLanguageHost();
    const { sessionId } = await host.openSession();
    // checkedRun, answer host calls from an allow-list, return the final state
  },
};
// caller Worker: env.RUNNER.fetch(...) with its own subrequest timeout
```

Cloudflare enforces CPU time and memory per isolate, which covers what cooperative
budgets cannot; keep `timeoutMs` below the platform CPU limit so a run fails with
`limit/time` rather than being cut off. The engine has no Node dependencies in the
facade (`createLanguage`, `createDefaultLanguageHost`), but this repository does
not yet ship a tested Cloudflare runner, so verify limits against your own plan
before relying on it.
