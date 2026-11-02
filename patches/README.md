# Alchemy on Effect 4.1

`alchemy@2.0.0-beta.83.patch` adapts Alchemy's OAuth implementation to Effect
4.1.1. Alchemy still imports the removed `effect/Crypto` module, which prevents
the deploy command and Cloudflare provider from loading.

The patch uses Effect's `crypto/SecureRandom` and `crypto/Digest` Web Crypto
layers for state generation and S256 PKCE. Each helper supplies its own layer;
callers need no crypto service. Crypto defects retain Alchemy's typed
`OAuthError` with `crypto_error`. The patch updates runtime JavaScript, the
corresponding TypeScript source, and declaration files that still require the
old Crypto service. It changes no token exchange or deployment behavior.

This is the beta.83 equivalent of the family's compatibility fix:

- [Foldworks beta.80 patch](https://github.com/bjacobso/foldworks/blob/7b60eb4342773cbd532f27ebcfd87ca9d7555356/patches/alchemy%402.0.0-beta.80.patch)
- [Triplex import/PKCE check](https://github.com/bjacobso/triplex/blob/main/scripts/check-alchemy.mjs)
- [Schematics crypto tests](https://github.com/bjacobso/schematics/blob/main/packages/server/test/alchemy-crypto.test.ts)

`pnpm install --frozen-lockfile` applies the version-scoped patch through
`pnpm-workspace.yaml`. `pnpm check:alchemy`, included in `pnpm check`, imports
the deploy command, Cloudflare provider, and Forma stack without executing
them. It checks offline PKCE/state generation, client-secret authorization,
and error mapping for random/digest failures. It performs no authentication,
token exchange, planning, or deployment.

Revisit this patch when upgrading Alchemy. Remove it only after the upstream
release uses compatible crypto APIs and the import, authorization, frozen
install, and full checks pass without the patch.
