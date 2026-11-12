# @forma-language/forma

## 0.5.0

### Minor Changes

- 6042916: Infer reusable numeric functions with numeric constraints and solve callback inputs before choosing Int or Float. Carry numeric requirements through portable module signatures and generated Effect modules; default ambiguous numeric values to Int.
- b7cad56: **Breaking:** Align the kernel VM and compile-time tree evaluator on constructor calls, lexical builtin shadowing, malformed function/conditional/binding validation, and runtime diagnostic names and tags. Malformed kernel forms previously accepted by the VM now fail. Replace the VM's per-instruction Effect Ref updates with a shared per-run counter while preserving callback budgets, observation steps, and cooperative cancellation. The compile-time evaluator and runtime fallback remain available.
- f52b012: **Breaking:** Replace the public document analysis `typeEnv` and `mechanicsBindingTypes` fields with read-only `bindingDisplay(name, offset?)` and `hasBinding(name)` queries. Editor services now obtain mechanics, HM, and builtin binding displays through one analysis adapter; inference and module schemes retain their internal environments.
- 2ec3020: Expose `authored` and `syntax` on elaborated declarations and export the
  `DeclarationSyntax` type from `/descriptor`. Consumers can inspect original
  top-level expressions and named, nested and repeated hole values with exact
  source spans without reparsing. Macro calls remain separate from recognized
  expanded syntax. Payload source maps and artifact contracts are unchanged;
  existing elaboration call signatures keep working.
- 8a44902: Add `forma mcp`, a stdio MCP server with structured checking, checked evaluation, formatting, diagnostic explanations, syntax node descriptions, and id-addressed editing. File access stays within the server working directory, formatting writes require explicit opt-in, and evaluation grants no host capabilities.
- 8a44902: Import shipped file-module libraries as `forma:kernel`, `forma:test`, `forma:clojure`, and `forma:routes` without copying source files or declaring dependencies. Embedded sources resolve in Node, browser hosts, and installed distributions with stable module identities. Unknown bundled names list the available libraries, and kernel sugar diagnostics show the reserved import syntax.
- 97aa275: **Breaking:** `concat` now checks lists, not strings, in both HM and Effect
  TypeScript. Replace kernel string calls with `str`. The repository audit found
  two checker-only conformance uses, both migrated without changing their
  expected types; no string calls occurred in preludes or examples.
  
  Add checked `reduce` and `conj`, runtime `reverse`, `sqrt`, and `quot`, and
  Effect translations for `reverse` and `sqrt`. `reduce` calls its callback with
  the accumulator first; `conj` appends; `reverse` does not mutate its input;
  `quot` truncates toward zero and rejects division by zero.
  
  Add a builtin availability inventory and regression fixtures across HM,
  the interpreter, VM, and strict generated TypeScript. Checked collection
  contracts cover fully applied calls; unchecked runtime variadic extensions
  and numeric generalization are unchanged.
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
- 8a44902: Check union literal lists against the type supplied by another generic argument, in either argument order. Fill omitted Option record fields and wrap bare field values when imported function signatures or embedding preludes supply the record type, consistently during checking and execution.
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
- d1cdfb1: **Breaking:** Diagnostics now carry 1-based start and end line/column positions in their source spans in engine and in-process host results. Messages no longer include position suffixes. CLI file responses keep diagnostics only in the top-level array, removing the duplicate arrays inside `value` and `value.result`.
- d1cdfb1: Add the experimental createLanguage embedding facade for checking and running source, loading preludes, handling JSON capabilities, describing forms, and emitting canonical IR without Effect imports or manual session and resume loops. Runs check before evaluating and support step limits and cooperative host-call timeouts.
- 73cabb2: Add the TypeScript forma JSON CLI and daemon, filesystem module commands, optional load timings, core debug operations, and structural form digests. Validate host type configuration and report specific inference diagnostic codes with source spans.
- d1cdfb1: Unify host capabilities, strict JSON request schemas, response projections, and session scopes in one operation registry. Expose structural editor services and observation through JSON, export the ABI 0.2.0 contract schema, and accept optional SemVer ABI negotiation with an explained `abi/version-mismatch` diagnostic.
- 61a546a: Help host preludes report precise diagnostics. A `:check` diagnostic may carry
  `:at`, a path into the form's authored syntax, and is reported at that node.
  Preserve existing Syntax-value locations and child diagnostic codes and spans.
  Add the `declarations-of` and
  `type-definition` reflection builtins, and let an optional positional `String`
  hole (a docstring) be omitted before other positional arguments. Cover the
  existing quantification of `:scope` signatures with host-prelude regressions.
