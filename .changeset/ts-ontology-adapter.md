---
"@formalang/ts": minor
---

Add `@formalang/ts/ontology` with `elaborateOntology`, which turns the bundled ontology DSL into typed entity, relation, action, and query declarations (mirroring `preludes/ontology-ir.lisp`), parses field types, resolves entity references across sources, and reports unknown entities, unknown types, and duplicate fields at the referring declaration. `elaborateSources` elaborates several files as one program, and `toJsonValue` lowers reader nodes passed through by construct hooks, such as `(Ref Customer)` field types, to canonical runtime values instead of serializing raw syntax nodes.
