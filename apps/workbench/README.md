# Forma workbench app

A small Vite application that mounts [`@formalang/workbench`](../../packages/workbench)
as a project workspace for authoring and a REPL. The example picker opens an
onboarding workflow, functions and collections, or a four-file pricing project.
The onboarding example includes workflow forms registered by a prelude and
capabilities that run only after you allow them. See the [design note](../../docs/workbench.md).

Choose a file in the sidebar, edit its outline or source, and evaluate expressions
in the REPL with Ctrl/⌘+Enter. The REPL replays pure definitions against current
file drafts; scratch definitions persist until Clear. F12 or Definition ↗ opens
the resolved declaration across imports and re-exports. Back returns to its use.
Add file creates a module, and Reset example restores the selected project.
Drafts and history survive project switches in memory and are discarded on reload.
`?project=functions` and `?project=modules` open those examples directly.

`?demo=code-mode` opens the interactive Foldkit [inline Forma experiment](../../packages/host/examples/inline-code-mode/README.md).
Edit a prose/code response, run its explicit `forma-run` segment, switch mock
runtime bindings, or try a write with access denied or explicitly allowed.
The transcript records executable source, checked host results and a deterministic
continuation. It uses the existing TypeScript host boundary through the experimental
`@formalang/host/inline-code-mode` package entry; the Effect companion is checked
separately and no live model or credentials are used.

The [screenshot tour](../../packages/workbench/README.md#screenshots) shows the
outline and inspector, source pane, proposal review, and capability approval flow.

The website serves this app at `/workbench/demo/`, with links from the docs
navigation, homepage, and playground examples. `pnpm website:build` builds
both apps and assembles their assets alongside the docs; `pnpm test:site`
checks the assembled Cloudflare site. The production bundle uses that base
path, while `pnpm workbench` still serves the standalone app at `/`.
`pnpm --filter @formalang/workbench-app preview` serves a production build at
`/workbench/demo/` too; its links back to the docs and playground need the
assembled website.

```sh
pnpm workbench
pnpm --filter @formalang/workbench-app test:e2e
```

| File | Purpose |
| --- | --- |
| `src/projects.ts` | Bundled project catalog and per-project configuration |
| `src/program/onboarding.forma` | The program the workbench opens |
| `src/program/functions.forma` | Pure functions and collections for the REPL |
| `src/program/modules/` | Named imports, namespace imports, and a re-export |
| `src/program/workflow.lisp` | The prelude that registers `step` and `workflow` |
| `src/program/capabilities.ts` | The simulated capabilities the program may call |

The Foldkit Vite plugin keeps each page's model on the dev server and pushes
it into newly loaded pages after a hot update. Reload or restart the dev
server after changing files before trusting what the browser shows. The
end-to-end tests start their own server.

First set up the unpublished Foldworks link as the package README describes.
`pnpm workbench` builds the language packages and workbench before starting
Vite. The app is separate from the React website.

The default assistant is local: focus a row and ask it to wrap, unwrap, raise,
splice, rename, or extract. Preview never performs the sample capabilities.
Run uses a simulated directory and chat channel; each call still goes through
an actual host suspension and a Foldworks permission checkpoint.
