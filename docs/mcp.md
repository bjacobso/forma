# MCP server

`forma mcp` serves structured language tools over stdio for MCP clients. Start it
in your project directory: paths and file imports are confined to that directory,
including symlink targets. It does not grant host capabilities to evaluated code.

The public package `@forma-language/forma` is not yet published. Until publication,
build from source and use `node /absolute/path/to/forma/packages/host/dist/cli.mjs mcp`
as the server command. Once published, install `@forma-language/forma` and its
`effect` peer dependency in your project so the `forma` executable is available.

## Setup

With the executable installed, Claude Code can register it with:

```sh
claude mcp add forma -- npx forma mcp
```

For an installation independent of an existing local executable, the explicit
package invocation is `npx --package @forma-language/forma --package effect forma mcp`
after publication.

For Codex, add this to `~/.codex/config.toml` (replace the working directory):

```toml
[mcp_servers.forma]
command = "npx"
args = ["forma", "mcp"]
cwd = "/absolute/path/to/project"
```

For a source checkout, use `command = "node"` and
`args = ["/absolute/path/to/forma/packages/host/dist/cli.mjs", "mcp"]` instead.
The server writes only MCP protocol messages to stdout.

## Tools

Every tool supplies a JSON input schema and returns `structuredContent` plus a
short text summary. Failures set `isError` and return `ok: false` with diagnostics.
Diagnostics retain engine spans (including line and column), help, and fixes.

| Tool | Input | Structured result |
| --- | --- | --- |
| `check` | Exactly one of `{ path }` or `{ source, sourceId? }` | `{ ok, type?, diagnostics }` |
| `run` | Exactly one of `{ path }` or `{ source }`, optional `stepLimit` | `{ ok, value, printed, type, diagnostics }` |
| `format` | Exactly one of `{ path }` or `{ source }`, optional `write` | `{ ok, source, diagnostics }` |
| `explain` | `{ code }` | Catalog `code`, `summary`, `explanation`, and `ok` |
| `describe_nodes` | `{ source }` | `{ ok, nodes, diagnostics }`; each node includes its id, text, kind and context |
| `edit` | `{ source, script }` | New `source`, identity, change preview, and diagnostics; edit errors if rejected |

`run` checks first and refuses programs with errors. `value` is the host's JSON
value projection; `printed` is its readable representation. `stepLimit` must be a
positive integer. File requests load relative modules and verified offline package
imports using the CLI's module session support; project discovery stops at cwd.
Local package dependencies must also remain inside cwd.

`format` returns text without changing files by default. Writing requires both
`path` and `write: true`; the path must already exist. `edit` always returns text
without writing. Its input schema includes the complete host edit-script schema.
Node ids refer to the exact source passed to `describe_nodes`; describe the updated
source again before preparing the next script.

## Example session

1. Call `check` with `{ "source": "(define total 1)\n(+ total 2)" }`.
   The result has `ok: true`, type `Int`, and no diagnostics.
2. Call `describe_nodes` with the same source. Find the symbol node whose text is
   `total` and copy its id.
3. Call `edit` with that source and this script, replacing `NODE_ID`:

   ```json
   { "version": 1, "ops": [{ "op": "rename", "target": "NODE_ID", "to": "subtotal" }] }
   ```

   The returned source is `(define subtotal 1)\n(+ subtotal 2)` with no diagnostics.
4. Call `run` with the returned source. The result has `printed: "3"`.
5. If a check fails, pass a diagnostic's `code` to `explain`, or apply its
   source-span fix and check the updated source again.
