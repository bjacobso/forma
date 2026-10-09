# RFC 0007: Checked evaluation of untrusted source

| | |
| --- | --- |
| Status | Proposed; partly implemented |
| Created | 2026-10-09 |
| Scope | Checking before running, capability grants, resource limits, permission points at host calls, diagnostics for programs that repair code, threat model |
| Direction | One host operation checks source against a grant set before it runs, then runs it under limits with every host call paused for a decision |

## Summary

A host submits source it did not write, a set of granted capabilities, and
limits. Forma parses, expands, and typechecks the source with only the granted
host builtins in scope, and rejects it before running if it fails or reaches an
ungranted capability. Accepted source runs under step, time, and host-call
limits. Every call to a granted capability pauses with its source span so the
host can perform, deny, or ask. Results and diagnostics are structured for a
program, such as a language model, to read and repair.

Most of the pieces exist. This RFC combines them into one operation and states
what that operation does not protect against: the TypeScript engine is an
in-process interpreter, not a security boundary.

## Motivation

Hosts increasingly run code written by models. One design gives a model a
single tool that evaluates code in a restricted language with a granted
vocabulary, instead of many fixed tools. oh-my-lisp plans this as an agent
whose only tool is `eval` in a SCI sandbox
([RFC 0005](./0005-live-sessions.md) describes that evaluation). Forma can
offer more than a restricted namespace: the code is typechecked before it
runs, its reachable capabilities are known before it runs, and each
capability call is a typed pause that the host controls.

The same operation serves any host that evaluates user-supplied Forma:
playgrounds, rule editors, and plugins.

## Current state

- **No check before running.** `evaluateInSession` runs the module graph
  (`Engine.evaluateInSession` in `packages/ts/src/engine/operations.ts`,
  `packages/ts/src/modules/runtime.ts`) without type inference. A consumer
  that wants checking calls `typecheck` or `moduleGraph` separately. The
  OCaml `replSubmit` operation evaluates a submission before it typechecks
  it (`packages/ocaml/lib/abi_session_ops.ml`).
- **Step limits.** Each request accepts `stepLimit`; the TypeScript host
  defaults to 50,000 (`packages/host/src/ts-host.ts`). Exceeding it fails
  with `StepLimitExceeded` (`packages/ts/src/diagnostic/errors.ts`). There
  are no limits on wall time, allocation, result size, host-call count, or
  retained values, and macro expansion and type inference have no budget.
- **Grants.** `configureSession({ hostBuiltins })` declares the host builtins
  of a session: name, arity, optional type scheme, effect name, and purity
  (`HostBuiltinDescriptor` in `packages/host/src/types.ts`). Only these names
  are bound as host builtins, and each call pauses the evaluation with
  `{ status: "host-call" }` until `resumeHostCall`. The default builtins
  (`packages/ts/src/builtins/index.ts`) perform no I/O. `TypePolicy` can
  remove the default builtin schemes from type checking.
- **Effect rows.** Function types in the Hindley–Milner checker carry effect
  rows (`packages/ts/src/type/types.ts`). Host builtin descriptors contribute
  only type schemes; their effect and purity do not appear in inferred rows.
  Effect programs have checked `:requires` and `:throws` rows
  ([Effect reference](../effect/reference.md)), but the kernel does not run
  Effect programs (`module/effect-runtime`).
- **Typed authority.** `Type.checkAuthority`
  (`packages/ts/src/type/authority.ts`) abstractly interprets lowered code to
  find the attributes of the facts it can produce, and compares them with
  grant facts of the form `[author "can" attribute]`. Unknown attributes are
  reported as `*`. It covers produced data, not host calls. It is pinned by
  `conformance/typed-authority/` and exists only in the TypeScript engine
  (a gap in `conformance/engine-parity/matrix.json`).
- **Workbench approvals.** The workbench computes the capabilities each row
  can reach from the symbol index (`packages/workbench/src/requirements.ts`)
  and turns each `HostCall` into a permission checkpoint
  (`packages/workbench/src/run.ts`). A denial resumes with a
  `capability/denied` failure. `HostCall` has no span, so the workbench
  locates a call only when the capability has exactly one reference.
- **Cancellation.** The TypeScript host's `abortEvaluation` sets a flag that
  is checked when the evaluation next calls a host builtin, and fails a
  pending call. It does not stop a computation that makes no host calls. The
  OCaml host notes that abort does not interrupt running native evaluation.
- **Diagnostics.** `Diagnostic` has a code, severity, message, phase, span
  with optional line and column, and free-form `details`.

## Proposal

### One operation

```ts
interface CheckedRunRequest {
  readonly sessionId: string;
  readonly source: string;
  readonly sourceId?: string;
  readonly grants: readonly {
    readonly name: string;                 // a configured host builtin
    readonly mode: "ask" | "allow";
    readonly maxCalls?: number;
  }[];
  readonly authority?: { readonly author: string; readonly grants: readonly GrantFact[] };
  readonly expectedType?: string;          // Forma type syntax for the result
  readonly limits?: {
    readonly steps?: number;
    readonly wallMs?: number;              // checking and running together
    readonly hostCalls?: number;
    readonly resultBytes?: number;
  };
}

type CheckedRunState =
  | { readonly status: "rejected"; readonly stage: "parse" | "expand" | "typecheck" | "grant" | "authority";
      readonly diagnostics: readonly Diagnostic[]; readonly requires: readonly string[] }
  | { readonly status: "host-call"; readonly call: HostCall & { readonly span: Span; readonly mode: "ask" | "allow" } }
  | { readonly status: "completed"; readonly result: EvaluationResult; readonly type: string;
      readonly hostCalls: number }
  | { readonly status: "failed"; readonly stage: "evaluate" | "limit" | "denied" | "aborted";
      readonly diagnostics: readonly Diagnostic[] };
```

