---
"@forma-language/forma": minor
---

Mixed numeric branch joins (`if`, `cond`, and `match`) now coerce Int branch results to Float so runtime value tags agree with their inferred `Float` type without affecting integer-only paths, overflow checks, `NaN`, infinities, or signed zero. Ordinary runtime evaluation now runs exclusively on the VM, with the tree evaluator retained strictly for compile-time macro and hook evaluation.
