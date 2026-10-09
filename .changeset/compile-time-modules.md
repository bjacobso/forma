---
"@formalang/ts": minor
"@formalang/host": minor
---

Add RFC 0002 stage 2 compile-time modules. Files can import and export forms and
macros with private helpers kept in their defining scope, select an isolated
project prelude, and export declaration identity, schema metadata, and pure
compile-time data with provenance through portable interfaces. Core forms such
as `type`, `service`, and `do!` stay built in.
