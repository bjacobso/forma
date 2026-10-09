# Canonical IR golden

`expected.json` is the native OCaml result for `schema.lisp` and `data.lisp`,
produced by `packages/ocaml/scripts/canonical-ir-golden.mjs`. The script loads
`kernel`, `compiler`, and `ontology` preludes, loads both sources into one session,
and emits `canonical-ir`. It retains artifact names, media types, and complete
content, including module identities, hashes, declarations, and author provenance;
it omits the outer artifact envelope. The current fixture has five declarations,
including two module-scoped records.

The OCaml gate checks this file. The website pipeline in
`apps/website/src/pipelines/canonicalIr.ts` imports it as its stored example.
TypeScript checking is owned by the artifact validation work; this capture change
does not add that check.

Regenerate while OCaml is available, then review the JSON diff:

```sh
opam exec -- pnpm build:ocaml
FORMA_UPDATE_GOLDEN=1 node packages/ocaml/scripts/canonical-ir-golden.mjs
node packages/ocaml/scripts/canonical-ir-golden.mjs
```

The capture was refreshed against the current native engine and remained unchanged.
Keep this stored reference after removing OCaml; it cannot then be regenerated
from its original producer.