- d1cdfb1: Add human-facing check, run, fmt, repl and explain commands with source diagnostics and optional JSON output. Preserve the existing file command JSON responses and expose the typed host REPL and formatter through the CLI.
- 535cd41: Let a file module's `form` produce an `:ir` type that another module exports.
  Discovery, compile-time elaboration, and type checking see the imported type
  and the definitions it reaches, and payloads are checked against them.
  Declaration data in module interfaces gains `contractId`, a SHA-256 identity of
  the `:ir` type closure, shared by declarations from different forms that produce
  the same type.
- bdc817d: **Breaking:** Add isolated file modules, host-owned relative resolution, explicit imports and exports, portable checked interfaces, and linked Effect TypeScript. Source loading no longer publishes bindings to other files. Re-exports preserve owning type and binding identities; generated files use real imports and exports.
- 97d2154: Support find references, and resolve definitions of names introduced by macros or descriptor forms, using the symbol index from `@formalang/host` across open documents and configured preludes.
- 1beb252: **Breaking:** Run the language server on the TypeScript engine instead of the bundled OCaml JavaScript artifact. The server no longer spawns a child process or ships `dist/runtime/jsoo_entry.cjs`. It adds rename, document symbols, and semantic tokens, offers slot completion inside descriptor forms, and types documents with the macros, definitions, and forms of their preludes. `FormaWorkspace` replaces `OcamlWorkspaceSession`; `OcamlAbiClient` and `createOcamlEditorAnalysisHost` are removed, and `FORMA_LANGUAGE_SERVER_ARTIFACT` is no longer read.
- 12c3324: Let libraries claim retired spellings (RFC 0021, stage 0). `def`, `defn`,
  `defmacro`, `lambda`, and `let*` are now rejected after macro expansion
  instead of before it, so a macro in scope may use one of those names. An
  unclaimed use still reports `Use define instead of defn` (or the matching
  replacement) at the author's form, and the file-module typechecker now keeps
  that diagnostic's `surface/invalid-form` code and inner span instead of
  reporting a type mismatch at the top-level form. Macros gain `sexpr-vector?`.
- d1cdfb1: **Breaking:** Use `.lisp` for Forma source files and package exports and preludes. Move the file-module libraries to `preludes/modules/`; the top-level legacy preludes remain separate. Imports and re-exports using the retired extension now report `module/retired-extension` with a suggested path edit. Update source paths and regenerate package locks after renaming files.
- 4453f84: Add independent light/dark appearance and Forma, Ocean, and Orchid syntax palettes
  for CodeMirror and LispEditor. Appearance changes preserve the document and undo
  history. Export showMechanicsType to render the Effect checker's inferred types
  in live authoring tools.
- **Breaking:** Prepare the 0.5.0 public contract. Keep the root and only these subpaths: `/engine`, `/reader`, `/modules`, `/diagnostic`, `/formatter`, `/editor-services`, `/analysis`, `/descriptor`, `/preludes`, `/mechanics`, `/http-api`, `/rpc`, `/type`, `/email`, `/elm`, `/expander`, `/node`, `/host`, `/host/types`, `/host/json-abi`, `/editor`, `/editor/codemirror`, `/editor/react`, `/language-server`. Other former subpaths are internal; use the root embedding facade or the retained engine/host contracts instead. All five WorldVM subpaths remain available.
  
  Retain CodeMirror, Lezer, MCP and LSP as dependencies so both bins work after an ordinary install with Effect. They are reachable only through the tool subpaths and bins; the runtime-neutral bundle check now also rejects MCP imports. Dependency weight is intentionally unchanged. The existing installed checking dependency closure (excluding optional React roots) measures 119 dependency packages and 79,313,133 file bytes before and after; the baseline packed distribution adds 2,348,069 bytes (81,661,202 total); the 0.5.0 tarball adds 2,345,942 bytes (81,659,075 total). Clean consumer installation could not complete offline in the sandbox (missing CodeMirror tarball), so these are existing-installation closure measurements, not a successful clean-install claim. `pack:check` now reports actual clean installed counts and bytes when its install succeeds.
  
  Add a clean committed-source tarball gate and document installation from main, first publication and legacy deprecation commands. Consume pending changesets into 0.5.0: the version on main names the next release, and later breaking changes must advance the minor in the same PR.
