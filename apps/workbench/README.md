# Forma workbench app

A small Vite application that mounts [`@formalang/workbench`](../../packages/workbench)
on an onboarding program: pricing functions, workflow steps registered by a
prelude through elaboration, and capabilities that run only after you allow
them. See the [design note](../../docs/workbench.md).

```sh
pnpm --filter @formalang/workbench-app dev
pnpm --filter @formalang/workbench-app test:e2e
```

| File | Purpose |
| --- | --- |
| `src/program/onboarding.forma` | The program the workbench opens |
| `src/program/workflow.lisp` | The prelude that registers `define-step` and `define-workflow` |
| `src/program/capabilities.ts` | The simulated capabilities the program may call |

The Foldkit Vite plugin keeps each page's model on the dev server and pushes
it into newly loaded pages after a hot update. Reload or restart the dev
server after changing files before trusting what the browser shows. The
end-to-end tests start their own server.
