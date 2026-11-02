# Design decisions

## Distinct Int and Float values

The TypeScript engine represents Int with an unboxed JavaScript number and Float
with a tagged value containing an IEEE 754 number. The reader records the lexical
kind: a decimal point or exponent makes a Float, including `1.0` and `1e0`.
Arithmetic preserves that tag even when the result is integral. Boxing only
Floats preserves the integer VM hot path; boxing every number would allocate on
every arithmetic operation. Bigint would provide a wider integer range but add
conversion costs to mixed arithmetic and require a different JSON/Effect boundary.

Int is limited to `-9007199254740991` through `9007199254740991`. Out-of-range
literals and Int results are errors, with no wrapping or silent loss of precision.
This deliberately differs from the 63-bit wrapping Int of the retired OCaml engine.
Float supports NaN, infinities, and signed zero. Division follows IEEE 754,
including division by zero; Int `mod` requires Int operands and rejects zero.
Rounding produces Int and rejects nonfinite or out-of-range results.

`Int` and `Float` are the only numeric type names. `Number` and `Num` are
rejected immediately with guidance to choose Int or Float; this greenfield
language does not retain aliases or a warning period. Conformance goldens
never normalize numeric type names or value kinds. Numeric operations accept both types;
`+`, `-`, `*`, `min`, `max`, and `abs` return Int when every operand is Int,
otherwise Float. `/` always returns Float. `mod`, `floor`, `ceil`, and `round`
return Int. Assignment permits Int where Float is expected;
that assignment does not retag the runtime value. Mixed branches and collections
join to Float. Equality compares numeric values, so `(= 2 2.0)` is true, including
inside collections. Numeric literal patterns remain kind-sensitive:
`(match 2.0 2 true _ false)` is false. NaN does not equal itself.

Float printing retains a decimal marker (`2.0` versus `2`); string concatenation
uses the integral Float spelling `2.`, inherited from the OCaml engine. The lossless reader preserves the original token; formatting preserves its
numeric kind, including overflowing exponent literals. Tagged ABI JSON preserves Int/Float identity; plain JSON and
host/generated TypeScript project both to JS numbers, where the schema or declared
type supplies the distinction. Nonfinite Floats have explicit tagged ABI spellings
because JSON numbers cannot represent them; signed zero is encoded as `"-0"`.
Plain JSON deliberately erases numeric identity and maps nonfinite values to null.
Generated Effect code uses native numbers with the same arithmetic, rounding, and
Int range checks. It retains static types and schemas, but JS numbers at this
interop boundary cannot preserve dynamic Float identity for generic printing or
literal patterns. Portable IR tags integral Float literals so the mechanics
interpreter can preserve their identity. Nonfinite artifact literals remain
unsupported by the portable JSON artifact/codegen boundary. Effect schemas emit
`Schema.Int` for Int and
`Schema.Number` for Float.

## TypeScript is the only engine

The TypeScript/Effect engine provides embedding, browser execution, language
services, and the host's JSON CLI. Forma previously also had an OCaml engine
with native, JavaScript, and WebAssembly builds. It served as the conformance
reference while TypeScript gained its capabilities and was then removed; its
outputs remain as reviewed goldens. Maintaining one implementation keeps
semantic changes in one place at the cost of a native binary and the native
engine's faster cold start. [Retiring the OCaml engine](./engine-consolidation.md)
records the measurements and follow-ups.

## Domain vocabulary belongs in preludes

Adding consumer nouns as compiler built-ins would close the extension point and
couple the project to one use case. Forma instead exposes descriptors and meta
hooks, with source-level preludes defining domain forms.

## Effects lower to portable data

The language tracks failures and requirements statically, but target backends
do not need native algebraic-effect support. Explicit IR operations allow a
host to use promises, an effect library, a state machine, or native handlers.

## Effects are values that `do!` runs

A service call or a call to an operation produces an `Effect` value. `do!`
runs effects and binds their results, `let` and `:let` bind pure values, and an
effect body may contain several forms that run in order. Operations declare
`(Effect A [E] [R])` signatures, and the checker holds bodies to them over
closed requirement and failure sets. Combinators such as `retry`, `timeout`, and
`provide` take effects directly, and effect bodies map one-to-one onto
`Effect.gen`.

[RFC 0003](./rfcs/0003-direct-style-effects.md) proposed direct-style calls with
inferred requirements and failures, and was declined: inference would let a
requirement widen unreviewed, and direct style needs open effect rows and
effect-polymorphic functions. Forma also removed algebraic `handle` forms. For
swapping implementations, as in tests, `(provide effect (implement Service ...))`
supplies an inline layer ([RFC 0014](./rfcs/0014-local-providers.md)) rather than
a handler with continuations.

## Artifacts cross a typed boundary

Artifact envelopes, declarations, summaries, and validation are typed before
serialization. JSON construction happens at named ABI boundaries, and the
media type is `application/vnd.forma.ir+json`.

## Compatibility follows publication

The project is pre-alpha and its packages are unpublished. Internal names and
wire contracts can change together while conformance remains green. Once a
public release exists, compatibility and migration policy become explicit
release requirements.
