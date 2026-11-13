---
"@forma-language/forma": minor
---

Select bundled Effect RPC, HTTP API, and Cluster libraries with lexical Forma imports. Check and generate multi-file Effect programs with real TypeScript imports between generated modules, and preserve author error tags across module boundaries. Deprecate the RPC generator's `schemasFrom` option in favor of file-module imports.

The experimental `/modules` linker exposes `linkEffectModules` and `moduleOutputName`, preserves readable `.lisp` → `.ts` output paths, and accepts a host `outputPath` override. Generated Effect library modules use author names and readable import aliases for collisions.
