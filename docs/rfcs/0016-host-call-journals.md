# RFC 0016: Host-call journals

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-16 |
| Scope | Recording host calls and their outcomes, deterministic replay, divergence diagnostics, journal format, lossless value projection |
| Direction | Every source of nondeterminism in a kernel evaluation is a host call, so recording host-call outcomes is enough to reproduce an evaluation exactly |

## Summary

A host can ask for an evaluation's host calls to be recorded. Each call that
pauses the evaluation is appended to a journal together with the outcome the
host resumed it with. A later evaluation of the same program can replay the
journal. The host then answers matching calls from the journal instead of
surfacing them, and reports a located diagnostic when the program asks for a
different call than the one recorded.

```text
record:  program + live host           → result + journal
replay:  program + journal             → the same result, with no host work
diverge: changed program + journal     → journal/diverged at the first different call
```

The journal is plain data in a line-oriented JSON format. It is written one
entry at a time, so a journal survives a crash of the recording process.

## Motivation

Loon's runtime records every nondeterministic effect operation (file reads,
clock reads, UUIDs, network calls) to a trace with `loon run --record`, and
`loon replay` runs the same program against it. Its source notes say that the
same program and the same trace give an identical execution, including
reproducing a crash at the same step.

Forma is in a better position to do this than most languages. The kernel
builtins perform no I/O and read no clock, randomness, or environment. All
access to the outside world goes through host builtins, and each call already
pauses the evaluation as a typed `HostCall` and waits for `resumeHostCall`.
The only missing piece is keeping those pauses and answers.

Uses include:

- **Reproducing agent runs.** The agent host in
  [RFC 0010](./0010-live-sessions.md) calls Forma steps that call model and
  tool capabilities. A journal turns a bad run into a deterministic
  reproduction that can be replayed against a redefined step.
- **Workbench runs.** A run whose capabilities were approved once can be
  replayed after an edit without asking again. Replay stops at the first call
  the edit changed.
- **Tests.** [RFC 0015](./0015-tests-in-forma.md) excludes host builtins from
  tests. A recorded journal is a fixture that lets a test exercise code that
  calls them.
- **Conformance.** A stored, reviewed journal is a golden for an effectful
  program, which extends conformance checks beyond pure evaluation.

## Current state

- **Host calls.** `HostCall` (`packages/host/src/types.ts`) has
  `evaluationId`, `callId`, `effect`, `name`, and `args` as
  `ValueProjection[]`. It has no span; [RFC 0012](./0012-checked-evaluation.md)
  proposes adding one. `EvaluationState` is `completed`, `host-call`, or
  `failed`. `HostCallResumeResult` is `{ok: true, value}` or
  `{ok: false, diagnostics}`.
- **Identifiers are not stable.** TypeScript allocates `ts-eval-N` and
  `ts-call-N` from counters on the host instance. Two runs of the same
  program in one host give different identifiers.
- **Failed resumes differ.** The TypeScript host turns `{ok: false}` into a
  `KernelTypeError` that keeps only the first diagnostic's message, so the
  host's code is lost (`ts-host.ts`, pinned by
  `packages/host/test/conformance.test.ts`). (The since-removed OCaml host
  kept the code.) The kernel cannot catch the failure.
- **Callbacks.** Functions passed to a host call can be retained and invoked
  with `callValue`. Each invocation is a new evaluation with its own
  identifier, and it can pause on host calls. Host conformance tests cover
  nested host calls from callbacks.
- **Suspension.** TypeScript suspends a running fiber with
  `Effect.callback`. It cannot serialize a suspended evaluation, so replay has
  to re-run from the start.
- **Value projection is lossy.** `ValueProjection` has `nil`, `bool`, `int`,
  `float`, `string`, `keyword`, `symbol`, `list`, `vector`, `map`, `function`,
  and `opaque`. Resuming in TypeScript (`kValueFromProjection`) turns functions
  and opaques into their display strings, map keys into strings, and vectors
  into lists. It also projects `1.0` as `int`.
- **Remaining nondeterminism.** `gensym` uses a process-global counter
  (`builtins/macro.ts`), so generated symbol names
  depend on earlier work in the same process.
  `FORMA_DISABLE_NATIVE_ELABORATION` changes elaboration.
