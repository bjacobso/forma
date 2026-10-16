---
"@formalang/ts": minor
"@formalang/host": minor
---

Distinguish Int and Float literals, inferred types, arithmetic, VM and evaluator
values, descriptors, host projections, and Effect schemas. Integral Float results
retain their kind. Int uses checked JavaScript safe integers; Number/Num are
rejected immediately in favor of Int or Float. Tagged JSON preserves nonfinite Floats and signed zero.
