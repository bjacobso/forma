# Forma for VS Code

Syntax highlighting for Forma `.lisp` files, plus the Forma language server:
diagnostics, hover types, go to definition, references, rename, completion,
document and workspace symbols, semantic highlighting, quick fixes and formatting.

The extension is a thin client. The server ships in `@forma-language/forma`
(`forma lsp`, or its `forma-language-server` bin), so it always matches the
engine your project checks with. The extension starts it from, in order:

1. `forma.server.command`, when set, such as `["pnpm", "exec", "forma", "lsp"]`.
2. The nearest `node_modules/@forma-language/forma` at or above a workspace
   folder, run with `forma.server.node` (Node.js 22.19 or later on `PATH` by default).
3. `npx @forma-language/forma` with the server's two optional peers.

The language server needs two optional peers of `@forma-language/forma`.
Install them next to it in a project:

```sh
npm install -D @forma-language/forma vscode-languageserver@^9.0.1 vscode-languageserver-textdocument@^1.0.12
```

Set `forma.preludes` to type documents against a domain's prelude files.
Run **Forma: Restart Language Server** after changing settings.

## Build and install from source

```sh
pnpm install
pnpm --filter @forma-language/forma build
pnpm --filter forma-vscode package      # writes apps/vscode/dist/forma.vsix
code --install-extension apps/vscode/dist/forma.vsix
```

To try the server from this repository without a project install, set
`forma.server.command` to
`["node", "/path/to/forma/packages/forma/dist/cli.mjs", "lsp"]`.
