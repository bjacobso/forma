---
"@formalang/ts": minor
---

Make every edit-script operation produce exactly the tree it intends. Text is joined so that a comment never runs into code and atoms never fuse, and the result is reparsed and compared with the intended tree before it is accepted. Operations that would break the grammar are refused with a named rule: `edit/reader-macro-operand`, the new `edit/brace-kind` (a map would become a set or back), and the new `edit/map-entry`. Ids come from the intended tree: a replacement's contents get fresh ids, and an id an operation removed cannot be reached by a later one. A wrap head may now end in a comment, and splicing an empty list no longer deletes the comment after it.
