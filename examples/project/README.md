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
`src/main.lisp` is a separate pure program evaluating `(+ 20 22)`. The script
uses the locally installed CLI through `pnpm exec` to check the form graph and
pure entry, assert the run result, and check formatting. It prints `42`. Form
libraries currently produce compile-time IR; running a graph that imports a form
definition is not supported by the pure evaluator.

From the repository root, `pnpm check:examples` runs this script against an
offline tarball installation without changing this directory.
