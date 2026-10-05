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
  | ({ readonly kind: "int" | "float"; readonly value: number } & RetainedValueProjection)
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
}

export interface EditorAnalysisResult {
  readonly sourceId: string;
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
  readonly sourceLoadSemantics?: "parse-and-store" | "apply-declarations" | "unsupported";
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
  readonly sessionId: string;
}

export interface LoadSourceResult {
  readonly sourceId: string;
  readonly formCount: number;
  readonly diagnostics: readonly Diagnostic[];
}

export interface LoadSourceBundleRequest {
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

export interface LanguageHost {
  readonly name: string;
  version(): Promise<VersionResult>;
  openSession(request?: OpenSessionRequest): Promise<OpenSessionResult>;
  configureSession(request: ConfigureSessionRequest): Promise<ConfigureSessionResult>;
  loadSource(request: LoadSourceRequest): Promise<LoadSourceResult>;
  loadSourceBundle(request: LoadSourceBundleRequest): Promise<LoadSourceBundleResult>;
  parse(request: ParseRequest): Promise<ParseResult>;
  expand(request: ExpandRequest): Promise<ExpandResult>;
  typecheck(request: TypecheckRequest): Promise<TypecheckResult>;
  evaluate(request: EvaluateRequest): Promise<EvaluationResult>;
  evaluateInSession(request: EvaluateInSessionRequest): Promise<EvaluationState>;
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
}
