# RFC 0005: Live sessions and redefinition

| | |
| --- | --- |
| Status | Proposed; not implemented |
| Created | 2026-10-09 |
| Scope | Session definitions, redefinition, keyed wrappers, revision records, host ABI, engine parity |
| Direction | A session is a revisioned module; a change is checked as a whole, dependents are re-instantiated, and hosts late-bind by name at the call boundary |

## Summary

A host session keeps the declarations submitted to it. Submitting a declaration
with an existing name replaces it. Each accepted change is checked against the
whole session, re-instantiates the definitions that depend on it, and produces
a numbered revision with a record of what changed. Hosts call session bindings
by name, so the next call after a redefinition uses the new code. Keyed
wrappers let a host install, replace, and remove behavior around a binding
without editing its source.

The proposal extends the [module model](../modules.md): updating a file already
creates new instances for that file and its dependents. A session applies the
same rule to individual declarations. It does not add mutable global cells,
dynamic binding, or in-language `eval` to Forma.

## Motivation

Some programs are changed while they run. A long-lived host process keeps its
state and I/O while an author, or a program acting for one, inspects and
replaces individual definitions. REPL-driven development, notebooks, live
service patches, and the workbench REPL all need this.

The case that prompted this RFC is a local coding agent. We evaluated
rebuilding [oh-my-lisp](https://github.com/sm-th/oh-my-lisp) ("oml"), a
babashka agent of about 1,500 lines, on Forma. In oml every step of the agent
loop is a named function that the core calls through its var. `defn` replaces
a step; `advise!` wraps one with a keyed, removable function; `/eval` and an
nREPL server change the running process. Its planned chapters add an agent
that may redefine its own functions under owner-approved invariants, with
every change recorded as a revision that can be rolled back.

The architecture we considered keeps I/O, model streaming, the loop driver, and
the client protocol in a TypeScript and Effect host. Forma holds the agent's
redefinable logic and tools as typed definitions. Triplex, a fact database,
stores transcripts, revisions, and receipts; Foldworks provides an optional
web UI. Those projects have their own proposals. Forma's part is general:
definitions that persist in a session, redefinition with defined semantics,
wrappers, and change records that a host can store. None of it is specific to
agents.

## Current state

- **TypeScript host.** `TsLanguageHost.evaluateInSession`
  (`packages/host/src/ts-host.ts`) evaluates the submitted source as the entry
  of a module graph through `Engine.evaluateInSession`
  (`packages/ts/src/engine/operations.ts`). The result includes an
  environment, which the host discards. Only `configureSession` variables and
  prelude `loadSource` calls replace `session.language.env`. A `define`
  submitted in one call is unbound in the next.
- **Files as a workaround.** A host can persist definitions by loading them
  as module sources and importing them from later evaluations. Updating a
  file creates new instances for it and its dependents
  (`packages/ts/src/modules/runtime.ts`). There is no per-definition change,
  record, or rollback.
- **OCaml.** The `replSubmit` operation (`submit_repl` in
  `packages/ocaml/lib/abi_session_ops.ml`) evaluates a submission, then
  typechecks it, then replaces `session.env` and `session.type_env`. The
  native `forma_cli.exe repl` uses it. `OcamlLanguageHost.evaluateInSession`
  (`packages/host/src/ocaml-host.ts`) uses it only when the session has host
  builtins configured; otherwise it calls `evaluateModule`, which does not
  persist. A submission that calls a host builtin takes the host-effect path
  in `abi_session_host_effect.ml`, which also does not persist. Ordinary
  source `loadSource` validates and stores a module; only preludes update the
  environment.
- **Runtime model.** `Env` (`packages/ts/src/Env.ts`) is an immutable chain of
  frames. `define` creates a mutable slot only so that a function can refer
  to itself (`evalDef` in `packages/ts/src/evaluator/special-forms.ts`).
  Closures capture frames. There are no vars, atoms, `set!`, dynamic
  bindings, or in-language `eval`, `read`, or `load`; the default builtins
  (`packages/ts/src/builtins/index.ts`) include none. A later definition can
  only shadow an earlier one, and closures that captured the earlier value
  keep it. That is also what OCaml's `replSubmit` does today.
- **Workbench REPL.** `mergeReplSource` (`packages/workbench/src/repl.ts`)
  keys declarations by kind and name, lets later ones replace earlier ones,
  and replays the merged source in a fresh session for each entry.
- **Toy REPL.** `packages/ts/src/cli/repl.ts` threads an environment through
  input lines without types, modules, or host builtins. It is not a package
  binary.

## Proposal

### A session is a revisioned module

Each session owns one session module. Its declarations are keyed by
declaration kind and name, as `mergeReplSource` keys them, for every named
declaration that kernel modules evaluate: `define`, `:`, `macro`, `form`,
`type`, `class`, `error`, and `typeclass`. The session module can import
loaded file modules and sees the session's preludes like any other module.
Services and layers stay out of scope while the kernel reports
`module/effect-runtime` for Effect programs.

A submission is processed as one change:

1. Parse the submission. Split it into declarations and other expressions.
2. Build a candidate module: each declaration replaces the entry with the
   same key or adds a new one. Keys listed in the request's `remove` field
   are deleted.
3. Check the candidate module graph as a whole, including file modules that
   import the session module. Macro or form changes re-expand every session
   declaration.
4. If the check fails, return its diagnostics. The current revision is
   unchanged.
5. Instantiate the candidate. A declaration is re-evaluated when its source
   changed or when any binding it references was re-instantiated; others
   keep their instances. This is the module runtime's reuse rule applied per
   declaration.
6. Publish the new revision, then evaluate the submission's expressions
   against it and return their result.

An expression failure in step 6 does not undo the revision, as in a REPL.
Definitions are instantiated without host builtins. A definition whose
initialization reaches a host call is rejected with a located diagnostic,
consistent with pure module initialization in
[RFC 0003](./0003-direct-style-effects.md). Host calls happen only in
submitted expressions and in calls made by the host.

Re-instantiation follows resolved binding references. A record of functions
defined at the top level is rebuilt when one of those functions changes. This
removes the main hazard of shadowing REPLs, where dependents silently keep old
behavior.

### Types across redefinition

A redefinition may change a binding's type. Every dependent in the session and
in importing modules is rechecked in step 3. If a dependent no longer types,
the change is rejected with diagnostics at the dependent's source. An author
who wants a fixed contract writes a signature; a redefinition that does not fit
it is rejected at the definition.

### Late binding at the host boundary

A new host operation, `callBinding`, resolves a session binding by name when
it is called:

```ts
interface CallBindingRequest {
  readonly sessionId: string;
  readonly name: string;
  readonly args: readonly ValueProjection[];
  readonly revision?: number;   // default: the current revision
  readonly stepLimit?: number;
  readonly retainValues?: "none" | "functions" | "all";
}
// Result: EvaluationState plus the revision that was used.
```

A host that drives a loop by calling named steps through `callBinding` sees a
redefinition from the next call. Within Forma, references stay lexical. An
evaluation runs to completion in the revision where it started, including
while it is paused at a host call. Values retained through `valueRef` record
their revision; calling them runs that revision's code.

This is a deliberate difference from Clojure vars, where a running loop that
calls through a var also picks up changes. Programs that need that behavior
put the loop in the host.

### Keyed wrappers

The host ABI adds `wrapBinding` and `unwrapBinding`:

```ts
interface WrapBindingRequest {
  readonly sessionId: string;
  readonly name: string;     // the binding to wrap
  readonly key: string;      // replaces an existing wrapper with this key
  readonly source: string;   // a Forma expression of type (-> T T)
}
interface UnwrapBindingRequest {
  readonly sessionId: string;
  readonly name: string;
  readonly key?: string;     // omitted: remove all wrappers
}
```

`T` is the binding's type. A wrapper receives the current implementation and
returns a replacement:

```lisp
(fn [call-model]
  (fn [request]
    (do (log-request request)
        (call-model request))))
```

The effective binding applies wrappers in installation order, so the newest
wrapper is outermost. Wrappers are entries in the session module, keyed by
binding and wrapper key. They are checked, re-instantiated, recorded, and
restored like definitions. Redefining the wrapped binding keeps its wrappers,
and the change record lists them.

Wrapper installation is a session change, not a Forma operation. Without
mutable cells, a library can provide combinators that build wrapper
functions, but it cannot install one. No `wrap` source form is proposed; a
REPL can offer a command that calls `wrapBinding`.

### Revision records

Every published change produces a record:

```ts
interface SessionRevision {
  readonly sessionId: string;
  readonly revision: number;
  readonly parent: number;
  readonly principal?: string;   // supplied by the host
  readonly reason?: string;      // supplied by the host
  readonly changes: readonly {
    readonly op: "define" | "remove" | "wrap" | "unwrap";
    readonly key: { readonly kind: string; readonly name: string; readonly wrapper?: string };
    readonly source?: string;
    readonly previousSource?: string;
    readonly span?: Span;
    readonly scheme?: ModuleTypeScheme;
    readonly previousScheme?: ModuleTypeScheme;
  }[];
  readonly reinstantiated: readonly string[];
  readonly digest: string;       // hash of the complete declaration set
}
```

Forma does not store records; it returns them so that a host can, for example
as facts in a database. Further operations:

- `proposeChange` returns a checked candidate revision without publishing it.
  The host can evaluate expressions against the candidate, such as invariant
  checks an owner approved, before calling `commitChange`. `submit` is
  propose followed by commit.
- `restoreRevision` publishes a new revision whose declaration set equals an
  older one. History is append-only.
- `exportRevision` returns the complete declaration set. Applying it to a
  fresh session with the same preludes and files reproduces the digest, which
  lets a host rebuild a session after a restart.
- Each change names its parent revision. A change based on a stale parent is
  rejected, so concurrent clients cannot silently overwrite each other.

A program that changes its own definitions does so through a host builtin
that calls `proposeChange`. Each such call is a permission point under
[RFC 0007](./0007-checked-evaluation.md), and the host decides whether to
commit.

## Alternatives considered

- **Var cells.** Top-level references would read a mutable cell at each use,
  and redefinition would write the cell. This matches oml most closely,
  including changes observed by a loop that is already running. It adds
  mutable global state to a language with immutable environments and pure
  module initialization. Type soundness would still require rechecking
  dependents or freezing types. Values built from earlier cell contents, such
  as records of functions, would still be stale. Generated Effect TypeScript
  and the OCaml engine would need a cell representation for every top-level
  binding, or a development mode with different semantics. Rollback would
  require restoring every cell consistently. Rejected.
- **Shadowing.** Extending the environment, as OCaml `replSubmit` does today,
  is simple but leaves dependents bound to old definitions without any
  report. Rejected as the session semantics.
- **Files only.** Hosts can already write definitions to module files and
  reload them. That provides no per-declaration records, wrappers, late
  binding, or atomic rejection, and it requires hosts to invent a file layout
  for interactive input.

## Engine parity

The TypeScript engine implements this first. The OCaml engine replaces its
shadowing `replSubmit` with the same candidate, check, instantiate, and
publish procedure. The new procedure checks before it evaluates, which changes
the current OCaml order. The `loadSource` entry in
`conformance/engine-parity/matrix.json` stays an intentional difference; a new
`live-session` entry is recorded as a gap until both engines pass the shared
fixture.

## Implementation stages and validation

1. **Persistent session module (TypeScript).** Add `submit` to the host ABI
   while keeping `evaluateInSession` unchanged. Fixture
   `conformance/live-sessions/` holds submission sequences with expected
   values, diagnostics, and changed keys. Required cases: a definition is
   visible to a later submission; a redefinition rebuilds a dependent record
   of functions; a redefinition that breaks a dependent is rejected and the
   previous revision still evaluates; expressions are not stored; a removal
   is rejected while it still has dependents; a definition that reaches a
   host call is rejected.
2. **Records and history.** Revision records, `proposeChange` and
   `commitChange`, `restoreRevision`, `exportRevision`, and parent checks.
   Tests rebuild a session from an exported declaration set in a new host
   and compare digests. A restore produces a new revision with the old
   digest. A stale parent is rejected.
3. **Late binding and wrappers.** `callBinding`, `wrapBinding`, and
   `unwrapBinding`. A host-loop test calls a step, redefines it, and observes
   the new behavior on the next call. An evaluation paused at a host call
   completes with its original revision. A wrapper with the same key
   replaces the earlier one. A mistyped wrapper is rejected at its source.
4. **OCaml parity.** The native host passes the same fixture through the
   daemon ABI, and the matrix gap is removed.

## Decisions still required

- Whether redefining a binding keeps its wrappers, as proposed, or drops
  them, as oml's `defn` does.
- Retention of old revisions and of values retained from them.
- Whether `form` and `macro` changes are allowed in sessions that file
  modules import, given that they re-expand those modules.
- Whether `callBinding` needs a way to pin a revision for a sequence of calls
  that must see consistent code.
