# Type-level record operations

These authored programs exercise closed-shape `Pick`, `Omit`, and disjoint
`Merge`, plus `Tagged` discriminator collisions. `pnpm surfaces` and
`packages/ts/test/row-operations.test.ts` run them; both are part of
`pnpm check`.

The single manifest is `../surfaces/cases.json`: entries whose ids start
with `row-operations/` specify source files and goldens. A positive golden
pins the normalized type and empty diagnostics. A negative golden pins the
diagnostic code, severity, phase, source id, and exact author offsets. The
TypeScript test also checks the `expectedMessage` text. See
[`../surfaces/README.md`](../surfaces/README.md) for how goldens are updated.

Open operands are intentionally negative cases until row-domain constraints
are implemented; see RFC 0005. Polymorphic field types in closed shapes are
positive cases and must stay generalized across uses.
