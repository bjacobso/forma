# Publishing Forma

The public npm packages are `@formalang/ts`, `@formalang/host`,
`@formalang/editor`, and `@formalang/language-server`. The website and
workbench apps remain private. The language server runs on `@formalang/ts`.
There are no native binaries.

## Normal releases

1. Run `pnpm changeset` and commit the release note with the code change.
2. Merge the change into `main`. Changesets opens or updates a version PR.
3. Review the version PR, then merge it. The Release workflow validates and
   packs the packages, publishes through npm trusted publishing, and creates
   tags and GitHub releases.

The version PR is opened with the workflow token, so CI does not run on it.
Before merging, check out its branch and run `pnpm release:check`. A failure
after the merge leaves `main` with versions that were never published. Read the
generated changelogs as well: breaking entries start with `**Breaking:**`.

`pnpm release:check` builds and tests the JavaScript packages, checks the
surface goldens, and installs the packed tarballs in a temporary consumer
project. The consumer check loads every library export and analyzes a document
with the language server's workspace. A release build machine needs only
Node.js and pnpm.

Forma pins an exact Effect version in its public types. Version 0.2.0 uses
Effect 3, 0.3.0 uses `effect@4.0.0-rc.112`, and 0.4.0 uses `effect@4.0.3`.
Consumers should install the same version as the Forma release they use, remove
any Effect 3 alias kept only for Forma, and import `Effect` from `effect`. Keep
that exact version until Forma and the consumer agree on a later Effect 4
version.

## Publishing a new package

An npm organization alone does not configure trusted publishing. Publish a new
package's first version from an authenticated maintainer session, then configure
its trusted publisher with these exact values:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `bjacobso` |
| Repository | `forma` |
| Workflow filename | `release.yml` |
| Environment | `npm-publish` |
| Allowed action | `npm publish` |

Apply the package's first changeset through the version PR before publishing so
the published version matches the repository. Validate with `pnpm release:check`,
then use `pnpm release:publish` from the validated main revision while logged
in to npm. Complete npm's authentication prompts in the maintainer session.

The GitHub publishing job uses OIDC and does not require a persistent npm token.
Do not enable automatic first publication until the intended scope and package
contents have been reviewed. The `npm-publish` GitHub environment must match
the name configured on npm. GitHub Actions must be allowed to create pull
requests for the version PR step.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[Changesets automation](https://changesets.dev/guide/automating).
