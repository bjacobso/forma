---
"@formalang/ts": minor
"@formalang/host": minor
---

Add slot affordances for editors. `formSlots` in `@formalang/ts/editor` finds the innermost descriptor-registered form at a position or node and reports its identifiers and slots: which are present (with their values' node ids and spans), empty, missing, or repeatable, the slot the position is in, keyword lists that name no slot, and an edit-script insertion with template text such as `(:trigger )` for each, so an editor can render placeholders such as `+ trigger`. `TsLanguageHost` implements the optional `formSlots` host method, using `define-form`s from the session's sources.
