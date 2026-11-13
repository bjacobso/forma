# Forma

Pre-alpha distribution, version 0.7.0. Install `@forma-language/forma` with `effect@4.1.1`:

```sh
npm install @forma-language/forma effect@4.1.1
```
The required Effect peer is `^4.1.1`; 4.1.1 is the tested baseline.

```js
import { parse, typecheck, evaluate, createDefaultLanguageHost } from "@forma-language/forma";
```

Use explicit subpaths for advanced operations. `/node` and `/language-server`
are Node-only (22.19 or later). `/editor` provides UI-free analysis; use
`/editor/codemirror` or `/editor/react` for UI adapters. The React adapter needs
its optional peers installed separately.
`/email`, `/elm`, `/cluster` and `/effect-system` are experimental, as is
`generateEffectSystem`'s `extensions` option; expect them to change in a minor release.

Local installations provide `pnpm exec forma help` and
`pnpm exec forma-language-server --stdio`. For global installation after
publication, install both this package and `effect@4.1.1` globally.
The library root does not start either executable.

Migrate old engine subpaths to this package, with `editor` renamed to
`editor-services`. Host exports live under `/host`; the old mixed editor root
is split into the UI adapters and UI-free `/editor`.

## Optional tooling

Checking, evaluation, the ordinary CLI commands and UI-free `/editor` need only
Forma and its required Effect peer. Tooling dependencies are optional peers:

| Entry or command | Additional packages |
| --- | --- |
| `/editor` | None (UI-free analysis) |
| `/editor/codemirror` | The CodeMirror and Lezer group below |
| `/editor/react` | The CodeMirror and Lezer group, plus `react@^19.0.0` and `react-dom@^19.0.0` |
| `forma mcp` | `@modelcontextprotocol/sdk@^1.32.2` |
| `/language-server`, `forma-language-server` | `vscode-languageserver@^9.0.1` and `vscode-languageserver-textdocument@^1.0.12` |

Install only the groups you use (quote ranges when needed by your shell):

```sh
# CodeMirror / Lezer editor adapters
npm install @codemirror/autocomplete@^6.18.6 @codemirror/commands@^6.8.1 @codemirror/lang-markdown@^6.5.0 @codemirror/language@^6.11.0 @codemirror/lint@^6.8.5 @codemirror/state@^6.5.2 @codemirror/view@^6.36.8 @lezer/highlight@^1.2.1 @lezer/lr@^1.4.2
# React adapter (also install the editor group above)
npm install react@^19.0.0 react-dom@^19.0.0
# MCP server
npm install @modelcontextprotocol/sdk@^1.32.2
# Language server
npm install vscode-languageserver@^9.0.1 vscode-languageserver-textdocument@^1.0.12
```

Editor adapter and language-server subpath imports can fail immediately if their
peers are missing. The bins exit with an install command when a required tooling
peer is missing. For global bins, install the corresponding peers globally too.
