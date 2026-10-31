# @formalang/editor

## 0.4.0

### Minor Changes

- 4453f84: Add independent light/dark appearance and Forma, Ocean, and Orchid syntax palettes
  for CodeMirror and LispEditor. Appearance changes preserve the document and undo
  history. Export showMechanicsType to render the Effect checker's inferred types
  in live authoring tools.
- 83bbb56: **Breaking:** Upgrade the Effect runtime and generated TypeScript target from
  `effect@4.0.0-rc.112` to the stable `effect@4.0.3`. Consumers must install the
  same exact version for Forma's public Effect types.
  Generated config readers use `Config.String/Int/Number/Boolean`, and HTTP
  modules import `effect/http-api` and `effect/http`.

### Patch Changes

- f5b3a0f: **Breaking:** Replace the previous authoring grammars with one canonical syntax
  for types, declarations, patterns, Effects, and forms (RFC 0001). Older source
  must be rewritten; no compatibility layer or automated migration is provided.
  `type` replaces `define-type` and `define-schema`, with records written
  `{:field T}`, `(Union :a :b)`, `(Tagged ...)`, and `(Option T)` for optional
  fields. Types use canonical names such as `String`, `Bool`, `Unit`, `List`, and
  `(Map String V)`; lowercase aliases and the `{a b}` set literal are removed.
  `error`, `class`, `service`, `layer`, `macro`, and `form` replace their
  `define-` forms, `(Effect A)` replaces `(Effect A [] [])`, `do!` binds with
  `[x e]` and `:let` instead of `<-`, and `Some`, `None`, `Ok`, and `Err` replace
  `some`, `none`, `success`, and `failure`. Ontology declarations use `entity`,
  `seed`, `attribute`, `query`, and `workspace`. Typed `form` definitions derive
  validation, bindings, projections, artifact contracts, completion, and
  formatting. Canonical artifact payloads change shape, and tagged wire values use
  the constructor name. `bootstrapFromFiles` moves from `@formalang/ts/descriptor`
  to the Node-only `@formalang/ts/node` entry point so browser entry points do not
  import the filesystem.
- Updated dependencies [0b72bb2]
- Updated dependencies [48e95b6]
- Updated dependencies [cc3a74f]
- Updated dependencies [09642e5]
- Updated dependencies [646c433]
- Updated dependencies [73cabb2]
- Updated dependencies [bdc817d]
- Updated dependencies [923ef53]
- Updated dependencies [5903e62]
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
- Updated dependencies [f5b3a0f]
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
