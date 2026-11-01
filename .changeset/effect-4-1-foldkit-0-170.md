---
"@formalang/ts": minor
"@formalang/host": minor
"@formalang/editor": minor
"@formalang/language-server": patch
---

**Breaking:** Use Effect 4.1.1 in Forma's public types and generated TypeScript.
Consumers should install the same Effect version. Validate the Foldkit generator
and structural workbench with Foldkit and @foldkit/ui 0.170.0 and
@foldkit/vite-plugin 0.29.0.
HTTP API builders reject stream and protocol upgrade schemas in endpoint errors,
including schemas wrapped with response headers, matching Effect 4.1's contract.
