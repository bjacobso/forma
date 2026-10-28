---
"@formalang/ts": minor
"@formalang/host": patch
"@formalang/language-server": patch
---

Share the mechanics checked-declaration result across Effect generation, canonical artifact validation, host/CLI checking, and workspace analysis. Invalid Effect bodies, undeclared typed errors, and undeclared requirements cannot become validated canonical declarations. Module checks retain lexical identities and dependency diagnostics before emission selection; validated snapshots become stale when a checked dependency changes.

Route explicit Effect declarations and signed helpers through mechanics checking in language services, preserving author spans, partial document analysis, and recorded expression types for hover. Add compiler diagnostic identities to host editor errors. Kernel and descriptor checks remain in place; low-level HM inference, language-server file import resolution, and full mechanics completion parity remain separate work.
