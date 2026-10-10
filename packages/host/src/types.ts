import type { ModuleInterface, LinkedEffectProgram } from "@formalang/ts/modules";
export interface Span {
  readonly sourceId: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly startLine?: number | undefined;
  readonly startColumn?: number | undefined;
  readonly endLine?: number | undefined;
  readonly endColumn?: number | undefined;
}

export interface Diagnostic {
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly phase?:
    | "parse"
    | "expand"
    | "typecheck"
    | "evaluate"
    | "elaborate"
    | "host-effect"
    | "emit";
  readonly span?: Span | undefined;
  readonly details?: Record<string, unknown> | undefined;
}

export type AstNode =
  | { readonly kind: "nil"; readonly span?: Span | undefined }
  | { readonly kind: "bool"; readonly value: boolean; readonly span?: Span | undefined }
  | { readonly kind: "int" | "float"; readonly value: number; readonly span?: Span | undefined }
  | { readonly kind: "string"; readonly value: string; readonly span?: Span | undefined }
  | { readonly kind: "symbol"; readonly value: string; readonly span?: Span | undefined }
  | { readonly kind: "keyword"; readonly value: string; readonly span?: Span | undefined }
  | {
      readonly kind: "list" | "vector";
      readonly items: readonly AstNode[];
      readonly span?: Span | undefined;
    }
  | {
      readonly kind: "map";
      readonly entries: readonly { readonly key: AstNode; readonly value: AstNode }[];
      readonly span?: Span | undefined;
    }
  | {
      readonly kind: "set";
      readonly items: readonly AstNode[];
      readonly span?: Span | undefined;
    }
  | { readonly kind: "error"; readonly message: string; readonly span?: Span | undefined };

interface RetainedValueProjection {
  readonly valueRef?: string | undefined;
}

export type ValueProjection =
  | ({ readonly kind: "nil" } & RetainedValueProjection)
  | ({ readonly kind: "bool"; readonly value: boolean } & RetainedValueProjection)
  | ({ readonly kind: "int"; readonly value: number } & RetainedValueProjection)
  | ({ readonly kind: "float"; readonly value: number | "NaN" | "Infinity" | "-Infinity" | "-0" } & RetainedValueProjection)
  | ({ readonly kind: "string"; readonly value: string } & RetainedValueProjection)
  | ({ readonly kind: "keyword"; readonly value: string } & RetainedValueProjection)
  | ({ readonly kind: "symbol"; readonly value: string } & RetainedValueProjection)
  | ({
      readonly kind: "list" | "vector";
      readonly items: readonly ValueProjection[];
    } & RetainedValueProjection)
  | ({
      readonly kind: "map";
      readonly entries: readonly {
        readonly key: ValueProjection;
        readonly value: ValueProjection;
      }[];
    } & RetainedValueProjection)
  | { readonly kind: "function"; readonly valueRef: string; readonly display?: string | undefined }
  | ({
      readonly kind: "opaque";
      readonly tag: string;
      readonly display?: string | undefined;
    } & RetainedValueProjection);

export type TypeProjection =
  | { readonly kind: "named"; readonly name: string; readonly display: string }
  | { readonly kind: "display"; readonly display: string };

export interface ExpressionType {
  readonly expressionId: string;
  readonly formIndex: number;
  readonly span?: Span | undefined;
  readonly display: string;
  readonly type: TypeProjection;
}

export interface SyntaxTreeProjection {
  readonly kind: string;
  readonly span: Span;
  readonly text?: string | undefined;
  readonly tokenType?: string | undefined;
  readonly children?: readonly SyntaxTreeProjection[] | undefined;
}

export interface EditorTypedSpan {
  readonly id: string;
  readonly span: Span;
  readonly display: string;
  readonly type: TypeProjection;
  readonly code: string;
  readonly exprTag: string;
}

export interface EditorAnalysisError {
  readonly message: string;
  readonly span?: Span | undefined;
  readonly code?: string | undefined;
}

