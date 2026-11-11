---
"@forma-language/forma": minor
---

Let a file module's `form` produce an `:ir` type that another module exports.
Discovery, compile-time elaboration, and type checking see the imported type
and the definitions it reaches, and payloads are checked against them.
Declaration data in module interfaces gains `contractId`, a SHA-256 identity of
the `:ir` type closure, shared by declarations from different forms that produce
the same type.
