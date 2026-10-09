# Corpus emission golden

`expected.json` stores the current native OCaml corpus emission summary:
58 sources, 548 declarations, counts by module and declaration kind, and a
SHA-256 manifest hash. `packages/ocaml/scripts/gates.mjs` reads this file for the
emission, architecture, benchmark, and reset gates.

The producer is `packages/ocaml/scripts/emit-corpus-golden.mjs`. It emits each
independent example with its dependency bundle via the native daemon. For each
source it records the canonical artifact's declaration count, declaration hash,
and sorted kind counts. It sorts sources by source ID, serializes object keys in
sorted order, and hashes that manifest. The golden contains no build times or
absolute paths.

Regenerate while OCaml is available, then review the JSON diff:

```sh
opam exec -- pnpm build:ocaml
FORMA_UPDATE_GOLDEN=1 node packages/ocaml/scripts/emit-corpus-golden.mjs
node packages/ocaml/scripts/emit-corpus-golden.mjs
```

`--print` prints the actual summary without changing the stored file. The OCaml
gate checks the summary and also checks native elaboration against Lisp fallback
through `elaboration-parity.mjs`. TypeScript validation of this summary is owned
by the artifact validation work; this capture change adds no TypeScript corpus
check.
