---
"@formalang/ts": minor
---

Remove the superseded `@formalang/ts/elaboration` (`DSLRegistry` handlers) and `@formalang/ts/form` (red-tree form patterns) frameworks, `createDSLTypeProviderFromRegistry`, the unused reader combinators, and the `form`-registry semantic tokens. Descriptors are the one way to define forms; semantic tokens come from `@formalang/ts/analysis`.
