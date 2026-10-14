# Releases

Run `pnpm changeset` for changes that affect public packages. Select the affected
packages, a version bump, and a short user-facing summary. Commit the generated
Markdown file with the implementation.

Include only public packages in a changeset's frontmatter. Private workspaces,
including `@formalang/ocaml`, are excluded from versioning; mixing them with
public packages prevents Changesets from creating a release plan. An entry for
a public package may still describe related changes in the private engine.
Run `pnpm check:changesets` to validate the release plan; `pnpm check` also runs
this validation in CI before merge.
Changesets compares against `origin/main`, so CI fetches full history before
checking the release plan. Local checkouts should also have an up-to-date
`origin/main` reference.

The Release workflow opens a version PR. Merging that PR publishes the changed
packages after release checks pass. Private workspaces are neither versioned nor
published. See `docs/publishing.md` for first-publish setup and verification.
