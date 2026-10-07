---
"@formalang/ts": patch
"@formalang/host": patch
---

Analyze imported modules with caller-located types, retain partial editor types,
and resolve definitions through named imports, namespaces, and re-exports while
keeping private globals lexical. Imported VM closures now retain their defining
compilation's global and builtin tables across calls.
