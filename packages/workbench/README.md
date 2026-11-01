# @formalang/workbench

A structural Forma IDE in which the outline is the program, built with
[Foldkit](https://github.com/foldkit/foldkit) and
[Foldworks](https://github.com/bjacobso/foldworks). Every outline row is one
Forma form. The [design note](../../docs/workbench.md) describes how it is
built.

## Screenshots

These captures show the standalone app running the real onboarding program.

**The outline is the program.** Rows show observed values and inferred types.
The inspector expands a retained collection, and descriptor slots offer missing
clauses as placeholders.

![Forma outline with live values, inferred types, descriptor placeholders, and an expanded collection inspector](../../docs/images/workbench/outline.png)

**One document, two views.** The source pane shares the outline's analysis and
highlights the inspected form. Located workflow warnings appear below the editor.

![Source editor showing the same Forma document, the inspected form highlighted, and two located workflow warnings](../../docs/images/workbench/source.png)

**Review structural changes.** The local assistant proposes a wrapper around the
focused form. The tree diff and analyzed consequences are visible before Accept;
the resulting edit can be undone in one step.

![Structural proposal review showing an added wrapper, the moved form, consequences, and Accept and Discard buttons](../../docs/images/workbench/proposal.png)

**Approve capabilities before they run.** Evaluation pauses at the directory
lookup and shows its arguments and description. This demo uses simulated
directory and chat capabilities; reads and writes each require approval.

![Permission checkpoint for Directory.lookup with the ada argument, capability description, and Allow once and Deny controls](../../docs/images/workbench/permission.png)

## Mounting the workbench

The workbench is a Foldkit submodel. An application mounts it and provides
the language host as a resource:

```ts
import { Runtime } from "foldkit";
import { TsLanguageHost } from "@formalang/host/ts-host";
import { FormaHost, Workbench } from "@formalang/workbench";

const config = { sourceId: "program.forma", preludes: [], capabilities: [] };

Runtime.run(
  Runtime.makeElement({
    Model: Workbench.Model,
    init: () => Workbench.init({ id: "workbench", title: config.sourceId, source }),
    update: Workbench.update,
    view: Workbench.view,
    container: document.getElementById("root"),
    resources: FormaHost.layer(new TsLanguageHost(), config),
  }),
);
```

Import `@foldworks/ui/base.css`, a Foldworks theme, and
`@formalang/workbench/styles.css`, and configure the StyleX compiler as
`@foldworks/ui` describes.

## Using the workbench

The demo mounts `Workspace`, a project wrapper around the single-document
`Workbench`. Choose Onboarding workflow, Functions & collections, or Pricing
modules. File drafts, outline/source undo histories, and REPL history stay in
memory when switching files or projects. Add file creates a module; Reset
example restores the bundled files. Reloading the page discards drafts.

Modules use explicit `(export name)`, `(import "./file.forma" [name])`,
`(import "./file.forma" :as alias)`, and `(export-from "./file.forma" [name])`.
Files load without running their application expressions. F12 or Definition ↗
at a symbol opens its original declaration, including through namespaces and
re-exports; the inspector's Uses links do the same. Back returns to the caller.

The REPL evaluates expressions using the active file's pure definitions and
the current project drafts. Ctrl/⌘+Enter submits multiline input. Successful
scratch definitions remain available to later entries and can be redefined.
Each entry replays those definitions in a fresh session, so changes to files
take effect on the next submission. Application expressions and definitions
known to require capabilities are omitted from the file context. The REPL
performs no capabilities; use Run in authoring for the approval flow. Clear
discards the transcript and scratch definitions.

Applications can mount the same project experience:

```ts
import { Workspace } from "@formalang/workbench";

const projects: readonly Workspace.Project[] = [{
  id: "pricing",
  title: "Pricing",
  description: "A small module project",
  entry: "main.forma",
  files: [
    { sourceId: "main.forma", source: '(import "./math.forma" [double]) (double 21)' },
    { sourceId: "math.forma", source: '(export double) (define double [x] (+ x x))' },
  ],
  repl: "(double 10)",
}];

Runtime.run(Runtime.makeElement({
  Model: Workspace.Model,
  init: () => Workspace.init({ id: "workbench", projects }),
  update: Workspace.update,
  view: Workspace.view,
  container: document.getElementById("root"),
  resources: Workspace.layer(new TsLanguageHost(), projects),
}));
```

Each project can supply `config` with its own preludes, checks, proposer, and
capabilities. No file's definitions become implicit globals in another file.

Edit a row's text, and use Return, Tab, and Shift+Tab to change the outline.
Fold and hoist with the outliner's controls. Outline and Brackets are two
notations for the same tree. Source opens the Foldworks code editor over the
same document; malformed source keeps the last valid outline available.

Values and types appear beside rows. Click a row's accessory to inspect its
value, requirements, definitions, and uses. Structured evaluation values load
through retained host handles. Domain forms show their elaborated payloads.
Ctrl+Shift+Space opens keyboard hover; Ctrl+Space offers scoped completions.
Descriptor placeholders insert the slot template as one undoable step.

Focus a row or select several, then choose a refactoring. The input supplies
the wrapper head or the new name for Rename and Extract. Assistant requests
such as “wrap selection in do” produce a TreeDiff and analyzed consequences.
Accept applies one undo step; Discard leaves the program unchanged. Run pauses
at each capability so the person can approve or deny it. Live analysis and
proposal previews never perform capabilities.

## Optional model proposer

The default is local and deterministic. An application can explicitly create
an adapter while supplying an Effect `LanguageModel` layer:

```ts
import { Effect } from "effect";
import { modelProposer } from "@formalang/workbench";

// languageModelLayer is the application's chosen provider, configured separately.
const proposer = await Effect.runPromise(
  modelProposer("My configured model").pipe(Effect.provide(languageModelLayer)),
);
const resources = FormaHost.layer(new TsLanguageHost(), { ...config, proposer });
```

Model output uses the same edit-script schema and host validation as the local
proposer. The person reviews its diff and consequences before applying it.
No provider is installed, no key is required, and no network call occurs by
default. Runtime resources own host sessions and close them on disposal.

## Foldworks

The workbench uses unpublished Foldworks primitives packed from
[`7b60eb4342773cbd532f27ebcfd87ca9d7555356`](https://github.com/bjacobso/foldworks/commit/7b60eb4342773cbd532f27ebcfd87ca9d7555356),
the current `main` when vendored. Seven committed tarballs in `vendor/` include
`agent`, `code-editor`, `history`, `keyboard` (a UI dependency), `outliner`,
`text-intelligence`, and `ui`. The [manifest](../../vendor/manifest.json) records
the source revision and SHA-256 of each archive. The workbench remains private.

From a fresh Forma clone, `pnpm install --frozen-lockfile` installs these
packages through `pnpm-workspace.yaml` file overrides. No Foldworks checkout,
manifest rewriting, registry workaround, or link hook is required in local,
CI, deployment, or release installs. Manifest version ranges still describe
intended minimum releases; the overrides select the pinned source packages,
whose version numbers have not yet caught up with those ranges.

For local Foldworks development, refresh the tarballs from a clean local
checkout with `FOLDWORKS_DIR=../foldworks pnpm vendor:foldworks`, then run
`pnpm install --no-frozen-lockfile` and `pnpm workbench`. This is a snapshot of
built package exports; after changing Foldworks, commit its changes and repeat
the refresh. See the [vendoring instructions](../../vendor/README.md) for
validation and how to discard a local experiment.

Forma uses Foldkit and @foldkit/ui 0.170.0, @foldkit/vite-plugin 0.29.0,
Effect 4.1.1, and StyleX 0.19.0. The pinned Foldworks packages declare compatible
peers, so no Foldworks peer exceptions are needed. Their upstream build runs
as is; Forma applies no Foldworks patches. Foldkit and its plugin accept
Effect 4.1.1 through their ~4.1.0 ranges. Alchemy's Effect companions remain
pinned to 4.1.1 within its supported ^4.0.0 ranges in `pnpm-workspace.yaml`.
The workbench unit tests, standalone browser tests, and assembled-site browser
tests exercise this combination. Vitest 5 satisfies @effect/vitest 4.1.1's peer
range. Release versioning regenerates the same complete lockfile.

Publication would require published Foldworks dependencies and revalidation
without file overrides before removing `private`; vendoring does not publish
any package.

Known first-release limits: evaluation stops at the first failure, observation
has no step trace, host calls have no exact dynamic source span, operational
Effect programs are typed but not executed, and files are not
persisted. See the design note for the language-service follow-ups.
