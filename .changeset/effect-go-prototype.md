---
"@formalang/ts": minor
---

Add the isolated `@formalang/ts/effect-go` prototype generator for RFC 0023. It checks an Effect program with the existing mechanics checker and generates a Go package for the effect-go runtime prototype in `prototypes/effect-go`, which is not published. It covers schemas, brands, enums, errors, services, layers, `do!`, `catch`, `match`, pure functions, and the concurrency combinators used by four conformance programs; other constructs are reported as `effect-go/unsupported`. `generateHttpApiGoProgram` generates the http-api prelude for Go: prelude `form`s may now declare `:emit {:ts ... :go ...}`, a function `:emit` stays the TypeScript hook, and the http-api TypeScript output is unchanged. This is TypeScript-engine only.
