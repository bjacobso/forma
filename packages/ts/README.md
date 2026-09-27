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

## Effect 4 consumer migration

The next release uses `effect@4.0.0-rc.112` in its public Effect types and
runtime. Consumers should install that same version, remove any Effect 3 alias
used only for Forma, and import `Effect` directly from `effect`. Generated
Effect TypeScript and Schema modules now target the Effect 4 APIs, including
`Context.Service` and `Schema.annotate`.

Release this change through the repository's normal changeset/version workflow.
After publication, consumers can replace the Effect 3 based
`@formalang/ts@0.2.0` with the new version.
