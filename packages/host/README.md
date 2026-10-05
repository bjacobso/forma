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

The default host uses the included TypeScript engine. Optional OCaml adapters
require a separately built artifact: set `FORMA_OCAML_CLI` for the native CLI,
or `FORMA_OCAML_JS` for the portable JavaScript engine.

Forma is pre-alpha. See https://forma-lang.com for documentation and demos.
