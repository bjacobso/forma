# MCP server

## Try it without installing

`https://forma-lang.com/mcp` is a hosted MCP server (Streamable HTTP) with the
[`repl`](#repl) tool. With Claude Code:

```sh
claude mcp add --transport http forma https://forma-lang.com/mcp
```

Other clients that support remote MCP servers take the same URL. Ask the model
to send `:help` to the `repl` tool. The hosted server keeps each MCP session's
REPL (definitions, session preludes and the Effect program) for a day after its
last call. It checks, infers, expands and generates Effect programs, but `:run`
is available only in a local `forma mcp`; `:help` and a session's first reply
say so. It has none of the file tools below. Calls are rate limited per client address.

## Local server

`forma mcp` serves structured language tools over stdio for MCP clients. Start it
in your project directory: paths and file imports are confined to that directory,
including symlink targets. It does not grant host capabilities to evaluated code.

Install `@forma-language/forma`, its `effect` peer dependency and the optional
`@modelcontextprotocol/sdk@^1.32.2` peer in your project so the `forma`
executable can start its MCP server (from a source checkout, use
`node /absolute/path/to/forma/packages/host/dist/cli.mjs mcp` as the server command):

```sh
npm install @forma-language/forma effect@4.1.1 @modelcontextprotocol/sdk@^1.32.2
```

## Setup

With the executable installed, Claude Code can register it with:

```sh
claude mcp add forma -- npx forma mcp
```

For an installation independent of an existing local executable, the explicit
package invocation is `npx --package @forma-language/forma --package effect --package @modelcontextprotocol/sdk@^1.32.2 forma mcp`.

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
| `describe` | `{ path }` | `{ ok, forms, functions, types, diagnostics }`: the vocabulary a file module graph provides, with typed slots, signatures, docs and checked examples |
| `describe_nodes` | `{ source }` | `{ ok, nodes, diagnostics }`; each node includes its id, text, kind and context |
| `edit` | `{ source, script }` | New `source`, identity, change preview, and diagnostics; edit errors if rejected |
| `repl` | `{ input, session? }` | A code-mode session; see [REPL](#repl). The text content is the readable result |

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

## REPL

The `repl` tool is a code-mode session: the model writes Forma, or one `:command`
per call, instead of choosing among narrow tools. Send `:help` first. Its text
content is a readable result, for clients that pass only text to the model, and
`structuredContent` has the same result as fields (`printed`, `type`,
`diagnostics`, `contracts`, `code`, `logs`).

A result longer than 8,000 characters comes in pages of whole lines. The text
ends with which lines it shows; `:more` returns the next page and `:more all`
the rest, with the full structured result. A paged structured result keeps its
short fields and lists the long ones it leaves out in `page.omitted`.

Each named `session` (default `"default"`) keeps two things until `:reset`:

- a pure Forma session: plain input is checked, then evaluated, and its
  definitions persist; `:type <expr>` checks without running and
  `:load <prelude.lisp>` loads a bundled prelude;
- an Effect program: `:effect <forms>` adds declarations (`type`, `error`,
  `service`, signatures, `define`, `layer`, `import "forma:effect"`) and replaces
  any earlier signature, definition or declaration with the same name. The whole
  program is checked; a cell with errors is reported and not kept.

### Evolving the language

`:prelude <name> <source>` defines or replaces a prelude in the session: macros,
`form` descriptors, types and functions. The session reloads its preludes in
order and replays its earlier inputs, so the new definitions apply at once. An
input that no longer checks is dropped and reported as a warning, and a prelude
that fails to load leaves the session unchanged. `:prelude` lists the session's
preludes, `:prelude <name>` shows one, `:unload <name>` removes one,
`:describe` shows the forms, functions and types they provide, and
`:describe <name>` shows one of them in full, with its examples.

Input made only of applications of the session's prelude forms is declared
rather than run: it elaborates to its IR, which the result shows, and is kept,
so later declarations can refer to it. Declaring the same name again replaces
the earlier declaration. Slot types are checked at the slot.

```text
> :prelude lang (type GreetingIR {:kind "Greeting" :name Symbol :message String})
                (form (greeting name message)
                  :types {:name (Declares Greeting) :message String}
                  :ir GreetingIR
                  {:kind "Greeting" :name name :message message})
Prelude lang added; the session was rebuilt.
> (greeting welcome "Ada")
greeting {"kind":"Greeting","name":"welcome","message":"Ada"}
> (greeting oops 3)
Not kept: the declarations have errors.
error[elaborate/hole-type]: message does not match its declared hole type
```

`:ir` (or `:export`) returns every declaration in the session as one JSON
document: the session's preludes, each form application's declaration id, form
and payload, and the Effect program's declarations without source offsets, so
two sessions' documents can be diffed.

### Effect commands

For the Effect program, `:infer <expr>` shows an expression's inferred
`(Effect A [Errors] [Requirements])`, `:run <expr>` runs it, `:ts` shows the
generated Effect TypeScript, `:expand <forms>` shows `forma:effect` macros
(`do`, `bind`, `pure`, `service`, `error`) expanded, and `:program` shows the
current declarations. `:effect` also reports each new definition's declared and
inferred type.

### Discovering the language

`:outline` lists what the session provides, by name; `:outline <module or
prelude>` maps a bundled source with a line number for each form, macro, type
and function, and `:source <module or prelude> <from>-<to>` shows those lines.
`:doc <name>` documents a prelude form (signature, arguments, option keys, IR and
its `:examples`), a macro, an Effect program keyword (`layer`, `retry`,
`provide`, ...), a builtin (`map`, `reduce`, ...), a session definition, or a
diagnostic code, and names related entries when nothing has that name.
`:modules` lists bundled modules and preludes, and `:examples [filter]` with
`:example <name>` shows the Effect TypeScript conformance programs, including
the diagnostics each rejected program expects.

### What running can touch

Pure input runs in the host's evaluator with a step limit and no host
capabilities, as with `run`. Forma has no file, network or process builtins.

`:run` generates the Effect module and runs it in a separate Node process
started with the permission model: it may read only the installed `effect`
package, cannot write files, start processes or workers, or load addons, has an
empty environment, 256 MB of heap, and is killed after 10 seconds. A program
can only reach what it declares: services are those of layers written in the
session, `Config` reads see no variables (use `:default`), `log` output is
returned in `logs`, and `sleep` waits within the time limit. On Node 25 and
later the permission model also denies network access; Node 24's does not, but
generated Forma code has no network operations. A run refuses an effect with unprovided requirements;
wrap it in `(provide expr Layer)`.

### Example REPL session

```text
> :effect (type User {:id String :name String})
          (error NotFound {:id String})
          (service Users (: find (-> String (Effect (Option User)))))
Kept. + declaration User, + declaration NotFound, + declaration Users
> :effect (import "forma:effect" [do bind pure])
          (: find-user (-> String (Effect User [] [Users.find])))
          (define find-user [id]
            (do (bind found (Users.find id))
                (match found (Some u) (pure u) None (fail (NotFound {:id id})))))
Not kept: the program has errors.
find-user
  declared (-> String (Effect User [] [Users.find]))
  inferred (Effect User [NotFound] [Users.find])
error[mechanics/undeclared-error]: Operation find-user can fail with NotFound, but its signature declares no errors.
```

After adding `NotFound` to the signature and a `UsersLive` layer,
`:run (provide (find-user "u-1") UsersLive)` returns
`{"id":"u-1","name":"Ada"}`, and an unknown id returns the typed failure
`{"_tag":"NotFound","id":"u-2"}`.
