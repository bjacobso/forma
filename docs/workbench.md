# The Forma workbench

<a href="/workbench/demo/" target="_self">Open the live demo</a> to edit
example projects as outlines or source, evaluate expressions in a REPL, jump
between module definitions, review assistant proposals, and approve simulated
capabilities.

This note decides how `@formalang/workbench` is built: a structural Forma IDE
in which the outline is the program. Every outline row is one Forma form and
shows its own value, type, and errors. Rows are edited by keyboard, by
refactorings, and by an assistant that proposes structural edits, never text
patches. A source pane shows the same program as Forma text.

[The outline is the program](./workbench-vision.md) states what the workbench
is for. It codes against the contract in Foldworks's
[language workbench note](https://github.com/bjacobso/foldworks/blob/main/docs/language-workbench.md#what-a-workbench-host-codes-against)
(Foldworks pull request 56)
and is built from the services in [Language services](./language-services.md).

Foldworks first explored the experience with a toy Lisp, preserved at
[`80c1077`](https://github.com/bjacobso/foldworks/tree/80c107756157a925227a5b0c898e78369f0f60ac/apps/demo/src/lisp).
The workbench is not a port of it. It is rebuilt against real Forma, and each
toy piece has a real counterpart:

| Prototype                               | Workbench                                                               |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `codec.ts`, rows ⇄ source               | `sourceToOutline` and `outlineToSource`, keeping comments and layout    |
| row ids                                 | syntax node ids, reconciled across reparses                             |
| `evaluate.ts` and its value trace       | per-expression observation, with values as handles shown in `ValueTree` |
| `analysis.ts`                           | the symbol index, references, and types, adapted to text intelligence   |
| `refactor.ts` and the assistant's edits | id-addressed edit scripts, previewed with `TreeDiff`                    |
| hand-written placeholder slots          | slot affordances from form descriptors                                  |
| the `defstep` and `workflow` sample     | a prelude that registers workflow forms through elaboration             |

The homepage and Effect page use a [live source embed](./workbench-embeds.md)
with real diagnostics, body inference, compiler output, and typing replays. That
note describes the embed contract, themes, and the next language-service work.

## Package boundary

- **`@formalang/workbench`** (`packages/workbench`) is a Foldkit submodel:
  `Workbench.init`, `update`, `view`, `Model`, and `Message`, plus the
  `FormaHost` service, the analysis adapter, and the assistant seam. It knows
  no domain. The program, its preludes, and the host capabilities a program
  may call come from its configuration.
- **Dependencies.** It depends on `@formalang/host` and `@formalang/ts`
  through workspace ranges, and on the Foldworks packages it renders
  (`outliner`, `text-intelligence`, `code-editor`, `ui`, `agent`, `history`).
  Like Foldworks, it declares `effect`, `foldkit`, `@foldkit/ui`, and
  `@stylexjs/stylex` as peers, so an application supplies one copy of each and
  runs the StyleX compiler. Its own styles are plain CSS on the Foldworks
  tokens, like the outliner's.
- **`apps/workbench`** is a small Vite application with the Foldkit plugin and
  StyleX. It mounts the project workspace and supplies three examples, a workflow
  prelude, and the capabilities the onboarding example uses. The React website does not
  include Foldkit. The website build serves this app's separate bundle at
  `/workbench/demo/`, linked from the docs and playground.
- **Host first.** Everything that can go through `LanguageHost` does, so a
  worker-backed or OCaml host can replace the in-process TypeScript host
  without changing the workbench. Two things go to `@formalang/ts` directly:
  reading one row's text in a view (`identifySyntax`, which is synchronous and
  pure) and elaboration, which the host ABI does not expose yet.
- **Publication.** The Foldworks primitives the workbench needs are not on npm
  yet, so the package is private until they are. For local development,
  `scripts/foldworks-link.mjs` packs a built Foldworks checkout and points the
  `@foldworks/*` dependencies at the tarballs through a gitignored
  `.pnpmfile.cjs`. Committed manifests name the published ranges the
  workbench needs.

## Where state lives

**Projects wrap documents.** `Workspace` adds an example picker, a file list,
file creation, navigation history, and a REPL around `Workbench`. Each file
keeps its editor model, including both undo histories and malformed source.
Projects keep separate drafts and REPL histories. Reset restores the bundled
project; reload discards all in-memory edits.

Every host command receives an immutable snapshot of the project's current
files; static analysis uses an isolated session. Files load as source modules,
while domain preludes stay shared core configuration. Explicit imports and
exports govern visibility. File changes invalidate older analyses and pending
runs; reset also rejects replies from the previous project generation. Resource
disposal closes retained value sessions.

F12, Definition ↗, and the inspector's Uses links resolve the original author
location, open the owning file, and select the declaration in Source. Namespace
imports and re-exports preserve definition identity. Back restores the caller's
location. The TypeScript host's editor analysis now checks the module graph and
retains typed spans; its symbol index keeps module globals lexical.

**A REPL beside authoring.** Ctrl/⌘+Enter evaluates multiline input against the
active file's pure declarations and current module drafts. Successful scratch
definitions persist and can be redefined; failed entries do not modify that
environment. Each entry replays declarations in a fresh session, so deleted or
edited definitions never leave hidden stale bindings. Top-level application
expressions and known capability-dependent definitions are excluded from the
file context. The REPL performs no host capabilities; authoring's Run retains
the explicit approval flow. Clear removes scratch declarations and history.

- **The outline is the program being edited.** `Outliner.Model` owns the rows,
  the caret, the selection, and undo history. Every change the workbench makes
  goes through `Outliner.Replace`, so typing, refactorings, accepted proposals,
  and source edits are all undoable steps.
- **The document is the outline printed.** `{ revision, source, identity }`
  is the outline printed by `outlineToSource`, with the previous document as
  the base. Unchanged rows keep their exact text, and every printed row's node
  has the row's id, so row ids are node ids. The identity is passed back on
  every request, so ids survive edits and reparses.
- **An analysis belongs to one revision.** Its facts are tagged with the
  outline revision they describe. A result for an older revision is dropped.
  A row shows facts only while its text is the text that was analyzed, so
  stale ranges never paint over newer text.
- **The source pane** is a `CodeEditor` model whose text is the document
  unless it is being edited. Edited source is reconciled against the previous
  identity, read back with `sourceToOutline`, and replaces the outline as one
  coalesced undo step. Source that does not read is marked where reading
  stopped and leaves the outline alone, as in the prototype.

The model stays serializable. The host, the proposer, and the capability
implementations are services, not model fields.

## Host sessions and observation as commands

`FormaHost` is an Effect service built from a `LanguageHost`, the preludes,
and the capabilities. The application provides it through Foldkit's
`resources` layer, which the runtime builds once and shares with every
command. The resource opens a session for static language services and loads
the preludes into it. Each observation and explicit run opens a fresh session
with the same configuration. Removed definitions cannot survive into a later
revision. Superseded value sessions are closed, and the resource closes every
session it owns when the runtime scope ends.

| Work                                | Foldkit                                                          |
| ----------------------------------- | ---------------------------------------------------------------- |
| print, identify, analyze a revision | `Analyze` command → `Analyzed({ revision, document, analysis })` |
| load a branch of a value            | `LoadValue` command, from `ValueTree`'s `RequestedChildren`      |
| try an edit script                  | `Preview` command → `Previewed({ proposal })`                    |
| ask the assistant                   | `Propose` command, through the `Proposer` service                |
| run with host capabilities          | `Run` and `Resume` commands → `Ran`, `HostCallRequested`         |

**One analysis per revision.** Each outline change starts an `Analyze`
command for the new revision. It prints the rows against the previous
document, then asks the host for editor analysis (types and type errors), the
symbol index, observation, and slot affordances, and elaborates descriptor
forms. Results for older revisions are ignored. The TypeScript host analyzes
a 60-line program in 50–90 ms in Node, so typing schedules an analysis after
a short pause instead of on every keystroke; a host in a worker would answer
the same messages without blocking input.

**Descriptor forms and code in one document.** Evaluation and type checking
do not know descriptor forms, and elaboration does not know ordinary code.
The workbench splits each document: descriptor forms are elaborated with the
rest blanked to spaces, and code is evaluated and typed with the descriptor
forms blanked. Blanking keeps every offset, so all facts stay in document
coordinates and observation records keep the document's node ids. The symbol
index and slot affordances read the whole document.

**Observation.** The program is evaluated in a fresh session with
`observe: { identity }`, so each record names the node it describes, and
`retainValues: "all"`, so a structured value is a handle. The inspector shows
a value as a `ValueTree`; expanding a branch sends `RequestedChildren`, which
the workbench answers by projecting the handle. Handles from a superseded
analysis are released by closing that analysis's session. Domain forms show
their elaborated payload and declared result type; those JSON payloads are
inspected locally. Descriptor slot clauses are inputs to elaboration, so they
show their evaluation state explicitly rather than a fabricated runtime value.
Type errors keep the observations produced before evaluation fails; the
located type diagnostic takes precedence over a duplicate runtime failure.

**Rows that do not read.** A row whose text does not parse is printed
verbatim in the document, so the source pane shows what was typed. For
analysis the outline is printed again with `brokenRows: "comment"` and the
document as base, so the rest of the program still evaluates and node ids
agree between the two printings. Facts are keyed by node id and placed with
the document's spans.

## The analysis adapter

One adapter turns Forma's analysis into the
`@foldworks/text-intelligence` vocabulary. It works in source coordinates and
keys every fact by node id:

- **Tokens.** Lexical kinds come from the syntax identity (delimiters,
  strings, numbers, keywords, comments, errors). Symbol kinds come from the
  symbol index: a definition, a reference to a global definition, a local, a
  macro, a descriptor form, a built-in, or unresolved.
- **Types** come from editor analysis's typed spans, matched to nodes by span.
- **Values** come from observation records, with their counts.
- **Diagnostics** come from parsing, type checking, evaluation, and
  elaboration, each at the span the service reported. With the macro change
  below, that span is author-written source even inside a macro call.
- **Hover** describes the node under an offset: what it is, its inferred type,
  its last value, its definition and documentation, and its references.
- **Completion** offers locals in scope, definitions, descriptor forms,
  available slots, capabilities, and built-ins, each with its type when known.

The source pane uses these facts directly. Outline rows use them through a
row layout: reading a row's text on its own yields the same nodes, in the same
order, as the row's elements in the source, so the two are paired node by
node. A fact at a source span is shown in the innermost row whose form
contains it, at the paired range, or over the whole row when the row's text
does not show it (a type error on a list whose elements are child rows).

## The edit flow

Every structural change is an edit script whose ids come from the current
document's identity.

1. **Propose.** A refactoring builds a script from the selection: wrap,
   unwrap, raise, splice, rename, and extract. The assistant returns a script
   with a title, or a reply when there is nothing to change.
2. **Preview.** `applyEditScript` produces the proposed source and identity,
   in which moved, wrapped, and renamed nodes keep their ids.
   `sourceToOutline` reads them as rows with the same ids. The proposed
   program is analyzed like any revision, and its consequences are the
   difference: diagnostics cleared and introduced, values that changed, and
   capabilities newly required. `TreeDiff` shows the rows inside a
   `ChangeSetPreview`, with the consequences as notices.
3. **Apply.** Accepting replaces the outline with the proposed rows as one
   undoable step, and the script's source becomes the document. Discarding
   leaves everything as it was. Refactorings the person invokes directly apply
   at once, as in the prototype, and are undoable in the same way.
4. **Undo.** The outliner's history restores rows. Each printed document is
   remembered for the rows it was printed from, so undoing to an earlier
   outline restores that outline's exact source.

**The assistant seam.** `Proposer` is a configurable service with one method: given the
prompt, the selected and focused node ids, `describeNodes` for them, and the
analysis facts for those rows, return an answer. The default implementation
is a deterministic local matcher, which is also the test fixture. A model
fills the same contract through `LanguageModel.generateObject` from
`effect/unstable/ai` with Forma's `EditScript` schema, as Foldworks's
`@foldworks/generative-ui` does for UI. `modelProposer()` captures an explicitly supplied `LanguageModel` and returns
a `Proposer` for `WorkbenchConfig.proposer`. Its structured schema covers every
edit operation; the host then validates the script against the current identity,
including scope and capture constraints. The default understands wrap, unwrap,
raise, splice, rename, and extract requests. The panel names the proposer that
answered, and edits invalidate outstanding proposals and replies.

## Effects and host capabilities

A program reaches the outside world through capabilities: host builtins the
application declares, each with a name, a type scheme, a purity (`read` or
`write`), a description, and an implementation the application runs. Forma
pauses an evaluation at every call to one and hands it to the host as a
`HostCall`, so the host decides whether it happens.

- **Types.** The capabilities' type schemes go to editor analysis, so a call
  to one is typed like any function and a misuse is a located type error.
- **Requirements.** A row's requirements are the capabilities it can reach:
  the ones it calls, and the ones required by the definitions it calls. The
  adapter computes them from the symbol index and shows them on the row, in
  hover, and in the inspector.
- **Live analysis performs no capabilities.** At a host call it resumes with
  an approval-required failure. Observations produced before the call remain
  available, and the row's requirements explain what blocked later values.
- **Running asks first.** Each `HostCall` becomes an `@foldworks/agent`
  permission checkpoint naming the capability, purity, description, and
  arguments. Allowing performs its implementation once and resumes evaluation
  with the result. Denying resumes with a located failure. Both reads and
  writes ask on every call; permission is never silently remembered.
- **One run at a time.** The model holds the run's pending call and revision.
  Outline and source edits invalidate it, abort a paused evaluation, and reject
  subsequent replies. Completed runs replace live observation values while
  retaining elaborated declarations.

`HostCall` carries no span or node id. Until the host ABI adds one, the
workbench places a call at the capability's reference in the program when
there is exactly one, and on the program otherwise. Programs with
Effect signatures get `Effect<A, E, R>` types from editor analysis, but the
evaluator does not run them; running them with gated service layers is
follow-up work.

## Language service changes

Three supporting changes precede the workbench in the stack:

- **Macro arguments keep their own locations.** The expander gives every node
  of an expansion the macro call's location, including the arguments the
  author wrote. A type error or runtime failure inside `(when ready (+ 1 "x"))`
  is reported on the whole call, and a macro that expands into another macro
  call can report an offset inside the prelude that defined it. Arguments
  should keep their own source traces, and a nested expansion should be
  located at the outer call the author wrote.
- **Editor analysis types capabilities and keeps partial results.**
  `analyzeEditor` cannot be given host builtins or a type policy, so a program
  that calls a capability has no types at all, and any type error empties
  every typed span. Its request gains the optional `hostBuiltins`,
  `typePolicy`, and `sessionId` that `typecheck` already accepts, and a failed
  analysis returns the types inferred before the error.
- **Browsers can import the descriptor module.** `@formalang/ts/descriptor`
  keeps bootstrap from sources browser-safe. Filesystem bootstrap is exported
  separately from `@formalang/ts/node`; its regression tests cover both entry points.

A workflow prelude's checks that need more than one declaration, such as a
step that reads data before another step writes it, run in the application
over the elaborated declarations and are located with `declarationDiagnostic`.
Typed `form` declarations validate their holes, references, and IR contracts
during elaboration. A form can add located diagnostics with `:check`.

## Typed workflow syntax

The sample uses `(define with-tax [amount] ...)` for functions. Its domain
prelude declares IR records with `type` and authoring patterns with `form`:

```lisp
(step verify-identity :system "Persona" :writes [:identity])
(step background-check :system "Checkr" :reads [:identity] :writes [:check])
(workflow onboarding
  (use verify-identity)
  (parallel (use background-check) (use collect-i9)))
```

`(Declares Step)` introduces each step name, `(Refers Step)` resolves a `use`,
and `(List flow)` projects nested sequences and parallel flows. Keyword
options stay in the form header; filling a `doc` placeholder appends `:doc`
and places the caret in that row. Both the outline and source pane use the
same typed forms and elaborated artifacts.

## Notation

The Outline and Brackets dial from the vision is a view over the same rows. In Brackets notation
a list row's bullet becomes `(` and its `)` is painted after the last row it
contains. Hoisting and folding work as in the outliner.

## First release

Someone can open the workbench app and, against real Forma:

- edit a program as an outline;
- see values, types, and diagnostics on every row;
- switch to the source pane and back without losing layout;
- fill a slot from a placeholder;
- run a refactoring;
- accept an assistant proposal after previewing its diff and consequences;
- approve a host capability before it runs.

Not in the first release:

- **Step-through.** Observation keeps each expression's last value and count,
  not a trace, so the prototype's step-through has nothing to replay. A trace
  would be a new language service.
- **Independent top-level forms.** Evaluation stops at the first failure, as
  Language services records; later rows show no values until it is fixed.
- A worker-backed host, the OCaml host, persistence, and the
  outliner's virtualization.

## Implementation

The workbench is delivered in one pull request: language-service support,
the Foldkit package, the standalone app and website demo, live editing and
observation, shared language assistance, source synchronization, structural
refactorings, capability checkpoints, assistant proposals, and verification.

## Validation and release

The workbench's tests exercise the shared adapter, scoped completions,
descriptor slots, observations and handle ownership, source reconciliation,
capture-safe edits and exact undo, proposal validation, capability denial and
approval, and cancellation on edits. The demo's Playwright scenarios cover the
complete user loop. Production screenshots and verification results accompany
the pull requests.

The implementation is tested against Foldworks main at `695695e`, after PR 56
merged. Its Lisp prototype at `80c1077` is only a historical reference; removing
the demo, its tests, and `docs/structural-lisp.md` does not change the contract
this package uses. There
are no local Foldworks code patches or additional primitive requirements.

The manifests declare the intended minimum releases: outliner and
text-intelligence 0.1.0, ui 0.3.0, code-editor and agent 0.2.0, with history
0.1.1. The main checkout still carries older package version numbers, so the
commit and contract are the development requirement until publication.
Once those releases exist, remove the development link,
generate a registry-only lockfile with the new workspace importers, run the
same checks, and then make the package public. A frozen install of the
unlinked stack cannot succeed before those packages are released.

Until publication, PR CI validates the committed registry lockfile with the two
unpublished workbench projects temporarily excluded, then builds and links the
pinned Foldworks commit in the isolated job. It runs the repository checks and
both website and workbench browser suites. The local dependency paths remain
temporary; main and release installs still require the frozen registry lockfile.

Follow-up language-service work includes spans on `HostCall`, paged value
projection, an observation trace for step-through, independently observed
forms after a failure, and execution of Effect programs through gated
service layers. The current release gates evaluator host builtins.
