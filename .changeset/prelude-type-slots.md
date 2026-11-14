---
"@forma-language/forma": patch
---

Editor analysis and the language server accept a document's own `type` and `error` declarations in the type slots of prelude forms such as `rpc` and `entity`, instead of reporting "Unknown type". The `handle` form from `forma:effect/http-api` is analyzed as that form instead of being rejected as the retired algebraic-effect `handle`.
