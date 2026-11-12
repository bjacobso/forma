---
"@forma-language/forma": minor
---

**Breaking:** Replace the public document analysis `typeEnv` and `mechanicsBindingTypes` fields with read-only `bindingDisplay(name, offset?)` and `hasBinding(name)` queries. Editor services now obtain mechanics, HM, and builtin binding displays through one analysis adapter; inference and module schemes retain their internal environments.
