---
"@forma-language/forma": minor
---

**Breaking:** Align the kernel VM and compile-time tree evaluator on constructor calls, lexical builtin shadowing, malformed function/conditional/binding validation, and runtime diagnostic names and tags. Malformed kernel forms previously accepted by the VM now fail. Replace the VM's per-instruction Effect Ref updates with a shared per-run counter while preserving callback budgets, observation steps, and cooperative cancellation. The compile-time evaluator and runtime fallback remain available.
