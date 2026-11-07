---
title: Smithers workflow DSL
description: Define a checked workflow language in a Forma prelude and execute it with the native Smithers runtime.
---

# Smithers workflow DSL

The [executable example](https://github.com/bjacobso/forma/tree/main/examples/smithers)
defines typed actions and workflows in an ordinary Forma prelude and lowers
their checked IR to the actual Smithers runtime. Workflow vocabulary stays in
the prelude and example adapter, outside Forma's compiler.

[Open the example in the playground](https://forma-lang.com/playground/custom?example=smithers).
The browser validates the prelude and program and displays their IR. Run the
Node example to execute it:

```sh
pnpm install --frozen-lockfile
pnpm --filter @formalang/ts build
pnpm --filter @formalang/example-smithers demo
```

The demonstration proposes a patch, runs checks concurrently, parks for an
approval, records a fixture answer, publishes, polls deployment, and calls a
child flow. Its handlers use local fixtures; it performs no model calls or
GitHub writes.

The language supports result bindings, typed payloads/results/errors, parallel
joins, branches, recovery, bounded handoffs, timers, signals, human questions,
polling, and typed integration with native flows. Its tests also run native
external jobs and queue workers. The prelude checks references, payloads,
result paths, capability grants, retry safety, and escaping typed failures.

The [example guide](https://github.com/bjacobso/forma/blob/main/examples/smithers/README.md)
lists every form, execution mapping, schema support, host requirements, and
limitations. The adapter pins Smithers `1.0.0-rc.16`; this is an evolving example,
not a compatibility promise or a complete Smithers product implementation.
The default memory engine supports local suspension and replay but loses state
when the process exits. Production persistence requires a store-backed native
runtime and the appropriate host services.
