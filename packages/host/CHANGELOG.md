# @formalang/host

## 0.4.0

### Minor Changes

- 0b72bb2: Add RFC 0002 stage 2 compile-time modules. Files can import and export forms and
  macros with private helpers kept in their defining scope, select an isolated
  project prelude, and export declaration identity, schema metadata, and pure
  compile-time data with provenance through portable interfaces. Core forms such
  as `type`, `service`, and `do!` stay built in.
- 48e95b6: Validate descriptor hooks, slot references, artifact validators, and payload contracts before committing a prelude load. Expose artifact emission, summaries, backend discovery, and typed stateful REPL submission through the JSON CLI and daemon. Support inline session emission without changing stored sources.
- cc3a74f: **Breaking:** Distinguish Int and Float literals, inferred types, arithmetic, VM and evaluator
  values, descriptors, host projections, and Effect schemas. Integral Float results
  retain their kind. Int uses checked JavaScript safe integers; Number/Num are
  rejected immediately in favor of Int or Float. Tagged JSON preserves nonfinite Floats and signed zero.
- 09642e5: Type host builtins in editor analysis and keep types around a type error. `analyzeEditor` accepts the `hostBuiltins` and `typePolicy` that `typecheck` does, or takes them from `sessionId`'s session, so a call to a host builtin is typed by its `typeScheme` instead of failing as unbound. Editor analysis now reports every top-level form that does not type, and still types the other forms: a definition that fails is anything to its users, and one failing definition no longer leaves the definitions next to it untyped. Typed spans are resolved with everything inference learned, so a lambda's parameters show their types instead of type variables. `Lsp.analyzeLsp` gains `inferOptions`, `inferProgram` gains an opt-in `onFormError`, and `Engine.typeInferOptions` is exported.
- 73cabb2: Add the TypeScript forma JSON CLI and daemon, filesystem module commands, optional load timings, core debug operations, and structural form digests. Validate host type configuration and report specific inference diagnostic codes with source spans.
- bdc817d: **Breaking:** Add isolated file modules, host-owned relative resolution, explicit imports and exports, portable checked interfaces, and linked Effect TypeScript. Source loading no longer publishes bindings to other files. Re-exports preserve owning type and binding identities; generated files use real imports and exports.
- 923ef53: **Breaking:** Remove the OCaml language hosts. `NodeOcamlLanguageHost`, `JsOcamlLanguageHost`, `parseOcamlJson`, and the `./ocaml-host` and `./js-ocaml-host` entry points are gone, along with the `FORMA_OCAML_CLI` and `FORMA_OCAML_JS` settings. Use `TsLanguageHost`, `createDefaultLanguageHost`, or the `forma` JSON CLI and daemon instead.
- 83bbb56: **Breaking:** Upgrade the Effect runtime and generated TypeScript target from
  `effect@4.0.0-rc.112` to the stable `effect@4.0.3`. Consumers must install the
  same exact version for Forma's public Effect types.
  Generated config readers use `Config.String/Int/Number/Boolean`, and HTTP
  modules import `effect/http-api` and `effect/http`.
