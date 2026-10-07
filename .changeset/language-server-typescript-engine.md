---
"@formalang/language-server": minor
---

Run the language server on the TypeScript engine instead of the bundled OCaml JavaScript artifact. The server no longer spawns a child process or ships `dist/runtime/jsoo_entry.cjs`. It adds rename, document symbols, and semantic tokens, offers slot completion inside descriptor forms, and types documents with the macros, definitions, and forms of their preludes. `FormaWorkspace` replaces `OcamlWorkspaceSession`; `OcamlAbiClient` and `createOcamlEditorAnalysisHost` are removed, and `FORMA_LANGUAGE_SERVER_ARTIFACT` is no longer read.
