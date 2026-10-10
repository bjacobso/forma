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
This deliberately differs from OCaml's 63-bit native Int range and overflow.
Float supports NaN, infinities, and signed zero. Division follows IEEE 754,
including division by zero; Int `mod` requires Int operands and rejects zero.
Rounding produces Int and rejects nonfinite or out-of-range results.

`Number` and `Num` are legacy aliases for Float, preserving existing source
annotations. The frozen OCaml source checker also resolves them to its floating
type but displays that type as `Number` and rejects explicit `Float` annotations.
Its host policy instead aliases them to Int. TypeScript consistently uses Float
for these aliases in source and host schemes; callers needing Int must name Int.
Parity records these display and annotation differences explicitly, without
normalizing numeric names. `Float` is a separate type. Numeric operations accept
both types;
`+`, `-`, `*`, `min`, `max`, and `abs` return Int when every operand is Int,
otherwise Float. `/` always returns Float. `mod`, `floor`, `ceil`, and `round`
return Int. Assignment permits Int where Float is expected, as OCaml does;
that assignment does not retag the runtime value. Mixed branches and collections
join to Float. Equality compares numeric values, so `(= 2 2.0)` is true, including
inside collections. Numeric literal patterns remain kind-sensitive, following
OCaml: `(match 2.0 2 true _ false)` is false. NaN does not equal itself.

Float printing retains a decimal marker (`2.0` versus `2`); string concatenation
uses OCaml's integral Float spelling (`2.`). The lossless reader preserves the original token; formatting preserves its
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

## TypeScript is the primary engine

The TypeScript engine provides embedding and browser execution. OCaml remains
the reference during consolidation; its native, JavaScript, and WebAssembly
implementations still exist. Shared conformance suites identify matched semantics
and record explicit differences. Removing OCaml is separate migration work.

## Domain vocabulary belongs in preludes

Adding consumer nouns as compiler built-ins would close the extension point and
couple the project to one use case. Forma instead exposes descriptors and meta
hooks, with source-level preludes defining domain forms.

## Effects lower to portable data

The language tracks failures and requirements statically, but target backends
do not need native algebraic-effect support. Explicit IR operations allow a
host to use promises, an effect library, a state machine, or native handlers.

## Artifacts cross a typed boundary

Artifact envelopes, declarations, summaries, and validation are typed before
serialization. JSON construction happens at named ABI boundaries, and the
media type is `application/vnd.forma.ir+json`.

## Compatibility follows publication

The project is pre-alpha and its packages are unpublished. Internal names and
wire contracts can change together while conformance remains green. Once a
public release exists, compatibility and migration policy become explicit
release requirements.