- **No history.** The workbench keeps one `RunOutcome` and replaces it on each
  run. Its REPL "replay" re-runs pure declarations; it does not replay host
  calls. `docs/workbench.md` notes that observations are not a trace.
- **Identity.** `sessionInfo` reports per-source hashes and a prelude
  fingerprint. TypeScript uses 32-bit FNV-1a, so these are not content
  digests. Only SHA-256 over canonical JSON (`artifact/canonical-json.ts`,
  `publicExportHash`) is. (The since-removed OCaml engine used MD5, so these
  hashes were also not comparable across engines.)

## Proposal

### Journal entries

```ts
interface JournalHeader {
  readonly format: "forma-journal/v1";
  readonly engine: string;                    // e.g. "typescript"
  readonly program: {
    readonly sources: readonly { readonly id: string; readonly sha256: string }[];
    readonly preludes: readonly { readonly id: string; readonly sha256: string }[];
    readonly entry: string;                   // source id or binding name
    readonly revision?: number;               // RFC 0010
  };
  readonly builtins: readonly { readonly name: string; readonly effect: string }[];
}

interface JournalEntry {
  readonly seq: number;                       // 0, 1, 2 … in pause order
  readonly evaluation: readonly number[];     // [] for the root; [k] for its k-th callback evaluation, and so on
  readonly effect: string;
  readonly name: string;
  readonly args: readonly JournalValue[];
  readonly outcome:
    | { readonly ok: true; readonly value: JournalValue }
    | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
}
```

Entries are matched by order and content, never by `callId`. The
`evaluation` path places calls made from `callValue` callbacks in the tree of
evaluations they belong to. Calls in different branches are matched within
their branch.

`JournalValue` is the projection of `nil`, `bool`, `int`, `float`, `string`,
`keyword`, `symbol`, `list`, `vector`, and `map` with exact round-tripping:
`int` and `float` stay distinct, map keys keep their kind, vectors stay
vectors, and floats are written as JSON numbers. A function or opaque argument
is recorded as `{kind: "function", ordinal: n}`, its position among the
call's function arguments. It is compared by position only, and it cannot
appear in an outcome.

### Recording

Evaluation requests (`evaluateInSession`, `callValue`, and the proposed
`callBinding` and checked run) accept:

```ts
readonly journal?: { readonly mode: "record" };
```

Recording does not change how calls are performed. Each call still pauses and
the host still decides. When the host resumes a call, the engine appends the
entry. In-process hosts receive entries through an `onJournalEntry` callback
as they happen. Under [RFC 0013](./0013-runnable-host.md), the server sends an
`evaluation/journal` notification for each entry. The terminal
`EvaluationState` includes the complete journal.

The file form is JSON Lines: the header on the first line, then one entry per
line, flushed after each write. A reader accepts a file truncated after any
complete line.

### Replay

```ts
readonly journal?: {
  readonly mode: "replay";
  readonly header: JournalHeader;
  readonly entries: readonly JournalEntry[];
  readonly onExhausted?: "fail" | "pause";    // default "fail"
};
```

Before running, the host compares the header with the program. A different
source or prelude digest is reported as a warning, `journal/program-changed`.
Replay still proceeds, because replaying a changed program is the point of
reproducing a bug against a fix. Unknown builtin names are an error,
`journal/unknown-builtin`.

During evaluation, each host call is compared with the next entry for its
evaluation path:

- **Match.** The effect, name, and arguments are equal. The host resumes the
  call with the recorded outcome itself, and the call is not surfaced.
- **Divergence.** Anything else ends the evaluation with `journal/diverged`.
  Its `details` hold the entry's `seq`, the recorded call, and the actual call.
  Once RFC 0012 adds `HostCall.span`, the diagnostic points at the call
  expression.
- **Exhausted.** A call with no remaining entry fails with `journal/exhausted`
  or, with `onExhausted: "pause"`, pauses as a live host call. Replaying a
  prefix and then continuing live resumes a run that crashed.

When the evaluation completes, unused entries are reported as a warning,
`journal/unused-entries`. A replayed evaluation can itself record. The new
journal then contains the replayed entries followed by any live ones.

### Determinism

