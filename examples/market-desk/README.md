# Market desk

An Effect market API expressed in Forma: schemas define the request and response,
services declare interfaces, and layers implement and wire those interfaces.

- [Forma source](../../conformance/effect-typescript/cases/market-desk/program.lisp)
- [Generated Effect TypeScript](../../conformance/effect-typescript/cases/market-desk/expected.ts)
- [HTTP contract and handlers](../../conformance/effect-typescript/cases/market-desk/http.ts)
- [Executable adapters and checks](../../conformance/effect-typescript/cases/market-desk/harness.ts)
- [Walkthrough](../../docs/effect/market-desk.md)

Run `pnpm dev` and open `/playground/demo/market-desk` for the source and generated
target, or `/playground/live/market-desk` to edit the program with live
diagnostics and generation. The workbench includes a variant that omits the model
requirement from the handler operation.

The HTTP and language-model services are domain adapters supplied by TypeScript.
The checks use deterministic implementations, with no network calls or API keys:

```sh
pnpm --filter @formalang/ts exec vitest run test/effect-typescript-conformance.test.ts -t market-desk
```
