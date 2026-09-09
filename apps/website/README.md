# `@formalang/website`

The static Vite/React site and browser compiler explorer for `forma-lang.com`.
Its live pipelines run `@formalang/ts` in a Web Worker and expose source, syntax,
inferred types, evaluated values, and generated artifacts.

```sh
pnpm --filter @formalang/website dev
pnpm --filter @formalang/website test
pnpm --filter @formalang/website build
pnpm --filter @formalang/website test:visual
pnpm website:dry-run
```

The checked-in Cloudflare configuration supports static assets and route-aware
metadata. CI validates it with a dry run and does not contain a deployment job.