Replay reproduces an evaluation exactly when the program, preludes, and
engine are the same. To make that guarantee hold:

- `gensym` counters become per-evaluation, so generated
  symbols do not depend on earlier work in the process.
- TypeScript keeps the host's diagnostics on a failed resume, so a recorded
  failure replays with the same code.
- The host projects and decodes `JournalValue` losslessly. This fixes the
  float, map-key, and vector conversions listed above.
- Step limits apply as usual. A replay that exceeds a limit the recording did
  not reach is a real difference in behavior and is reported as one.

### Privacy

A journal contains everything capabilities returned, which can include file
contents, credentials, and model output. Forma does not store journals; hosts
own storage, retention, and access control. Recording accepts an optional
`redact(entry)` callback that can replace values before an entry is emitted.
A redacted value is recorded as `{kind: "redacted"}`, and replaying it fails
with `journal/redacted` at that call.

### Effect programs

Generated Effect TypeScript does not use host calls, and the mechanics runtime
calls host services directly. Journals do not cover them in this RFC. A later
proposal can derive a recording provider and a replaying provider for each
service, either with [RFC 0014](./0014-local-providers.md) local providers or
in the generator. Those providers would produce the same entry format, using
the service as the `effect` and the member as the `name`.

## Alternatives considered

- **Snapshotting suspended evaluations.** Serializing a paused evaluation would
  allow resuming without re-running. The engine cannot serialize closures or
  fibers, and snapshots would be tied to one engine version. Re-running from the start
  with recorded outcomes is portable and cheap for the workloads in view.
- **Recording in the host only.** A host can already log the calls it answers.
  It cannot replay them without the engine's help, because matching needs the
  evaluation tree and the engine has to report divergence at a source location.
- **Matching by call identifier.** Identifiers are allocated from counters and
  differ between runs. Content and order are the only stable keys.
- **Trace every evaluation step.** A full trace would support time-travel
  debugging but is much larger, and nothing in it is needed for replay.
  Observations already cover per-expression values.

## Conformance

A new fixture, `conformance/host-call-journals/`, holds programs with stored,
reviewed journals and expected results. Tests record each program and compare
the journal with the stored one, then replay the stored journal and compare
the result. (As proposed, both engines implemented recording and replay and
the parity runner replayed journals across engines; that was dropped when the
OCaml engine was removed.)

## Implementation stages and validation

1. **Lossless values and failures.** `JournalValue` projection and decoding,
   TypeScript resumes that keep host diagnostics, and per-evaluation `gensym`.
   Host conformance tests round-trip `1.0`, keyword map keys, and vectors
   through a host call. They also check that a failed resume keeps its code.
2. **Recording (TypeScript).** Header, entries, the callback, and the terminal
   journal. Tests record a program with two sequential calls, a failed call,
   and a nested call from a callback, and compare the journals with goldens.
3. **Replay (TypeScript).** Matching, divergence, exhaustion with both modes,
   unused entries, changed-program warnings, and redaction. Tests replay with
   zero surfaced host calls and the recorded result. They also check that
   changing an argument reports `journal/diverged` at the right `seq`, and
   that a truncated journal followed by `pause` continues live.
4. **OCaml and cross-engine replay.** Dropped: the OCaml engine was removed.
5. **Consumers.** The workbench keeps the journal of its last approved run and
   offers replay after an edit. `forma run` gains `--record <file>` and
   `--replay <file>`.

## Decisions still required

- Whether replay should require the header digests to match unless a flag
  allows a changed program.
- How a host should treat calls whose arguments include functions, which match
  by position only.
- Whether journals should carry the outcomes of `callValue` evaluations
  started by the host, or only host calls made by Forma.
- Whether [RFC 0015](./0015-tests-in-forma.md) tests can name a journal
  fixture, and how such fixtures are re-recorded.

## Related designs

Loon's record and replay is in `crates/loon-lang/src/eir/replay.rs` in
[ecto/loon](https://github.com/ecto/loon). Durable execution systems such as
Temporal replay a workflow's history of activity results to rebuild its state.
rr records nondeterministic inputs to reproduce a process exactly. This
proposal records only host-call outcomes, the one boundary through which
Forma programs observe the outside world.
