# Alchemy on Effect 4.1

`alchemy@2.0.0-beta.84.patch` adapts Alchemy's OAuth implementation to Effect
4.1.1. Alchemy still imports the removed `effect/Crypto` module, which prevents
the deploy command and Cloudflare provider from loading.

The patch uses Effect's `crypto/SecureRandom` and `crypto/Digest` Web Crypto
layers for state generation and S256 PKCE. Alchemy's `PlatformServices` supplies
both layers to the CLI and authorization flows. Crypto defects retain beta.84's
typed `OAuthCryptoError`. The patch updates runtime JavaScript, the
corresponding TypeScript source, and declaration files that still require the
old Crypto service. It changes no token exchange or deployment behavior.

This replaces the beta.83 patch. It follows the family's beta.84 fix, with
defect handling to preserve Alchemy's typed crypto errors:

- [Triplex beta.84 patch](https://github.com/bjacobso/triplex/blob/main/patches/alchemy%402.0.0-beta.84.patch)
- [Triplex import/PKCE check](https://github.com/bjacobso/triplex/blob/main/scripts/check-alchemy.mjs)
- [Schematics crypto tests](https://github.com/bjacobso/schematics/blob/main/packages/server/test/alchemy-crypto.test.ts)

`pnpm install --frozen-lockfile` applies the version-scoped patch through
`pnpm-workspace.yaml`. `pnpm check:alchemy`, included in `pnpm check`, imports
the deploy/state commands, Cloudflare provider, and Forma stack. It compiles
production and two PR stages offline to check Worker names, domain isolation,
routes, and removal policy. It loads Cloudflare's state-store/auth contributions
and lifecycle functions without running them. It checks offline PKCE/state
generation, client-secret authorization, and error mapping for random/digest
failures. It performs no authentication, remote state access, token exchange,
planning, or deployment.

Revisit this patch when upgrading Alchemy. Remove it only after the upstream
release uses compatible crypto APIs and the import, authorization, frozen
install, and full checks pass without the patch.
