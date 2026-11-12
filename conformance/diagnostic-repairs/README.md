# Diagnostic repair protocol

`packages/ts/test/diagnostic-repairs.test.ts` checks these author-source fixtures:

| Fixture | Expected diagnostic |
| --- | --- |
| `unbound.lisp` | One `typecheck/unbound-symbol`, suggesting `total`, with at most five author-visible candidates and an atomic edit of `totl`. Ordinary, module, and session checks preserve the repair. |
| `arity.lisp` | One `ArityError`: `add expects 2 arguments, got 1`. The VM and compile-time interpreter name the binding. |
| `retired.lisp` | One `surface/invalid-form` requesting `define` instead of `defn`. Editor recovery retains the binding, avoiding a dependent unbound-symbol error. |

The host tests also pin repair metadata through the JSON transport and compare
`version()` against the engine's package manifest. Surface goldens intentionally
project diagnostic codes and locations rather than messages and repair advice;
the focused tests check those details directly.
