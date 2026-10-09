# Module contracts

These source fixtures exercise exported identities, brands, tagged constructors,
polymorphic portable schemes, and linked Effect modules. The host suite in
`packages/host/test/modules.test.ts` always checks TypeScript against native
OCaml outputs stored in `interfaces-and-linked-modules.json` and
`portable-schemes.json`. Native OCaml is checked against the same files when its
CLI is available. Linked modules are returned by the native host using its shared
TypeScript linker over native module declarations.

After `opam exec -- pnpm build:ocaml`, capture and review the native references:

```sh
FORMA_UPDATE_GOLDEN=1 FORMA_REQUIRE_NATIVE_MODULES=1 pnpm --filter @formalang/host exec vitest run test/modules.test.ts
```

Update mode requires native OCaml, captures it first, and then compares TypeScript
with the new files. Object keys are sorted; arrays, schemes, source spans, and
provenance are retained. `FORMA_REQUIRE_NATIVE_MODULES=1` without update mode
fails if the native CLI is missing. Ordinary `pnpm test` runs the golden comparisons
without OCaml. Behavioral assertions for private scopes, imports, diagnostics,
and evaluation also continue to run.
