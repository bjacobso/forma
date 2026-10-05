# @formalang/workbench

A structural Forma IDE in which the outline is the program, built with
[Foldkit](https://github.com/foldkit/foldkit) and
[Foldworks](https://github.com/bjacobso/foldworks). Every outline row is one
Forma form. The [design note](../../docs/workbench.md) describes how it is
built.

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

## Foldworks

The workbench needs Foldworks primitives that are not published yet:
`@foldworks/outliner` and `@foldworks/text-intelligence` 0.1.0,
`@foldworks/ui` 0.3.0, `@foldworks/code-editor` 0.2.0, and
`@foldworks/agent` 0.2.0. Until they are, the package is private, and a
Foldworks checkout can be linked for development:

```sh
# In Foldworks, on main or bjacobso/outliner-lisp-ide:
pnpm install && pnpm build:packages
# Here:
FOLDWORKS_DIR=../foldworks pnpm foldworks:link
pnpm install
```

Linking rewrites `pnpm-lock.yaml` with local paths. Do not commit it;
`pnpm foldworks:unlink` restores it.
