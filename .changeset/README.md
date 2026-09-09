# Releases

Run `pnpm changeset` for changes that affect public packages. Select the affected
packages, a version bump, and a short user-facing summary. Commit the generated
Markdown file with the implementation.

The Release workflow opens a version PR. Merging that PR publishes the changed
packages after release checks pass. Private workspaces are neither versioned nor
published. See `docs/publishing.md` for first-publish setup and verification.
