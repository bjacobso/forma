---
"@formalang/ts": patch
---

Keep fallback self-tail-call arity failures at the failed call, preserving diagnostics when observation is enabled, and count calls to runtime-valued macros once while retaining argument observations. Freeze public expansion origins and their author and macro context arrays so callers cannot rewrite recorded provenance through `originOf`.
