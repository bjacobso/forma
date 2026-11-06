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

Open `/playground/custom` to build a DSL with separate prelude and example
editors in a full-window workspace. Drag the divider (or use its arrow keys)
to resize the editor and inspector. Both files can be shown together on large
screens; file tabs switch between them on smaller screens. Inspector tabs show
typed IR, each file's syntax tree, registered form definitions, clickable source
maps, and compiler timings/provenance. **New playground** opens a blank workspace
in a new tab, preserving the current draft.

The compiler elaborates the example against that prelude in a worker
and displays diagnostics and typed IR. **Share playground** saves both files
and the title in R2 and copies a short `/playground/p/<id>` URL. Anyone with
the link can load the snapshot and edit a copy without an account. Sharing
an edit creates a new snapshot; existing links keep their original content.
The website Worker serves the saved title in social metadata on a cold request.

Alchemy provisions a private `PLAYGROUNDS` R2 binding and a
`PLAYGROUND_WRITES` rate limiter on the existing website Worker. Production
uses `forma-playgrounds`, retained on stack removal. Each preview gets its own
bucket, destroyed with its contents when the preview is removed. The deployment
token needs **Workers R2 Storage Edit** in addition to the existing permissions.

The API accepts version 1 JSON snapshots at
`POST /playground/api/playgrounds` and reads them at
`GET /playground/api/playgrounds/<id>`. IDs derive from snapshot content, writes
are create-only, and bodies are limited to 128 KiB. Saves are rate limited to
10 per minute per IP. Snapshots have no expiry, editing, listing, or deletion
endpoint; operators can remove an object directly from R2 when necessary.

For local storage and sharing, run `pnpm website:build` followed by
`pnpm --filter @formalang/website exec wrangler dev --local` and open its
`/playground/custom` route. Wrangler simulates R2 locally; no cloud credentials
are needed. The Vite-only `pnpm dev` server supports editing and compilation,
but does not serve the storage API. `pnpm test:site` tests the full Worker and
local R2 flow. Compressed fragment snapshots can also be opened locally.

The starter workflow demonstrates a prelude-defined plan format; it does not
execute agents or provide a durable workflow runtime.
