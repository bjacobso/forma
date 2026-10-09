# RFC 0013: A runnable host

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-09 |
| Scope | A TypeScript `forma` command, a host protocol for out-of-process and attached sessions, host-call concurrency, streaming, and cancellation |
| Direction | One JSON-RPC protocol whose requests are the existing host ABI objects, served by a `forma` command and embeddable in any Node process |

## Summary

A new `@formalang/cli` package provides a `forma` command with `check`, `run`,
`interface`, `repl`, `daemon`, and `attach`. The daemon and any embedding
process speak one protocol: JSON-RPC 2.0 messages, one per line, whose
parameters and results are the existing `LanguageHost` request and result
objects. A client implementation of `LanguageHost` over that protocol lets
existing consumers use a host in another process. An application can serve its
in-process host on a local socket so a REPL can attach to it while it runs.
Host calls keep their pause and resume model; this RFC adds request ids,
cooperative cancellation, and a defined pattern for streaming.

## Motivation

Today a Forma program can only be run by writing a script against the
TypeScript packages, or by building the OCaml engine. There is no command to
check or run a file, and no way to connect to a Forma session inside a
running process.

The agent evaluation described in [RFC 0010](./0010-live-sessions.md) needs
both. Its host process owns I/O and calls Forma definitions; an author
inspects and redefines those definitions while it runs, as oh-my-lisp does
through an nREPL server. A web UI may connect to the same session. None of
this is agent-specific: editors, build scripts, notebooks, and test runners
need the same command and protocol.

## Current state

- **No TypeScript command.** The README, the [agent entry page](../agents.md),
  and the [Effect page](../effect.md) state that there is no published
  `forma` CLI. `packages/ts/src/cli/repl.ts` is a readline loop that threads
  an environment through lines with `evaluateCompileTimeExprs`, without
  types, modules, or host builtins; `@formalang/ts` declares no `bin`.
  `@formalang/language-server` has a `forma-language-server` binary that
  speaks LSP over stdio.
- **OCaml command.** `forma_cli.exe` (`packages/ocaml/bin/forma_cli.ml`)
  supports `request`, `daemon`, `file <typecheck|evaluate|interface|declarations>`,
  `repl`, and `version`. The daemon reads one JSON request per line,
  `{"op": ..., ...}`, and writes one response per line,
  `{"ok": true, "value": ...}` or `{"ok": false, "diagnostics": [...]}`. It
  answers in order, has no request ids, and sends no unsolicited messages.
  `OcamlLanguageHost` (`packages/host/src/ocaml-host.ts`) spawns it, matches
  responses in order, and applies a per-request timeout
  (`FORMA_DAEMON_TIMEOUT_MS`, 30 seconds by default).
- **In-process ABI.** `LanguageHost` (`packages/host/src/types.ts`) is a
  TypeScript interface. The TypeScript host has no wire form. The workbench
  goes through `LanguageHost` so that a worker-backed or OCaml host can
  replace the in-process one ([workbench](../workbench.md)); its REPL replays
  definitions in a fresh browser session for every entry.
- **Host calls.** An evaluation that calls a host builtin returns
  `{ status: "host-call", call }` and waits for `resumeHostCall`. Each
  evaluation has at most one pending call; several evaluations in one session
  can be pending at once. A resumed call supplies one value. Functions passed
  as host-call arguments are retained and can be invoked with `callValue`.
  Nested host calls from such callbacks are tested for the OCaml host
  (`packages/host/test/conformance.test.ts`); the TypeScript callback path is
  tested without nesting.
- **Cancellation.** The TypeScript host's `abortEvaluation` takes effect at
  the evaluation's next host call. The OCaml host can kill the daemon process
  but does not interrupt a running native evaluation.
- **Effect programs.** Kernel evaluation reports `module/effect-runtime`;
  Effect programs run through `linkEffectModules` output that the consumer
  compiles ([file modules](../modules.md)).

## Proposal

### The `forma` command

A new package, `@formalang/cli`, depends on `@formalang/host` and
`@formalang/ts` and declares the `forma` binary.

| Command | Behavior |
| --- | --- |
| `forma check <entry>` | Check the module graph with the Node file resolver. Print diagnostics with source excerpts, or JSON with `--json`. Exit 1 on errors. |
| `forma run <entry> [--main name] [--args json]` | Evaluate the entry, or call an exported binding with JSON arguments decoded by its type ([RFC 0011](./0011-signatures-as-contracts.md)). |
| `forma interface <entry>` | Print the module interface; with `--contracts`, binding contracts and JSON Schema. |
| `forma repl [entry]` | Open a session with the entry's modules loaded. Supports `:type`, `:doc`, `:exports`, and, once [RFC 0010](./0010-live-sessions.md) is implemented, persistent definitions and `:revisions`. |
| `forma daemon` | Serve the host protocol over stdio. |
| `forma attach <socket>` | Run the REPL against a session served by another process. |

`forma run` evaluates kernel programs. Host builtins come from
`--host <module>`, a JavaScript module that exports descriptors and
implementations. Each host call runs its implementation if granted with
`--allow <name>`, prompts on a terminal otherwise, and is denied when there is
no terminal. Grants and limits follow [RFC 0012](./0012-checked-evaluation.md).
Effect programs report `module/effect-runtime` until running linked Effect
output is specified.