- 22c549f: Add id-addressed structural edit scripts. `@formalang/ts/editor` exports the `EditScript` Effect Schema, `decodeEditScript`, `editScriptJsonSchema` for structured model output, `describeNodes` for the context a model or preview needs, and `applyEditScript`, which applies `replace`, `insert`, `delete`, `wrap`, `splice`, `unwrap`, `raise`, `move`, scope-aware `rename`, and `extract` operations atomically, keeps the author's layout, and returns the new source with a reconciled identity, a change list, and before and after text for each affected form. `TsLanguageHost` implements the optional `applyEditScript`, `describeNodes`, and `editScriptSchema` host methods.
- 1e93832: Add slot affordances for editors. `formSlots` in `@formalang/ts/editor` finds the innermost descriptor-registered form at a position or node and reports its identifiers and slots: which are present (with their values' node ids and spans), empty, missing, or repeatable, the slot the position is in, keyword lists that name no slot, and an edit-script insertion with template text such as `(:trigger )` for each, so an editor can render placeholders such as `+ trigger`. `TsLanguageHost` implements the optional `formSlots` host method, using `define-form`s from the session's sources.
- d950a22: Add opt-in per-expression observation. `evaluate` and `evaluateInSession` accept `observe` and return `observations`: for each author-written expression that ran, its node id and span, evaluation count, last value, and any failure raised there, also when the evaluation fails. The VM gains an `OBSERVE` instruction emitted only for observed evaluations, the expander records the author-written origin of every rebuilt node (`sourceOriginsOf`) so values computed inside macro expansions map back to the call and its arguments, and the host bounds records, collection items, depth, and string length. In a session, `retainValues: "all"` gives each observed value a `valueRef`.
- d47da26: Add an outline codec for structural editors. `sourceToOutline` in `@formalang/ts/syntax` reads source as rows in the style of indentation-sensitive Lisp (SRFI 119): a row's text holds the leading elements of its list and its children hold the rest, comments are rows, multi-line literals stay whole, and broken text becomes rows with errors instead of failing. `outlineToSource` prints rows line for line, reuses the base document's layout for unchanged rows so reading and printing a source with itself as base is exact, gives every printed row's node the row's id, and can comment out rows that do not read. `TsLanguageHost` implements the optional `sourceToOutline` and `outlineToSource` host methods.
- 4662c76: Add a symbol index for editors. `indexSymbols` in `@formalang/ts/editor` returns definitions and references with node ids and spans for one or more documents. It resolves programs after macro expansion, so definitions made by macros are found and macro temporaries are not, handles `define`, `fn`, `let`, `do!`, `match`, `catch`, types, typeclasses, services, and operations, and uses descriptors (including `define-form`s in the indexed documents) for domain forms. `findReferences` returns a symbol's definition and references. `TsLanguageHost` implements the optional `symbolIndex` and `findReferences` host methods, including a session's loaded sources.
- e10e2b5: Add stable node identity for structural editors. `@formalang/ts/syntax` exports `identifySyntax`, which gives every syntax node and line comment an id, and `reconcileSyntax`, which carries ids to a new version of a document: nodes keep their ids when edits happen elsewhere, when they are retyped in place, and when they move with identical tokens. The trivia-preserving lexer now turns unterminated strings and unexpected characters into error nodes instead of throwing, so `parse` always returns a tree. `TsLanguageHost` implements the new optional `identifySyntax` host method.
- 8f8e14b: Validate source structure and module directives at load time, and commit prelude
  values and inferred types atomically. Add an optional typed `replSubmit` host
  operation that retains values, schemes, type registries, and sources only after
  successful evaluation. Session typechecks use retained schemes; loading reports
  `validate-and-store` through the version capability.
  
  Descriptor hooks and hosted helper type contracts remain pending the descriptor
  metacheck port; bootstrap continues to validate their structure.
- f5b3a0f: Validate declaration payloads and contracts before packaging artifacts.
  `@formalang/ts/artifact` exports `emit`, `emitMany`, `emitBackends`,
  `artifactSummary`, `validateDeclarations`, a named `ArtifactValidatorRegistry`,
  and descriptor payload-contract checks. Invalid declarations return
  source-located diagnostics instead of being packaged, and packages hash
  sorted-key canonical payload JSON with SHA-256. `LanguageHost` gains optional
  `emit`, `emitMany`, `emitBackends`, and `artifactSummary` methods taking an
  `EmitRequest`.

### Patch Changes

- 646c433: Check `:pattern`, `:min-length`, `:max-length`, `:min`, `:max`, and `:finite` refinements
  in form hole and IR types instead of rejecting refined fields, and generate the
  matching Effect schema filters. Add `Null`, JSON `null`, as a schema type. Generate recursive Effect schemas with
  `Schema.suspend` unless the recursion passes through a brand or a class. Hole
  types and scoped expressions accept enum aliases by member, `=` reports a
  literal outside an enum, generic `:scope` functions are instantiated per use,
  and child form diagnostics point at the child.
  Form hooks expand their programs once per descriptor rather than on every use,
  which makes re-checking a document with many forms several times faster.
  `:check` diagnostics accept `:at` to point inside a `Syntax` hole. Edit scripts
  insert record entries laid out like their siblings, and slot affordances name
  the concrete forms a category of children accepts.
- 5903e62: Share the mechanics checked-declaration result across Effect generation, canonical artifact validation, host/CLI checking, and workspace analysis. Invalid Effect bodies, undeclared typed errors, and undeclared requirements cannot become validated canonical declarations. Module checks retain lexical identities and dependency diagnostics before emission selection; validated snapshots become stale when a checked dependency changes.
  
  Route explicit Effect declarations and signed helpers through mechanics checking in language services, preserving author spans, partial document analysis, and recorded expression types for hover. Add compiler diagnostic identities to host editor errors. Kernel and descriptor checks remain in place; low-level HM inference, language-server file import resolution, and full mechanics completion parity remain separate work.
- 30d7db4: Add `elaborateProgram` to `@formalang/ts/descriptor`. It elaborates a whole DSL source against a bootstrapped prelude and returns JSON payloads shaped as packageable declarations, with spans that include end lines and columns, plus structured diagnostics for parse errors, unknown or unsupported forms, duplicate declarations, missing identifiers and required slots, and construct failures. Also adds `elaborateProgramOrThrow`, `ElaborationFailure`, `formatDiagnostic`, `declarationDiagnostic`, `sourceLocator`, `toJsonValue`, and `isJsonRuntimeStringLiteral`. Engine and host diagnostics accept the new `"elaborate"` phase.
- bb9ad6a: Analyze imported modules with caller-located types, retain partial editor types,
  and resolve definitions through named imports, namespaces, and re-exports while
  keeping private globals lexical. Imported VM closures now retain their defining
  compilation's global and builtin tables across calls.
- Updated dependencies [4735260]
- Updated dependencies [0b72bb2]
- Updated dependencies [48e95b6]
- Updated dependencies [22d2060]
- Updated dependencies [cc3a74f]
- Updated dependencies [09642e5]
- Updated dependencies [f5b3a0f]
- Updated dependencies [3a18c39]
- Updated dependencies [a117963]
- Updated dependencies [646c433]
- Updated dependencies [73cabb2]
- Updated dependencies [bdc817d]
- Updated dependencies [4453f84]
- Updated dependencies [5903e62]
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
- Updated dependencies [8f8e14b]
- Updated dependencies [f5b3a0f]
- Updated dependencies [f5b3a0f]
  - @formalang/ts@0.4.0

## 0.3.0

### Minor Changes

- 7c1d7da: Use Effect 4.0.0-rc.112 throughout Forma's TypeScript packages. Update service keys, result handling, host callbacks, and generated Effect TypeScript and Schema modules for the Effect 4 API.

### Patch Changes

- Updated dependencies [7c1d7da]
  - @formalang/ts@0.3.0

## 0.2.0

### Minor Changes

- 74a83ec: Prepare the first public Forma packages under the @formalang scope. Ship compiled
  JavaScript and declarations, the shared host API, CodeMirror and React editor
  integrations, and a standalone language server with its portable OCaml engine.

### Patch Changes

- Updated dependencies [74a83ec]
  - @formalang/ts@0.2.0
