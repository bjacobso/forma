# @formalang/ts

## 0.4.0

### Minor Changes

- 4735260: Add closed-record type operations `Pick`, `Omit`, and disjoint `Merge` to the
  HM checkers, preserving polymorphic field types and reporting located errors
  for unresolved or open shapes. Reject inline `Tagged` record payloads that
  declare their discriminator or have an unknown row tail.
- 0b72bb2: Add RFC 0002 stage 2 compile-time modules. Files can import and export forms and
  macros with private helpers kept in their defining scope, select an isolated
  project prelude, and export declaration identity, schema metadata, and pure
  compile-time data with provenance through portable interfaces. Core forms such
  as `type`, `service`, and `do!` stay built in.
- 48e95b6: Validate descriptor hooks, slot references, artifact validators, and payload contracts before committing a prelude load. Expose artifact emission, summaries, backend discovery, and typed stateful REPL submission through the JSON CLI and daemon. Support inline session emission without changing stored sources.
- 22d2060: Run descriptor infer, check, bindings, and result-type hooks in the active
  Hindley–Milner context, including source-local hooks and prelude hooks in editor
  analysis. Add their meta helper vocabulary and preserve diagnostic codes and
  authored expression spans. Export the plain `checkDescriptors` stage for
  descriptor definition and application validation, with a callback for artifact
  contract checks. Host prelude-loading integration remains separate.
- a62797e: Make expansion and identity reproducible. `gensym` numbers names per expansion
  pass and per top-level evaluation instead of from a process-wide counter, so
  the same program expands to the same names regardless of earlier work.
  `GensymScope` and `withGensymScope` are exported from `Evaluator`. Source hashes
  and the session prelude fingerprint are now SHA-256 (previously 32-bit FNV-1a),
  and the fingerprint no longer depends on locale or separator characters in
  source ids. Source hashes are computed on first use.
  
  The TypeScript host keeps keyword, symbol, and string map-key kinds when it
  projects values, including bounded observations, and when it decodes host-call
  results and arguments. A function or opaque projection whose `valueRef` is
  retained in the session decodes to the retained value instead of its display
  text.
- cc3a74f: **Breaking:** Distinguish Int and Float literals, inferred types, arithmetic, VM and evaluator
  values, descriptors, host projections, and Effect schemas. Integral Float results
  retain their kind. Int uses checked JavaScript safe integers; Number/Num are
  rejected immediately in favor of Int or Float. Tagged JSON preserves nonfinite Floats and signed zero.
- 09642e5: Type host builtins in editor analysis and keep types around a type error. `analyzeEditor` accepts the `hostBuiltins` and `typePolicy` that `typecheck` does, or takes them from `sessionId`'s session, so a call to a host builtin is typed by its `typeScheme` instead of failing as unbound. Editor analysis now reports every top-level form that does not type, and still types the other forms: a definition that fails is anything to its users, and one failing definition no longer leaves the definitions next to it untyped. Typed spans are resolved with everything inference learned, so a lambda's parameters show their types instead of type variables. `Lsp.analyzeLsp` gains `inferOptions`, `inferProgram` gains an opt-in `onFormError`, and `Engine.typeInferOptions` is exported.
- 6d3ea9c: **Breaking:** Use Effect 4.1.1 in Forma's public types and generated TypeScript.
  Consumers should install the same Effect version. Validate the Foldkit generator
  and structural workbench with Foldkit and @foldkit/ui 0.170.0 and
  @foldkit/vite-plugin 0.29.0.
  HTTP API builders reject stream and protocol upgrade schemas in endpoint errors,
  including schemas wrapped with response headers, matching Effect 4.1's contract.
- 3a18c39: Add the isolated `@formalang/ts/elm` prototype generator and bundled Elm-style app prelude. Generate Foldkit / Effect TypeScript with exhaustive message updates, typed command recovery, checked payloads, and pure views. Experimental: its API and prelude may change in any minor release.
- a117963: Add the isolated `@formalang/ts/email` prototype generator and bundled email rule prelude. A `rule` declares sending lanes and first-match `send`, `defer`, and `skip` decisions over a prelude-defined contact; the linker checks it through the Effect checker and generates Effect TypeScript. Experimental: its API and prelude may change in any minor release.
- e44ffca: Allow forms to carry literal, domain-neutral `:extensions` metadata with located validation errors. Migrate bundled UI and ViewSpec forms to local metadata and the `named-map` projection macro, preserving their existing metadata and IR. Keep the older `:descriptor-name` attachment convention as a deprecated compatibility path.
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
- 73cabb2: Add the TypeScript forma JSON CLI and daemon, filesystem module commands, optional load timings, core debug operations, and structural form digests. Validate host type configuration and report specific inference diagnostic codes with source spans.
- 61a546a: Help host preludes report precise diagnostics. A `:check` diagnostic may carry
  `:at`, a path into the form's authored syntax, and is reported at that node.
  Preserve existing Syntax-value locations and child diagnostic codes and spans.
  Add the `declarations-of` and
  `type-definition` reflection builtins, and let an optional positional `String`
  hole (a docstring) be omitted before other positional arguments. Cover the
  existing quantification of `:scope` signatures with host-prelude regressions.
