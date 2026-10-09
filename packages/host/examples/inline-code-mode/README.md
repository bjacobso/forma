# Inline Forma code mode experiment

The executable language can be Forma while the model's interface remains ordinary
text. This prototype intercepts one explicit fence, checks and evaluates its Lisp,
handles suspended host calls, records the result, and requests fresh continuation
text. No model tool-call schema or execute-tool wrapper is involved. A host is
still essential: text does not execute itself.

From the repository root, using Node 24 and pnpm 10.20:

```sh
node scripts/setup-workspace.mjs
pnpm --filter @formalang/host... build
node packages/host/examples/inline-code-mode/cli.ts
node packages/host/examples/inline-code-mode/cli.ts --alternate
node packages/host/examples/inline-code-mode/cli.ts --write
```

For the interactive Foldkit demo, run `pnpm workbench` and open
`http://localhost:5173/?demo=code-mode`. You can edit the response, swap mock
bindings while keeping its Lisp, inspect the transcript and contract, and deny
or explicitly allow a mock write. Fixture chunks play back before the real host
evaluation; the playback is not a live model stream. The production app uses
`/workbench/demo/?demo=code-mode`.

The browser and CLI share the experimental `@formalang/host/inline-code-mode`
package entry: `compileCatalog(source)` checks a host-owned catalog, and
`new ExecutionSession(catalog, bindings, grants)` evaluates segments against it.
The generic core has no filesystem catalog loader. Node-only loading lives in
the CLI wrapper; Vite supplies the browser's catalog as raw text. A regression
test keeps the browser catalog and Effect companion identical to the CLI copies.

The first command prepares dependencies as usual; it is unnecessary in an already
prepared workspace. The CLI also accepts a UTF-8 transcript file as its positional
argument. It emits JSON containing prose, source, result and continuation records.
`transcript.json` pins the default demonstration. There is no provider, key or
live account: the continuation is a deterministic function of the actual result,
not a claim about a model run. `fixture.ts` keeps mock account and issue data in
host-owned bindings. Issue IDs encode their owner (`ada/I-1`) to keep the catalog
small; a production catalog would expose proper domain records.

## JavaScript and executable Forma

A familiar executor code-mode computation, with host-supplied tool objects, is:

```js
const issues = await Issues.listOpen();
const accounts = await Accounts.listActive();
return accounts.map(account => ({
  account,
  open: issues.filter(issue => issue.startsWith(account + "/")).length
}));
```

The running transcript contains prose, an inert `forma` example, then this segment:

````markdown
I'll count open issues for each active account.

```forma-run counts
(let [issues (Issues.list-open)
      accounts (Accounts.list-active)]
  (map (fn [account]
         {:account account
          :open (count (filter (fn [issue]
                                 (starts-with? issue (str account "/")))
                               issues))})
       accounts))
```
````

The default result is `[{":account":"ada",":open":2},{":account":"lin",":open":1}]`.
The existing plain-JSON projection preserves keyword colons. `--alternate` changes
only the bindings, producing counts 0 and 1 from exactly the same source.

## Contract, implementation and authority

`catalog.forma` declares real Forma services with successful values and typed
errors. For example:

```forma
(error Unavailable {:message String})
(service Accounts
  (: list-active (-> (Effect (List String) [Unavailable] []))))
```

The empty requirement set belongs to the implementation contract of a service
method; calling that method contributes `Accounts.list-active` to its caller.
`summary-effect.forma` uses supported `do!`/`succeed` syntax. The existing mechanics
checker infers its body's success, errors and requirements, which the CLI prints:

```text
(Effect (Array {:account String :open Int})
  [Unavailable] [Issues.list-open Accounts.list-active])
```

The authored collection spelling is `List`; the mechanics display currently says
`Array`. The evidence comes from `check.effectTypes` for the body, rather than
just echoing its declared signature. A test pins that inference.

