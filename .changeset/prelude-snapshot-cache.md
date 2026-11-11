---
"@formalang/ts": minor
"@formalang/host": patch
---

Persist validated prelude descriptor data and closed macro-library scopes across CLI processes. Reconstruct hooks from the current build, invalidate on source/build/runtime changes, and fall back on corrupt or unwritable caches. Expose opt-in Node SDK caching and a reproducible cold-process benchmark.