export interface EditorParseProjection {
  readonly errors: readonly {
    readonly message: string;
    readonly span?: Span | undefined;
  }[];
  readonly greenTree: SyntaxTreeProjection | null;
  readonly redTree: SyntaxTreeProjection | null;
}

export interface EditorAnalysisRequest {
  readonly sourceId?: string | undefined;
  readonly source: string;
  /** Host builtins the source may call, typed by their `typeScheme`. */
  readonly hostBuiltins?: readonly HostBuiltinDescriptor[] | undefined;
  readonly typePolicy?: TypePolicy | undefined;
  /** Use the session's host builtins and type policy when the request gives none. */
  readonly sessionId?: string | undefined;
}

export interface EditorAnalysisResult {
  readonly sourceId: string;
  /**
   * False when any top-level form does not type. Every such form has an
   * error, and the other forms are still typed in `typedSpans`.
   */
  readonly success: boolean;
  readonly resultType?: TypeProjection | undefined;
  readonly resultTypeDisplay?: string | undefined;
  readonly typedSpans: readonly EditorTypedSpan[];
  readonly errors: readonly EditorAnalysisError[];
  readonly diagnostics: readonly Diagnostic[];
  readonly parse: EditorParseProjection;
}

export type TypeSchemeExpr =
  | { readonly kind: "type"; readonly name: string }
  | {
      readonly kind: "function";
      readonly params: readonly TypeSchemeExpr[];
      readonly result: TypeSchemeExpr;
    }
  | {
      readonly kind: "variadic-function";
      readonly params: readonly TypeSchemeExpr[];
      readonly rest: TypeSchemeExpr;
      readonly result: TypeSchemeExpr;
    }
  | { readonly kind: "list"; readonly item: TypeSchemeExpr }
  | { readonly kind: "map"; readonly key: TypeSchemeExpr; readonly value: TypeSchemeExpr }
  | { readonly kind: "any" };

export interface HostBuiltinDescriptor {
  readonly name: string;
  readonly arity: number | { readonly min: number; readonly max?: number | undefined };
  readonly typeScheme?: TypeSchemeExpr | undefined;
  readonly handler: { readonly kind: "host-effect"; readonly effect: string };
  readonly purity?: "pure" | "read" | "write" | "service" | undefined;
}

export interface TypePolicy {
  readonly unboundSymbols?: readonly {
    readonly match: { readonly kind: "exact" | "prefix"; readonly value: string };
    readonly type: TypeSchemeExpr;
    readonly reason?: string | undefined;
  }[];
  readonly defaultBuiltinScheme?: "kernel" | "none" | undefined;
}

export interface HostCall {
  readonly evaluationId: string;
  readonly callId: string;
  readonly effect: string;
  readonly name: string;
  readonly args: readonly ValueProjection[];
}

export type ValueProjectionName = "printed" | "plain-json" | "triple-value" | "truthy" | "summary";

/** Opt-in per-expression observation. See docs/language-services.md. */
export interface ObservationRequest {
  /** Ids for records; pass the identity of the evaluated source. Fresh ids otherwise. */
  readonly identity?: SyntaxIdentity | undefined;
  /** Maximum number of expressions with records. Default 5,000. */
  readonly maxRecords?: number | undefined;
  /** Maximum items shown per list, vector, or map. Default 20. */
  readonly maxItems?: number | undefined;
  /** Maximum nesting depth of a projected value. Default 4. */
  readonly maxDepth?: number | undefined;
  /** Maximum length of a projected string. Default 500. */
  readonly maxStringLength?: number | undefined;
}

export interface ExpressionObservation {
  readonly nodeId: string;
  readonly span: Span;
  /** Times the expression finished evaluating. */
  readonly count: number;
  /**
   * The last value, bounded by the request's limits. Truncated collections
   * end with an opaque item tagged `truncated`. Absent when `count` is 0.
   */
  readonly value?: ValueProjection | undefined;
  /** A failure raised while evaluating this expression. */
  readonly failure?: Diagnostic | undefined;
}

