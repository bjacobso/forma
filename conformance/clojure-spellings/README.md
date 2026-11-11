# Clojure spellings

Source fixtures for `preludes/modules/clojure.lisp`, the Clojure-spelling macro
library from [RFC 0021](../../docs/rfcs/0021-languages-as-libraries.md) stage 0.
They pin what the library does and, just as importantly, what it does not do:
it changes spelling, not semantics.

| Fixture | Pins |
| --- | --- |
| `orders.lisp` | A module written with `def`, `defn`, `defn-`, `if-let`, and `->` typechecks, infers `(-> Int (Option Int) String)` for its export, and evaluates `receipt` to `"4400 cents"` at compile time. |
| `truthiness.lisp` | An `Option` used as an `if` condition is rejected. Clojure truthiness is not lowered silently. |
| `nil-punning.lisp` | `nil` is a `Unit` value, not an absent `Int`. Absence is `Option`. |
| `keyword-access.lisp` | `(:key m)` is rejected. Forma core has no non-symbol application head; `get` is the supported spelling. RFC 0021's `:apply` interposition point would make it a surface's choice. |
| `multi-arity.lisp` | A multi-arity `defn` is rejected. The rejection is an `ArityError` with a message thrown from macro expansion, but still has no author span, which is a gap, not an intended diagnostic. |

The three rejected type-level fixtures report at the author's span, inside the
`defn` body, rather than inside the macro expansion.

`packages/ts/test/clojure-spellings.test.ts` checks every row above, and
`apps/website/src/clojurePageSnippets.ts` regenerates the `/clojure` page's
snippets from these same files, so the page cannot describe behavior the
engine does not have.

```sh
pnpm --filter @formalang/ts exec vitest run test/clojure-spellings.test.ts
```
