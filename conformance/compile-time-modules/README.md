# Compile-time modules

This file-based RFC 0002 stage 2 slice runs against the TypeScript host in
`packages/host/test/compile-time-modules.test.ts`.

- `stripe.lisp` exports `price` and its public declaration/payload types. Its
  label helper stays private and executes in its defining scope.
- `billing.lisp` imports the form, declares two prices, and exports their
  immutable descriptors as a pure `prices` collection.
- `salesforce.lisp` exports forms that derive picklists and check price references.
- `main.lisp` imports the collection and forms to export a picklist and selection.
- `broken.lisp` pins an unresolved namespace reference at its authored token.

`interfaces.json` stores the complete portable interfaces. It was captured from
the retired native OCaml engine and is now a reviewed expectation. The host
suite compares TypeScript against it, including data, contracts, schemas,
metadata, and provenance. The suite also checks private helpers, macro hygiene,
macro-introduced declarations, project preludes, re-exports, source edits,
schema inspection, and deferred platform syntax. No host-bootstrap prelude stack
is needed. The platform names are a local illustrative example, not a claim to
implement an external Stripe/Salesforce design document.

After building `@formalang/ts`:

```sh
pnpm --filter @formalang/host exec vitest run test/compile-time-modules.test.ts
```

Object keys are sorted; contracts, schemes, arrays, spans, and provenance are
retained. Ordinary `pnpm test` runs the comparison. To change the expectation,
rewrite it from TypeScript output and review the JSON diff:

```sh
FORMA_UPDATE_GOLDEN=1 pnpm --filter @formalang/host exec vitest run test/modules.test.ts test/compile-time-modules.test.ts
```

Data provenance uses JSON pointer paths into the elaborated descriptor. Arbitrary
pure transformations conservatively retain all input declaration origins on each
member. Interfaces rebuild from current dependency sources; persistent caching
and minimal per-member dependency tracking remain future work.