- 7563d01: Support `bootstrapFromSources([{sourceId, source}, ...], options?)` alongside the existing string signature. Named prelude definition diagnostics retain each file's ID and offsets, and the original inputs are available as `sourceInputs` without changing `sources`.
  
  Add `FormDescriptorRegistry.getChildForms(formName, holeName)` using the compiler's child-family rules, export `closestName` from `/diagnostic`, and support an optional source ID in `toSExprMany`. Existing registry listings already expose forms, holes, and types; consumers no longer need to scrape prelude text or concatenate files.
- 41f7bcc: **Breaking:** `forma file evaluate` now typechecks first and returns the typecheck
  response when it fails; pass `--unchecked` to evaluate without checking. File
  commands exit 1 when `ok` is false, and `help`/`--help` exit 0.
  
  `file declarations` lists each form application's elaborated IR as a
  `FormApplication` entry. Generic top-level functions stay generic across later
  definitions; implicit `Some`/`None` filling and field access work for imported
  record types; form `:check` hooks can call imported helpers; every failing form
  application is reported. JSON diagnostics carry lines and columns and use author
  names, and hook failures are located at the form application.
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
- d1cdfb1: Forward diagnostic help and structured details, offer atomic diagnostic edits as preferred quick fixes when only one is available, and enable document formatting by default.
- 923ef53: **Breaking:** Remove the OCaml language hosts. `NodeOcamlLanguageHost`, `JsOcamlLanguageHost`, `parseOcamlJson`, and the `./ocaml-host` and `./js-ocaml-host` entry points are gone, along with the `FORMA_OCAML_CLI` and `FORMA_OCAML_JS` settings. Use `TsLanguageHost`, `createDefaultLanguageHost`, or the `forma` JSON CLI and daemon instead.
- 8a44902: Type mismatches identify the expected and actual types consistently and use local letters for inference variables. Diagnostics carry related declaration locations through the JSON ABI, CLI notes, and LSP. Add mechanical repairs for nearby record field names and retired form heads, and improve diagnostic catalog explanations and stability labels.
- 94e8947: Add a dedicated unary RPC prelude and `@formalang/ts/rpc` host adapter. Generate native Effect RPC groups from typed Forma contracts, optionally importing shared domain schemas, without RPC-specific mechanics compiler extensions.
- 535cd41: Add `AnalysisWorkspace.search`, which finds forms and global definitions across
  preludes and documents by name, documentation (docstrings, slot docs, and the
  comments above a definition or its signature), produced `:ir` type, and
  inferred type. The language server answers `workspace/symbol` with it and
  accepts `produces:IRType` and `type:TypeName` filters in the query.
- 5903e62: Share the mechanics checked-declaration result across Effect generation, canonical artifact validation, host/CLI checking, and workspace analysis. Invalid Effect bodies, undeclared typed errors, and undeclared requirements cannot become validated canonical declarations. Module checks retain lexical identities and dependency diagnostics before emission selection; validated snapshots become stale when a checked dependency changes.
  
  Route explicit Effect declarations and signed helpers through mechanics checking in language services, preserving author spans, partial document analysis, and recorded expression types for hover. Add compiler diagnostic identities to host editor errors. Kernel and descriptor checks remain in place; low-level HM inference, language-server file import resolution, and full mechanics completion parity remain separate work.
