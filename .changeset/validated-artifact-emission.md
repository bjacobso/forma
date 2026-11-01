---
"@formalang/ts": minor
"@formalang/host": minor
---

Validate declaration payloads and contracts before packaging artifacts.
`@formalang/ts/artifact` exports `emit`, `emitMany`, `emitBackends`,
`artifactSummary`, `validateDeclarations`, a named `ArtifactValidatorRegistry`,
and descriptor payload-contract checks. Invalid declarations return
source-located diagnostics instead of being packaged, and packages hash
sorted-key canonical payload JSON with SHA-256. `LanguageHost` gains optional
`emit`, `emitMany`, `emitBackends`, and `artifactSummary` methods taking an
`EmitRequest`.