`check` and `interface` correspond to the OCaml `file typecheck` and
`file interface` operations, so both engines can be compared on the same
files.

### The host protocol

Messages are JSON-RPC 2.0 objects, one per line. Method names are
`LanguageHost` method names. `params` is the existing request object and
`result` is the existing result object, unchanged:

```json
{"jsonrpc":"2.0","id":7,"method":"evaluateInSession","params":{"sessionId":"s1","source":"(double 21)"}}
{"jsonrpc":"2.0","id":7,"result":{"status":"completed","result":{"value":{"kind":"int","value":42},"diagnostics":[]}}}
```

- Request ids allow concurrent requests and out-of-order responses.
- The server sends notifications for events a client did not request:
  `session/revision` with a revision record (RFC 0010) and `evaluation/hostCall`
  when an evaluation started by another client pauses, so that an attached
  REPL and a UI can observe the same session.
- Errors in Forma programs remain results with diagnostics. JSON-RPC errors
  are reserved for protocol failures: unknown methods, invalid parameters,
  unknown sessions.
- `RemoteLanguageHost` in `@formalang/host` implements `LanguageHost` over
  the protocol. The existing host conformance suite runs against it.

The OCaml daemon keeps its current format and gains the envelope: it accepts
`jsonrpc`, `id`, `method`, and `params`, and echoes the id. Because request
bodies are already the same ABI objects, this is a framing change. The
TypeScript client for the native host then shares the protocol client.

### Transports and attach

- **stdio** for a parent process that owns the server, as `OcamlLanguageHost`
  does today.
- **Unix domain sockets** for attach. `serveHost(host, { socket })` in
  `@formalang/host` serves an existing in-process host. The application
  decides which sessions to expose. The socket is created with mode `0600`.
- **WebSocket** for browser clients, later.

Attaching grants full control of the served sessions, including running code
with their host builtins. The server does not listen on a network port by
default and has no authentication beyond file permissions.

### Host calls: concurrency, streaming, cancellation

The pause and resume model stays, because each pause is a permission point.

- **Concurrency.** Several evaluations per session may be pending at once, as
  today. Within one evaluation, calls stay sequential until the concurrency
  work in [RFC 0003](./0003-direct-style-effects.md) lands; pending calls are
  already keyed by `callId`, so the protocol needs no change when an
  evaluation can have several.
- **Streaming.** Forma does not receive streams from host calls. A host either
  accumulates a stream and resumes with the final value, or calls a function
  argument once per chunk through `callValue`. The TypeScript host must
  support host calls made from such callbacks, matching the OCaml test.
- **Cancellation.** `abortEvaluation` is checked at every evaluation step
  (RFC 0012). Aborting fails the pending call with `evaluation/aborted`. When
  a client implements a host builtin, the server sends
  `evaluation/cancelHostCall` so the client can stop that work, for example
  by closing an HTTP stream.
- **Timeouts.** Per-request timeouts belong to the client. The server applies
  the run limits of RFC 0012.

## Alternatives considered

- **Adopt the OCaml line format unchanged.** It has no ids, so one slow
  request blocks every other request and the server cannot send events. The
  proposed envelope keeps its request bodies.
- **LSP framing.** `vscode-languageserver` is already a dependency of the
  language server, and its messages are JSON-RPC 2.0. Its `Content-Length`
  framing is harder to use from shells and line-oriented tools. The message
  format is the same, so a second framing can be added if needed.
- **nREPL.** It would let Clojure tooling connect, but its operations
  evaluate untyped text and return printed output. The host ABI already
  provides typed sessions, retained values, and host-call pauses.
- **Agent protocols.** Client protocols for agents, such as ACP, belong to the
  application host. Forma's protocol serves sessions, not conversations.
- **Embedding only.** Documenting the library without a command leaves no
  supported way to check or run a file.

## Implementation stages and validation

1. **Command.** `@formalang/cli` with `check`, `run` for kernel programs, and
   `interface`. Tests run the binary on fixtures: `check` on
   `conformance/modules/main.forma` exits 0; for failing fixtures, its
   diagnostic codes and spans match `forma_cli.exe file typecheck`.
2. **Protocol.** `forma daemon` over stdio and `RemoteLanguageHost`. The host
   conformance suite passes against the remote host; a test sends two
   requests and receives the second response before the first.
3. **Attach.** `serveHost`, Unix sockets, and `forma attach`. A test embeds a
   host in a Node process, attaches a client, defines a function under RFC
   0010, and observes the embedding process's next `callBinding` use it.
4. **Host calls.** `--host` modules and grants for `run`, cooperative abort,
   and nested host calls from TypeScript callbacks. A test aborts a pure
   infinite loop; a test mirrors the OCaml nested-callback test.
5. **OCaml envelope.** The native daemon accepts the envelope and the
   protocol client drives both engines; the parity runner uses it.

Running Effect programs from `forma run` depends on RFC 0003 and is not part of
these stages.

## Decisions still required

- Whether the protocol is versioned separately from `hostAbiVersion`.
- Default limits and grant prompts for `forma run`.
- The WebSocket transport and its authentication.
- Whether `forma repl` and `forma attach` share one client with the
  workbench REPL.
