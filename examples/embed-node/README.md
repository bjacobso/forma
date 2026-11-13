# Embed Forma in Node

Use Node 22.19 or later. Run `npm install` here, then `npm start` and
`npm test`.
To try unreleased changes, build and pack the package from the repository root
instead:

```sh
pnpm exec turbo run build --filter=@forma-language/forma
pnpm --dir packages/forma pack --out /tmp/forma.tgz
cd examples/embed-node
npm install /tmp/forma.tgz effect@4.1.1
npm start
npm test
```

`index.mjs` loads `prelude.lisp` and grants only `notify`. Checking a call does
not execute the handler; running checks first, then calls it. The prelude defines
`greeting`, whose `:check` rejects an empty message during elaboration. The tests
exercise valid and invalid form emission and an ungranted capability. Always
close the language when finished. The facade is experimental.

From the repository root, `pnpm check:examples` runs this example against an
offline tarball installation without changing this directory.
