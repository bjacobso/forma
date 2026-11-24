---
"@forma-language/forma": patch
---

`class`, `layer`, and `catch` surface lowering in Effect programs is now handled by the bundled `forma:effect` library rather than hardcoded in the engine (RFC 0029 stage 3). Programs need no import, diagnostics preserve author spans, and generated code is unchanged.
