---
"@formalang/ts": minor
"@formalang/host": minor
---

Validate source structure and module directives at load time, and commit prelude
values and inferred types atomically. Add an optional typed `replSubmit` host
operation that retains values, schemes, type registries, and sources only after
successful evaluation. Session typechecks use retained schemes; loading reports
`validate-and-store` through the version capability.

Descriptor hooks and hosted helper type contracts remain pending the descriptor
metacheck port; bootstrap continues to validate their structure.
