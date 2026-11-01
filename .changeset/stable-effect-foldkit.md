---
"@formalang/ts": minor
"@formalang/host": minor
"@formalang/editor": minor
---

**Breaking:** Upgrade the Effect runtime and generated TypeScript target from
`effect@4.0.0-rc.112` to the stable `effect@4.0.3`. Consumers must install the
same exact version for Forma's public Effect types.
Generated config readers use `Config.String/Int/Number/Boolean`, and HTTP
modules import `effect/http-api` and `effect/http`.
