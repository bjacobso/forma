# Working on Forma

Forma is a pre-alpha typed Lisp. Preserve the distinction between implemented
behavior, engine parity, and planned features when changing code or docs.

## Setup and checks

Use Node.js 24 and pnpm 10.20 (the version in `packageManager`). From the root:

```sh
node scripts/setup-workspace.mjs
pnpm check
```

Setup validates registry dependencies with the frozen lockfile, then builds and
packs the same pinned, unpublished Foldworks packages as CI. It installs those
tarballs through the existing local link hook and restores the committed
lockfile. `.context/`, `.foldworks/`, and `.pnpmfile.cjs` are local artifacts.
Do not commit a lockfile containing local Foldworks paths. See
`packages/workbench/README.md` for manual linking and current limits.

`pnpm check` runs the branding check, TypeScript checks, JavaScript tests,
parity-runner tests, and the VitePress docs build including the `llms.txt`
structure and link-target check. There is no repository-wide formatting command;
match nearby formatting. Turbo builds dependent JavaScript packages as needed.

For native engine changes, install the OCaml 5.2 toolchain with `mise install`
and run `pnpm test:ocaml` and `pnpm parity:engines`. For site changes, also run
`pnpm website:build` and `pnpm test:site` (install Playwright Chromium first with
`pnpm --filter @formalang/website exec playwright install chromium`). CI covers
visual tests, workbench browser tests, and the Wrangler deployment dry run.

## Layout and conventions

- `packages/ts/` and `packages/ocaml/`: the two language engines.
- `packages/host/`, `packages/editor/`, `packages/language-server/`: host ABI and editor tooling.
- `packages/workbench/` and `apps/workbench/`: structural IDE and standalone demo.
- `apps/website/`: compiler playground, production Worker, and site tests.
- `docs/`: VitePress source; `docs/agents.md` generates `/llms.txt` at build time.
- `preludes/`, `examples/`, `conformance/`: library vocabulary and behavior fixtures.
- `scripts/`: checks, package linking, parity tools, and website assembly.

Use the existing ESM, TypeScript, Vitest, and Node script conventions. Domain
vocabulary belongs in preludes and descriptors, not hardcoded compiler concepts.
Keep diagnostics tied to author source and pin semantic changes in meaningful
fixtures. Both engines share conformance expectations but have documented
differences; do not claim parity without checking it. Regenerate homepage samples
with `pnpm --filter @formalang/website snippets:home` when their inputs change.

## Boundaries

Depend on sibling projects through packages, never sibling source imports.
Keep generated `dist*` output, local links, credentials, and deployment state out
of commits. Do not add a framework to serve static documentation. Keep
`docs/agents.md` accurate about shipped features and maturity; use public Markdown
source links and real built pages. `pnpm check:llms` checks existing docs output.

Do not deploy by hand, publish packages, or merge unless explicitly instructed.
The existing Deploy workflow deploys validated pushes to `main`, and Changesets
handles releases. Pull requests do not deploy.
