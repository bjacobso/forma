---
"@forma-language/forma": patch
---

Editor analysis and the language server accept a document's own `type` and `error` declarations in the type slots of prelude forms such as `rpc` and `entity`, instead of reporting "Unknown type".
