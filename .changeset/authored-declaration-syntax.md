---
"@formalang/ts": minor
---

Expose `authored` and `syntax` on elaborated declarations and export the
`DeclarationSyntax` type from `/descriptor`. Consumers can inspect original
top-level expressions and named, nested and repeated hole values with exact
source spans without reparsing. Macro calls remain separate from recognized
expanded syntax. Payload source maps and artifact contracts are unchanged;
existing elaboration call signatures keep working.
