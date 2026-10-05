# The Forma workbench

This note decides how `@formalang/workbench` is built: a structural Forma IDE
in which the outline is the program. Every outline row is one Forma form and
shows its own value, type, and errors. Rows are edited by keyboard, by
refactorings, and by an assistant that proposes structural edits, never text
patches. A source pane shows the same program as Forma text.

The workbench replaces each toy piece of Foldworks's
[structural Lisp prototype](https://github.com/bjacobso/foldworks/blob/bjacobso/outliner-lisp-ide/docs/structural-lisp.md)
with the real language service from [Language services](./language-services.md),
and it codes against the contract in Foldworks's
[language workbench note](https://github.com/bjacobso/foldworks/blob/bjacobso/outliner-lisp-ide/docs/language-workbench.md#what-a-workbench-host-codes-against).

| Prototype (`apps/demo/src/lisp`)        | Workbench                                                               |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `codec.ts`, rows ⇄ source               | `sourceToOutline` and `outlineToSource`, keeping comments and layout    |
| row ids                                 | syntax node ids, reconciled across reparses                             |
| `evaluate.ts` and its value trace       | per-expression observation, with values as handles shown in `ValueTree` |
| `analysis.ts`                           | the symbol index, references, and types, adapted to text intelligence   |
| `refactor.ts` and the assistant's edits | id-addressed edit scripts, previewed with `TreeDiff`                    |
| hand-written placeholder slots          | slot affordances from form descriptors                                  |
| the `defstep` and `workflow` sample     | a prelude that registers workflow forms through elaboration             |

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
  StyleX. It mounts the workbench and supplies the sample program, a workflow
  prelude, and the capabilities the sample uses. The React website does not
  include Foldkit; at most it links to this app.
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
command. The service opens one session and loads the preludes into it.

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

**Observation.** The program is evaluated in the session with
`observe: { identity }`, so each record names the node it describes, and
`retainValues: "all"`, so a structured value is a handle. The inspector shows
a value as a `ValueTree`; expanding a branch sends `RequestedChildren`, which
the workbench answers by projecting the handle. Handles from a superseded
analysis are released.

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
- **Completion** offers locals in scope, definitions, descriptor forms and
  their slots, and built-ins, each with its type when known.

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

**The assistant seam.** `Proposer` is a service with one method: given the
prompt, the selected and focused node ids, `describeNodes` for them, and the
analysis facts for those rows, return an answer. The default implementation
is a deterministic local matcher, which is also the test fixture. A model
fills the same contract through `LanguageModel.generateObject` from
`effect/unstable/ai` with Forma's `EditScript` schema, as Foldworks's
`@foldworks/generative-ui` does for UI. The model layer is opt-in: the
application must provide a `LanguageModel` and choose the model proposer,
and the panel names which proposer answered.

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
- **Live analysis asks nothing and performs nothing it was not allowed.**
  When the evaluation behind live values reaches a capability, the workbench
  answers with a failure that names the capability, unless it is a `read`
  the person allowed for the session; then the remembered or freshly
  performed result is used. Values computed before the call stay, and the row
  that needs the capability says so.
- **Running asks first.** Run evaluates the program with a person in the
  loop. Each `HostCall` becomes a `HostCallRequested` message and an
  `@foldworks/agent` permission checkpoint that names the capability, its
  purity, its arguments, and the row that needs it. Allowing performs the
  implementation and resumes the evaluation with its result. Denying resumes
  with a failure, which ends the run with a diagnostic on that row. A `read`
  can be allowed for the session; a `write` is asked for every time.
- **One run at a time.** A session's environment is replaced by each
  successful evaluation, so the workbench runs one evaluation per session at
  a time and aborts a paused run before the next analysis.

`HostCall` carries no span or node id. Until the host ABI adds one, the
workbench places a call at the capability's reference in the program when
there is exactly one, and on the program otherwise. Programs written with
`define-operation` get `Effect<A, E, R>` types from editor analysis, but the
evaluator does not run them; running them with gated service layers is
follow-up work.

## Language service changes

Two gaps in the TypeScript engine block the first release, and land before the
workbench:

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

A workflow prelude's checks that need more than one declaration, such as a
step that reads data before another step writes it, run in the application
over the elaborated declarations and are located with `declarationDiagnostic`.
Descriptor validation hooks are registered but not run by `elaborateProgram`;
running them is follow-up work for elaboration.

## Notation

The prototype's Outline and Brackets dial carries over. In Brackets notation
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
- A worker-backed host, the OCaml host, persistence, multiple files, and the
  outliner's virtualization.

## Stack

Each step is its own pull request:

1. This note.
2. Macro arguments keep their own source locations.
3. Editor analysis types capabilities and keeps partial results.
4. The package, the demo app, and read-only rows from the codec.
5. Live editing with identity, analysis, and diagnostics.
6. Values in rows and the inspector, with handles.
7. Hover, completion, and slot placeholders.
8. The source pane.
9. Refactorings and previews.
10. Effects and host calls through the permission checkpoint.
11. The assistant seam.
