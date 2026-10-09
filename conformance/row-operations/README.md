# Type-level record operations

These authored programs exercise closed-shape `Pick`, `Omit`, and disjoint
`Merge`, plus `Tagged` discriminator collisions. Both engines run them through
`pnpm parity:engines`; TypeScript also runs them in `pnpm check`.

The single manifest is `../engine-parity/cases.json`: entries whose ids start
with `row-operations/` specify source files and goldens. A positive golden
pins the normalized type and empty diagnostics. A negative golden pins the
diagnostic code, severity, phase, source id, and exact author offsets. The
TypeScript test also checks the `expectedMessage` text. The parity runner
compares both engines with these goldens, as well as with each other.

Open operands are intentionally negative cases until row-domain constraints
are implemented; see RFC 0005. Polymorphic field types in closed shapes are
positive cases and must stay generalized across uses.
