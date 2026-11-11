---
"@forma-language/forma": patch
---

Reuse the kernel macro prelude across host hook builtins objects. Form hook
program expansion continues to use the existing per-expression cache, including
helpers, constructors, scopes, checks, and projections.
