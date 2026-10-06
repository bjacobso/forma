# Forma workbench app

A small Vite application that mounts [`@formalang/workbench`](../../packages/workbench)
on an onboarding program: pricing functions, workflow steps registered by a
prelude through elaboration, and capabilities that run only after you allow
them. See the [design note](../../docs/workbench.md).

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
| `src/program/onboarding.forma` | The program the workbench opens |
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