- d1cdfb1: **Breaking:** Prepare the initial single-package Forma distribution, with a curated root, explicit advanced subpaths, optional React peers and both executables. The four implementation workspaces are private. Migrate old engine imports to `@forma-language/forma` subpaths (`editor` becomes `editor-services`), host imports to `/host`, and UI imports to `/editor/codemirror` or `/editor/react`. Install the required Effect peer; 4.1.1 is the tested baseline. Pending implementation release notes now apply to this distribution and retain their original breaking notes.
- 8a44902: Add `forma test` with checked file discovery, independent bounded evaluations, filtering, human summaries and JSON results. Add the ordinary `test`, `is` and `is=` file-module library. Preserve macro assertion locations through module resolution and support calling builtin values in both evaluators.
- 83bbb56: **Breaking:** Upgrade the Effect runtime and generated TypeScript target from
  `effect@4.0.0-rc.112` to the stable `effect@4.0.3`. Consumers must install the
  same exact version for Forma's public Effect types.
  Generated config readers use `Config.String/Int/Number/Boolean`, and HTTP
  modules import `effect/http-api` and `effect/http`.
- 5b5736d: Add an exported offline diagnostic catalog with stable identifiers, summaries,
  explanations and consumer registration. Add typed diagnostic detail contracts
  for consumer form/name/type checks, preserving enum and type alternatives and
  exact unknown-type spans. Keep existing codes and embedding signatures.
  
  Diagnostics gain optional author help and atomic source-span text edits.
  Form `:check` results can supply details, help and fixes, which survive
  elaboration and editor/host projections. The source-built CLI gains
  `forma explain <code>`; unknown codes fail with `abi/unknown-code`.
  
  See the consumer upgrade note for changes since `1317204`, including list-only
  `concat`, exhaustive-match errors, larger diagnostic sets, hook-failure codes,
  prelude extensions and offline package discovery. FX1 itself is additive.
- 8a44902: Accept exported file modules as automatic vocabulary in `createLanguage`. Add a shared `describe` host operation and CLI reference covering typed forms, checked examples, function signatures, and types. Document typed capabilities and add a checked core cheat sheet.
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
- 8a44902: **Breaking:** Reject calls with the wrong number of arguments instead of inferring implicit partial application. Arithmetic operators can be passed as binary function values with Int/Float result types, and builtin values are callable through variables and collection callbacks in both execution engines.
- 38b3da9: Add `generateTypeSchemas(sources)` under `/mechanics` and `forma schema <sources...> --out <dir> [--check]`. They generate deterministic Effect codecs, plain TypeScript types, and JSON Schema 2020-12 from explicit source bundles. The freshness check fails without writing stale output. Supported data shapes include refinements, nonempty lists, optional fields, unions, and recursion; unsupported wire encodings produce located diagnostics.
  
  Fix recursive standalone mechanics schemas with suspended references and explicit recursive types. Nonempty list metadata now produces `Schema.NonEmptyArray`. Existing mechanics signatures and Effect-operation `Unit = void` behavior remain unchanged; the new data-only build uses `Unit = null` and finite JSON numbers.
- 8a44902: Add typed expression holes (`?` and `?name`) with expected types, bounded visible-binding suggestions, structured diagnostics, and language-server replacement fixes. Checked runs reject incomplete programs; unchecked evaluation reports a located hole error. Leading-question-mark symbols are now reserved in executable expressions; quoted query data and descriptor syntax are unaffected.
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

- bece13a: Locate descriptor normalization and duplicate form diagnostics. Export typed errors with stable codes and field paths for invalid protocol generator, diagnostic catalog, and artifact validator registrations, and retain module/package-fetch for transport filesystem failures.
- 636d8e3: Locate unmatched and duplicate type signatures, reject incomplete match arms and List type applications before early traversal can crash, and report invalid module declaration names without exposing internal markers.
- a711c0e: Report invalid protocol manifest fields, missing names, and nonliteral values as typed diagnostics located at the authored prelude syntax.
- 95dbd22: Report malformed surface declarations, form applications, action operations, and type contracts as located diagnostics. Keep invalid authored hook results in the Effect failure channel, and expose `SurfaceInputError` with a stable code and field path for unsupported host-supplied syntax.
- 8a44902: Reduce typechecking allocations by caching scheme free variables and sharing schemes that are unaffected by a substitution, preserving inference results.
- 93e8642: Align the shared CodeMirror theme with Forma's green-black code panels and warm-paper light mode. Improve comment, gutter, and placeholder contrast and use a restrained default syntax palette without changing editing behavior or the optional syntax palettes.
- e44ffca: Expose form documentation examples as source strings on descriptors. Accept source strings or vectors of example programs without evaluating them or capturing their helper references. Document all bundled domain forms and check their examples in the repository checks.
- f5b3a0f: Generate Effect TypeScript from the shared operational-effect body IR, covering
  typed failures, service and operation calls, sequencing, and branching.
  Unsupported nodes now fail generation with an explicit error instead of
  producing incomplete output.
