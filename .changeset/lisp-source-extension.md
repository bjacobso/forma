---
"@forma-language/forma": minor
---

**Breaking:** Use `.lisp` for Forma source files and package exports and preludes. Move the file-module libraries to `preludes/modules/`; the top-level legacy preludes remain separate. Imports and re-exports using the retired extension now report `module/retired-extension` with a suggested path edit. Update source paths and regenerate package locks after renaming files.
