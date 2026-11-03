# Working on Forma

Forma is a pre-alpha typed Lisp. Preserve the distinction between implemented
behavior and planned features when changing code or docs.

## Setup and checks

Use Node.js 24 and pnpm 10.20 (the version in `packageManager`). From the root:

```sh
pnpm install --frozen-lockfile
pnpm check
```

The root frozen install is the complete setup; no sibling checkout, link hook,
or manifest rewriting is needed. Forma has no Foldworks dependencies. The
structural workbench lives in Foldworks; this repository keeps the language,
UI-free language service, source editor integrations, and browser playground.
`.context/` contains local artifacts.

`pnpm check` runs the branding check, TypeScript checks, JavaScript tests,
the surface golden check, and the VitePress docs build including the `llms.txt`
structure and link-target check. There is no repository-wide formatting command;
match nearby formatting. Turbo builds dependent JavaScript packages as needed.

For site changes, also run `pnpm website:build` and `pnpm test:site` (install
Playwright Chromium first with
`pnpm --filter @formalang/website exec playwright install chromium`). CI covers
visual tests, assembled-site browser tests, and the Wrangler deployment dry run.

## Layout and conventions

- `packages/ts/`: the language engine.
- `packages/host/`, `packages/editor/`, `packages/language-server/`: host ABI and editor tooling.
- `apps/website/`: compiler playground, production Worker, and site tests.
- `docs/`: VitePress source; `docs/agents.md` generates `/llms.txt` at build time.
  `docs/rfcs/` holds design RFCs for the repository only: the site excludes them,
  and site pages link to them on GitHub.
- `preludes/`, `examples/`, `conformance/`: library vocabulary and behavior fixtures.
- `scripts/`: checks, surface goldens, and website assembly.

Use the existing ESM, TypeScript, Vitest, and Node script conventions. Domain
vocabulary belongs in preludes and descriptors, not hardcoded compiler concepts.
Keep diagnostics tied to author source and pin semantic changes in meaningful
fixtures. Stored goldens are reviewed expectations: when `pnpm surfaces --update`
or a test's update flag rewrites them, review and explain the diff. Regenerate
homepage samples with `pnpm --filter @formalang/website snippets:home` when their
inputs change.

## Boundaries

Depend on sibling projects through packages, never sibling source imports.
Keep generated `dist*` output, local links, credentials, and deployment state out
of commits. Do not add a framework to serve static documentation. Keep
`docs/agents.md` accurate about shipped features and maturity; use public Markdown
source links and real built pages. `pnpm check:llms` checks existing docs output.

Do not deploy by hand, publish packages, or merge unless explicitly instructed.
The Deploy workflow deploys validated pushes to `main`, and Changesets handles
releases. Same-repository pull requests deploy isolated previews when the
`preview` environment has Cloudflare credentials; closing the PR destroys its
preview. Forks never deploy.
