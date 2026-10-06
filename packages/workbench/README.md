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

The workbench needs Foldworks primitives that are not published yet:
`@foldworks/outliner` and `@foldworks/text-intelligence` 0.1.0,
`@foldworks/ui` 0.3.0, `@foldworks/code-editor` 0.2.0, and
`@foldworks/agent` 0.2.0. Until they are, the package is private, and a
Foldworks checkout can be linked for development:

```sh
# In a sibling Foldworks checkout:
git checkout main
pnpm install && pnpm build:packages
# Here:
FOLDWORKS_DIR=../foldworks pnpm foldworks:link
pnpm install
pnpm workbench
```

Linking rewrites `pnpm-lock.yaml` with local paths. Do not commit it;
`pnpm foldworks:unlink` restores it.

Validated with Foldworks main at `695695e`. The
manifest ranges describe the minimum intended releases, while that unpublished
checkout currently has older version numbers. Foldkit and @foldkit/ui are
0.156.0, Effect is 4.0.0-rc.112, and StyleX is 0.19.0. The workbench has no
local Foldworks patches. Once the primitives are released, unlink, generate
a registry lockfile, recheck, and remove `private` before publication.

PR CI first validates the existing registry dependencies with a frozen install,
then builds the pinned Foldworks commit and links its packages for that job.
The temporary tarballs, hook, and lockfile changes are never committed. Main
and release workflows continue to require a frozen registry install. CI switches
to that same install once the workbench is public and its release lockfile exists.

Known first-release limits: evaluation stops at the first failure, observation
has no step trace, host calls have no exact dynamic source span, operational
Effect programs are typed but not executed, and files are not
persisted. See the design note for the language-service follow-ups.
