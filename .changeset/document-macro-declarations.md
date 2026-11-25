---
"@forma-language/forma": patch
---

The checker types declarations that a document's own macros produce, such as ``(macro (quick-research n) `(research ~n :title "x" :cost 1))``. It used to match the declaration's form against the unexpanded macro call and fail with an error such as `Missing required option :title`. A problem in what the macro wrote, such as a missing option or a wrong value in its template, is reported at the macro call; a value the author passed is still reported where they wrote it.
