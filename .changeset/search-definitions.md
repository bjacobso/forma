---
"@forma-language/forma": minor
---

Add `AnalysisWorkspace.search`, which finds forms and global definitions across
preludes and documents by name, documentation (docstrings, slot docs, and the
comments above a definition or its signature), produced `:ir` type, and
inferred type. The language server answers `workspace/symbol` with it and
accepts `produces:IRType` and `type:TypeName` filters in the query.
