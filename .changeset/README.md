# Releases

Run `pnpm changeset` for changes that affect public packages. Select the affected
packages, a version bump, and a short user-facing summary. Commit the generated
Markdown file with the implementation.

Include only public packages in a changeset's frontmatter. Private workspaces,
such as the website and workbench apps, are excluded from versioning; mixing
them with public packages prevents Changesets from creating a release plan.
Start a breaking entry with `**Breaking:**` and say what consumers must change.
Run `pnpm check:changesets` to validate the release plan. CI runs this validation
on ordinary pull requests before merge. Changesets consumes the release notes
when it creates the version PR, so that PR and checks on `main` run
`pnpm check` without requiring another changeset.
Changesets compares against `origin/main`, so CI fetches full history before
checking the release plan. Local checkouts should also have an up-to-date
`origin/main` reference.

The Release workflow opens a version PR. Merging that PR publishes the changed
packages after release checks pass. Private workspaces are neither versioned nor
published. See `docs/publishing.md` for first-publish setup and verification.