There is a deliberate execution seam. **This workspace's session evaluator runs
kernel Forma, not the complete Effect authoring language.** The executable example
therefore uses `let`. The host derives `HostBuiltinDescriptor` success-value
schemes and Effect Schema decoders from the checked service catalog. It treats
each service call as a suspended kernel host builtin. It does not claim `let`
runs native Effect computations, and it does not erase `do!` by a new compiler
pass. The Effect companion is checked, not executed. The existing hosted
mechanics runtime supports a smaller Effect subset; it is not a replacement for
kernel evaluation of this collection computation.

Three separate objects matter:

| Object | Meaning in this experiment |
| --- | --- |
| Forma service contract | Operation arguments, successful values and declared failures |
| JS binding map | Session-specific implementations of those operations |
| Host allow set | Authority to perform each operation at its suspension point |

`ExecutionSession` copies the bindings and grants. Each segment opens a fresh
`TsLanguageHost` session, configures the descriptors, typechecks before running,
then uses `evaluateInSession` and `resumeHostCall`. JS implementations run only
after the suspended call passes the allow set, call budget and argument decoder.
Success and failure envelopes are decoded with existing Effect Schema before
resuming. Missing bindings, undeclared/malformed failures, thrown bindings and
wrong success values produce checked failures. The small schema/ABI adapter
accepts only String, Bool, Int and their lists; unsupported contracts fail closed.

Typed host failures retain their tag, fields and source identity in result
diagnostics. They terminate kernel evaluation; catching them inside Lisp awaits
an Effect execution bridge. This snapshot wraps rejected host resumes in a
kernel diagnostic, so the experiment preserves the original boundary diagnostics
in the transcript. Boundary spans cover the segment; engine parse/type/evaluation
diagnostics retain their authored spans. The ABI does not supply exact host-call
spans here. Kernel inference currently displays
`List<{:account Unknown :open Int}>` for the example; the stronger Effect companion
type must not be substituted for that display or claimed as kernel inference.

`--write` requests `(Issues.close "ada/I-1")`. It returns `capability/denied`
without calling the binding. Declarations confer no authority. Tests demonstrate
an explicit host grant with `new Set(["Issues.close"])`. A UI could resolve a
pending call through the workbench's existing approval flow. The Foldkit demo
lets a person explicitly grant mock writes before a run; it does not implement
per-call approval or a permission management system. The CLI remains deny-only
for the write example.

## Framing, streaming and identity

The opening line starts at column zero and contains exactly three backticks,
`forma-run`, one space and the segment ID. Its closing line contains exactly
three backticks at column zero, with no trailing text.
IDs use letters, digits, underscores and hyphens. Source is retained verbatim.
This is a narrow host protocol, not general Markdown interpretation: inline
backticks, indented blocks, blockquote-prefixed lines, ordinary fences (including
longer backticks and tildes), HTML comments and raw pre/code/script/style blocks
are inert. Ordinary `forma` fences never execute. Only fresh assistant text
generations enter the parser; user messages, retrieved data, catalog text, host
results and rendered history are never reparsed for execution. An unprefixed
column-zero marker in assistant text outside these protected blocks is explicit
execution intent, even if surrounding prose describes it as an example.

Arbitrary decoded network chunks can split markers and s-expressions. The parser
buffers lines and the entire executable body, and exposes source only after its
closing line (or EOF completing that line). EOF inside a fence is an error and
executes nothing. A complete fence with invalid Lisp fails checking before calls.
A provider adapter must decode bytes incrementally, since this interface takes
strings, not raw network bytes.

At the execution boundary, `chat.ts` closes the current text iterator. A real
adapter must implement iterator cancellation by stopping generation and dropping
queued tokens. Non-whitespace trailing text in the same chunk is rejected before
execution; later queued chunks are discarded by cancellation. A prerecorded
fixture must likewise put dependent prose in a separate generation; the CLI
validates the entire recording before streaming it and rejects any such tail. After
execution the adapter receives the transcript with the result, then generates
the continuation. Already generated text cannot know a future result. One visible
chat response may assemble several internal generations.

