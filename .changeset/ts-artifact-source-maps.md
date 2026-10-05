---
"@formalang/ts": minor
---

Elaborated declarations now record provenance. Top-level calls to macros defined with `define-macro` in the same source are expanded before elaboration; each declaration carries an `origin` (`authored`, or `expanded` with the macro calls that produced it) and a `sourceMap` from payload JSON pointers to authored spans, including one entry per child form such as `/fields/0`. Both fields are part of `PackageableDeclaration` and pass through `packageArtifact`. Declarations also report the descriptor's `:artifact` payload contract. Ontology declarations expose `origin` and per-field and per-input spans.
