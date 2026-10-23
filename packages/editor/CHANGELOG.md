# @formalang/editor

## 0.4.0

### Minor Changes

- 4453f84: Add independent light/dark appearance and Forma, Ocean, and Orchid syntax palettes
  for CodeMirror and LispEditor. Appearance changes preserve the document and undo
  history. Export showMechanicsType to render the Effect checker's inferred types
  in live authoring tools.

### Patch Changes

- 83bbb56: Upgrade the Effect runtime and generated TypeScript target to Effect 4.0.3.
  Consumers should use the same stable version for Forma's public Effect types.
  Generated config readers use `Config.String/Int/Number/Boolean`, and HTTP
  modules import `effect/http-api` and `effect/http`.
- Updated dependencies [0b72bb2]
- Updated dependencies [48e95b6]
- Updated dependencies [cc3a74f]
- Updated dependencies [09642e5]
- Updated dependencies [73cabb2]
- Updated dependencies [bdc817d]
- Updated dependencies [923ef53]
- Updated dependencies [83bbb56]
- Updated dependencies [22c549f]
- Updated dependencies [30d7db4]
- Updated dependencies [1e93832]
- Updated dependencies [bb9ad6a]
- Updated dependencies [d950a22]
- Updated dependencies [d47da26]
- Updated dependencies [4662c76]
- Updated dependencies [e10e2b5]
- Updated dependencies [8f8e14b]
  - @formalang/host@0.4.0

## 0.3.0

### Minor Changes

- 7c1d7da: Use Effect 4.0.0-rc.112 throughout Forma's TypeScript packages. Update service keys, result handling, host callbacks, and generated Effect TypeScript and Schema modules for the Effect 4 API.

### Patch Changes

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
