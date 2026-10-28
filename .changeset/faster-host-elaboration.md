---
"@formalang/ts": patch
---

Speed up host-prelude elaboration. Build the kernel macro prelude once over the
default builtins instead of once per builtins object, and expand a form's
helpers once per form instead of once per projection, scope, and check.
