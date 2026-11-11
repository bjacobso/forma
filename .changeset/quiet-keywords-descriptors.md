---
"@forma-language/forma": patch
---

Widen literals when they constrain unresolved inference variables so keyword comparisons and polymorphic calls inside lambdas accept Keyword fields. Preserve explicit literal and enum checks. Name missing fields and suggest nearby record keys, locate numeric argument errors at their argument, and report the check function, form, and missing holes when a shared descriptor check destructures undeclared holes.
