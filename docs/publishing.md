# Publishing Forma

The public npm packages are `@formalang/ts`, `@formalang/host`,
`@formalang/editor`, and `@formalang/language-server`. The website and OCaml
build workspace remain private. The language server includes the portable
OCaml JavaScript artifact; platform-specific native binaries are not published.

## Normal releases

1. Run `pnpm changeset` and commit the release note with the code change.
2. Merge the change into `main`. Changesets opens or updates a version PR.
3. Review and merge the version PR. The Release workflow validates and packs
   the packages, publishes through npm trusted publishing, and creates tags
   and GitHub releases.

`pnpm release:check` builds and tests the JavaScript packages, builds the OCaml
engine, prepares the language-server runtime, and installs the packed tarballs
in a temporary consumer project. The consumer check loads every library export
and starts the bundled engine. OCaml, Dune, and js_of_ocaml must be installed
on a release build machine; GitHub installs them automatically.

## First publication

An npm organization alone does not configure trusted publishing. Bootstrap
the four packages with an authenticated maintainer session, then configure each
package's trusted publisher with these exact values:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `bjacobso` |
| Repository | `forma` |
| Workflow filename | `release.yml` |
| Environment | `npm-publish` |
| Allowed action | `npm publish` |

The initial changeset proposes version `0.2.0` from the current unpublished
`0.1.0` manifests. Apply it through the version PR before bootstrapping so the
first published versions match the repository. Validate with `pnpm release:check`,
then use `pnpm release:publish` from the validated main revision while logged
in to npm. Complete npm's authentication prompts in the maintainer session.

The GitHub publishing job uses OIDC and does not require a persistent npm token.
Do not enable automatic first publication until the intended scope and package
contents have been reviewed. The `npm-publish` GitHub environment must match
the name configured on npm. GitHub Actions must be allowed to create pull
requests for the version PR step.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[Changesets automation](https://changesets.dev/guide/automating).
