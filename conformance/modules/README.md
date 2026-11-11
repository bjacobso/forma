# Module contracts

These source fixtures exercise exported identities, brands, tagged constructors,
polymorphic portable schemes, and linked Effect modules. The host suite in
`packages/host/test/modules.test.ts` checks TypeScript against the stored
outputs in `interfaces-and-linked-modules.json` and `portable-schemes.json`.
Both files were captured from the retired native OCaml engine and are now
reviewed expectations. Object keys are sorted; arrays, schemes, source spans,
and provenance are retained.

After building `@formalang/ts`:

```sh
pnpm --filter @formalang/host exec vitest run test/modules.test.ts
```

Ordinary `pnpm test` runs the comparisons. Behavioral assertions for private
scopes, imports, diagnostics, and evaluation also run. To change an
expectation, rewrite the files from TypeScript output and review the JSON diff:

```sh
FORMA_UPDATE_GOLDEN=1 pnpm --filter @formalang/host exec vitest run test/modules.test.ts test/compile-time-modules.test.ts
```

`run-forms/` pins successful checking and runtime values for a form library,
a module that declares a greeting and ordinary values, and an importing entry.
`expected.json` is asserted by `packages/ts/test/check-run-modules.test.ts`;
it also verifies descriptor identity and that runtime evaluation does not rerun
form hooks. `unnamed.lisp` pins projected IR values, and `multiple-names.lisp`
checks that every `Declares` hole introduces a runtime binding.
