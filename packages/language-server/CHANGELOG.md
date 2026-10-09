# @formalang/language-server

## 0.3.0

### Minor Changes

- 97d2154: Support find references, and resolve definitions the OCaml engine cannot (names introduced by macros or descriptor forms), using the symbol index from `@formalang/host` across open documents and configured preludes.
- 1beb252: Run the language server on the TypeScript engine instead of the bundled OCaml JavaScript artifact. The server no longer spawns a child process or ships `dist/runtime/jsoo_entry.cjs`. It adds rename, document symbols, and semantic tokens, offers slot completion inside descriptor forms, and types documents with the macros, definitions, and forms of their preludes. `FormaWorkspace` replaces `OcamlWorkspaceSession`; `OcamlAbiClient` and `createOcamlEditorAnalysisHost` are removed, and `FORMA_LANGUAGE_SERVER_ARTIFACT` is no longer read.

### Patch Changes

- Updated dependencies [0b72bb2]
- Updated dependencies [09642e5]
- Updated dependencies [bdc817d]
- Updated dependencies [4453f84]
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
