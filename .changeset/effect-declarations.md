---
"@forma-language/forma": patch
---

`service` and `error` declarations in Effect programs are now lowered by the bundled `forma:effect` library rather than the engine (RFC 0029 stage 2). Programs need no import, and checking, diagnostics, and generated code are unchanged.