export interface ObservationResult {
  /** Records in document order, for expressions that ran or failed. */
  readonly records: readonly ExpressionObservation[];
  /** True when `maxRecords` dropped records. */
  readonly truncated: boolean;
  readonly limits: {
    readonly maxRecords: number;
    readonly maxItems: number;
    readonly maxDepth: number;
    readonly maxStringLength: number;
  };
}

export interface EvaluationResult {
  readonly value: ValueProjection;
  readonly printed?: string | undefined;
  /** Inferred result type of a successful REPL submission. */
  readonly type?: TypeProjection | undefined;
  readonly projected?: Record<string, unknown> | undefined;
  readonly steps?: number | undefined;
  readonly diagnostics: readonly Diagnostic[];
  /** Present when the request set `observe`, including when evaluation failed. */
  readonly observations?: ObservationResult | undefined;
}

export type EvaluationState =
  | { readonly status: "completed"; readonly result: EvaluationResult }
  | { readonly status: "host-call"; readonly call: HostCall }
  | {
      readonly status: "failed";
      readonly diagnostics: readonly Diagnostic[];
      readonly observations?: ObservationResult | undefined;
    };

export interface VersionResult {
  readonly engine: string;
  readonly engineVersion: string;
  readonly hostAbiVersion: string;
  readonly capabilities: readonly string[];
  /** What loadSource does before returning. Consumers can call typecheck explicitly for either engine. */
  readonly sourceLoadSemantics?: "parse-and-store" | "validate-and-store" | "apply-declarations" | "unsupported";
  readonly capabilityNotes?: readonly {
    readonly capability: string;
    readonly status: "ready" | "partial" | "unsupported";
    readonly detail: string;
  }[];
}

export interface ParseRequest {
  readonly sourceId?: string | undefined;
  readonly source: string;
}

