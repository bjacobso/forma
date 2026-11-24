---
"@forma-language/forma": patch
---

Analysis workspaces now reuse successful, closed Hindley-Milner definition components between edits. A warm edit of one definition among 500 re-infers only its component; types, diagnostics, spans and symbols match full analysis. Documents with holes, declarations, macros, descriptors or mechanics ownership still use full analysis.
