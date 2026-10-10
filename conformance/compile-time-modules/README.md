# Compile-time modules

This file-based RFC 0002 stage 2 slice runs against the TypeScript and Native
OCaml hosts in `packages/host/test/compile-time-modules.test.ts`.

- `stripe.forma` exports `price` and its public declaration/payload types. Its
  label helper stays private and executes in its defining scope.
- `billing.forma` imports the form, declares two prices, and exports their
  immutable descriptors as a pure `prices` collection.
- `salesforce.forma` exports forms that derive picklists and check price references.
- `main.forma` imports the collection and forms to export a picklist and selection.
- `broken.forma` pins an unresolved namespace reference at its authored token.

`interfaces.json` stores native OCaml's complete portable interfaces. The shared
host suite always compares TypeScript against this golden, including data,
contracts, schemas, metadata, and provenance. It also checks native OCaml when
available; `FORMA_REQUIRE_NATIVE_MODULES=1` requires it. The suite checks private
helpers, macro hygiene, macro-introduced declarations, project preludes, re-exports,
source edits, schema inspection, and deferred platform syntax. No host-bootstrap
prelude stack is needed. The platform names are a local illustrative example,
not a claim to implement an external Stripe/Salesforce design document.

After building the engines:

```sh
FORMA_REQUIRE_NATIVE_MODULES=1 pnpm --filter @formalang/host exec vitest run test/compile-time-modules.test.ts
```

To regenerate after building native OCaml, then review the JSON diff:

```sh
FORMA_UPDATE_GOLDEN=1 FORMA_REQUIRE_NATIVE_MODULES=1 pnpm --filter @formalang/host exec vitest run test/compile-time-modules.test.ts
```

Capture runs native first and then checks TypeScript against the new file. Object
keys are sorted; contracts, schemes, arrays, spans, and provenance are retained.
Ordinary `pnpm test` exercises the golden comparison without OCaml.

Data provenance uses JSON pointer paths into the elaborated descriptor. Arbitrary
pure transformations conservatively retain all input declaration origins on each
member. Interfaces rebuild from current dependency sources; persistent caching
and minimal per-member dependency tracking remain future work.
