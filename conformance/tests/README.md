# Forma test runner

`assertions-test.lisp` pins the ordinary library's structural equality,
multiple assertions, and calling a builtin stored in a variable. All three
cases must pass. `packages/host/test/test-cli.test.ts` runs this fixture and
also checks failure values/locations, full-file checking, independent execution,
step exhaustion, discovery, filtering, and process exit codes using temporary
modules. Run `pnpm --filter @formalang/host test test/test-cli.test.ts` after
building the engine and host. No generated golden is used here.
