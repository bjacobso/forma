---
"@formalang/ts": patch
---

Generate Effect TypeScript from the shared operational-effect body IR, covering
typed failures, service and operation calls, sequencing, and branching.
Unsupported nodes now fail generation with an explicit error instead of
producing incomplete output.
