# Forma

Prepared pre-alpha distribution, version 0.5.0. This package has not been published.
After publication, install `@forma-language/forma` with `effect@4.1.1`.
The required Effect peer is `^4.1.1`; 4.1.1 is the tested baseline.

```js
import { parse, typecheck, evaluate, createDefaultLanguageHost } from "@forma-language/forma";
```

Use explicit subpaths for advanced operations. `/node` and `/language-server`
require Node 24 or later. `/editor` provides UI-free analysis; use
`/editor/codemirror` or `/editor/react` for UI adapters. The React adapter needs
React and React DOM 19 installed separately. CodeMirror/Lezer and LSP dependencies
are installed with the package, including for language-only consumers.
`/email` and `/elm` are experimental.

Local installations provide `pnpm exec forma help` and
`pnpm exec forma-language-server --stdio`. For global installation after
publication, install both this package and `effect@4.1.1` globally.
The library root does not start either executable.

Migrate old engine subpaths to this package, with `editor` renamed to
`editor-services`. Host exports live under `/host`; the old mixed editor root
is split into the UI adapters and UI-free `/editor`.