The host resumes `host-call` states with the existing `resumeHostCall`. The
operation runs these steps in order and stops at the first failure:

1. Parse and expand under the time budget. Expansion counts steps.
2. Check the module graph against the session scope, with only the granted
   host builtins in scope. A reference to a configured but ungranted builtin
   is reported as `grant/ungranted` at its span, not as an unbound name.
3. Compute the capabilities the source can reach, including through session
   definitions. Any reachable capability outside the grants rejects the run.
4. If `authority` is given, run `checkAuthority` and reject on missing
   attributes.
5. If `expectedType` is given, require the result type to fit it.
6. Evaluate under the limits. Each call to a granted builtin pauses with its
   span. In `ask` mode the host decides; in `allow` mode the host performs it
   without asking, but the call is still reported and counted.

A rejected run performs no host calls. The session is not changed; to keep
definitions, a host submits accepted source through
[RFC 0005](./0005-live-sessions.md).

### Static capability requirements

The engine computes reachable capabilities from the checked program instead
of each consumer computing them. Host builtin calls contribute their effect
name to the inferred effect row; `attachEffectToOperationType` in
`packages/ts/src/type/infer-core.ts` already attaches a label to an operation
type. The workbench's `requirementsFor` then becomes a projection of the
engine result. The requirement set is returned with every rejection, so the
caller can see what the source needed.

### Permission points

`HostCall` gains `span`, the author source span of the call expression. A
denial resumes with `capability/denied` at that span, as the workbench does
today. `maxCalls` and `limits.hostCalls` fail the run with `limit/host-calls`
at the call that exceeded them. Implementations of host builtins still
validate their arguments; with [RFC 0006](./0006-signatures-as-contracts.md),
arguments can be decoded against the builtin's declared type.

### Limits and cancellation

Abort and the wall-clock deadline are checked at every evaluation step,
together with the step limit, so `abortEvaluation` stops a computation that
makes no host calls. Type inference and expansion run under the same
deadline. `resultBytes` bounds the projected result, reusing the bounded
projection the TypeScript host already applies to observations. Memory use is
not limited in process.

### Diagnostics for repair

Every rejection and failure diagnostic has a stable code, a span with line and
column, and `details` with structured fields where they exist: expected and
actual types, the missing capability, the exceeded limit. A deterministic text
rendering, `renderDiagnostics(diagnostics, source, { maxDiagnostics })`, prints
each diagnostic with the source line and a caret. Golden tests pin the
rendering so that prompts built from it do not change unintentionally.

## Threat model

The operation is designed to stop mistakes in code written by a model or a
person who is not trying to escape, and to make every external effect visible
and individually approvable. It provides:

- source cannot call a capability that was not granted, because it is
  rejected before it runs;
- source that does not typecheck does not run;
- every call to a capability pauses at a known span before it happens;
- long-running computations stop at the step and time limits.

It does not provide isolation from hostile code:

- The TypeScript engine is an interpreter running in the host's JavaScript
  realm. A defect in the reader, expander, evaluator, builtins, or value
  projection could expose host objects or crash the host.
- Allocation is not bounded. A program can build large values within its
  step limit and exhaust memory.
- Values that host calls return are visible to the program and can appear in
  its result. Grants determine what information the program can obtain.
- Data returned by a capability, such as file contents, can steer a model.
  Permission points let a host review the resulting calls; they do not
  detect manipulation.

Hosts that run hostile code should run the engine in a separate process or
worker with operating-system limits ([RFC 0008](./0008-runnable-host.md)
proposes a process protocol; the native OCaml daemon already runs as a
child process, without a sandbox). Host builtin implementations are the trust
boundary: each one must validate its arguments and enforce its own policy,
such as confining paths to a directory.

## Alternatives considered

- **A JavaScript sandbox.** Compiling to JavaScript and running it in an
  isolated engine such as QuickJS gives stronger isolation but loses the
  typed check before running and typed pauses at capability calls. The two
  can be combined later by running a Forma engine inside such an isolate.
- **Interactive approval only.** The workbench asks before each call. Headless
  hosts need grants decided before the run and a rejection before any work.
- **Capabilities as values.** Passing capability objects instead of granting
  ambient names would allow attenuation and delegation. It needs capability
  values in the type system and is outside this proposal.

## Implementation stages and validation

1. **Check, then run (TypeScript).** Add the operation with grant scoping,
   type checking, expected type, and step limits. Fixture
   `conformance/checked-run/` covers: a type error and an ungranted
   capability are rejected with spans and a test asserts zero host calls; a
   granted call pauses with its span; a denial fails with
   `capability/denied`; the step limit fails with `limit/steps`.
2. **Engine requirements.** Effect labels for host builtins and the reachable
   capability set from the checked program. The workbench uses it; its
   existing requirement tests pass unchanged.
3. **Limits.** Wall-clock deadline, cooperative abort, host-call counts, and
   result size. A test aborts a pure infinite loop and expects
   `evaluation/aborted` within a bounded time; a test exhausts the time
   budget during type inference.
4. **Diagnostics.** `renderDiagnostics` with golden output for each
   rejection and failure code.
5. **OCaml parity.** The native host checks before it evaluates and passes
   the fixture; `typed-authority` remains a recorded gap until the OCaml
   engine implements it.

## Decisions still required

- Whether `allow` mode should exist or every call should pause.
- Whether grants can constrain arguments, such as path prefixes, or whether
  that stays in host builtin implementations.
- How the authority check, which covers produced facts, relates to effect
  labels on host builtins that write facts.
- Defaults for limits when a request omits them.
