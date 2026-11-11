---
"@forma-language/forma": patch
---

Reduce typechecking allocations by caching scheme free variables and sharing schemes that are unaffected by a substitution, preserving inference results.