- 535cd41: Let a file module's `form` produce an `:ir` type that another module exports.
  Discovery, compile-time elaboration, and type checking see the imported type
  and the definitions it reaches, and payloads are checked against them.
  Declaration data in module interfaces gains `contractId`, a SHA-256 identity of
  the `:ir` type closure, shared by declarations from different forms that produce
  the same type.
- bdc817d: **Breaking:** Add isolated file modules, host-owned relative resolution, explicit imports and exports, portable checked interfaces, and linked Effect TypeScript. Source loading no longer publishes bindings to other files. Re-exports preserve owning type and binding identities; generated files use real imports and exports.
- 12c3324: Let libraries claim retired spellings (RFC 0021, stage 0). `def`, `defn`,
  `defmacro`, `lambda`, and `let*` are now rejected after macro expansion
  instead of before it, so a macro in scope may use one of those names. An
  unclaimed use still reports `Use define instead of defn` (or the matching
  replacement) at the author's form, and the file-module typechecker now keeps
  that diagnostic's `surface/invalid-form` code and inner span instead of
  reporting a type mismatch at the top-level form. Macros gain `sexpr-vector?`.
- 4453f84: Add independent light/dark appearance and Forma, Ocean, and Orchid syntax palettes
  for CodeMirror and LispEditor. Appearance changes preserve the document and undo
  history. Export showMechanicsType to render the Effect checker's inferred types
  in live authoring tools.
- 535cd41: Add `forma add <name> <spec>`, `forma update [name]`, offline `forma verify`,
  and `forma vendor` to restore exact locked commits. Fetch arbitrary git servers
  through git and known forges through commit-pinned archives with git fallback.
  Select transitive semver tags using highest-minimum selection, reject conflicting
  refs or source locations, and stage complete results before updating project
  files. `@formalang/ts/node` also exposes these commands and a fetcher interface.
- 535cd41: Add package imports (RFC 0020). `(import "@acme/flows/ir" [FlowIR])` resolves
  through the `exports` field of a dependency's `forma.json`.
  Modules may import only packages their own package declares, and package
  modules get location-independent `pkg:<name>/<path>` identities. The compiler
  takes a host package table (`ModuleCoreOptions.packages`, `configureSession({
  packages })`); `@formalang/ts/node` builds one from `forma.json`, verified
  `forma.lock`, and committed `vendor/` or relative sources. The `forma file`
  commands use it. Packages may declare a prelude for their own modules. Session
  loading no longer bootstraps a file module's own forms as session descriptors,
  so a module's form can use an imported `:ir` type in sessions and the CLI.
- 535cd41: Record a content identity for each declaration's payload contract. Artifact
  declarations gain `payloadContractId`: SHA-256 over an `:ir` type's definition
  and every type it reaches (layout and record field order ignored), or over the
  resolved descriptor payload constraints. Forms with different surface syntax
  that produce the same IR type share an identity.
- 535cd41: Add `AnalysisWorkspace.search`, which finds forms and global definitions across
  preludes and documents by name, documentation (docstrings, slot docs, and the
  comments above a definition or its signature), produced `:ir` type, and
  inferred type. The language server answers `workspace/symbol` with it and
  accepts `produces:IRType` and `type:TypeName` filters in the query.
- 5903e62: Share the mechanics checked-declaration result across Effect generation, canonical artifact validation, host/CLI checking, and workspace analysis. Invalid Effect bodies, undeclared typed errors, and undeclared requirements cannot become validated canonical declarations. Module checks retain lexical identities and dependency diagnostics before emission selection; validated snapshots become stale when a checked dependency changes.
  
  Route explicit Effect declarations and signed helpers through mechanics checking in language services, preserving author spans, partial document analysis, and recorded expression types for hover. Add compiler diagnostic identities to host editor errors. Kernel and descriptor checks remain in place; low-level HM inference, language-server file import resolution, and full mechanics completion parity remain separate work.
- 83bbb56: **Breaking:** Upgrade the Effect runtime and generated TypeScript target from
  `effect@4.0.0-rc.112` to the stable `effect@4.0.3`. Consumers must install the
  same exact version for Forma's public Effect types.
  Generated config readers use `Config.String/Int/Number/Boolean`, and HTTP
  modules import `effect/http-api` and `effect/http`.
