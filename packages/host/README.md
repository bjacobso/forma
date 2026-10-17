# @formalang/host

The host API and JSON boundary for Forma's TypeScript engine (`@formalang/ts`).

```sh
npm install @formalang/host
```

```ts
import { createDefaultLanguageHost } from "@formalang/host";

const host = createDefaultLanguageHost();
const result = host.parseSync({ sourceId: "example", source: "(+ 1 2)" });
```

The TypeScript host also implements the optional structural editor services
listed in `version().capabilities`: `identifySyntax`; `observe` on
`evaluate` and `evaluateInSession`, which returns each expression's last value,
count, and failure; `symbolIndex` and `findReferences`, which resolve names
across a session's sources, macros, and descriptor forms; and
`applyEditScript`, `describeNodes`, and `editScriptSchema` for id-addressed
structural edits; `sourceToOutline` and `outlineToSource`, the outline
codec; and `formSlots`, which reports a descriptor form's present and empty
slots with insertions for editor placeholders. Check a host's capabilities
before relying on them through `LanguageHost`.

The TypeScript host exposes session `emit`, `emitMany`, `emitBackends`, and
`artifactSummary` operations. `canonical-ir` is the implemented backend.
It validates canonical payloads, descriptor contracts, named validators and
HTTP contracts before returning an artifact; failures return diagnostics.
The TypeScript envelope is `language-ts-artifact/v1`, with modules, type
summaries and a SHA-256 declarations hash. Check `version().capabilities` when
using the optional methods through `LanguageHost`.

`analyzeEditor` accepts the `hostBuiltins` and `typePolicy` that `typecheck`
does, or takes them from a session, so calls to host builtins are typed. A top-level form that does not type
is reported and the forms around it are still typed.

`createDefaultLanguageHost` returns a `TsLanguageHost` over the included
TypeScript engine, which is Forma's only implementation.

Forma is pre-alpha. See https://forma-lang.com for documentation and demos.

The package also supplies the TypeScript `forma` executable:

```sh
forma request '{"op":"typecheck","source":"(+ 1 2)"}'
forma daemon
forma file typecheck path/to/main.forma
forma version
```

`request` handles one JSON request, given as an argument or on stdin. `file`
reads a module graph from an entry file and runs `typecheck`, `evaluate`,
`interface`, or `declarations` on it. Each command prints one JSON response.
The daemon accepts one JSON request per line, preserves sessions, and continues
serving after request errors. `@formalang/host/json-abi` exports the boundary
schemas and dispatcher. See [File modules](https://forma-lang.com/modules) for
filesystem commands, debug operations, diagnostic contracts, and load timings.
From a source checkout, build both TypeScript packages and run
`node packages/host/dist/cli.mjs`.

## Experimental MCP binding

`@formalang/host/mcp-prototype` exports `discoverMcpService`,
`compileMcpService`, and `runMcpProgram`. From a source checkout:

```sh
pnpm --filter @formalang/ts --filter @formalang/host build
pnpm --filter @formalang/host demo:mcp
```

The demo starts the official `@modelcontextprotocol/server-filesystem` over
stdio, restricted to a temporary directory containing two demo files. It
discovers `read_text_file`, generates a service prelude, checks and runs a
zero-argument Forma operation that reads both files, and prints its result and
call records as JSON. It also removes the requirement from the signature and
verifies `mechanics/undeclared-requirement` with no calls. The directory and
server are cleaned up on exit. No credentials are needed.

```ts
import { discoverMcpService, runMcpProgram } from "@formalang/host/mcp-prototype";

// An already connected MCP SDK Client; the embedding host owns its lifetime.
const binding = await discoverMcpService(client, {
  service: "Filesystem",
  tools: ["read_text_file"],
});
const result = await runMcpProgram(client, binding, {
  source: `
    (: main (Effect Filesystem_read_text_file_Output
      [Filesystem_read_text_file_Failed] [Filesystem.read_text_file]))
    (define main (Filesystem.read_text_file {:path "/allowed/example.txt"}))
  `,
  entry: "main",
  grants: ["Filesystem.read_text_file"],
  maxCalls: 1,
});
```

Discovery follows pagination and requires an explicit tool selection. Each
tool becomes a method taking one argument record, with generated input/output
aliases and one coarse tagged failure (`Service_tool_Failed`). Output schemas
describe MCP `structuredContent`; without an `outputSchema`, the result type is
`Json` and the entire MCP result envelope is returned. This follows the
[MCP tools contract](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
Tool errors, transport exceptions, and JSON validation failures use the coarse
tag and can be handled by Forma's typed `catch`.

The compiler projects strings, booleans, integers, numbers, null, homogeneous
arrays, records with required/optional fields, primitive enums/constants, and
`anyOf`/type unions. Forma's own checker also validates the generated prelude;
for example, collections of `Unit` are not supported. Names must be simple
Forma identifiers. References, `oneOf`, intersections, conditional schemas,
tuple schemas, and boolean schemas are rejected rather than silently widened.
Bounds, patterns, formats, and other JSON Schema refinements are runtime checks,
not static Forma refinements. The SDK's AJV validator checks the original
schemas before sending arguments and accepting structured results.

The whole source is elaborated before execution. The independent host `grants`
must cover the entry's exact operation requirements. The adapter installs only
those methods, even if discovery or grants include other tools. Agent source
must not control the connected client, binding, or grants. The generated
prelude is prepended internally; author diagnostic offsets and line numbers
are adjusted back to the submitted source.

This is a binding prototype over `makeMechanicsRuntime`, separate from the
existing JSON host ABI. It accepts complete source and a zero-argument entry;
it does not add accumulating session submissions, a VM bridge, `traverse`,
full language evaluation, or an instruction budget. `maxCalls` limits external
calls only. A preflight restricts execution to service/operation calls,
sequencing, typed failures/catches, simple conditionals, and literal/local
values. General value applications and other unsupported nodes are rejected
before calls, even when the checker accepts them. Call
records describe adapter calls and outcomes, not canonical runtime steps,
crash-safe journals, or deterministic replay. This API is not an untrusted-code
sandbox; those parts of the proposed agent execution loop remain future work.
