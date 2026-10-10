# @formalang/ts

## 0.4.0

### Minor Changes

- 0b72bb2: Add RFC 0002 stage 2 compile-time modules. Files can import and export forms and
  macros with private helpers kept in their defining scope, select an isolated
  project prelude, and export declaration identity, schema metadata, and pure
  compile-time data with provenance through portable interfaces. Core forms such
  as `type`, `service`, and `do!` stay built in.
- 09642e5: Type host builtins in editor analysis and keep types around a type error. `analyzeEditor` accepts the `hostBuiltins` and `typePolicy` that `typecheck` does, or takes them from `sessionId`'s session, so a call to a host builtin is typed by its `typeScheme` instead of failing as unbound. Editor analysis now reports every top-level form that does not type, and still types the other forms: a definition that fails is anything to its users, and one failing definition no longer leaves the definitions next to it untyped. Typed spans are resolved with everything inference learned, so a lambda's parameters show their types instead of type variables. `Lsp.analyzeLsp` gains `inferOptions`, `inferProgram` gains an opt-in `onFormError`, and `Engine.typeInferOptions` is exported.
- bdc817d: Add isolated file modules, host-owned relative resolution, explicit imports and exports, portable checked interfaces, and linked Effect TypeScript. Source loading no longer publishes bindings to other files. Re-exports preserve owning type and binding identities; generated files use real imports and exports.
- 4453f84: Add independent light/dark appearance and Forma, Ocean, and Orchid syntax palettes
  for CodeMirror and LispEditor. Appearance changes preserve the document and undo
  history. Export showMechanicsType to render the Effect checker's inferred types
  in live authoring tools.
- 1beb252: Add `@formalang/ts/analysis`, a workspace of preludes and documents whose language services are memoized queries: diagnostics, typed spans, hover, completion (with descriptor slots), definitions, references, rename, document symbols, semantic tokens, and formatting. Documents are typed in the scope of their preludes: prelude macros expand, prelude definitions keep their inferred types, and descriptor forms are typed. `analyzeLsp` accepts that scope (`initialEnv`, `macroEnv`, `captureEnv`), types source-local `form` declarations, and keeps typing the forms around one that does not lower. The symbol index now records macro call heads as references to their macro. `Diagnostic` and `Span` live in `@formalang/ts/diagnostic`.
  
  `indexSymbols` accepts a `cache` from `createSymbolIndexCache()`. Documents whose text is unchanged are not read again, and the expansion of an unchanged leading run of documents is reused, so re-indexing after an edit to one document no longer re-reads and re-expands its preludes.
