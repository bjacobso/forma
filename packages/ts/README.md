# `@formalang/ts`

The TypeScript implementation of Forma. It provides the lossless reader,
formatter, macro expander, evaluator, bytecode VM, Hindley–Milner inference,
editor analysis, elaboration protocols, and artifact generation.

```ts
import { Evaluator, Reader, Type } from "@formalang/ts";
import { parseManyToSExpr } from "@formalang/ts/reader";
import { inferSourceStr } from "@formalang/ts/type";
```

The package is runtime-neutral. Domain forms and target-specific behavior are
registered by consumers through descriptors, preludes, and host services.

```sh
pnpm --filter @formalang/ts build
pnpm --filter @formalang/ts test
pnpm --filter @formalang/ts typecheck
```
