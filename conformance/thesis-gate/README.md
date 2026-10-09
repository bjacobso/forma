# Descriptor typing thesis gate

The 22 sources, the `prelude.lisp` fixture, and the nine files in `goldens/`
are copied from `packages/ocaml/test/fixtures/thesis-gate/` and
`packages/ocaml/preludes/thesis-gate.lisp`. The originals remain the reference.
The domain fixtures also use the shared `preludes/ontology.lisp`.

`typescript-expectations.json` stores result types, diagnostic codes, and the
exact authored text covered by each diagnostic. The TypeScript suite runs every
source through the analysis workspace, including descriptors and macros in
preludes. Additional tests cover source-local hooks, session typing, lexical
scope, polymorphic inference, invalid hook results, and hover annotations.

Intentional differences from the OCaml diagnostic goldens:

- Repeated slot failures cover the failing value, rather than the whole slot.
- The expanded-string failure covers the authored macro argument, rather than
  the whole macro call. Spans retain the original argument location.
- Record validation covers the failing field value, rather than the entire map.
- Diagnostic prose follows the TypeScript checker. Codes and authored text are
  checked independently of prose.
- Editor recovery retains types for successfully inferred forms and can retain
  a descriptor result type alongside collected slot or validation diagnostics.

`type/vector` uses the TypeScript engine's existing List representation for
vector literals. This port does not change collection or numeric semantics.
Unlike OCaml's record type builder, TypeScript rejects malformed field specs
instead of silently dropping them.

These fixtures demonstrate the descriptor slice; they do not establish parity
for every engine operation. `conformance/engine-parity/matrix.json` records the
remaining intentional differences.
