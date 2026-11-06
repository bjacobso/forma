# @formalang/language-server

## 0.3.0

### Minor Changes

- 97d2154: Support find references, and resolve definitions of names introduced by macros or descriptor forms, using the symbol index from `@formalang/host` across open documents and configured preludes.
- 1beb252: **Breaking:** Run the language server on the TypeScript engine instead of the bundled OCaml JavaScript artifact. The server no longer spawns a child process or ships `dist/runtime/jsoo_entry.cjs`. It adds rename, document symbols, and semantic tokens, offers slot completion inside descriptor forms, and types documents with the macros, definitions, and forms of their preludes. `FormaWorkspace` replaces `OcamlWorkspaceSession`; `OcamlAbiClient` and `createOcamlEditorAnalysisHost` are removed, and `FORMA_LANGUAGE_SERVER_ARTIFACT` is no longer read.
- 535cd41: Add `AnalysisWorkspace.search`, which finds forms and global definitions across
  preludes and documents by name, documentation (docstrings, slot docs, and the
  comments above a definition or its signature), produced `:ir` type, and
  inferred type. The language server answers `workspace/symbol` with it and
  accepts `produces:IRType` and `type:TypeName` filters in the query.

### Patch Changes

- 6d3ea9c: **Breaking:** Use Effect 4.1.1 in Forma's public types and generated TypeScript.
  Consumers should install the same Effect version. Validate the Foldkit generator
  and structural workbench with Foldkit and @foldkit/ui 0.170.0 and
  @foldkit/vite-plugin 0.29.0.
  HTTP API builders reject stream and protocol upgrade schemas in endpoint errors,
  including schemas wrapped with response headers, matching Effect 4.1's contract.
- 5903e62: Share the mechanics checked-declaration result across Effect generation, canonical artifact validation, host/CLI checking, and workspace analysis. Invalid Effect bodies, undeclared typed errors, and undeclared requirements cannot become validated canonical declarations. Module checks retain lexical identities and dependency diagnostics before emission selection; validated snapshots become stale when a checked dependency changes.
  
  Route explicit Effect declarations and signed helpers through mechanics checking in language services, preserving author spans, partial document analysis, and recorded expression types for hover. Add compiler diagnostic identities to host editor errors. Kernel and descriptor checks remain in place; low-level HM inference, language-server file import resolution, and full mechanics completion parity remain separate work.
- Updated dependencies [4735260]
- Updated dependencies [0b72bb2]
- Updated dependencies [48e95b6]
- Updated dependencies [22d2060]
- Updated dependencies [a62797e]
- Updated dependencies [cc3a74f]
- Updated dependencies [e44ffca]
- Updated dependencies [09642e5]
- Updated dependencies [6d3ea9c]
- Updated dependencies [f5b3a0f]
- Updated dependencies [1317204]
- Updated dependencies [3a18c39]
- Updated dependencies [a117963]
- Updated dependencies [61a546a]
- Updated dependencies [e44ffca]
- Updated dependencies [646c433]
- Updated dependencies [535cd41]
- Updated dependencies [73cabb2]
- Updated dependencies [61a546a]
- Updated dependencies [535cd41]
- Updated dependencies [bdc817d]
- Updated dependencies [12c3324]
- Updated dependencies [4453f84]
- Updated dependencies [41f7bcc]
- Updated dependencies [535cd41]
- Updated dependencies [535cd41]
- Updated dependencies [535cd41]
- Updated dependencies [1739e4c]
- Updated dependencies [e44ffca]
- Updated dependencies [535cd41]
- Updated dependencies [5903e62]
- Updated dependencies [e44ffca]
- Updated dependencies [83bbb56]
- Updated dependencies [1beb252]
- Updated dependencies [30d7db4]
- Updated dependencies [30d7db4]
- Updated dependencies [30d7db4]
- Updated dependencies [22c549f]
- Updated dependencies [5709d16]
- Updated dependencies [30d7db4]
- Updated dependencies [1e93832]
- Updated dependencies [dd124ba]
- Updated dependencies [09642e5]
- Updated dependencies [bb9ad6a]
- Updated dependencies [d950a22]
- Updated dependencies [30d7db4]
- Updated dependencies [d47da26]
- Updated dependencies [33bb758]
- Updated dependencies [30d7db4]
- Updated dependencies [1beb252]
- Updated dependencies [4662c76]
- Updated dependencies [e10e2b5]
- Updated dependencies [2016386]
- Updated dependencies [8f8e14b]
- Updated dependencies [f5b3a0f]
- Updated dependencies [f5b3a0f]
- Updated dependencies [535cd41]
- Updated dependencies [7d1a3ab]
  - @formalang/ts@0.4.0

## 0.2.1

### Patch Changes

- 7c1d7da: Use Effect 4.0.0-rc.112 throughout Forma's TypeScript packages. Update service keys, result handling, host callbacks, and generated Effect TypeScript and Schema modules for the Effect 4 API.
- Updated dependencies [7c1d7da]
  - @formalang/host@0.3.0

## 0.2.0

### Minor Changes

- 74a83ec: Prepare the first public Forma packages under the @formalang scope. Ship compiled
  JavaScript and declarations, the shared host API, CodeMirror and React editor
  integrations, and a standalone language server with its portable OCaml engine.

### Patch Changes

- Updated dependencies [74a83ec]
  - @formalang/host@0.2.0
