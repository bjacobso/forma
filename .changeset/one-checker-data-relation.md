---
"@forma-language/forma": minor
---

Extract a shared primitive, literal, nominal brand, and covariant `Option` assignability relation (`data-relation`) used by both the Hindley-Milner and mechanics checkers, preserving directional `Int` to `Float` widening and nominal brand identity while allowing branded values to assign to their base type across both checkers. Add the `conformance/checker-parity/` contract suite pinning shared positive and negative behavior across HM, mechanics, `Engine.typecheck`, and `AnalysisWorkspace`.