- 1beb252: Add `@formalang/ts/analysis`, a workspace of preludes and documents whose language services are memoized queries: diagnostics, typed spans, hover, completion (with descriptor slots), definitions, references, rename, document symbols, semantic tokens, and formatting. Documents are typed in the scope of their preludes: prelude macros expand, prelude definitions keep their inferred types, and descriptor forms are typed. `analyzeLsp` accepts that scope (`initialEnv`, `macroEnv`, `captureEnv`), types source-local `form` declarations, and keeps typing the forms around one that does not lower. The symbol index now records macro call heads as references to their macro. `Diagnostic` and `Span` live in `@formalang/ts/diagnostic`.
  
  `indexSymbols` accepts a `cache` from `createSymbolIndexCache()`. Documents whose text is unchanged are not read again, and the expansion of an unchanged leading run of documents is reused, so re-indexing after an edit to one document no longer re-reads and re-expands its preludes.
- 30d7db4: Elaborated declarations now record provenance. Top-level calls to macros defined with `define-macro` in the same source are expanded before elaboration; each declaration carries an `origin` (`authored`, or `expanded` with the macro calls that produced it) and a `sourceMap` from payload JSON pointers to authored spans, including one entry per child form such as `/fields/0`. Both fields are part of `PackageableDeclaration` and pass through `packageArtifact`. Declarations also report the descriptor's `:artifact` payload contract. Ontology declarations expose `origin` and per-field and per-input spans.
- 30d7db4: Add `@formalang/ts/preludes`, which embeds Forma's Lisp preludes as source strings and provides `bootstrapPreludes` and `bootstrapOntologyPreludes`. Consumers no longer need to vendor prelude files or read them from disk.
- 30d7db4: Register `construct/query` and `construct/declaration` meta builtins so the bundled ontology preludes elaborate queries without patching. Runtime string literals in construct output are now marked with the Forma-owned `$forma.runtimeExpr` key, exported as `RUNTIME_STRING_LITERAL_KEY` together with an `isRuntimeStringLiteral` guard from `@formalang/ts/descriptor`.
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
- 1beb252: **Breaking:** Remove the superseded `@formalang/ts/elaboration` (`DSLRegistry` handlers) and `@formalang/ts/form` (red-tree form patterns) frameworks, `createDSLTypeProviderFromRegistry`, the unused reader combinators, and the `form`-registry semantic tokens. Descriptors are the one way to define forms; semantic tokens come from `@formalang/ts/analysis`.
- 4662c76: Add a symbol index for editors. `indexSymbols` in `@formalang/ts/editor` returns definitions and references with node ids and spans for one or more documents. It resolves programs after macro expansion, so definitions made by macros are found and macro temporaries are not, handles `define`, `fn`, `let`, `do!`, `match`, `catch`, types, typeclasses, services, and operations, and uses descriptors (including `define-form`s in the indexed documents) for domain forms. `findReferences` returns a symbol's definition and references. `TsLanguageHost` implements the optional `symbolIndex` and `findReferences` host methods, including a session's loaded sources.
- e10e2b5: Add stable node identity for structural editors. `@formalang/ts/syntax` exports `identifySyntax`, which gives every syntax node and line comment an id, and `reconcileSyntax`, which carries ids to a new version of a document: nodes keep their ids when edits happen elsewhere, when they are retyped in place, and when they move with identical tokens. The trivia-preserving lexer now turns unterminated strings and unexpected characters into error nodes instead of throwing, so `parse` always returns a tree. `TsLanguageHost` implements the new optional `identifySyntax` host method.
- 8f8e14b: Validate source structure and module directives at load time, and commit prelude
  values and inferred types atomically. Add an optional typed `replSubmit` host
  operation that retains values, schemes, type registries, and sources only after
  successful evaluation. Session typechecks use retained schemes; loading reports
  `validate-and-store` through the version capability.
  
  Descriptor hooks and hosted helper type contracts remain pending the descriptor
  metacheck port; bootstrap continues to validate their structure.
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
- f5b3a0f: Validate declaration payloads and contracts before packaging artifacts.
  `@formalang/ts/artifact` exports `emit`, `emitMany`, `emitBackends`,
  `artifactSummary`, `validateDeclarations`, a named `ArtifactValidatorRegistry`,
  and descriptor payload-contract checks. Invalid declarations return
  source-located diagnostics instead of being packaged, and packages hash
  sorted-key canonical payload JSON with SHA-256. `LanguageHost` gains optional
  `emit`, `emitMany`, `emitBackends`, and `artifactSummary` methods taking an
  `EmitRequest`.
- 535cd41: Replace npm-based Forma package discovery with offline `forma.json` manifests,
  `forma.lock` verification, and committed `vendor/<name>` sources or relative
  packages. Check the full dependency closure and report stale manifests, identity
  mismatches, and missing, extra, or edited package files before compiling.
