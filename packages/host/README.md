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

The default host uses the included TypeScript engine. Optional OCaml adapters
require a separately built artifact: set `FORMA_OCAML_CLI` for the native CLI,
or `FORMA_OCAML_JS` for the portable JavaScript engine.

Forma is pre-alpha. See https://forma-lang.com for documentation and demos.
