---
"@forma-language/forma": patch
---

Macros defined in a session prelude now expand when the session evaluates, expands, or takes a REPL submission, as they already did when it typechecked. `forma repl --prelude` can use prelude macros.
