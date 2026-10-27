---
"@formalang/ts": minor
---

Add the isolated `@formalang/ts/effect-go` prototype generator for RFC 0019. It checks an Effect program with the existing mechanics checker and generates a Go package for the effect-go runtime prototype in `prototypes/effect-go`, which is not published. It covers schemas, brands, enums, errors, services, layers, `do!`, `catch`, `match`, pure functions, and the concurrency combinators used by four conformance programs; other constructs are reported as `effect-go/unsupported`. This is TypeScript-engine only.
