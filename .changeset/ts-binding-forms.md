---
"@formalang/ts": patch
"@formalang/host": patch
"@formalang/language-server": patch
---

Describe core binding and expression positions in shared data. Index global
redefinitions as sites of one mutable cell, expose expanded reference metadata
for semantic edits, and add optional definitionSites to reference results.
Bound editor expansion work, cache language-server indexes in a fixed source
order, and reuse fn lowering for destructured define parameters.

The VM uses the same binding description to predeclare nested global cells,
preserving their initial builtin values until the definitions execute.
