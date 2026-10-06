---
"@formalang/ts": patch
---

Keep author locations inside macro calls. The expander and the evaluator gave every node of a macro's expansion the call's location, including the arguments the author wrote, so a type error or runtime failure inside `(when ready (+ 1 "x"))` was reported on the whole call and expressions inside it were typed at the call's span. Arguments now keep their own source traces. A macro that expands into another macro call is located at the call the author wrote, instead of at an offset inside the prelude that defined the inner call.
