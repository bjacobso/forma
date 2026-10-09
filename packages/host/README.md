# @formalang/host

The shared host API for Forma's TypeScript and OCaml engines.

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
slots with insertions for editor placeholders. Check a host's capabilities before relying on them; the
OCaml adapters do not implement them yet and ignore `observe`.

The TypeScript host exposes session `emit`, `emitMany`, `emitBackends`, and
`artifactSummary` operations. `canonical-ir` is the implemented backend.
It validates canonical payloads, descriptor contracts, named validators and
HTTP contracts before returning an artifact; failures return diagnostics.
The TypeScript envelope is `language-ts-artifact/v1`, with modules, type
summaries and a SHA-256 declarations hash. It intentionally differs from
OCaml's envelope and MD5 hash. Check `version().capabilities` when using the
optional methods through `LanguageHost`.

`analyzeEditor` accepts the `hostBuiltins` and `typePolicy` that `typecheck`
does, or takes them from a session, so calls to host builtins are typed. A top-level form that does not type
is reported and the forms around it are still typed.

The default host uses the included TypeScript engine. Optional OCaml adapters
require a separately built artifact: set `FORMA_OCAML_CLI` for the native CLI,
or `FORMA_OCAML_JS` for the portable JavaScript engine.

Forma is pre-alpha. See https://forma-lang.com for documentation and demos.

The repository's [inline code-mode experiment](examples/inline-code-mode/README.md)
uses this ABI for executable chat fences, checked mock bindings and continuation
transcripts. It is a development example, not an exported package API.