- 1317204: Declare Effect as a `^4.1.1` peer dependency so applications can share one
  compatible runtime across Forma libraries. Keep repository tests pinned to
  Effect 4.1.1.
- 0e2a593: Reject matches missing constructors of a closed tagged type in the kernel
  typechecker, matching the Effect checker's existing error behavior. Cover every
  constructor or add a final `_` arm. Duplicate-constructor and unreachable-arm
  diagnostics remain warnings.
  
  RFC 0019 stage-2 audit: the existing programs that change from warning to error
  are the three typecheck fixtures `match-non-exhaustive-warning`,
  `match-let-bound-non-exhaustive-warning`, and
  `match-let-alias-chain-non-exhaustive-warning` in `conformance/fixtures/typecheck`.
  Their historical fixture IDs are retained; their expectations now require an
  error and unsuccessful checking. Diagnostic messages, source spans, and inferred
  types are unchanged.
  
  The conformance suites, bundled-prelude checks, and example artifact corpus
  (58 sources, 548 declarations) pass without program repairs. No surface golden
  changes are needed (249 comparisons pass).
- d1cdfb1: Suggest nearby author-visible names for unbound symbols, bound candidate lists to five names, and offer an atomic source edit when the nearest name is unambiguous.
- d1cdfb1: Give runtime arity and step-limit failures readable messages and name directly bound functions in evaluator and VM arity diagnostics.
- d1cdfb1: Recover bindings from retired def and defn spellings during editor analysis, avoiding dependent unbound-symbol errors while retaining the spelling diagnostic.
- d1cdfb1: Report the engine version bundled from its package manifest and export a single host ABI version constant.
- 61a546a: Reuse the kernel macro prelude across host hook builtins objects. Form hook
  program expansion continues to use the existing per-expression cache, including
  helpers, constructors, scopes, checks, and projections.
- d1cdfb1: Correct the engine overview and Effect peer migration documentation.
- d1cdfb1: Forward spelling fixes for unbound form heads through workspace diagnostics and editor quick fixes. Share repeated host ABI JSON schemas through named definitions while preserving request and response constraints.
- 535cd41: Keep a host's diagnostics when it resumes a host call with `{ok: false}`. The
  failed evaluation's diagnostic now has the host's first code instead of
  `KernelTypeError`, and `details.hostDiagnostics` carries every diagnostic the
  host returned. `KernelTypeError` gains an optional `details` field that
  survives source tracing and VM stack traces.
- 8a44902: Report malformed form declarations, function parameter lists, type metadata, and service members as located diagnostics during module checking. Preserve source diagnostics raised while preparing compile-time definitions across check, run, and declarations commands.
- 1739e4c: Widen literals when they constrain unresolved inference variables so keyword comparisons and polymorphic calls inside lambdas accept Keyword fields. Preserve explicit literal and enum checks. Name missing fields and suggest nearby record keys, locate numeric argument errors at their argument, and report the check function, form, and missing holes when a shared descriptor check destructures undeclared holes.
- e44ffca: Format core declaration headers, bindings, conditionals, and branch pairs using conventional Lisp layouts. Preserve quotation using reader shorthand.
- e44ffca: Remove unused ViewSpec registry field-name and mechanism hints. Keep the seven adapter settings read by the existing registry API; hosted compilation and protocol conventions are unchanged.
- 8a44902: Run module graphs containing imported forms by reusing their elaborated declaration descriptors and projected IR without rerunning hooks. Preserve declared bindings at runtime and expand module macros in their defining scope.
- 8a44902: Resolve named record aliases recursively in form expression hole contracts, including lists, options, and generic aliases. Preserve nominal brands and tagged types, and report mismatched literal fields at their authored spans.
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
