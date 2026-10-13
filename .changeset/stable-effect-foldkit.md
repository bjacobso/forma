---
"@formalang/ts": patch
"@formalang/host": patch
"@formalang/editor": patch
---

Upgrade the Effect runtime and generated TypeScript target to Effect 4.0.3.
Consumers should use the same stable version for Forma's public Effect types.
Generated config readers use `Config.String/Int/Number/Boolean`, and HTTP
modules import `effect/http-api` and `effect/http`.
