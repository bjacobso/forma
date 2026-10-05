---
"@formalang/ts": patch
---

Let browsers import `@formalang/ts/descriptor`. The module imported `node:fs` for `bootstrapFromFiles`, so bundling it for a browser failed even when only `bootstrapFromSources` and `elaborateProgram` were used. Node's file system is now loaded only when `bootstrapFromFiles` reads a file.
