---
"@forma-language/forma": minor
---

**Breaking:** `concat` now checks lists, not strings, in both HM and Effect
TypeScript. Replace kernel string calls with `str`. The repository audit found
two checker-only conformance uses, both migrated without changing their
expected types; no string calls occurred in preludes or examples.

Add checked `reduce` and `conj`, runtime `reverse`, `sqrt`, and `quot`, and
Effect translations for `reverse` and `sqrt`. `reduce` calls its callback with
the accumulator first; `conj` appends; `reverse` does not mutate its input;
`quot` truncates toward zero and rejects division by zero.

Add a builtin availability inventory and regression fixtures across HM,
the interpreter, VM, and strict generated TypeScript. Checked collection
contracts cover fully applied calls; unchecked runtime variadic extensions
and numeric generalization are unchanged.
