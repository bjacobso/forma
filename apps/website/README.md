# `@formalang/website`

The static Vite/React site and browser compiler explorer for `forma-lang.com`.
Its live pipelines run `@formalang/ts` in a Web Worker and expose source, syntax,
inferred types, evaluated values, and generated artifacts.

The website also serves the separate Foldkit workbench app at
`/workbench/demo/`. `pnpm website:build` assembles the docs, playground, and
workbench without adding Foldkit to the React app.

```sh
pnpm --filter @formalang/website dev
pnpm --filter @formalang/website test
pnpm --filter @formalang/website build
pnpm --filter @formalang/website test:visual
pnpm test:site
pnpm website:dry-run
```

The checked-in Cloudflare configuration supports static assets and route-aware
metadata. CI validates it with a dry run and browser tests of the assembled
site. The Deploy workflow publishes validated pushes to `main`.
