# A standalone Forma project

Use Node 24 and pnpm 10.20. After publication, run `pnpm install` here, then
`sh check.sh`. `@forma-language/forma` is not yet published. From the repository
root, build and pack it locally instead:

```sh
pnpm exec turbo run build --filter=@forma-language/forma
pnpm --dir packages/forma pack --out /tmp/forma.tgz
cd examples/project
pnpm add /tmp/forma.tgz effect@4.1.1
sh check.sh
```

`forma.json` identifies the project. `src/rules.lisp` exports a `greeting` form
with a nonempty-message check; `src/data.lisp` uses it and exports a message;
`src/main.lisp` imports that message and evaluates it. The script uses the
locally installed CLI through `pnpm exec` to check and run the form graph,
assert the run result, and check formatting. It prints `"Hello from Forma"`.
Form applications reuse their elaborated declaration descriptors at runtime;
the form's checks and projection do not run again.
The script also runs `src/main-test.lisp` with `forma test`. It imports the
embedded `forma:test` library directly, without a vendored source file.

From the repository root, `pnpm check:examples` runs this script against an
offline tarball installation without changing this directory.
