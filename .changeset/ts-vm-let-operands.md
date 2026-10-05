---
"@formalang/ts": patch
---

Fix a VM bug in which a `let` among a call's or a vector's operands left its bound value on the operand stack, shifting the other operands: `[1 (let [x 2] x) 3]` evaluated to `[2 2 3]`, and `((fn [w] w) (let [u 7] u))` failed with "Cannot call number as function".