The host allocates response IDs (`reply-1`, `reply-2`); the marker supplies the
segment ID (`counts`). Invocation identity is `reply-1/counts`, with individual
call identities such as `reply-1/counts/call-1`. Call IDs from the engine remain
internal resume tokens. Callers must allocate a distinct response prefix for a
new conversation. The executor caches the in-flight promise and final success
or failure for each invocation. Concurrent retries/history revisits reuse it;
changed source under the same identity is rejected. The transcript keeps both
source and result. This is session-local deduplication, not durable restart
recovery, transactional writes or cross-process exactly-once execution.

## Budgets, discovery and integration

Defaults are 16,384 UTF-16 code units per generation, 8,192 per executable source,
2,000 engine evaluation steps, eight host calls per segment, 4,096 serialized
characters per host outcome/final value, and four internal generations. Calls are
sequential. Limits return failures rather than a successful truncated value.
These are experiment budgets, not a process sandbox: decoding and projection
allocate values before measuring output; inference/expansion and trusted JS
bindings have no hard time or memory limit. A hostile production workload needs
worker/process isolation, cancellation and binding deadlines. Generated Lisp gets
only the kernel and configured operations: no JS eval, arbitrary JS imports,
filesystem or credentials. Trusted implementations own any resources they use.

The small static catalog is enough for discovery: a harness can include its
typed signatures in model context, while holding implementations, grants and
data outside generated source. Dynamic discovery, generated signatures, schema
federation, catalog versions and attenuated capabilities remain follow-up work.

`TextAdapter.generate(history): AsyncIterable<string>` is provider neutral. An
OpenCode-style harness could intercept its assistant text stream here, cancel at
the boundary, execute and append result context before requesting continuation.
This is an integration proposal, not a verified OpenCode hook. Official
[OpenCode custom-tool docs](https://opencode.ai/docs/custom-tools/) describe
JS/TS definitions with arguments and an execute method;
[its SDK docs](https://opencode.ai/docs/sdk/) describe sessions and events.
Neither establishes that inline fences are automatically executable. Installing
an ordinary execute tool would retain the model tool-call wrapper, so it would
explore a different protocol.

[PR #64](https://github.com/bjacobso/forma/pull/64) proposes additive typed
`replSubmit` persistence while preserving snapshot `evaluateInSession` semantics.
It could support future cross-segment Lisp bindings after landing; this prototype
depends only on this workspace's APIs and retains no Lisp state between segments.
No engine semantics changed, no shared conformance fixture was needed, and OCaml
parity for this chat host has not been tested. WorldVM Programs are a separate
closed language and play no role here.

The next decisions are whether to execute full checked Effect programs through
the session boundary, how typed failures become catchable there, how adapters
guarantee generation cancellation, and how invocation identity and write recovery
survive restarts. Model fluency, full OpenCode integration and live-service use
remain untested.

Validation in this workspace (Node 24.14.1, pnpm 10.20.0):

```sh
pnpm --filter @formalang/host exec vitest run test/inline-code-mode.test.ts
TURBO_CONCURRENCY=1 pnpm check
TURBO_CONCURRENCY=1 pnpm website:build
pnpm --filter @formalang/workbench-app test:e2e
pnpm test:site
pnpm pack:check
```

All passed: 26 focused host tests; branding and TypeScript checks; 827 package
tests; nine parity-runner tests; 208 TypeScript/reference comparisons; docs/llms
checks and website assembly; 16 workbench Chromium tests; six assembled-site
Chromium tests; and installed-tarball export smoke checks. Browser tests cover
editing, swapped bindings, denied and allowed writes, inert examples,
dependent-tail rejection and a mobile viewport. The default CLI output matches
`transcript.json` exactly; alternate bindings and the denied write were also run.
`git diff --check` passed, and the committed lockfile is unchanged. Native OCaml
parity for the chat host was not tested.
