---
"@forma-language/forma": patch
---

Preserve the declared union type of qualified tagged constructors through
standalone Effect normalization, local bindings, vectors, conditionals, and
collection joins. Optional record fields now accept compatible existing
Options as well as plain values. Generated TypeScript evaluates each Option
once and omits absent keys under exactOptionalPropertyTypes.

Add strict generated-TypeScript and runtime conformance cases for RFC 0019
E1–E3, located rejection controls, and checks for the updated domain-modeling
guide examples. Named Effect callbacks and literal refinements remain separate
follow-up work.
