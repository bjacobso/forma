# `@formalang/website`

The static Vite/React site and browser compiler explorer for `forma-lang.com`.
Its live pipelines run `@formalang/ts` in a Web Worker and expose source, syntax,
inferred types, evaluated values, and generated artifacts.

The structural workbench lives in Foldworks. The Worker redirects the legacy
`/workbench/demo` and `/workbench/demo/` paths to the destination in
`src/lib/workbenchLocation.ts`. `pnpm website:build` assembles only the docs
and playground. The homepage's `LiveWorkbench` and `WorkbenchEditor` stay here
and use `@formalang/editor`; they do not depend on Foldworks.

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
