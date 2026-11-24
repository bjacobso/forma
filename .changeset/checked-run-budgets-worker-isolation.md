---
"@forma-language/forma": minor
---

`checkedRun` now enforces resource budgets (RFC 0012 stage 3). `limits.timeoutMs` (default 5,000 ms), `limits.maxExpansionSteps` (default 10,000), `limits.maxResultBytes` (default 1 MiB) and `limits.hostCalls` (default 1,000) join `limits.steps`, failing with the coded diagnostics `limit/time`, `limit/expansion`, `limit/result-size` and `limit/host-calls`. The VM loop checks the deadline and `abortEvaluation` itself, so a pure infinite loop stops with `limit/time` or `evaluation/aborted` instead of only at host calls; time spent paused on a host call does not count. `checkedRun` accepts an `evaluationId` so a caller can abort a run that has not paused, and `evaluateInSession`/`replSubmit` accept the same `timeoutMs`, `maxExpansionSteps` and `maxResultBytes`. The embedding guide documents a tested `node:worker_threads` isolation recipe, a Cloudflare Worker recipe, and the in-process threat model.
