---
"@formalang/ts": minor
"@formalang/ocaml": minor
---

Add closed-record type operations `Pick`, `Omit`, and disjoint `Merge` to the
HM checkers, preserving polymorphic field types and reporting located errors
for unresolved or open shapes. Reject inline `Tagged` record payloads that
declare their discriminator or have an unknown row tail.
