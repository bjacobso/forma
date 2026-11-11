---
"@forma-language/forma": minor
---

**Breaking:** Reject calls with the wrong number of arguments instead of inferring implicit partial application. Arithmetic operators can be passed as binary function values with Int/Float result types, and builtin values are callable through variables and collection callbacks in both execution engines.
