# Worker isolation example

Runs `checkedRun` inside a `node:worker_threads` Worker so a runaway program can
be stopped from outside the engine's own realm. The example layers three
defenses, in the order they fire:

1. **Cooperative budgets** inside the engine: `timeoutMs`, `steps`,
   `maxExpansionSteps`, `maxResultBytes` and `hostCalls`.
2. **A parent-side backstop**: `worker.terminate()` after `killAfterMs`.
3. **Worker resource limits** (`resourceLimits.maxOldGenerationSizeMb`) so a
   memory bomb crashes the worker, not the parent.

It does not make hostile code safe: see the threat model in
[Embedding](../../docs/embedding.md#isolating-untrusted-source).

```sh
pnpm install
pnpm test
pnpm start
```