- 30d7db4: Elaborated declarations now record provenance. Top-level calls to macros defined with `define-macro` in the same source are expanded before elaboration; each declaration carries an `origin` (`authored`, or `expanded` with the macro calls that produced it) and a `sourceMap` from payload JSON pointers to authored spans, including one entry per child form such as `/fields/0`. Both fields are part of `PackageableDeclaration` and pass through `packageArtifact`. Declarations also report the descriptor's `:artifact` payload contract. Ontology declarations expose `origin` and per-field and per-input spans.
- 30d7db4: Add `@formalang/ts/preludes`, which embeds Forma's Lisp preludes as source strings and provides `bootstrapPreludes` and `bootstrapOntologyPreludes`. Consumers no longer need to vendor prelude files or read them from disk.
- 30d7db4: Register `construct/query` and `construct/declaration` meta builtins in the TypeScript engine, matching the OCaml engine, so the bundled ontology preludes elaborate queries without patching. Runtime string literals in construct output are now marked with the Forma-owned `$forma.runtimeExpr` key, exported as `RUNTIME_STRING_LITERAL_KEY` together with an `isRuntimeStringLiteral` guard from `@formalang/ts/descriptor`.
- 22c549f: Add id-addressed structural edit scripts. `@formalang/ts/editor` exports the `EditScript` Effect Schema, `decodeEditScript`, `editScriptJsonSchema` for structured model output, `describeNodes` for the context a model or preview needs, and `applyEditScript`, which applies `replace`, `insert`, `delete`, `wrap`, `splice`, `unwrap`, `raise`, `move`, scope-aware `rename`, and `extract` operations atomically, keeps the author's layout, and returns the new source with a reconciled identity, a change list, and before and after text for each affected form. `TsLanguageHost` implements the optional `applyEditScript`, `describeNodes`, and `editScriptSchema` host methods.
- 5709d16: Make Forma an authoring language for Effect TypeScript programs. `@formalang/ts/mechanics` adds `elaborateEffectProgram` and `generateEffectProgram`, which read, project, check, and generate an Effect 4 module and report line and column diagnostics. It also adds `checkMechanicsDeclarations`, a checker over the portable mechanics IR. The checker verifies schemas, declared errors and requirements, exhaustive `match`, possible `catch`, non-failing finalizers, and layer completeness.
  
  The mechanics surface gains:
  
  - layers (`define-layer` with `:provides`/`:setup`/`:methods`, `layer-merge`, `layer-provide`, `layer-provide-merge`, `provide`);
  - Schema classes (`define-class`) and typed functions and constants (`(: f T) (define f ...)`);
  - zero-argument operations;
  - multi-clause and catch-all `catch`;
  - Effect combinators: `acquire-release`, `scoped`, `ensuring`, `all`, `for-each`, `race`, `fork`/`join`, `timeout`, `retry`, `map-error`, `option`, `result`, `config`, `decode`, `log`, and `Ref` operations;
  - streams;
  - value-level `match`;
  - a library of pure value functions;
  - `Option`, `Result`, `Ref`, `Fiber`, `Stream`, and function types.
  
  The generated module now uses Schema-backed data, `Schema.TaggedError` and `Schema.Class` classes, camelCase operation names, `undefined` for `Unit`, and Effect 4 call shapes. `generateMechanicsEffectSchemaModule` now emits Effect 4 call shapes: `Schema.Union([...])`, `Schema.Tuple([...])`, `Schema.Literals([...])`, and `Schema.optionalKey`. This changes the generated code: operation exports are camelCase (`always_fail` becomes `alwaysFail`), errors are classes, and conditions must be `Bool`.