export interface ParseResult {
  readonly sourceId: string;
  readonly ast: readonly AstNode[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface ExpandRequest {
  readonly sessionId?: string | undefined;
  readonly sourceId?: string | undefined;
  readonly source?: string | undefined;
}

export interface ExpandResult {
  readonly sourceId: string;
  readonly ast: readonly AstNode[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface TypecheckRequest {
  readonly sessionId?: string | undefined;
  readonly sourceId?: string | undefined;
  readonly source?: string | undefined;
  readonly hostBuiltins?: readonly HostBuiltinDescriptor[] | undefined;
  readonly typePolicy?: TypePolicy | undefined;
  readonly result?: "summary" | "per-expression" | undefined;
}

export interface TypecheckResult {
  readonly type?: TypeProjection | undefined;
  readonly display?: string | undefined;
  readonly expressionTypes?: readonly ExpressionType[] | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

export interface SessionVariable {
  readonly name: string;
  readonly value: ValueProjection;
}

export interface OpenSessionRequest {
  readonly defaultStepLimit?: number | undefined;
  readonly astKeywordContract?: "keyword" | undefined;
}

export interface OpenSessionResult {
  readonly sessionId: string;
}

export interface ConfigureSessionRequest {
  readonly projects?: ModuleGraphRequest["projects"];
  readonly sessionId: string;
  readonly variables?: readonly SessionVariable[] | undefined;
  readonly hostBuiltins?: readonly HostBuiltinDescriptor[] | undefined;
  readonly typePolicy?: TypePolicy | undefined;
}

export interface ConfigureSessionResult {
  readonly sessionId: string;
  readonly bindingCount: number;
  readonly builtinCount: number;
}

export interface SourceDocument {
  readonly sourceId: string;
  readonly source: string;
  readonly kind?: "source" | "prelude" | "generated" | undefined;
}

export interface LoadSourceRequest extends SourceDocument {
  readonly timings?: boolean | undefined;
  readonly sessionId: string;
}

/** Absent phases were not executed by this engine during load. Durations are milliseconds. */
export interface LoadPhaseTimings {
  readonly parseMs?: number;
  readonly evalMs?: number;
  readonly typecheckMs?: number;
  readonly metacheckMs?: number;
  readonly elaborateMs?: number;
  readonly storeMs?: number;
}

export interface LoadSourceResult {
  readonly timings?: LoadPhaseTimings;
  readonly sourceId: string;
  readonly formCount: number;
  readonly diagnostics: readonly Diagnostic[];
}

export interface LoadSourceBundleRequest {
  readonly timings?: boolean | undefined;
  readonly sessionId: string;
  readonly sources: readonly SourceDocument[];
}

export interface LoadSourceBundleResult {
  readonly sources: readonly LoadSourceResult[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface EvaluateRequest {
  readonly sourceId?: string | undefined;
  readonly source: string;
  readonly variables?: readonly SessionVariable[] | undefined;
  readonly typePolicy?: TypePolicy | undefined;
  readonly stepLimit?: number | undefined;
  readonly resultProjection?: readonly ValueProjectionName[] | undefined;
  readonly observe?: ObservationRequest | undefined;
}

export interface EvaluateInSessionRequest {
  readonly sessionId: string;
  readonly evaluationId?: string | undefined;
  readonly sourceId?: string | undefined;
  readonly source?: string | undefined;
  readonly variables?: readonly SessionVariable[] | undefined;
  readonly stepLimit?: number | undefined;
  readonly resultProjection?: readonly ValueProjectionName[] | undefined;
  /** Also applies to observed values: each record's value gets a `valueRef`. */
  readonly retainValues?: "none" | "functions" | "all" | undefined;
  readonly observe?: ObservationRequest | undefined;
}

export interface CallValueRequest {
  readonly sessionId: string;
  readonly evaluationId?: string | undefined;
  readonly valueRef: string;
  readonly args: readonly ValueProjection[];
  readonly stepLimit?: number | undefined;
  readonly resultProjection?: readonly ValueProjectionName[] | undefined;
  readonly retainValues?: "none" | "functions" | "all" | undefined;
}

export type HostCallResumeResult =
  | {
      readonly ok: true;
      readonly value: ValueProjection;
      readonly hostEffects?: readonly Record<string, unknown>[] | undefined;
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export interface ResumeHostCallRequest {
  readonly sessionId: string;
  readonly evaluationId: string;
  readonly callId: string;
  readonly result: HostCallResumeResult;
}

export interface AbortEvaluationRequest {
  readonly sessionId: string;
  readonly evaluationId: string;
  readonly reason?: string | undefined;
}

export interface AbortEvaluationResult {
  readonly evaluationId: string;
  readonly aborted: boolean;
}

export interface ProjectValueRequest {
  readonly sessionId?: string | undefined;
  readonly valueRef?: string | undefined;
  readonly value?: ValueProjection | undefined;
  readonly projections: readonly ValueProjectionName[];
}

export interface ProjectValueResult {
  readonly value: ValueProjection;
  readonly printed?: string | undefined;
  readonly plainJson?: unknown;
  readonly truthy?: boolean | undefined;
  readonly summary?: { readonly kind: string; readonly size?: number | undefined } | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ReleaseValueRequest {
  readonly sessionId: string;
  readonly valueRefs: readonly string[];
}

export interface ReleaseValueResult {
  readonly released: readonly string[];
}

export interface SessionSourceInfo {
  readonly sourceId: string;
  readonly hash?: string | undefined;
  readonly order?: number | undefined;
  readonly textLength?: number | undefined;
  readonly formCount?: number | undefined;
}

export interface SessionInfoRequest {
  readonly sessionId: string;
}

export interface SessionInfoResult {
  readonly sessionId: string;
  readonly sourceCount: number;
  readonly preludeCount: number;
  readonly sources: readonly SessionSourceInfo[];
  readonly preludes: readonly SessionSourceInfo[];
  readonly preludeFingerprint?: string | undefined;
  readonly parsedSourceCount?: number | undefined;
  readonly parsedPreludeCount?: number | undefined;
  readonly envBindingCount?: number | undefined;
  readonly typeBindingCount?: number | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ResetSessionRequest {
  readonly sessionId: string;
}

export interface ResetSessionResult {
  readonly sessionId: string;
  readonly reset: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

export interface CloseSessionRequest {
  readonly sessionId: string;
}

export interface CloseSessionResult {
  readonly sessionId: string;
  readonly closed: boolean;
}

// =============================================================================
// Structural editor services. See docs/language-services.md.
// =============================================================================

export type SyntaxNodeKind =
  | "List"
  | "Vector"
  | "Map"
  | "Set"
  | "Symbol"
  | "String"
  | "Number"
  | "Boolean"
  | "ReaderMacro"
  | "Error"
  | "Comment";

/** Offsets into one source text. */
export interface OffsetSpan {
  readonly start: number;
  readonly end: number;
}

export interface SyntaxNode {
  readonly id: string;
  readonly kind: SyntaxNodeKind;
  readonly span: OffsetSpan;
  readonly parent: string | null;
  /** Position among the parent's identified children, comments included. */
  readonly index: number;
}

/** Ids for every node and comment of one source text. JSON-safe; pass it back to reconcile. */
export interface SyntaxIdentity {
  readonly version: 1;
  readonly idPrefix: string;
  readonly nextId: number;
  readonly nodes: readonly SyntaxNode[];
  readonly errors: readonly { readonly message: string; readonly span: OffsetSpan }[];
}

export interface TextChange {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface SyntaxAnchor {
  readonly id: string;
  readonly span: OffsetSpan;
}

export interface SyntaxIdentityRequest {
  readonly sourceId?: string | undefined;
  readonly source: string;
  /** The previous version of the document; ids carry over from it. */
  readonly previous?:
    | { readonly source: string; readonly identity: SyntaxIdentity }
    | undefined;
  /** Edits from `previous.source` to `source`, when the caller knows them. */
  readonly changes?: readonly TextChange[] | undefined;
  readonly anchors?: readonly SyntaxAnchor[] | undefined;
  /** Prefix for generated ids when there is no previous identity. */
  readonly idPrefix?: string | undefined;
}

export interface SyntaxIdentityResult {
  readonly sourceId: string;
  readonly identity: SyntaxIdentity;
  readonly diagnostics: readonly Diagnostic[];
}

export interface SymbolDocumentInput extends SourceDocument {
  readonly identity?: SyntaxIdentity | undefined;
}

export interface SymbolIndexRequest {
  readonly sourceId?: string | undefined;
  readonly source: string;
  /** Ids for `source`. A fresh identity is used when omitted. */
  readonly identity?: SyntaxIdentity | undefined;
  /** Further documents indexed before `source`, in load order. */
  readonly documents?: readonly SymbolDocumentInput[] | undefined;
  /** Index the session's loaded preludes and sources before `source`. */
  readonly sessionId?: string | undefined;
}

export type SymbolDefinitionKind =
  | "value"
  | "function"
  | "macro"
  | "type"
  | "constructor"
  | "method"
  | "declaration"
  | "parameter"
  | "local";

export interface SymbolDefinition {
  /** Unique key: `sourceId#nodeId`. */
  readonly key: string;
  readonly name: string;
  readonly kind: SymbolDefinitionKind;
  readonly scope: "global" | "local";
  readonly nodeId: string;
  readonly span: Span;
  /** Head of the author-written form that introduced the name (`define`, `let`, a macro, a descriptor form). */
  readonly form: string;
  readonly formNodeId?: string | undefined;
  /** For locals, the node that bounds where the name is visible. */
  readonly scopeNodeId?: string | undefined;
}

export interface SymbolReference {
  readonly name: string;
  readonly nodeId: string;
  readonly span: Span;
  readonly resolution: "definition" | "builtin" | "form" | "unresolved";
  /** Key of the definition the reference resolves to. */
  readonly definition?: string | undefined;
}

export interface SymbolIndexResult {
  readonly sourceId: string;
  readonly definitions: readonly SymbolDefinition[];
  readonly references: readonly SymbolReference[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface FindReferencesRequest extends SymbolIndexRequest {
  /** A position inside the symbol in `source`. */
  readonly offset?: number | undefined;
  /** Or the symbol's node id in `identity`. */
  readonly nodeId?: string | undefined;
}

export interface FindReferencesResult {
  readonly sourceId: string;
  readonly definition?: SymbolDefinition | undefined;
  readonly references: readonly SymbolReference[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Edit operations address nodes by id. The full contract is `editScriptSchema()`. */
export type EditPlace =
  | { readonly before: string }
  | { readonly after: string }
  | { readonly parent: string | null; readonly index?: number | undefined };

export type EditOp =
  | { readonly op: "replace"; readonly target: string; readonly text: string }
  | { readonly op: "insert"; readonly at: EditPlace; readonly text: string }
  | { readonly op: "delete"; readonly target: string }
  | { readonly op: "wrap"; readonly targets: readonly string[]; readonly head: string }
  | { readonly op: "splice"; readonly target: string }
  | { readonly op: "unwrap"; readonly target: string }
  | { readonly op: "raise"; readonly target: string }
  | { readonly op: "move"; readonly target: string; readonly to: EditPlace }
  | { readonly op: "rename"; readonly target: string; readonly to: string }
  | { readonly op: "extract"; readonly target: string; readonly name: string };

export interface EditScript {
  readonly version: 1;
  readonly description?: string | undefined;
  readonly ops: readonly EditOp[];
}

export interface EditScriptRequest {
  readonly sourceId?: string | undefined;
  readonly source: string;
  /** The identity the script's ids refer to. A fresh identity is used when omitted. */
  readonly identity?: SyntaxIdentity | undefined;
  /** An edit script, validated by the host. Unknown input is accepted so model output can be passed through. */
  readonly script: EditScript | unknown;
  /** Resolve renames and extracts against the session's sources too. */
  readonly sessionId?: string | undefined;
}

export interface EditScriptError {
  /** Index of the failing operation, or -1 for a malformed script. */
  readonly op: number;
  readonly code: string;
  readonly message: string;
}

export type EditScriptResult =
  | {
      readonly ok: true;
      readonly sourceId: string;
      readonly source: string;
      /** Identity of the new source; moved, wrapped, and renamed nodes keep their ids. */
      readonly identity: SyntaxIdentity;
      readonly changes: {
        readonly added: readonly string[];
        readonly removed: readonly string[];
        readonly moved: readonly string[];
        readonly edited: readonly string[];
      };
      /** Changed top-level forms, before and after, for a preview. */
      readonly forms: readonly {
        readonly id: string;
        readonly before?: string | undefined;
        readonly after?: string | undefined;
      }[];
    }
  | { readonly ok: false; readonly sourceId: string; readonly errors: readonly EditScriptError[] };

export interface DescribeNodesRequest {
  readonly source: string;
  readonly identity: SyntaxIdentity;
  readonly ids: readonly string[];
}

export interface NodeDescription {
  readonly id: string;
  readonly kind: SyntaxNodeKind;
  readonly text: string;
  readonly parent: string | null;
  readonly head?: string | undefined;
  /** Ids from the top-level form down to the parent. */
  readonly path: readonly string[];
  readonly topLevel: { readonly id: string; readonly text: string };
}

export interface DescribeNodesResult {
  readonly nodes: readonly NodeDescription[];
}

/** An outline row: one form, written the way indentation-sensitive Lisp (wisp) writes it. */
export interface OutlineItem {
  readonly id: string;
  readonly text: string;
  readonly children: readonly OutlineItem[];
}

export interface OutlineRowError {
  readonly id: string;
  readonly message: string;
}

export interface SourceToOutlineRequest {
  readonly sourceId?: string | undefined;
  readonly source: string;
  /** Ids for the source; row ids are node ids. A fresh identity is used when omitted. */
  readonly identity?: SyntaxIdentity | undefined;
}

export interface SourceToOutlineResult {
  readonly sourceId: string;
  readonly items: readonly OutlineItem[];
  readonly identity: SyntaxIdentity;
  readonly errors: readonly OutlineRowError[];
}

export interface OutlineToSourceRequest {
  readonly sourceId?: string | undefined;
  readonly items: readonly OutlineItem[];
  /** The source and identity the outline was read from; unchanged rows keep their layout. */
  readonly base?: { readonly source: string; readonly identity: SyntaxIdentity } | undefined;
  /** `"comment"` comments out rows whose text does not read, so the rest still reads. */
  readonly brokenRows?: "verbatim" | "comment" | undefined;
  readonly idPrefix?: string | undefined;
}

export interface OutlineToSourceResult {
  readonly sourceId: string;
  readonly source: string;
  /** Identity of the printed source; each printed row's node has the row's id. */
  readonly identity: SyntaxIdentity;
  readonly rows: readonly { readonly id: string; readonly span: OffsetSpan }[];
  readonly errors: readonly OutlineRowError[];
}

export interface FormSlotsRequest {
  readonly sourceId?: string | undefined;
  readonly source: string;
  readonly identity?: SyntaxIdentity | undefined;
  /** A position inside the form, or inside one of its slots. */
  readonly offset?: number | undefined;
  /** Or the id of the form, or of a node inside it. */
  readonly nodeId?: string | undefined;
  /** Use `define-form`s from the session's loaded sources. */
  readonly sessionId?: string | undefined;
  /** Further sources whose `define-form`s describe forms. */
  readonly descriptorSources?: readonly SourceDocument[] | undefined;
}

/** An edit-script `insert` that fills an identifier or slot. */
export interface SlotInsertion {
  readonly at: EditPlace;
  readonly text: string;
  /** Offset in `text` where the value goes. */
  readonly cursor: number;
}

export interface FormSlotAffordance {
  readonly name: string;
  readonly mode: "value" | "expr" | "form";
  readonly required: boolean;
  readonly many: boolean;
  readonly type?: string | undefined;
  readonly doc?: string | undefined;
  readonly aliases: readonly string[];
  readonly childForm?: string | undefined;
  readonly occurrences: readonly {
    readonly nodeId: string;
    readonly span: Span;
    readonly values: readonly { readonly nodeId: string; readonly span: Span }[];
  }[];
  readonly empty: boolean;
  readonly missing: boolean;
  readonly available: boolean;
  /** Label for an editor placeholder, such as `+ trigger`. */
  readonly placeholder: string;
  readonly insertion: SlotInsertion;
}

export interface FormSlotsResult {
  readonly sourceId: string;
  /** Absent when no descriptor form encloses the position. */
  readonly form?:
    | {
        readonly name: string;
        readonly nodeId: string;
        readonly span: Span;
        readonly phase: "meta" | "domain";
        readonly doc?: string | undefined;
      }
    | undefined;
  readonly identifiers: readonly {
    readonly name: string;
    readonly kind: "Symbol" | "String" | "Value";
    readonly declaration: boolean;
    readonly doc?: string | undefined;
    readonly nodeId?: string | undefined;
    readonly span?: Span | undefined;
    readonly insertion?: SlotInsertion | undefined;
  }[];
  readonly slots: readonly FormSlotAffordance[];
  readonly activeSlot?: string | undefined;
  readonly unknownSlots: readonly { readonly name: string; readonly nodeId: string }[];
}

export interface ModuleGraphRequest { readonly sessionId:string; readonly sourceId:string; readonly source?:string|undefined;
  readonly projects?: readonly {
    readonly id: string;
    readonly base: string;
    readonly prelude?: string;
    readonly modules?: readonly string[];
  }[];
}
export interface ModuleGraphResult { readonly entry:string; readonly interfaces:readonly ModuleInterface[]; readonly diagnostics:readonly Diagnostic[] }
export type ModuleLinkResult = LinkedEffectProgram;

export interface LanguageHost {
  readonly name: string;
  emit?(request: EmitRequest): Promise<import("@formalang/ts/artifact").EmitResult>;
  emitMany?(request: EmitRequest): Promise<ReturnType<typeof import("@formalang/ts/artifact").emitMany>>;
  emitBackends?(): Promise<ReturnType<typeof import("@formalang/ts/artifact").emitBackends>>;
  artifactSummary?(request: EmitRequest): Promise<ReturnType<typeof import("@formalang/ts/artifact").artifactSummary>>;
  version(): Promise<VersionResult>;
  openSession(request?: OpenSessionRequest): Promise<OpenSessionResult>;
  configureSession(request: ConfigureSessionRequest): Promise<ConfigureSessionResult>;
  loadSource(request: LoadSourceRequest): Promise<LoadSourceResult>;
  loadSourceBundle(request: LoadSourceBundleRequest): Promise<LoadSourceBundleResult>;
  moduleGraph(request:ModuleGraphRequest):Promise<ModuleGraphResult>;
  linkEffectModules(request:ModuleGraphRequest):Promise<ModuleLinkResult>;
  parse(request: ParseRequest): Promise<ParseResult>;
  expand(request: ExpandRequest): Promise<ExpandResult>;
  typecheck(request: TypecheckRequest): Promise<TypecheckResult>;
  evaluate(request: EvaluateRequest): Promise<EvaluationResult>;
  evaluateInSession(request: EvaluateInSessionRequest): Promise<EvaluationState>;
  /** Atomically typecheck and evaluate, retaining bindings and types on success. */
  replSubmit?(request: EvaluateInSessionRequest & { readonly source: string }): Promise<EvaluationState>;
  callValue(request: CallValueRequest): Promise<EvaluationState>;
  resumeHostCall(request: ResumeHostCallRequest): Promise<EvaluationState>;
  abortEvaluation(request: AbortEvaluationRequest): Promise<AbortEvaluationResult>;
  projectValue(request: ProjectValueRequest): Promise<ProjectValueResult>;
  releaseValue(request: ReleaseValueRequest): Promise<ReleaseValueResult>;
  sessionInfo(request: SessionInfoRequest): Promise<SessionInfoResult>;
  resetSession(request: ResetSessionRequest): Promise<ResetSessionResult>;
  closeSession(request: CloseSessionRequest): Promise<CloseSessionResult>;
  analyzeEditor?(request: EditorAnalysisRequest): Promise<EditorAnalysisResult>;
  identifySyntax?(request: SyntaxIdentityRequest): Promise<SyntaxIdentityResult>;
  symbolIndex?(request: SymbolIndexRequest): Promise<SymbolIndexResult>;
  findReferences?(request: FindReferencesRequest): Promise<FindReferencesResult>;
  applyEditScript?(request: EditScriptRequest): Promise<EditScriptResult>;
  describeNodes?(request: DescribeNodesRequest): Promise<DescribeNodesResult>;
  /** The edit-script contract as a JSON Schema document, for structured model output. */
  editScriptSchema?(): Promise<unknown>;
  sourceToOutline?(request: SourceToOutlineRequest): Promise<SourceToOutlineResult>;
  outlineToSource?(request: OutlineToSourceRequest): Promise<OutlineToSourceResult>;
  formSlots?(request: FormSlotsRequest): Promise<FormSlotsResult>;
}


/** Session artifact operations; canonical IR is the only implemented backend. */
export interface EmitRequest {
  readonly sessionId: string;
  readonly sourceId?: string;
  readonly sourceIds?: readonly string[];
  readonly backend?: string;
}
