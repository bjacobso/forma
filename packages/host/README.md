# @formalang/host

The host API and JSON boundary for Forma's TypeScript engine (`@formalang/ts`).

```sh
npm install @formalang/host effect@^4.1.1
```

Effect `^4.1.1` is a peer dependency shared with the application's other Forma
libraries.

```ts
import { createDefaultLanguageHost } from "@formalang/host";

const host = createDefaultLanguageHost();
const result = host.parseSync({ sourceId: "example", source: "(+ 1 2)" });
```

The TypeScript host also implements the optional structural editor services
listed in `version().capabilities`: `identifySyntax`; `observe` (or the
`observe` option on `evaluate` and `evaluateInSession`), which returns each expression's last value,
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
forma file typecheck path/to/main.lisp
forma version
```

`request` handles one JSON request, given as an argument or on stdin. `file`
reads a module graph from an entry file and runs `typecheck`, `evaluate`,
`interface`, or `declarations` on it. `file evaluate` typechecks first unless
given `--unchecked`. Each command prints one JSON response; file commands exit
1 when it is not `ok`. `forma help` lists the commands.
The daemon accepts one JSON request per line, preserves sessions, and continues
serving after request errors. `@formalang/host/json-abi` exports the boundary
schemas and dispatcher. See [File modules](https://forma-lang.com/modules) for
filesystem commands, debug operations, diagnostic contracts, and load timings.
From a source checkout, build both TypeScript packages and run
`node packages/host/dist/cli.mjs`.

The programmatic host and JSON boundary share an operation registry. Every name
in `version().capabilities` accepts a JSON request, including `analyzeEditor`,
the structural editor operations above, and the debug aliases `parseAst`,
`parseSummary`, `incrementalSummary`, `lowerCore`, `typecheckCore`, and
`typecheckCoreTyped`. Editor requests use the programmatic methods' field names;
identities, outlines, and edit scripts are plain JSON. `applyEditScript` returns
the edited source and identity in `value`; edit failures set the envelope's `ok`
to false and include diagnostics. Use `typecheck` to check the edited source's
types. An edit does not store or evaluate the new source.

All requests accept an optional SemVer `abiVersion`. The current contract is
`0.2.0` (`HOST_ABI_VERSION`); a different major returns `abi/version-mismatch`.
Omitting the field preserves existing clients. Minor and patch differences are
accepted, including valid prerelease and build suffixes. Unknown request fields
are rejected, including in nested identities and outline rows. Edit scripts
are passed through to the edit-script validator so malformed model output gets
edit diagnostics; `editScriptSchema` returns their JSON Schema.

```ts
import { HOST_ABI_VERSION, hostAbiSchema } from "@formalang/host";
import { JsonAbi } from "@formalang/host/json-abi";

const abi = new JsonAbi();
const schema = hostAbiSchema(); // requests, responses keyed by op, session scopes
const result = await abi.handleJson(JSON.stringify({
  op: "editScriptSchema", abiVersion: HOST_ABI_VERSION,
}));
```

`hostAbiSchema()` uses Effect's JSON Schema generator. It describes every request
and response envelope, with explicit structural editor payloads; engine debug
payloads remain open. The reviewed snapshot is `conformance/host-abi/schema.json`.
Run `FORMA_UPDATE_GOLDEN=1 pnpm --filter @formalang/host test test/host-contract.test.ts`
to update it, then review the diff.
