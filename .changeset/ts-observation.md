---
"@formalang/ts": minor
"@formalang/host": minor
---

Add opt-in per-expression observation. `evaluate` and `evaluateInSession` accept `observe` and return `observations`: for each author-written expression that ran, its node id and span, evaluation count, last value, and any failure raised there, also when the evaluation fails. The VM gains an `OBSERVE` instruction emitted only for observed evaluations, the expander records the author-written origin of every rebuilt node (`sourceOriginsOf`) so values computed inside macro expansions map back to the call and its arguments, and the host bounds records, collection items, depth, and string length. In a session, `retainValues: "all"` gives each observed value a `valueRef`.