- 30d7db4: Add `elaborateProgram` to `@formalang/ts/descriptor`. It elaborates a whole DSL source against a bootstrapped prelude and returns JSON payloads shaped as packageable declarations, with spans that include end lines and columns, plus structured diagnostics for parse errors, unknown or unsupported forms, duplicate declarations, missing identifiers and required slots, and construct failures. Also adds `elaborateProgramOrThrow`, `ElaborationFailure`, `formatDiagnostic`, `declarationDiagnostic`, `sourceLocator`, `toJsonValue`, and `isJsonRuntimeStringLiteral`. Engine and host diagnostics accept the new `"elaborate"` phase.
- 1e93832: Add slot affordances for editors. `formSlots` in `@formalang/ts/editor` finds the innermost descriptor-registered form at a position or node and reports its identifiers and slots: which are present (with their values' node ids and spans), empty, missing, or repeatable, the slot the position is in, keyword lists that name no slot, and an edit-script insertion with template text such as `(:trigger )` for each, so an editor can render placeholders such as `+ trigger`. `TsLanguageHost` implements the optional `formSlots` host method, using `define-form`s from the session's sources.
- d950a22: Add opt-in per-expression observation. `evaluate` and `evaluateInSession` accept `observe` and return `observations`: for each author-written expression that ran, its node id and span, evaluation count, last value, and any failure raised there, also when the evaluation fails. The VM gains an `OBSERVE` instruction emitted only for observed evaluations, the expander records the author-written origin of every rebuilt node (`sourceOriginsOf`) so values computed inside macro expansions map back to the call and its arguments, and the host bounds records, collection items, depth, and string length. In a session, `retainValues: "all"` gives each observed value a `valueRef`.
- 30d7db4: Add `@formalang/ts/ontology` with `elaborateOntology`, which turns the bundled ontology DSL into typed entity, relation, action, and query declarations (mirroring `preludes/ontology-ir.lisp`), parses field types, resolves entity references across sources, and reports unknown entities, unknown types, and duplicate fields at the referring declaration. `elaborateSources` elaborates several files as one program, and `toJsonValue` lowers reader nodes passed through by construct hooks, such as `(Ref Customer)` field types, to canonical runtime values instead of serializing raw syntax nodes.
- d47da26: Add an outline codec for structural editors. `sourceToOutline` in `@formalang/ts/syntax` reads source as rows in the style of indentation-sensitive Lisp (SRFI 119): a row's text holds the leading elements of its list and its children hold the rest, comments are rows, multi-line literals stay whole, and broken text becomes rows with errors instead of failing. `outlineToSource` prints rows line for line, reuses the base document's layout for unchanged rows so reading and printing a source with itself as base is exact, gives every printed row's node the row's id, and can comment out rows that do not read. `TsLanguageHost` implements the optional `sourceToOutline` and `outlineToSource` host methods.
- 33bb758: Add prelude-defined TypeScript emit hooks and a restricted typed form builder
  generator. Introduce the independent `http-api` prelude and public API for
  Effect 4 endpoints, groups, and checked handler operations, with generated
  TypeScript builders and HTTP conformance coverage.
- 1beb252: Remove the superseded `@formalang/ts/elaboration` (`DSLRegistry` handlers) and `@formalang/ts/form` (red-tree form patterns) frameworks, `createDSLTypeProviderFromRegistry`, the unused reader combinators, and the `form`-registry semantic tokens. Descriptors are the one way to define forms; semantic tokens come from `@formalang/ts/analysis`.
- 4662c76: Add a symbol index for editors. `indexSymbols` in `@formalang/ts/editor` returns definitions and references with node ids and spans for one or more documents. It resolves programs after macro expansion, so definitions made by macros are found and macro temporaries are not, handles `define`, `fn`, `let`, `do!`, `match`, `catch`, types, typeclasses, services, and operations, and uses descriptors (including `define-form`s in the indexed documents) for domain forms. `findReferences` returns a symbol's definition and references. `TsLanguageHost` implements the optional `symbolIndex` and `findReferences` host methods, including a session's loaded sources.
- e10e2b5: Add stable node identity for structural editors. `@formalang/ts/syntax` exports `identifySyntax`, which gives every syntax node and line comment an id, and `reconcileSyntax`, which carries ids to a new version of a document: nodes keep their ids when edits happen elsewhere, when they are retyped in place, and when they move with identical tokens. The trivia-preserving lexer now turns unterminated strings and unexpected characters into error nodes instead of throwing, so `parse` always returns a tree. `TsLanguageHost` implements the new optional `identifySyntax` host method.

### Patch Changes

- dd124ba: Fix structural edits that fuse adjacent tokens or retain replaced descendants,
  outline whitespace and comment row identities, shared macro-template traces,
  current type syntax and quasiquote reference indexing, and retired syntax anchors.
- 09642e5: Keep author locations inside macro calls. The expander and the evaluator gave every node of a macro's expansion the call's location, including the arguments the author wrote, so a type error or runtime failure inside `(when ready (+ 1 "x"))` was reported on the whole call and expressions inside it were typed at the call's span. Arguments now keep their own source traces. A macro that expands into another macro call is located at the call the author wrote, instead of at an offset inside the prelude that defined the inner call.
- bb9ad6a: Analyze imported modules with caller-located types, retain partial editor types,
  and resolve definitions through named imports, namespaces, and re-exports while
  keeping private globals lexical. Imported VM closures now retain their defining
  compilation's global and builtin tables across calls.
- 30d7db4: Add the `meta/query-select-fields`, `meta/validate-query-select-fields`, and `view/compile-expr-record` meta builtins to the TypeScript engine, matching the OCaml engine, so `define-query` and views with named queries construct from the bundled ontology preludes.

## 0.3.0

### Minor Changes

- 7c1d7da: Use Effect 4.0.0-rc.112 throughout Forma's TypeScript packages. Update service keys, result handling, host callbacks, and generated Effect TypeScript and Schema modules for the Effect 4 API.

## 0.2.0

### Minor Changes

- 74a83ec: Prepare the first public Forma packages under the @formalang scope. Ship compiled
  JavaScript and declarations, the shared host API, CodeMirror and React editor
  integrations, and a standalone language server with its portable OCaml engine.