- 7d1a3ab: Expose UI-free authoring helpers for capability reachability, REPL declaration
  merging and filtering, descriptor source spans, and outline source coordinates
  as `@formalang/ts/authoring`. The structural workbench moves to Foldworks;
  Forma keeps the language, host ABI, and source editor integrations.

### Patch Changes

- e44ffca: Expose form documentation examples as source strings on descriptors. Accept source strings or vectors of example programs without evaluating them or capturing their helper references. Document all bundled domain forms and check their examples in the repository checks.
- f5b3a0f: Generate Effect TypeScript from the shared operational-effect body IR, covering
  typed failures, service and operation calls, sequencing, and branching.
  Unsupported nodes now fail generation with an explicit error instead of
  producing incomplete output.
- 1317204: Declare Effect as a `^4.1.1` peer dependency so applications can share one
  compatible runtime across Forma libraries. Keep repository tests pinned to
  Effect 4.1.1.
- 61a546a: Reuse the kernel macro prelude across host hook builtins objects. Form hook
  program expansion continues to use the existing per-expression cache, including
  helpers, constructors, scopes, checks, and projections.
- 535cd41: Keep a host's diagnostics when it resumes a host call with `{ok: false}`. The
  failed evaluation's diagnostic now has the host's first code instead of
  `KernelTypeError`, and `details.hostDiagnostics` carries every diagnostic the
  host returned. `KernelTypeError` gains an optional `details` field that
  survives source tracing and VM stack traces.
- 41f7bcc: **Breaking:** `forma file evaluate` now typechecks first and returns the typecheck
  response when it fails; pass `--unchecked` to evaluate without checking. File
  commands exit 1 when `ok` is false, and `help`/`--help` exit 0.
  
  `file declarations` lists each form application's elaborated IR as a
  `FormApplication` entry. Generic top-level functions stay generic across later
  definitions; implicit `Some`/`None` filling and field access work for imported
  record types; form `:check` hooks can call imported helpers; every failing form
  application is reported. JSON diagnostics carry lines and columns and use author
  names, and hook failures are located at the form application.
- 1739e4c: Widen literals when they constrain unresolved inference variables so keyword comparisons and polymorphic calls inside lambdas accept Keyword fields. Preserve explicit literal and enum checks. Name missing fields and suggest nearby record keys, locate numeric argument errors at their argument, and report the check function, form, and missing holes when a shared descriptor check destructures undeclared holes.
- e44ffca: Format core declaration headers, bindings, conditionals, and branch pairs using conventional Lisp layouts. Preserve quotation using reader shorthand.
- e44ffca: Remove unused ViewSpec registry field-name and mechanism hints. Keep the seven adapter settings read by the existing registry API; hosted compilation and protocol conventions are unchanged.
- dd124ba: Fix structural edits that fuse adjacent tokens or retain replaced descendants,
  outline whitespace and comment row identities, shared macro-template traces,
  current type syntax and quasiquote reference indexing, and retired syntax anchors.
- 09642e5: Keep author locations inside macro calls. The expander and the evaluator gave every node of a macro's expansion the call's location, including the arguments the author wrote, so a type error or runtime failure inside `(when ready (+ 1 "x"))` was reported on the whole call and expressions inside it were typed at the call's span. Arguments now keep their own source traces. A macro that expands into another macro call is located at the call the author wrote, instead of at an offset inside the prelude that defined the inner call.
- bb9ad6a: Analyze imported modules with caller-located types, retain partial editor types,
  and resolve definitions through named imports, namespaces, and re-exports while
  keeping private globals lexical. Imported VM closures now retain their defining
  compilation's global and builtin tables across calls.
- 30d7db4: Add the `meta/query-select-fields`, `meta/validate-query-select-fields`, and `view/compile-expr-record` meta builtins so `query` declarations and views with named queries construct from the bundled ontology preludes.
- 2016386: Keep imported macro names out of type annotations. A module that imported a
  macro named `->`, as `preludes/clojure.forma` re-exports from
  `preludes/kernel.forma`, could no longer write a function type: `(: total
  (-> Int Int))` resolved the arrow to the imported macro and failed with
  `Cannot unify Float -> Float with ->…<Int, Int>` at a span inside the
  library. Module resolution now leaves `macro` and `form` bindings alone in
  type position, where they can never be a type, so the annotation means what
  it says. Value, type, service, and error bindings resolve as before.

## 0.3.0

### Minor Changes

- 7c1d7da: Use Effect 4.0.0-rc.112 throughout Forma's TypeScript packages. Update service keys, result handling, host callbacks, and generated Effect TypeScript and Schema modules for the Effect 4 API.

## 0.2.0

### Minor Changes

- 74a83ec: Prepare the first public Forma packages under the @formalang scope. Ship compiled
  JavaScript and declarations, the shared host API, CodeMirror and React editor
  integrations, and a standalone language server with its portable OCaml engine.
