---
"@forma-language/forma": minor
---

Move CodeMirror/Lezer, the MCP SDK and the language-server libraries to optional peers so checking and runtime installs need only Forma and Effect. For `/editor/codemirror`, install the declared `@codemirror/*`, `@lezer/highlight` and `@lezer/lr` peers; `/editor/react` also needs React and React DOM 19. For `forma mcp`, install `@modelcontextprotocol/sdk@1.32.2`. For `/language-server` and `forma-language-server`, install `vscode-languageserver@^9.0.1` and `vscode-languageserver-textdocument@^1.0.12`. UI-free `/editor` needs no additional peers. Missing-tool bins now print the required install command.
