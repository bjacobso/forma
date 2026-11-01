---
"@formalang/ts": minor
---

Record a content identity for each declaration's payload contract. Artifact
declarations gain `payloadContractId`: SHA-256 over an `:ir` type's definition
and every type it reaches (layout and record field order ignored), or over the
resolved descriptor payload constraints. Forms with different surface syntax
that produce the same IR type share an identity.
