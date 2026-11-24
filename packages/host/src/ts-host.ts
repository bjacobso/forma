import { describeForm, describeBinding, referenceEntries, type LanguageDescription } from "./description.js";
import { HOST_ABI_VERSION, HOST_CAPABILITIES } from "./host-contract.js";
import * as Artifact from "@formalang/ts/artifact";
import * as Modules from "@formalang/ts/modules";
import { Effect, Ref } from "effect";
import * as Builtins from "@formalang/ts/builtins";
import { diagnosticLocator, spanLocator, KernelTypeError, type KernelError } from "@formalang/ts/diagnostic";
import { Env } from "@formalang/ts/env";
import * as Evaluator from "@formalang/ts/evaluator";
import type { BuiltinFn, KFn, KValue } from "@formalang/ts/evaluator";
import * as Expander from "@formalang/ts/expander";
import * as Lsp from "@formalang/ts/lsp";
import * as Reader from "@formalang/ts/reader";
import * as Editor from "@formalang/ts/editor";
import * as Engine from "@formalang/ts/engine";
import * as LanguageSession from "@formalang/ts/session";
import * as Syntax from "@formalang/ts/syntax";
import * as VM from "@formalang/ts/vm";

import { typeProjection } from "./abi-projections.js";
import {
  JOURNAL_FORMAT,
  JournalRuntime,
  journalArgsFromProjections,
  validateReplayHeader,
  valueProjectionFromJournal,
  type JournalHeader,
  type JournalRequest,
  type OnJournalEntryCallback,
} from "./journal.js";
import { floatProjectionValue, keyStringFromProjection, projectInlineValue } from "./value-projections.js";
import type {
  AbortEvaluationRequest,
  AbortEvaluationResult,
  CallValueRequest,
  CapabilityManifest,
  CheckedRunGrant,
  CheckedRunRequest,
  CheckedRunState,
  CloseSessionRequest,
  CloseSessionResult,
  ConfigureSessionRequest,
  ConfigureSessionResult,
  DescribeNodesRequest,
  DescribeNodesResult,
  Diagnostic,
  EditorAnalysisRequest,
  EditorAnalysisResult,
  EditScriptRequest,
  EditScriptResult,
  ExpandRequest,
  ExpandResult,
  FindReferencesRequest,
  FindReferencesResult,
  FormSlotsRequest,
  FormSlotsResult,
  EvaluateInSessionRequest,
  EvaluateRequest,
  EvaluationResult,
  EvaluationState,
  ExpressionObservation,
  HostCall,
  HostCallResumeResult,
  HostBuiltinDescriptor,
  LanguageHost,
  ModuleGraphRequest,
  ModuleGraphResult,
  ModuleLinkResult,
  LoadSourceBundleRequest,
  LoadSourceBundleResult,
  LoadSourceRequest,
  LoadSourceResult,
  OpenSessionRequest,
  ObservationRequest,
  ObservationResult,
  OpenSessionResult,
  OutlineToSourceRequest,
  OutlineToSourceResult,
  ParseRequest,
  ParseResult,
  ProjectValueRequest,
  ProjectValueResult,
  ReleaseValueRequest,
  ReleaseValueResult,
  ResetSessionRequest,
  ResetSessionResult,
  ResumeHostCallRequest,
  SessionInfoRequest,
  SessionInfoResult,
  SourceToOutlineRequest,
  SourceToOutlineResult,
  Span,
  SymbolDefinition,
  SymbolIndexRequest,
  SymbolIndexResult,
  SymbolReference,
  SyntaxIdentityRequest,
  SyntaxIdentityResult,
  TypePolicy,
  TypeSchemeExpr,
  TypecheckRequest,
  TypecheckResult,
  ValueProjection,
  VersionResult,
  SyntaxTreeProjection,
} from "./types.js";

const DEFAULT_STEP_LIMIT = 50_000;
const DEFAULT_MAX_HOST_CALLS = 1_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_EXPANSION_STEPS = 10_000;
const DEFAULT_MAX_RESULT_BYTES = 1_048_576;

interface TsSession {
  readonly sessionId: string;
  readonly language: LanguageSession.LanguageSession;
  readonly valueRefs: Map<string, TsRetainedValue>;
  defaultStepLimit: number;
  hostBuiltins: readonly HostBuiltinDescriptor[];
  typePolicy?: TypePolicy | undefined;
  readonly evaluations: Map<string, TsPendingEvaluation>;
}

interface TsRetainedValue {
  readonly value: KValue;
  readonly apply?: ((args: readonly KValue[]) => Effect.Effect<KValue, KernelError>) | undefined;
  readonly invoke?: ((request: CallValueRequest) => Promise<EvaluationState>) | undefined;
}

interface TsPendingHostCall {
  readonly call: HostCall;
  readonly resume: (result: HostCallResumeResult) => void;
}

interface CheckedRunContext {
  readonly grants: ReadonlyMap<string, { readonly name: string; readonly mode: "ask" | "allow"; readonly maxCalls?: number | undefined }>;
  readonly maxHostCalls?: number | undefined;
  readonly type: string;
  readonly manifest: CapabilityManifest;
  hostCalls: number;
  readonly callCounts: Map<string, number>;
}

interface JournalParentContext {
  readonly runtime: JournalRuntime;
  readonly evaluationPath: readonly number[];
  readonly nextChild: () => number;
}

interface TsPendingEvaluation {
  readonly session: TsSession;
  readonly evaluationId: string;
  readonly sourceId: string;
  readonly sourceText?: string | undefined;
  readonly checkedRun?: CheckedRunContext | undefined;
  readonly journalRuntime?: JournalRuntime | undefined;
  readonly evaluationPath: readonly number[];
  nextChildIndex: number;
  deadlineMs?: number | undefined;
  timeoutMs?: number | undefined;
  pausedAtMs?: number | undefined;
  completed: boolean;
  aborted: boolean;
  abortReason?: string | undefined;
  pendingCall?: TsPendingHostCall | undefined;
  readonly callQueue: HostCall[];
  readonly callWaiters: ((call: HostCall) => void)[];
  readonly completion: Promise<EvaluationState | CheckedRunState>;
}



/** Map keys keep their kind: keyword, symbol, or string. */
function mapKeyProjection(key: string): ValueProjection {
  const value = Evaluator.mapKeyValue(key);
  if (Evaluator.isKKeyword(value)) return { kind: "keyword", value: value.name };
  if (Evaluator.isKSymbol(value)) return { kind: "symbol", value: value.name };
  return { kind: "string", value: String(value) };
}

function valueProjection(value: KValue): ValueProjection {
  if (Evaluator.isKKeyword(value)) return {kind:"keyword",value:value.name};
  if (Evaluator.isKSymbol(value)) return {kind:"symbol",value:value.name};
  if (value === null) return { kind: "nil" };
  if (typeof value === "boolean") return { kind: "bool", value };
  if (Evaluator.isKFloat(value)) return { kind: "float", value: floatProjectionValue(value.value) };
  if (typeof value === "number") return { kind: "int", value };
  if (typeof value === "string") return { kind: "string", value };
  if (Array.isArray(value)) return { kind: "list", items: value.map(valueProjection) };
  if (Evaluator.isKMap(value)) {
    return {
      kind: "map",
      entries: [...value.entries()].map(([key, nested]) => ({
        key: mapKeyProjection(key),
        value: valueProjection(nested),
      })),
    };
  }
  if (Evaluator.isKFn(value)) {
    return { kind: "function", valueRef: "ts:function", display: Evaluator.printKValue(value) };
  }
  if (Evaluator.isKSExpr(value)) {
    return { kind: "opaque", tag: "sexpr", display: Evaluator.printKValue(value) };
  }
  if (Evaluator.isKMacro(value)) {
    return { kind: "opaque", tag: "macro", display: value.name };
  }
  if (Evaluator.isKMeta(value)) {
    return { kind: "opaque", tag: "meta", display: Evaluator.printKValue(value) };
  }
  return { kind: "opaque", tag: "unknown", display: String(value) };
}

type ObservationLimits = ObservationResult["limits"];

function observationLimits(request: ObservationRequest): ObservationLimits {
  return {
    maxRecords: request.maxRecords ?? Evaluator.DEFAULT_MAX_OBSERVATION_RECORDS,
    maxItems: request.maxItems ?? 20,
    maxDepth: request.maxDepth ?? 4,
    maxStringLength: request.maxStringLength ?? 500,
  };
}

function engineObservation(request: ObservationRequest): Evaluator.ObservationOptions {
  return {
    ...(request.identity ? { identity: request.identity } : {}),
    ...(request.maxRecords !== undefined ? { maxRecords: request.maxRecords } : {}),
  };
}

function truncatedMarker(display: string): ValueProjection {
  return { kind: "opaque", tag: "truncated", display };
}

function truncateString(value: string, limits: ObservationLimits): string {
  return value.length > limits.maxStringLength
    ? `${value.slice(0, limits.maxStringLength)}…`
    : value;
}

/** Project a value within observation limits. */
function boundedValueProjection(
  value: KValue,
  limits: ObservationLimits,
  depth = 0,
): ValueProjection {
  if (typeof value === "string") return { kind: "string", value: truncateString(value, limits) };
  if (Array.isArray(value) || Evaluator.isKMap(value)) {
    if (depth >= limits.maxDepth) {
      return truncatedMarker(truncateString(Evaluator.printKValue(value), limits));
    }
    if (Array.isArray(value)) {
      const items = value
        .slice(0, limits.maxItems)
        .map((item) => boundedValueProjection(item, limits, depth + 1));
      if (value.length > limits.maxItems) {
        items.push(truncatedMarker(`… ${value.length - limits.maxItems} more`));
      }
      return { kind: "list", items };
    }
    const entries = [...value.entries()];
    const shown = entries.slice(0, limits.maxItems).map(([key, nested]) => ({
      key: mapKeyProjection(key),
      value: boundedValueProjection(nested, limits, depth + 1),
    }));
    if (entries.length > limits.maxItems) {
      const more = entries.length - limits.maxItems;
      shown.push({ key: truncatedMarker("…"), value: truncatedMarker(`… ${more} more`) });
    }
    return { kind: "map", entries: shown };
  }
  const projected = valueProjection(value);
  if ("display" in projected && projected.display !== undefined) {
    return { ...projected, display: truncateString(projected.display, limits) };
  }
  return projected;
}

export class TsLanguageHost implements LanguageHost {
  readonly name = "ts";
  #nextSessionId = 1;
  #nextEvaluationId = 1;
  #nextCallId = 1;
  #nextValueRefId = 1;
  readonly #sessions = new Map<string, TsSession>();

  async loadSource(request: LoadSourceRequest): Promise<LoadSourceResult> {
    return this.#locateResult(await this.#loadSourceUnlocated(request), request);
  }

  async loadSourceBundle(request: LoadSourceBundleRequest): Promise<LoadSourceBundleResult> {
    return this.#locateResult(await this.#loadSourceBundleUnlocated(request), request);
  }

  async evaluate(request: EvaluateRequest): Promise<EvaluationResult> {
    return this.#locateResult(await this.#evaluateUnlocated(request), request);
  }

  async evaluateInSession(request: EvaluateInSessionRequest): Promise<EvaluationState> {
    return this.#locateResult(await this.#evaluateInSessionUnlocated(request), { ...request, sourceId: request.sourceId ?? "session" });
  }

  async checkedRun(request: CheckedRunRequest): Promise<CheckedRunState> {
    return this.#locateResult(await this.#checkedRunUnlocated(request), { ...request, sourceId: request.sourceId ?? "checked-run" });
  }

  async replSubmit(request: EvaluateInSessionRequest & { readonly source: string }): Promise<EvaluationState> {
    return this.#locateResult(await this.#replSubmitUnlocated(request), request);
  }

  async analyzeEditor(request: EditorAnalysisRequest): Promise<EditorAnalysisResult> {
    return this.#locateResult(await this.#analyzeEditorUnlocated(request), request);
  }

  /** Project host-created diagnostics before they leave the in-process API. */
  #locateResult<R>(result: R, request: { readonly source?: string | undefined; readonly sourceId?: string | undefined; readonly sessionId?: string | undefined; readonly sources?: readonly { readonly sourceId: string; readonly source: string }[] | undefined }): R {
    const locate = diagnosticLocator(id =>
      (id === (request.sourceId ?? "source") ? request.source : undefined) ??
      request.sources?.find(source => source.sourceId === id)?.source ??
      (request.sessionId ? this.sessionSourceText(request.sessionId, id) : undefined));
    const visit = (value: unknown): unknown => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const record = value as Record<string, unknown>;
      const projected = { ...record };
      for (const key of ["diagnostics", "errors"]) {
        if (Array.isArray(record[key])) projected[key] = record[key].map(diagnostic => locate(diagnostic));
      }
      for (const key of ["result", "observations", "parse"]) if (record[key]) projected[key] = visit(record[key]);
      if (Array.isArray(record.records)) projected.records = record.records.map(visit);
      if (record.failure) projected.failure = locate(record.failure as Diagnostic);
      return projected;
    };
    return visit(result) as R;
  }

  async moduleGraph(request: ModuleGraphRequest): Promise<ModuleGraphResult> {
    return this.#locateResult(await this.#moduleGraphUnlocated(request), request);
  }

  async linkEffectModules(request: ModuleGraphRequest): Promise<ModuleLinkResult> {
    return this.#locateResult(await this.#linkEffectModulesUnlocated(request), request);
  }

  async version(): Promise<VersionResult> {
    return {
      engine: "forma-typescript",
      engineVersion: Engine.engineVersion,
      hostAbiVersion: HOST_ABI_VERSION,
      sourceLoadSemantics: "validate-and-store",
      capabilities: [...HOST_CAPABILITIES],
    };
  }

  async openSession(request: OpenSessionRequest = {}): Promise<OpenSessionResult> {
    const sessionId = `ts-session-${this.#nextSessionId++}`;
    this.#sessions.set(sessionId, {
      sessionId,
      language: LanguageSession.openSession({ id: sessionId }),
      valueRefs: new Map(),
      defaultStepLimit: request.defaultStepLimit ?? DEFAULT_STEP_LIMIT,
      hostBuiltins: [],
      evaluations: new Map(),
    });
    return { sessionId };
  }

  async configureSession(request: ConfigureSessionRequest): Promise<ConfigureSessionResult> {
    const session = this.#requireSession(request.sessionId);
    if (request.projects) session.language.projects = request.projects;
    if (request.packages) session.language.packages = request.packages;
    if (request.variables) {
      session.language.configurationEnv = session.language.configurationEnv.extend(
        variablesToBindings(request.variables),
      );
      session.language.env = (
        await Effect.runPromise(
          Evaluator.evaluateExprs(session.language.coreExpressions(), {
            env: session.language.configurationEnv,
            builtins: Builtins.defaultBuiltins,
            stepLimit: session.defaultStepLimit,
          }),
        )
      ).env;
    }
    if (request.hostBuiltins) {
      session.hostBuiltins = request.hostBuiltins;
    }
    if (request.typePolicy) {
      session.typePolicy = request.typePolicy;
    }
    return {
      sessionId: session.sessionId,
      bindingCount: request.variables?.length ?? 0,
      builtinCount: session.hostBuiltins.length,
    };
  }

  async #loadSourceUnlocated(request: LoadSourceRequest): Promise<LoadSourceResult> {
    const session = this.#requireSession(request.sessionId);
    const kind = request.kind === "prelude" ? "prelude" : "source";
    const sourceId =
      kind === "source" ? Modules.normalizeModuleId(request.sourceId) : request.sourceId;
    const timings: { -readonly [K in keyof import("./types.js").LoadPhaseTimings]: import("./types.js").LoadPhaseTimings[K] } = {};
    const parseStart = performance.now();
    const parsed = Engine.parseSource({ sourceId, source: request.source });
    timings.parseMs = performance.now() - parseStart;
    const timingResult = () => request.timings ? { timings: { ...timings } } : {};
    if (parsed.diagnostics.some((d) => d.severity === "error"))
      return { ...timingResult(), sourceId, formCount: parsed.ast.length, diagnostics: parsed.diagnostics };
    if (kind === "source") {
      const validation = Engine.validateSourceLoad(session.language, sourceId, parsed.exprs, request.source);
      if (validation.diagnostics.some(d => d.severity === "error"))
        return { ...timingResult(), sourceId, formCount: parsed.ast.length, diagnostics: validation.diagnostics };
    } else {
      const surfaceErrors = parsed.exprs.flatMap(expr => Engine.validateSurface(sourceId, expr));
      if (surfaceErrors.length) return { ...timingResult(), sourceId, formCount: parsed.ast.length, diagnostics: surfaceErrors };
      const sources = session.language.orderedSources("prelude").map(s => ({
        sourceId: s.id, text: s.id === sourceId ? request.source : s.text,
      }));
      if (!sources.some(s => s.sourceId === sourceId)) sources.push({ sourceId, text: request.source });
      const typecheckStart = performance.now();
      const checked = Engine.validatePreludeTypes(sources, session, session.language.configurationEnv);
      timings.typecheckMs = performance.now() - typecheckStart;
      if (checked.diagnostics.some(d => d.severity === "error"))
        return { ...timingResult(), sourceId, formCount: parsed.ast.length, diagnostics: checked.diagnostics };
      // A detached candidate keeps failed evaluation/type/metacheck loads atomic,
      // including source order, fingerprints and the inferred scope.
      const candidate = LanguageSession.openSession({ id: session.sessionId });
      for (const source of sources) {
        candidate.rememberSource({ id: source.sourceId, text: source.text, kind: "prelude" });
        candidate.rememberParsedSource("prelude", source.sourceId,
          source.sourceId === sourceId ? parsed.exprs : session.language.parsedPreludes.get(source.sourceId)!);
      }
      const evalStart = performance.now();
      try {
        const evaluated = await Effect.runPromise(Evaluator.evaluateExprs(candidate.coreExpressions(), {
          env: session.language.configurationEnv, builtins: Builtins.defaultBuiltins,
          stepLimit: session.defaultStepLimit,
        }));
        timings.evalMs = performance.now() - evalStart;
        const metacheckStart = performance.now();
        const diagnostics = Engine.validatePreludeMetacheck(evaluated.env,
          sources.map(source => ({ sourceId: source.sourceId, source: source.text,
            expressions: candidate.parsedPreludes.get(source.sourceId)! })), checked.scope!.prelude!);
        timings.metacheckMs = performance.now() - metacheckStart;
        if (diagnostics.some(d => d.severity === "error")) return { ...timingResult(), sourceId, formCount: parsed.ast.length, diagnostics };
        // Evaluation drops macro definitions; keep the prelude's macros so session
        // evaluation, expansion and REPL submissions expand them as typechecking does.
        let env = evaluated.env;
        const macros = checked.scope!.macroEnv;
        for (const name of macros?.bindingNames() ?? []) {
          const value = macros!.lookup(name);
          if (value !== undefined && Evaluator.isKMacro(value) && !env.has(name)) env = env.bind(name, value);
        }
        session.language.env = env;
        session.language.scope = checked.scope!;
      } catch (error) {
        timings.evalMs ??= performance.now() - evalStart;
        return { ...timingResult(), sourceId, formCount: parsed.ast.length, diagnostics: [diagnosticLocator(id => id === sourceId ? request.source : session.language.sourceText(id))(Engine.diagnosticFromUnknown(error, "evaluate", sourceId))] };
      }
    }
    const storeStart = performance.now();
    session.language.rememberSource({ id: sourceId, text: request.source, kind });
    session.language.rememberParsedSource(kind, sourceId, parsed.exprs);
    timings.storeMs = performance.now() - storeStart;
    return { ...timingResult(), sourceId, formCount: parsed.ast.length, diagnostics: parsed.diagnostics };
  }

  async #loadSourceBundleUnlocated(request: LoadSourceBundleRequest): Promise<LoadSourceBundleResult> {
    const sources: LoadSourceResult[] = [];
    for (const source of request.sources) {
      sources.push(await this.loadSource({ ...source, sessionId: request.sessionId, timings: request.timings }));
    }
    return {
      sources,
      diagnostics: sources.flatMap((source) => source.diagnostics),
    };
  }

  #moduleGraph(request: ModuleGraphRequest): Modules.ModuleGraph {
    const session = this.#requireSession(request.sessionId);
    const source =
      request.source ?? session.language.sourceText(Modules.normalizeModuleId(request.sourceId));
    if (source === undefined) throw new Error(`Unknown module ${request.sourceId}`);
    return Modules.resolveModuleGraph(
      { id: request.sourceId, source },
      Modules.sourceModuleResolver(
        session.language.orderedSources("source").map((s) => ({ id: s.id, source: s.text })),
      ),
      { ...Engine.moduleCoreOptions(session.language), ...(request.projects ? { projects: request.projects } : {}) },
    );
  }
  async #moduleGraphUnlocated(request: ModuleGraphRequest): Promise<ModuleGraphResult> {
    try {
      const graph = this.#moduleGraph(request),
        session = this.#requireSession(request.sessionId),
        checked = Modules.checkModuleGraph(
          graph,
          Engine.moduleCheckOptions({
            session: session.language,
            source: request.source ?? "",
            hostBuiltins: session.hostBuiltins,
            typePolicy: session.typePolicy,
          }),
        );
      return {
        entry: graph.entry,
        interfaces: checked.interfaces,
        diagnostics: checked.diagnostics,
      };
    } catch (error) {
      return {
        entry: request.sourceId,
        interfaces: [],
        diagnostics: error instanceof Modules.ModuleError
          ? [...error.diagnostics]
          : [Engine.diagnosticFromUnknown(error, "typecheck", request.sourceId)],
      };
    }
  }
  async #linkEffectModulesUnlocated(request: ModuleGraphRequest): Promise<ModuleLinkResult> {
    try {
      return Modules.linkEffectModules(this.#moduleGraph(request));
    } catch (error) {
      return {
        ok: false,
        entry: request.sourceId,
        interfaces: [],
        declarations: [],
        modules: [],
        diagnostics: error instanceof Modules.ModuleError
          ? [...error.diagnostics]
          : [Engine.diagnosticFromUnknown(error, "emit", request.sourceId)],
      };
    }
  }

  async emit(request: import("./types.js").EmitRequest): Promise<Artifact.EmitResult> {
    return Artifact.emit({ ...request, session: this.#requireSession(request.sessionId).language });
  }
  async emitMany(request: import("./types.js").EmitRequest): Promise<ReturnType<typeof Artifact.emitMany>> {
    return Artifact.emitMany({ ...request, session: this.#requireSession(request.sessionId).language });
  }
  async emitBackends(): Promise<ReturnType<typeof Artifact.emitBackends>> { return Artifact.emitBackends(); }
  async artifactSummary(request: import("./types.js").EmitRequest): Promise<ReturnType<typeof Artifact.artifactSummary>> {
    return Artifact.artifactSummary({ ...request, session: this.#requireSession(request.sessionId).language });
  }

  async parse(request: ParseRequest): Promise<ParseResult> {
    return this.parseSync(request);
  }

  parseSync(request: ParseRequest): ParseResult {
    return Engine.parse(request);
  }

  async expand(request: ExpandRequest): Promise<ExpandResult> {
    const session = request.sessionId ? this.#requireSession(request.sessionId) : undefined;
    return Engine.expand({ ...request, session: session?.language });
  }

  async typecheck(request: TypecheckRequest): Promise<TypecheckResult> {
    return this.typecheckSync(request);
  }

  typecheckSync(request: TypecheckRequest): TypecheckResult {
    const session = request.sessionId ? this.#requireSession(request.sessionId) : undefined;
    const effectiveBuiltins = request.hostBuiltins ?? session?.hostBuiltins ?? [];
    const result = Engine.typecheck({
      ...request,
      session: session?.language,
      hostBuiltins: request.hostBuiltins ?? session?.hostBuiltins,
      typePolicy: request.typePolicy ?? session?.typePolicy,
    });
    const sourceId = request.sourceId ?? (!request.source && session?.language.orderedSources("source").length === 1
      ? session.language.orderedSources("source")[0]!.id : "source");
    const source = request.source ?? (request.sourceId !== undefined
      ? session?.language.sourceText(Modules.normalizeModuleId(request.sourceId)) ?? session?.language.sourceText(request.sourceId)
      : session?.language.orderedSources("source").length === 1 ? session.language.orderedSources("source")[0]?.text : undefined);
    const manifest = source !== undefined
      ? this.#buildManifest(session, sourceId, source, effectiveBuiltins).manifest
      : undefined;
    return manifest ? { ...result, manifest } : result;
  }

  /** Debug operations share the session's host type configuration. */
  async debugCore(request: TypecheckRequest, mode: "lowerCore" | "typecheckCore" | "typecheckCoreTyped"): Promise<Engine.CoreDebugResult> {
    const session = request.sessionId ? this.#requireSession(request.sessionId) : undefined;
    const source = request.source ?? (request.sourceId ? session?.language.sourceText(request.sourceId) : undefined);
    if (source === undefined) return {sourceId:request.sourceId ?? "source", diagnostics:[{code:"abi/missing-source", severity:"error", message:"Debug operations require a source or a loaded session source."}]};
    return Engine.debugCore({...request, source, session:session?.language, hostBuiltins:request.hostBuiltins ?? session?.hostBuiltins, typePolicy:request.typePolicy ?? session?.typePolicy}, mode);
  }

  async #evaluateUnlocated(request: EvaluateRequest): Promise<EvaluationResult> {
    const sourceId = request.sourceId ?? "source";
    const result = await Engine.evaluate({
      sourceId,
      source: request.source,
      stepLimit: request.stepLimit ?? DEFAULT_STEP_LIMIT,
      ...(request.variables ? { env: Env.from(variablesToBindings(request.variables)) } : {}),
      ...(request.observe ? { observe: engineObservation(request.observe) } : {}),
    });
    const observations = this.#observations(undefined, sourceId, request, result, undefined);
    if (result.diagnostics.length > 0) {
      return {
        value: { kind: "nil" },
        diagnostics: result.diagnostics,
        ...(observations ? { observations } : {}),
      };
    }
    return {
      value: valueProjection(result.value),
      printed: result.printed,
      steps: result.steps,
      diagnostics: [],
      ...(observations ? { observations } : {}),
    };
  }

  async #evaluateInSessionUnlocated(request: EvaluateInSessionRequest): Promise<EvaluationState> {
    const session = this.#requireSession(request.sessionId);
    const sourceId = request.sourceId ?? (!request.source && session.language.orderedSources("source").length === 1
      ? session.language.orderedSources("source")[0]!.id : "session");
    const source =
      request.source ??
      (request.sourceId !== undefined
        ? session.language.sourceText(Modules.normalizeModuleId(request.sourceId))
        : session.language.orderedSources("source").length === 1 ? session.language.orderedSources("source")[0]?.text : undefined);
    if (source === undefined) {
      return {
        status: "failed",
        diagnostics: [
          {
            code: "session/source-not-found",
            severity: "error",
            message: `No loaded source found for ${request.sourceId ?? "session"}`,
            phase: "evaluate",
          },
        ],
      };
    }
    const env = request.variables
      ? session.language.env.extend(variablesToBindings(request.variables))
      : session.language.env;
    if (
      session.hostBuiltins.length > 0 ||
      request.evaluationId !== undefined ||
      request.timeoutMs !== undefined ||
      request.maxExpansionSteps !== undefined ||
      request.maxResultBytes !== undefined ||
      request.journal !== undefined
    ) {
      return this.#evaluateInSessionWithHostBuiltins(session, {...request,sourceId}, source, env);
    }

    const result = await Engine.evaluateInSession({
      session: session.language,
      sourceId,
      source,
      env,
      stepLimit: request.stepLimit ?? session.defaultStepLimit,
      ...(request.observe ? { observe: engineObservation(request.observe) } : {}),
    });
    const observations = this.#observations(
      session,
      sourceId,
      request,
      result,
      request.retainValues,
    );
    if (result.diagnostics.length > 0) {
      return {
        status: "failed",
        diagnostics: result.diagnostics,
        ...(observations ? { observations } : {}),
      };
    }
    return {
      status: "completed",
      result: {
        value: this.#projectValue(session, result.value, request.retainValues),
        printed: result.printed,
        steps: result.steps,
        diagnostics: [],
        ...(observations ? { observations } : {}),
      },
    };
  }

  async #replSubmitUnlocated(request: EvaluateInSessionRequest & { readonly source: string }): Promise<EvaluationState> {
    const session = this.#requireSession(request.sessionId);
    const sourceId = request.sourceId ?? `repl-${this.#nextEvaluationId++}`;
    const parsed = Engine.parseSource({ sourceId, source: request.source });
    if (parsed.diagnostics.some(d => d.severity === "error")) return { status: "failed", diagnostics: parsed.diagnostics };
    const checked = Engine.checkReplSubmission(session.language, sourceId, request.source, session);
    if (checked.diagnostics.some(d => d.severity === "error")) return { status: "failed", diagnostics: checked.diagnostics };
    const commit = (env: Env) => {
      session.language.env = env;
      session.language.scope = { ...session.language.scope, typeEnv: checked.typeEnv, inferenceState: checked.inferenceState };
      session.language.rememberSource({ id: sourceId, text: request.source });
      session.language.rememberParsedSource("source", sourceId, parsed.exprs);
    };
    const type = typeProjection(checked.display);
    if (session.hostBuiltins.length || request.journal !== undefined) return this.#evaluateInSessionWithHostBuiltins(session,
      { ...request, sourceId }, request.source, session.language.env, { commit, type });
    const result = await Engine.evaluateInSession({ session: session.language, sourceId,
      source: request.source, env: session.language.env, stepLimit: request.stepLimit ?? session.defaultStepLimit,
      ...(request.observe ? { observe: engineObservation(request.observe) } : {}) });
    if (result.diagnostics.length) return { status: "failed", diagnostics: result.diagnostics };
    commit(result.env!);
    return { status: "completed", result: { value: this.#projectValue(session, result.value, request.retainValues),
      printed: result.printed, steps: result.steps, type, diagnostics: checked.diagnostics,
      ...(request.observe ? { observations: this.#observations(session, sourceId, request, result, request.retainValues) } : {}) } };
  }

  #observations(
    session: TsSession | undefined,
    sourceId: string,
    request: { readonly observe?: ObservationRequest | undefined },
    result: Pick<Engine.EvaluateResult, "observations">,
    retainValues: EvaluateInSessionRequest["retainValues"] | undefined,
  ): ObservationResult | undefined {
    if (!request.observe || !result.observations) return undefined;
    const limits = observationLimits(request.observe);
    return {
      records: result.observations.records.map((record): ExpressionObservation => {
        let value: ValueProjection | undefined;
        if (record.count > 0) {
          value = boundedValueProjection(record.value, limits);
          const retain =
            session !== undefined &&
            (retainValues === "all" ||
              (retainValues === "functions" && Evaluator.isKFn(record.value)));
          if (retain) {
            value = {
              ...value,
              valueRef: this.#retainValue(
                session,
                record.value,
                undefined,
                this.#callableValueInvoker(session, record.value),
              ),
            } as ValueProjection;
          }
        }
        return {
          nodeId: record.nodeId,
          span: { sourceId, startOffset: record.span.start, endOffset: record.span.end },
          count: record.count,
          ...(value ? { value } : {}),
          ...(record.failure ? { failure: record.failure } : {}),
        };
      }),
      truncated: result.observations.truncated,
      limits,
    };
  }

  async callValue(request: CallValueRequest): Promise<EvaluationState> {
    const session = this.#requireSession(request.sessionId);
    const retained = session.valueRefs.get(request.valueRef);
    if (!retained) {
      return failedEvaluation("value-ref/not-found", "No retained TS value found to call");
    }
    if (retained.invoke) {
      return retained.invoke(request);
    }
    if (!retained.apply) {
      return failedEvaluation(
        "value-ref/unsupported",
        "Retained TS value does not have a callable continuation",
      );
    }
    try {
      const value = await Effect.runPromise(
        Evaluator.withGensymScope(
          retained.apply(request.args.map((arg) => kValueFromProjection(arg, session))),
        ),
      );
      return {
        status: "completed",
        result: {
          value: this.#projectValue(session, value, request.retainValues),
          printed: Evaluator.printKValue(value),
          diagnostics: [],
        },
      };
    } catch (error) {
      return {
        status: "failed",
        diagnostics: [diagnosticLocator(id => session.language.sourceText(id))(Engine.diagnosticFromUnknown(error, "evaluate", "value-ref"))],
      };
    }
  }

  async resumeHostCall(request: ResumeHostCallRequest): Promise<EvaluationState> {
    const session = this.#requireSession(request.sessionId);
    const evaluation = session.evaluations.get(request.evaluationId);
    if (!evaluation || evaluation.completed) {
      return failedEvaluation("evaluation/not-found", "No retained TS evaluation found to resume");
    }
    const pendingCall = evaluation.pendingCall;
    if (!pendingCall || pendingCall.call.callId !== request.callId) {
      return failedEvaluation("host-effect/call-not-found", "No matching retained host call found");
    }
    evaluation.pendingCall = undefined;
    pendingCall.resume(request.result);
    return (await this.#nextEvaluationState(evaluation)) as EvaluationState;
  }

  async abortEvaluation(request: AbortEvaluationRequest): Promise<AbortEvaluationResult> {
    const session = this.#requireSession(request.sessionId);
    const evaluation = session.evaluations.get(request.evaluationId);
    if (evaluation && !evaluation.completed) {
      evaluation.aborted = true;
      evaluation.abortReason = request.reason ?? "Evaluation aborted";
      evaluation.pendingCall?.resume({
        ok: false,
        diagnostics: [
          {
            code: "evaluation/aborted",
            severity: "error",
            message: evaluation.abortReason,
            phase: "evaluate",
          },
        ],
      });
      session.evaluations.delete(request.evaluationId);
    }
    return { evaluationId: request.evaluationId, aborted: true };
  }

  async projectValue(request: ProjectValueRequest): Promise<ProjectValueResult> {
    if (request.valueRef) {
      if (!request.sessionId) {
        return {
          value: { kind: "nil" },
          diagnostics: [
            {
              code: "session/required",
              severity: "error",
              message: "Projecting a retained TS value requires a sessionId",
              phase: "evaluate",
            },
          ],
        };
      }
      const session = this.#requireSession(request.sessionId);
      const retained = session.valueRefs.get(request.valueRef);
      if (retained) {
        const value = this.#projectRetainedValue(retained.value, request.valueRef);
        return {
          ...projectInlineValue(value, request.projections),
          diagnostics: [],
        };
      }
      return {
        value: { kind: "nil" },
        diagnostics: [
          {
            code: "value-ref/not-found",
            severity: "error",
            message: "No retained TS value found to project",
            phase: "evaluate",
          },
        ],
      };
    }
    const value = request.value ?? { kind: "nil" };
    return {
      ...projectInlineValue(value, request.projections),
      diagnostics: [],
    };
  }

  async releaseValue(request: ReleaseValueRequest): Promise<ReleaseValueResult> {
    const session = this.#requireSession(request.sessionId);
    const released: string[] = [];
    for (const valueRef of request.valueRefs) {
      if (session.valueRefs.delete(valueRef)) {
        released.push(valueRef);
      }
    }
    return { released };
  }

  /** The text of a source loaded in a session, for locating diagnostics. */
  sessionSourceText(sessionId: string, sourceId: string): string | undefined {
    return this.#sessions.get(sessionId)?.language.sourceText(sourceId);
  }

  /** Describe checked public library vocabulary without evaluating an entry program. */
  async describe(request: { readonly sessionId: string; readonly sourceId?: string }): Promise<LanguageDescription> {
    const session = this.#requireSession(request.sessionId);
    const forms: LanguageDescription["forms"][number][] = [];
    const functions: LanguageDescription["functions"][number][] = [];
    const types: LanguageDescription["types"][number][] = [];
    const diagnostics: Diagnostic[] = [];
    for (const source of session.language.orderedSources("prelude")) {
      for (const entry of referenceEntries(source.id, source.text)) {
        if (entry.kind === "function" && ["TFun", "TVariadic"].includes(session.language.scope.typeEnv.get(entry.name)?.type._tag ?? "")) {
          const checked = entry.signature ? undefined : await this.typecheck({ sessionId: request.sessionId, source: entry.name });
          const vars = new Map<string, string>();
          const signature = entry.signature ?? checked?.display?.replace(/\bt\d+\b/gu, name => {
            if (!vars.has(name)) vars.set(name, `a${vars.size}`);
            return vars.get(name)!;
          }) ?? entry.pattern ?? entry.name;
          functions.push({ name: entry.name, sourceId: source.id, signature, ...(entry.doc ? { doc: entry.doc } : {}) });
        } else if (entry.kind === "type") types.push({ name: entry.name, sourceId: source.id, signature: entry.source, ...(entry.doc ? { doc: entry.doc } : {}) });
      }
    }
    for (const descriptor of session.language.scope.prelude?.descriptions.list() ?? []) {
      if (descriptor.resultType.kind === "none" && !descriptor.surface) continue;
      const sourceId = session.language.orderedSources("prelude").find(source => referenceEntries(source.id, source.text).some(entry => entry.kind === "form" && entry.name === descriptor.name))?.id ?? "prelude";
      forms.push(describeForm(descriptor.name, sourceId, descriptor));
    }
    const roots = request.sourceId ? [request.sourceId] : session.language.orderedSources("source").map(source => source.id);
    const seen = new Set<string>();
    for (const sourceId of roots) {
      try {
        const graph = this.#moduleGraph({ sessionId: request.sessionId, sourceId });
        const checked = Modules.checkModuleGraph(graph, Engine.moduleCheckOptions({ session: session.language, source: "", hostBuiltins: session.hostBuiltins, typePolicy: session.typePolicy }));
        diagnostics.push(...checked.diagnostics);
        if (!checked.ok) continue;
        for (const binding of checked.interfaces.find(entry => entry.moduleId === graph.entry)!.exports) {
          const key = `${binding.name}:${binding.identity.moduleId}:${binding.identity.declaration}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const owner = graph.modules.find(module => module.id === binding.identity.moduleId)!;
          const entries = referenceEntries(owner.id, owner.source);
          if (binding.kind === "form") {
            const descriptor = owner.compileTime?.forms.get(binding.symbol)?.descriptor;
            if (descriptor) {
              const form = describeForm(binding.name, owner.id, descriptor);
              forms.push(form);
              // Examples are authored in the defining library's scope, including private helpers.
              // Reuse its compile-time form provider through the graph's own module checker.
              for (const example of form.examples) {
                const parsed = Engine.parseSource({ sourceId: `${owner.id}#example`, source: example });
                diagnostics.push(...parsed.diagnostics);
                if (!parsed.diagnostics.length) {
                  const exampleGraph = Modules.resolveModuleGraph({ id: owner.id, source: owner.source + "\n" + example },
                    Modules.sourceModuleResolver(graph.modules.map(module => ({ id: module.id, source: module.source }))), Engine.moduleCoreOptions(session.language));
                  diagnostics.push(...Modules.checkModuleGraph(exampleGraph, Engine.moduleCheckOptions({ session: session.language, source: example, hostBuiltins: session.hostBuiltins, typePolicy: session.typePolicy })).diagnostics);
                }
              }
            }
          } else if (binding.kind === "type" || binding.kind === "class" || binding.kind === "error" || binding.kind === "service") {
            types.push(describeBinding(binding, entries));
          } else if (binding.kind === "value" && Array.isArray(binding.scheme?.type) && binding.scheme.type[0] === "->") {
            functions.push(describeBinding(binding, entries));
          }
        }
      } catch (error) {
        diagnostics.push(...(error instanceof Modules.ModuleError ? error.diagnostics : [Engine.diagnosticFromUnknown(error, "typecheck", sourceId)]));
      }
    }
    return { forms, functions, types, diagnostics };
  }

  async sessionInfo(request: SessionInfoRequest): Promise<SessionInfoResult> {
    const session = this.#requireSession(request.sessionId);
    return {
      ...LanguageSession.sessionInfo(session.language),
      diagnostics: [],
    };
  }

  async resetSession(request: ResetSessionRequest): Promise<ResetSessionResult> {
    const session = this.#requireSession(request.sessionId);
    session.language.reset();
    session.valueRefs.clear();
    session.evaluations.clear();
    session.hostBuiltins = [];
    session.typePolicy = undefined;
    return {
      sessionId: request.sessionId,
      reset: true,
      diagnostics: [],
    };
  }

  async closeSession(request: CloseSessionRequest): Promise<CloseSessionResult> {
    const session = this.#sessions.get(request.sessionId);
    if (session) {
      session.evaluations.clear();
      session.valueRefs.clear();
      this.#sessions.delete(request.sessionId);
    }
    return { sessionId: request.sessionId, closed: true };
  }

  async #analyzeEditorUnlocated(request: EditorAnalysisRequest): Promise<EditorAnalysisResult> {
    const sourceId = request.sourceId ?? "source";
    const parse = editorParseProjection(sourceId, request.source);
    const session = request.sessionId ? this.#requireSession(request.sessionId) : undefined;
    try {
      Engine.validateHostTypes({hostBuiltins:request.hostBuiltins ?? session?.hostBuiltins, typePolicy:request.typePolicy ?? session?.typePolicy}, request.source);
    } catch (error) {
      return {sourceId, success:false, parse, typedSpans:[], errors:[], diagnostics:[Engine.diagnosticFromUnknown(error,"typecheck",sourceId)]};
    }
    if (session && (session.language.projects.length || /\((?:import|export|export-from)\s/.test(request.source))) {
      try {
        const graph = this.#moduleGraph({ sessionId: request.sessionId!, sourceId, source: request.source });
        const checked = Modules.checkModuleGraph(graph, {
          ...Engine.moduleCheckOptions({ session: session.language, source: request.source,
            hostBuiltins: request.hostBuiltins ?? session.hostBuiltins,
            typePolicy: request.typePolicy ?? session.typePolicy }),
          editor: true,
        });
        const display = Modules.moduleResultDisplay(checked, graph.entry);
        return { sourceId, success: checked.ok, parse,
          ...(checked.ok ? { resultTypeDisplay: display, resultType: typeProjection(display) } : {}),
          typedSpans: [...(checked.mechanics?.typedSpans.filter(s => s.span.sourceId === graph.entry).map((s, index) => ({
            id: `mechanics:${index}`, span: s.span, display: s.display, type: typeProjection(s.display),
            code: request.source.slice(s.span.startOffset, s.span.endOffset), exprTag: s.exprTag,
          })) ?? []), ...(checked.typedSpans.get(graph.entry) ?? []).map((typed) => ({
            id: typed.id, span: { sourceId, startOffset: typed.span.start, endOffset: typed.span.end },
            display: typed.typeString, type: typeProjection(typed.typeString), code: typed.code, exprTag: typed.exprTag,
          }))],
          errors: [], diagnostics: checked.diagnostics,
        };
      } catch (error) {
        const diagnostics = error instanceof Modules.ModuleError ? [...error.diagnostics]
          : [Engine.diagnosticFromUnknown(error, "typecheck", sourceId)];
        return { sourceId, success: false, parse, typedSpans: [], errors: [], diagnostics };
      }
    }
    const inferOptions = Engine.typeInferOptions({
      hostBuiltins: request.hostBuiltins ?? session?.hostBuiltins,
      typePolicy: request.typePolicy ?? session?.typePolicy,
    });
    const scope = session?.language.scope;
    const lspResult = await Effect.runPromise(Lsp.analyzeLsp(request.source, {
      sourceId,
      inferOptions: { ...inferOptions, ...(scope?.inferenceState ? {initialState:scope.inferenceState} : {}) },
      ...(scope ? {
        initialEnv: scope.typeEnv,
        macroEnv: scope.macroEnv,
        mechanicsContext: scope.mechanicsSources ?? [],
        ...(scope.formProvider ? {dslProvider:scope.formProvider} : {}),
      } : {}),
    }));
    return {
      sourceId,
      success: lspResult.success,
      ...(lspResult.resultTypeString
        ? {
            resultTypeDisplay: lspResult.resultTypeString,
            resultType: typeProjection(lspResult.resultTypeString),
          }
        : {}),
      typedSpans: [...(lspResult.mechanics?.typedSpans.filter(s => s.span.sourceId === sourceId).map((s, index) => ({
        id: `mechanics:${index}`, span: s.span, display: s.display, type: typeProjection(s.display),
        code: request.source.slice(s.span.startOffset, s.span.endOffset), exprTag: s.exprTag,
      })) ?? []), ...lspResult.typedSpans.map((span) => ({
        id: span.id,
        span: {
          sourceId,
          startOffset: span.span.start,
          endOffset: span.span.end,
        },
        display: span.typeString,
        type: typeProjection(span.typeString),
        code: span.code,
        exprTag: span.exprTag,
      }))],
      errors: lspResult.errors.map((error) => ({
        message: error.message,
        ...(error.details ? {details:error.details} : {}),
        ...(error.help ? {help:error.help} : {}),
        ...(error.related ? {related:error.related} : {}),
        ...(error.fix ? {fix:error.fix} : {}),
        ...(error.span
          ? {
              span: {
                sourceId,
                startOffset: error.span.start,
                endOffset: error.span.end,
              },
            }
          : {}),
        ...(error.code ? { code: error.code } : {}),
        ...(error.diagnosticCode ? { diagnosticCode: error.diagnosticCode } : {}),
      })),
      diagnostics: lspResult.diagnostics.map((diagnostic) => ({
        code: diagnostic.code ?? `${diagnostic.source}/diagnostic`,
        severity: diagnostic.severity,
        message: diagnostic.message,
        ...(diagnostic.details ? {details:diagnostic.details} : {}),
        ...(diagnostic.help ? {help:diagnostic.help} : {}),
        ...(diagnostic.related ? {related:diagnostic.related} : {}),
        ...(diagnostic.fix ? {fix:diagnostic.fix} : {}),
        phase: "typecheck",
        ...(diagnostic.span
          ? {
              span: {
                sourceId,
                startOffset: diagnostic.span.start,
                endOffset: diagnostic.span.end,
              },
            }
          : {}),
      })),
      parse,
    };
  }

  /** Evaluate while collecting per-expression observations. */
  async observe(request: EvaluateRequest): Promise<EvaluationResult> {
    return this.evaluate({ ...request, observe: request.observe ?? {} });
  }

  async identifySyntax(request: SyntaxIdentityRequest): Promise<SyntaxIdentityResult> {
    return this.identifySyntaxSync(request);
  }

  identifySyntaxSync(request: SyntaxIdentityRequest): SyntaxIdentityResult {
    const sourceId = request.sourceId ?? "source";
    const anchors = request.anchors ?? [];
    const identity = request.previous
      ? Syntax.reconcileSyntax(request.previous, request.source, {
          anchors,
          ...(request.changes ? { changes: request.changes } : {}),
        })
      : Syntax.identifySyntax(request.source, {
          anchors,
          ...(request.idPrefix !== undefined ? { idPrefix: request.idPrefix } : {}),
        });
    return {
      sourceId,
      identity,
      diagnostics: identity.errors.map((error) => ({
        code: "parse/syntax",
        severity: "error",
        message: error.message,
        phase: "parse",
        span: spanLocator(request.source)({ sourceId, startOffset: error.span.start, endOffset: error.span.end }),
      })),
    };
  }

  async symbolIndex(request: SymbolIndexRequest): Promise<SymbolIndexResult> {
    const sourceId = request.sourceId ?? "source";
    const index = this.#indexSymbols(request);
    return {
      sourceId,
      definitions: index.definitions.map(definitionProjection),
      references: index.references.map(referenceProjection),
      diagnostics: [],
    };
  }

  async findReferences(request: FindReferencesRequest): Promise<FindReferencesResult> {
    const sourceId = request.sourceId ?? "source";
    const occurrences = Editor.findReferences(this.#indexSymbols(request), {
      sourceId,
      ...(request.offset !== undefined ? { offset: request.offset } : {}),
      ...(request.nodeId !== undefined ? { nodeId: request.nodeId } : {}),
    });
    return {
      sourceId,
      ...(occurrences.definition ? { definition: definitionProjection(occurrences.definition) } : {}),
      references: occurrences.references.map(referenceProjection),
      diagnostics: [],
    };
  }

  async applyEditScript(request: EditScriptRequest): Promise<EditScriptResult> {
    const sourceId = request.sourceId ?? "source";
    const session = request.sessionId ? this.#requireSession(request.sessionId) : undefined;
    const result = Editor.applyEditScript({
      sourceId,
      source: request.source,
      script: request.script,
      ...(request.identity ? { identity: request.identity } : {}),
      documents: (session?.language.orderedSources() ?? []).map((source) => ({
        sourceId: source.id,
        source: source.text,
      })),
    });
    return { ...result, sourceId };
  }

  async describeNodes(request: DescribeNodesRequest): Promise<DescribeNodesResult> {
    return { nodes: Editor.describeNodes(request.source, request.identity, request.ids) };
  }

  async editScriptSchema(): Promise<unknown> {
    return Editor.editScriptJsonSchema();
  }

  async sourceToOutline(request: SourceToOutlineRequest): Promise<SourceToOutlineResult> {
    const result = Syntax.sourceToOutline(
      request.source,
      request.identity ? { identity: request.identity } : {},
    );
    return { sourceId: request.sourceId ?? "source", ...result };
  }

  async outlineToSource(request: OutlineToSourceRequest): Promise<OutlineToSourceResult> {
    const result = Syntax.outlineToSource(request.items, {
      ...(request.base ? { base: request.base } : {}),
      ...(request.brokenRows ? { brokenRows: request.brokenRows } : {}),
      ...(request.idPrefix !== undefined ? { idPrefix: request.idPrefix } : {}),
    });
    return { sourceId: request.sourceId ?? "source", ...result };
  }

  async formSlots(request: FormSlotsRequest): Promise<FormSlotsResult> {
    const sourceId = request.sourceId ?? "source";
    const session = request.sessionId ? this.#requireSession(request.sessionId) : undefined;
    const slots = Editor.formSlots({
      source: request.source,
      ...(request.identity ? { identity: request.identity } : {}),
      ...(request.offset !== undefined ? { offset: request.offset } : {}),
      ...(request.nodeId !== undefined ? { nodeId: request.nodeId } : {}),
      descriptorSources: [
        ...(session?.language.orderedSources() ?? []).map((source) => source.text),
        ...(request.descriptorSources ?? []).map((document) => document.source),
      ],
    });
    if (!slots) return { sourceId, identifiers: [], slots: [], unknownSlots: [] };
    const span = (value: { readonly start: number; readonly end: number }) => hostSpan(sourceId, value);
    return {
      sourceId,
      form: { ...slots.form, span: span(slots.form.span) },
      identifiers: slots.identifiers.map((identifier) =>
        identifier.span ? { ...identifier, span: span(identifier.span) } : identifier,
      ) as FormSlotsResult["identifiers"],
      slots: slots.slots.map((slot) => ({
        ...slot,
        occurrences: slot.occurrences.map((occurrence) => ({
          nodeId: occurrence.nodeId,
          span: span(occurrence.span),
          values: occurrence.values.map((value) => ({ nodeId: value.nodeId, span: span(value.span) })),
        })),
      })),
      ...(slots.activeSlot ? { activeSlot: slots.activeSlot } : {}),
      unknownSlots: slots.unknownSlots,
    };
  }

  #indexSymbols(request: SymbolIndexRequest): Editor.SymbolIndex {
    const sourceId = request.sourceId ?? "source";
    const session = request.sessionId ? this.#requireSession(request.sessionId) : undefined;
    const documents: Editor.SymbolDocument[] = [
      ...(session?.language.orderedSources() ?? [])
        .filter((source) => source.id !== sourceId)
        .map((source) => ({ sourceId: source.id, source: source.text })),
      ...(request.documents ?? [])
        .filter((document) => document.sourceId !== sourceId)
        .map((document) => ({
          sourceId: document.sourceId,
          source: document.source,
          ...(document.identity ? { identity: document.identity } : {}),
        })),
      {
        sourceId,
        source: request.source,
        ...(request.identity ? { identity: request.identity } : {}),
      },
    ];
    return Editor.indexSymbols(documents, {
      moduleSourceIds: session ? [
        ...session.language.orderedSources("source").map((source) => source.id),
        ...(session.language.orderedSources("source").length > 0 || /\((?:import|export|export-from)\s/.test(request.source) ? [sourceId] : []),
      ] : undefined,
    });
  }

  #requireSession(sessionId: string): TsSession {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown language session: ${sessionId}`);
    }
    return session;
  }

  async #checkedRunUnlocated(request: CheckedRunRequest): Promise<CheckedRunState> {
    const session = this.#requireSession(request.sessionId);
    const sourceId = request.sourceId ?? "checked-run";
    const source = request.source;
    const grantMap = new Map(
      request.grants.map((grant) => [
        grant.name,
        { name: grant.name, mode: grant.mode ?? ("ask" as const), maxCalls: grant.maxCalls },
      ]),
    );
    const budget = resolveBudget(request.limits, true);
    const guard = <T>(fn: () => T): T => Expander.withExpansionBudget(expansionBudget(budget), fn);
    const grantedBuiltins = session.hostBuiltins.filter((builtin) => grantMap.has(builtin.name));
    const parsed = Engine.parseSource({ sourceId, source });
    const locateError = diagnosticLocator((id) => (id === sourceId ? source : session.language.sourceText(id)));
    const failedFromError = (error: unknown): CheckedRunState => {
      const mapped = mapCheckedRunDiagnostic(Engine.diagnosticFromUnknown(error, "evaluate", sourceId), locateError);
      return { status: "failed", stage: checkedRunFailureStage(mapped), diagnostics: mapped };
    };
    let built: { readonly manifest: CapabilityManifest; readonly spans: ReadonlyMap<string, Span> };
    try {
      built = guard(() => this.#buildManifest(session, sourceId, source, session.hostBuiltins));
    } catch (error) {
      return failedFromError(error);
    }
    const { manifest, spans } = built;
    const requires = manifest.capabilities.map((cap) => cap.name);
    if (parsed.diagnostics.some((d) => d.severity === "error")) {
      return {
        status: "rejected",
        stage: "parse",
        diagnostics: parsed.diagnostics,
        requires,
        manifest,
      };
    }
    const ungranted = manifest.capabilities.filter((cap) => !grantMap.has(cap.name));
    if (ungranted.length > 0) {
      return {
        status: "rejected",
        stage: "grant",
        diagnostics: ungranted.map((cap) => ({
          code: "capability/ungranted",
          severity: "error" as const,
          message: `Capability "${cap.name}" is not granted.`,
          phase: "typecheck" as const,
          ...(spans.get(cap.name) ? { span: spans.get(cap.name) } : {}),
          details: { capability: cap.name, effect: cap.effect },
        })),
        requires,
        manifest,
      };
    }
    const checked = guard(() => Engine.typecheck({
      session: session.language,
      sourceId,
      source,
      hostBuiltins: grantedBuiltins,
      typePolicy: session.typePolicy,
    }));
    if (checked.diagnostics.some((d) => d.code.startsWith("limit/"))) {
      return { status: "failed", stage: "limit", diagnostics: checked.diagnostics };
    }
    if (checked.diagnostics.some((d) => d.severity === "error")) {
      return {
        status: "rejected",
        stage: "typecheck",
        diagnostics: checked.diagnostics,
        requires,
        manifest,
      };
    }
    const actualType = checked.display ?? "Unit";
    if (request.expectedType !== undefined) {
      const expectedCheck = guard(() => this.#checkExpectedType(
        session,
        sourceId,
        source,
        parsed.exprs,
        request.expectedType!,
        actualType,
        grantedBuiltins,
      ));
      if (expectedCheck) {
        return {
          status: "rejected",
          stage: "typecheck",
          diagnostics: [expectedCheck],
          requires,
          manifest,
        };
      }
    }
    const preparedJournal = this.#prepareJournalRuntime(
      session,
      sourceId,
      source,
      grantedBuiltins,
      request.journal,
      request.onJournalEntry,
    );
    if (!preparedJournal.ok) {
      return { status: "failed", stage: "evaluate", diagnostics: preparedJournal.diagnostics };
    }
    const journalRuntime = preparedJournal.runtime;
    const env = request.variables
      ? session.language.env.extend(variablesToBindings(request.variables))
      : session.language.env;
    const stepLimit = request.limits?.steps ?? session.defaultStepLimit;
    let expressions: readonly Reader.SExpr[];
    try {
      const prepared = await Engine.prepareModuleImports(
        { session: session.language, sourceId, source, env, stepLimit },
        sourceId,
        source,
        env,
      );
      expressions = prepared.expressions;
      const evaluationId = request.evaluationId ?? `ts-eval-${this.#nextEvaluationId++}`;
      const checkedRunContext: CheckedRunContext = {
        grants: grantMap,
        maxHostCalls: request.limits?.hostCalls ?? DEFAULT_MAX_HOST_CALLS,
        type: actualType,
        manifest,
        hostCalls: 0,
        callCounts: new Map(),
      };
      const evaluation = createPendingEvaluation(
        session,
        evaluationId,
        sourceId,
        source,
        checkedRunContext,
        journalRuntime,
      );
      applyBudget(evaluation, budget);
      const builtins = {
        ...Builtins.defaultBuiltins,
        ...this.#hostBuiltinFns(evaluation, grantedBuiltins),
      };
      const completion = runBudgeted(expressions, { stepLimit, builtins, env: prepared.env }, evaluation, budget)
        .then((result): CheckedRunState => {
          const printed = Evaluator.printKValue(result.value);
          const terminalJournal = journalRuntime?.toJournal();
          const oversize = resultSizeDiagnostic(printed, budget.maxResultBytes);
          if (oversize) {
            return {
              status: "failed",
              stage: "limit",
              diagnostics: [...(journalRuntime?.completionDiagnostics(false) ?? []), oversize],
              ...(terminalJournal ? { journal: terminalJournal } : {}),
            };
          }
          const value = this.#projectValue(session, result.value, request.retainValues);
          const projectedOversize = resultSizeDiagnostic(JSON.stringify(value), budget.maxResultBytes);
          if (projectedOversize) {
            return {
              status: "failed",
              stage: "limit",
              diagnostics: [...(journalRuntime?.completionDiagnostics(false) ?? []), projectedOversize],
              ...(terminalJournal ? { journal: terminalJournal } : {}),
            };
          }
          const journalDiagnostics = journalRuntime?.completionDiagnostics(true) ?? [];
          return {
            status: "completed",
            result: {
              value,
              printed,
              steps: result.steps,
              type: typeProjection(actualType),
              diagnostics: [...journalDiagnostics],
            },
            type: actualType,
            hostCalls: checkedRunContext.hostCalls,
            manifest,
            ...(terminalJournal ? { journal: terminalJournal } : {}),
          };
        })
        .catch((error): CheckedRunState => {
          const failed = failedFromError(error);
          if (failed.status !== "failed") return failed;
          const journalWarnings = journalRuntime?.completionDiagnostics(false) ?? [];
          const terminalJournal = journalRuntime?.toJournal();
          return {
            ...failed,
            diagnostics: [...journalWarnings, ...failed.diagnostics],
            ...(terminalJournal ? { journal: terminalJournal } : {}),
          };
        });
      Object.assign(evaluation, { completion });
      session.evaluations.set(evaluationId, evaluation);
      return (await this.#nextEvaluationState(evaluation)) as CheckedRunState;
    } catch (error) {
      const diagnostics = (error instanceof Modules.ModuleError
        ? [...error.diagnostics]
        : [Engine.diagnosticFromUnknown(error, "evaluate", sourceId)]
      ).map(locateError);
      return { status: "failed", stage: checkedRunFailureStage(diagnostics), diagnostics };
    }
  }

  #checkExpectedType(
    session: TsSession,
    sourceId: string,
    source: string,
    exprs: readonly Reader.SExpr[],
    expectedType: string,
    actualType: string,
    hostBuiltins: readonly HostBuiltinDescriptor[],
  ): Diagnostic | undefined {
    const last = exprs.at(-1);
    const lastSpan: Span | undefined = last
      ? spanLocator(source)({ sourceId, startOffset: last.loc.start, endOffset: last.loc.end })
      : undefined;
    const isDecl = last?._tag === "List" && last.items[0]?._tag === "Sym" &&
      ["define", "type", "import", "export", "export-from", "error", "service", "class", "instance"].includes(last.items[0].name);
    const wrappedSource = !last || isDecl
      ? `${source}\n(: nil ${expectedType})`
      : `${source.slice(0, last.loc.start)}(: ${source.slice(last.loc.start, last.loc.end)} ${expectedType})${source.slice(last.loc.end)}`;
    const verified = Engine.typecheck({
      session: session.language,
      sourceId,
      source: wrappedSource,
      hostBuiltins,
      typePolicy: session.typePolicy,
    });
    if (!verified.diagnostics.some((d) => d.severity === "error")) return undefined;
    return {
      code: "typecheck/type-mismatch",
      severity: "error",
      message: `Expected type ${expectedType}, got ${actualType}.`,
      phase: "typecheck",
      ...(lastSpan ? { span: lastSpan } : {}),
      details: { expected: expectedType, actual: actualType },
    };
  }

  #buildManifest(
    session: TsSession | undefined,
    sourceId: string,
    source: string,
    hostBuiltins: readonly HostBuiltinDescriptor[],
  ): { readonly manifest: CapabilityManifest; readonly spans: ReadonlyMap<string, Span> } {
    const preludes = (session?.language.orderedSources("prelude") ?? []).map((entry) => ({
      sourceId: entry.id,
      sha256: sha256(entry.text),
    }));
    const sources = [
      ...(session?.language.orderedSources("source") ?? [])
        .filter((entry) => entry.id !== sourceId)
        .map((entry) => ({ sourceId: entry.id, sha256: sha256(entry.text) })),
      { sourceId, sha256: sha256(source) },
    ];
    const { reachable, spans } = this.#findReachableCapabilities(session, sourceId, source, hostBuiltins);
    return {
      manifest: {
        sources,
        preludes,
        capabilities: reachable.map((builtin) => ({
          name: builtin.name,
          effect: builtin.handler.effect,
          signature: formatTypeScheme(builtin.typeScheme),
          ...(builtin.purity ? { purity: builtin.purity } : {}),
        })),
      },
      spans,
    };
  }

  #findReachableCapabilities(
    session: TsSession | undefined,
    sourceId: string,
    source: string,
    hostBuiltins: readonly HostBuiltinDescriptor[],
  ): { readonly reachable: readonly HostBuiltinDescriptor[]; readonly spans: ReadonlyMap<string, Span> } {
    const spans = new Map<string, Span>();
    if (hostBuiltins.length === 0) return { reachable: [], spans };
    const byName = new Map(hostBuiltins.map((builtin) => [builtin.name, builtin]));
    const found = new Set<string>();
    const locateEntry = spanLocator(source);
    const index = this.#indexSymbols({ sessionId: session?.sessionId, sourceId, source });
    const defByKey = new Map(index.definitions.map((def) => [def.key, def]));
    const refsBySource = new Map<string, Editor.SymbolReference[]>();
    for (const ref of index.references) {
      let list = refsBySource.get(ref.sourceId);
      if (!list) { list = []; refsBySource.set(ref.sourceId, list); }
      list.push(ref);
    }
    const worklist: { readonly defKey: string; readonly entrySpan: Span }[] = [];
    const visitedDefs = new Set<string>();
    for (const ref of refsBySource.get(sourceId) ?? []) {
      const refSpan = locateEntry(hostSpan(sourceId, ref.span));
      if (ref.resolution !== "definition" && byName.has(ref.name)) {
        found.add(ref.name);
        if (!spans.has(ref.name)) spans.set(ref.name, refSpan);
      } else if (ref.resolution === "definition" && ref.definition && !visitedDefs.has(ref.definition)) {
        visitedDefs.add(ref.definition);
        worklist.push({ defKey: ref.definition, entrySpan: refSpan });
      }
    }
    while (worklist.length > 0) {
      const { defKey, entrySpan } = worklist.shift()!;
      const def = defByKey.get(defKey);
      if (!def || def.sourceId === sourceId) continue;
      const parsed = session?.language.parsedPreludes.get(def.sourceId) ??
        session?.language.parsedSources.get(def.sourceId);
      const enclosing = parsed?.find((expr) => expr.loc.start <= def.span.start && def.span.end <= expr.loc.end);
      const docRefs = refsBySource.get(def.sourceId) ?? [];
      for (const ref of docRefs) {
        if (enclosing && (ref.span.start < enclosing.loc.start || ref.span.end > enclosing.loc.end)) continue;
        if (ref.resolution !== "definition" && byName.has(ref.name)) {
          found.add(ref.name);
          if (!spans.has(ref.name)) spans.set(ref.name, entrySpan);
        } else if (ref.resolution === "definition" && ref.definition && !visitedDefs.has(ref.definition)) {
          visitedDefs.add(ref.definition);
          worklist.push({ defKey: ref.definition, entrySpan });
        }
      }
    }
    // Also check expanded AST so macro-introduced capability calls are caught.
    const expanded = Engine.expand({ session: session?.language, sourceId, source });
    if (!expanded.diagnostics.some((d) => d.severity === "error")) {
      const visitAst = (node: Engine.AstNode): void => {
        if (node.kind === "symbol" && byName.has(node.value)) {
          found.add(node.value);
          if (!spans.has(node.value) && node.span) {
            spans.set(node.value, locateEntry(node.span));
          }
        } else if (node.kind === "list" || node.kind === "vector" || node.kind === "set") {
          node.items.forEach(visitAst);
        } else if (node.kind === "map") {
          node.entries.forEach((entry) => { visitAst(entry.key); visitAst(entry.value); });
        }
      };
      expanded.ast.forEach(visitAst);
    }
    return {
      reachable: hostBuiltins.filter((builtin) => found.has(builtin.name)),
      spans,
    };
  }

  #locateCallSpan(evaluation: TsPendingEvaluation, loc: Reader.Loc): Span {
    const spanSourceId = loc.sourceId ?? evaluation.sourceId;
    const rawSpan: Span = {
      sourceId: spanSourceId,
      startOffset: loc.start,
      endOffset: loc.end,
      ...(loc.line !== undefined ? { startLine: loc.line } : {}),
      ...(loc.col !== undefined ? { startColumn: loc.col } : {}),
    };
    const text = (spanSourceId === evaluation.sourceId ? evaluation.sourceText : undefined) ??
      evaluation.session.language.sourceText(spanSourceId);
    return text !== undefined ? spanLocator(text)(rawSpan) : rawSpan;
  }

  #buildJournalHeader(
    session: TsSession,
    sourceId: string,
    source: string,
    descriptors: readonly HostBuiltinDescriptor[],
  ): JournalHeader {
    const preludes = (session.language.orderedSources("prelude") ?? []).map((entry) => ({
      id: entry.id,
      sha256: sha256(entry.text),
    }));
    const sources = [
      ...session.language
        .orderedSources("source")
        .filter((entry) => entry.id !== sourceId)
        .map((entry) => ({ id: entry.id, sha256: sha256(entry.text) })),
      { id: sourceId, sha256: sha256(source) },
    ];
    return {
      format: JOURNAL_FORMAT,
      engine: "typescript",
      program: {
        sources,
        preludes,
        entry: sourceId,
      },
      builtins: descriptors.map((b) => ({ name: b.name, effect: b.handler.effect })),
    };
  }

  #prepareJournalRuntime(
    session: TsSession,
    sourceId: string,
    source: string,
    descriptors: readonly HostBuiltinDescriptor[],
    journalRequest: JournalRequest | undefined,
    onJournalEntry: OnJournalEntryCallback | undefined,
  ):
    | { readonly ok: true; readonly runtime?: JournalRuntime | undefined }
    | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] } {
    if (!journalRequest) return { ok: true };
    const currentHeader = this.#buildJournalHeader(session, sourceId, source, descriptors);
    if (journalRequest.mode === "record") {
      return {
        ok: true,
        runtime: new JournalRuntime({
          recordHeader: currentHeader,
          redact: journalRequest.redact,
          onJournalEntry,
        }),
      };
    }
    const knownBuiltins = new Set(descriptors.map((b) => b.name));
    const validation = validateReplayHeader(
      journalRequest.journal.header,
      currentHeader,
      knownBuiltins,
      journalRequest.allowProgramMismatch === true,
    );
    if (!validation.ok) {
      return { ok: false, diagnostics: validation.diagnostics };
    }
    return {
      ok: true,
      runtime: new JournalRuntime({
        recordHeader: journalRequest.record ? currentHeader : undefined,
        redact: journalRequest.redact,
        onJournalEntry,
        replay: {
          entries: journalRequest.journal.entries,
          onExhausted: journalRequest.onExhausted ?? "fail",
          warnings: validation.diagnostics,
        },
      }),
    };
  }

  async #evaluateInSessionWithHostBuiltins(
    session: TsSession,
    request: EvaluateInSessionRequest,
    source: string,
    env: Env,
    repl?: { readonly commit: (env: Env) => void; readonly type: import("./types.js").TypeProjection },
  ): Promise<EvaluationState> {
    const sourceId = request.sourceId ?? "session";
    const preparedJournal = this.#prepareJournalRuntime(
      session,
      sourceId,
      source,
      session.hostBuiltins,
      request.journal,
      request.onJournalEntry,
    );
    if (!preparedJournal.ok) {
      return { status: "failed", diagnostics: preparedJournal.diagnostics };
    }
    const journalRuntime = preparedJournal.runtime;
    let expressions:readonly Reader.SExpr[];
    try {const prepared=await Engine.prepareModuleImports({session:session.language,sourceId,source,env,stepLimit:request.stepLimit ?? session.defaultStepLimit},sourceId,source,env);expressions=prepared.expressions;env=prepared.env;}
    catch(error) {return {status:"failed",diagnostics:error instanceof Modules.ModuleError ? [...error.diagnostics] : [Engine.diagnosticFromUnknown(error,"evaluate",sourceId)]};}
    const evaluationId = request.evaluationId ?? `ts-eval-${this.#nextEvaluationId++}`;
    const evaluation = createPendingEvaluation(session, evaluationId, sourceId, source, undefined, journalRuntime);
    const budget = resolveBudget(request, false);
    applyBudget(evaluation, budget);
    const builtins = {
      ...Builtins.defaultBuiltins,
      ...this.#hostBuiltinFns(evaluation, session.hostBuiltins),
    };
    if (request.observe) {
      const observe = request.observe;
      const completion = Engine.evaluateObserved(
        { sourceId, source, env, stepLimit: request.stepLimit ?? session.defaultStepLimit },
        engineObservation(observe),
        builtins,
        expressions,
      ).then((result): EvaluationState => {
        const observations = this.#observations(
          session,
          sourceId,
          request,
          result,
          request.retainValues,
        );
        const terminalJournal = journalRuntime?.toJournal();
        if (result.diagnostics.length > 0) {
          const journalWarnings = journalRuntime?.completionDiagnostics(false) ?? [];
          return {
            status: "failed",
            diagnostics: [...journalWarnings, ...result.diagnostics],
            ...(observations ? { observations } : {}),
            ...(terminalJournal ? { journal: terminalJournal } : {}),
          };
        }
        if (repl && !evaluation.aborted) repl.commit(result.env!);
        const journalDiagnostics = journalRuntime?.completionDiagnostics(true) ?? [];
        return {
          status: "completed",
          result: {
            value: this.#projectValue(session, result.value, request.retainValues),
            printed: Evaluator.printKValue(result.value),
            steps: result.steps,
            diagnostics: [...journalDiagnostics],
            ...(repl ? { type: repl.type } : {}),
            ...(observations ? { observations } : {}),
          },
          ...(terminalJournal ? { journal: terminalJournal } : {}),
        };
      });
      Object.assign(evaluation, { completion });
      session.evaluations.set(evaluationId, evaluation);
      return (await this.#nextEvaluationState(evaluation)) as EvaluationState;
    }
    const completion = runBudgeted(
      expressions,
      { stepLimit: request.stepLimit ?? session.defaultStepLimit, builtins, env },
      evaluation,
      budget,
    )
      .then((result): EvaluationState => {
        const printed = Evaluator.printKValue(result.value);
        const terminalJournal = journalRuntime?.toJournal();
        const oversize = resultSizeDiagnostic(printed, budget.maxResultBytes);
        if (oversize) {
          return {
            status: "failed",
            diagnostics: [...(journalRuntime?.completionDiagnostics(false) ?? []), oversize],
            ...(terminalJournal ? { journal: terminalJournal } : {}),
          };
        }
        if (repl && !evaluation.aborted) repl.commit(result.env);
        const journalDiagnostics = journalRuntime?.completionDiagnostics(true) ?? [];
        return {
          status: "completed",
          result: {
            value: this.#projectValue(session, result.value, request.retainValues),
            printed,
            steps: result.steps,
            diagnostics: [...journalDiagnostics],
            ...(repl ? { type: repl.type } : {}),
          },
          ...(terminalJournal ? { journal: terminalJournal } : {}),
        };
      })
      .catch(
        (error): EvaluationState => {
          const journalWarnings = journalRuntime?.completionDiagnostics(false) ?? [];
          const terminalJournal = journalRuntime?.toJournal();
          return {
            status: "failed",
            diagnostics: [
              ...journalWarnings,
              diagnosticLocator(id => id === sourceId ? source : session.language.sourceText(id))(Engine.diagnosticFromUnknown(error, "evaluate", sourceId)),
            ],
            ...(terminalJournal ? { journal: terminalJournal } : {}),
          };
        },
      );
    Object.assign(evaluation, { completion });
    session.evaluations.set(evaluationId, evaluation);
    return (await this.#nextEvaluationState(evaluation)) as EvaluationState;
  }

  #hostBuiltinFns(
    evaluation: TsPendingEvaluation,
    descriptors: readonly HostBuiltinDescriptor[],
  ): Record<string, BuiltinFn> {
    return Object.fromEntries(
      descriptors.map((descriptor) => [
        descriptor.name,
        (args: readonly KValue[], apply) => {
          const callLoc = VM.currentBuiltinCallLoc();
          return this.#pauseForHostCall(evaluation, descriptor, args, apply, callLoc);
        },
      ]),
    );
  }

  #pauseForHostCall(
    evaluation: TsPendingEvaluation,
    descriptor: HostBuiltinDescriptor,
    args: readonly KValue[],
    apply: (fn: KValue, args: readonly KValue[]) => Effect.Effect<KValue, KernelError>,
    callLoc?: Reader.Loc,
  ): Effect.Effect<KValue, KernelError> {
    return Effect.callback<KValue, KernelError>((resume) => {
      if (evaluation.aborted) {
        resume(Effect.fail(hostCallDiagnosticsError("evaluation/aborted", evaluation.abortReason ?? "Evaluation aborted")));
        return Effect.void;
      }
      const span = callLoc ? this.#locateCallSpan(evaluation, callLoc) : undefined;
      if (evaluation.deadlineMs !== undefined && Date.now() >= evaluation.deadlineMs) {
        resume(Effect.fail(hostCallDiagnosticsErrorFromDiagnostics([{
          code: "limit/time",
          severity: "error",
          message: evaluation.timeoutMs !== undefined
            ? `Evaluation exceeded the time limit of ${evaluation.timeoutMs}ms.`
            : "Evaluation exceeded its time limit.",
          phase: "evaluate",
          ...(span ? { span } : {}),
          ...(evaluation.timeoutMs !== undefined ? { details: { limit: evaluation.timeoutMs } } : {}),
        }])));
        return Effect.void;
      }
      if (evaluation.checkedRun) {
        const grant = evaluation.checkedRun.grants.get(descriptor.name);
        if (!grant) {
          resume(Effect.fail(hostCallDiagnosticsErrorFromDiagnostics([{
            code: "capability/ungranted",
            severity: "error",
            message: `Capability "${descriptor.name}" is not granted.`,
            phase: "host-effect",
            ...(span ? { span } : {}),
            details: { capability: descriptor.name, effect: descriptor.handler.effect },
          }])));
          return Effect.void;
        }
        if (evaluation.checkedRun.maxHostCalls !== undefined && evaluation.checkedRun.hostCalls >= evaluation.checkedRun.maxHostCalls) {
          resume(Effect.fail(hostCallDiagnosticsErrorFromDiagnostics([{
            code: "limit/host-calls",
            severity: "error",
            message: `Host call limit (${evaluation.checkedRun.maxHostCalls}) exceeded.`,
            phase: "evaluate",
            ...(span ? { span } : {}),
            details: { limit: evaluation.checkedRun.maxHostCalls, capability: descriptor.name },
          }])));
          return Effect.void;
        }
        const currentCount = evaluation.checkedRun.callCounts.get(descriptor.name) ?? 0;
        if (grant.maxCalls !== undefined && currentCount >= grant.maxCalls) {
          resume(Effect.fail(hostCallDiagnosticsErrorFromDiagnostics([{
            code: "limit/host-calls",
            severity: "error",
            message: `Call limit (${grant.maxCalls}) exceeded for capability "${descriptor.name}".`,
            phase: "evaluate",
            ...(span ? { span } : {}),
            details: { limit: grant.maxCalls, capability: descriptor.name },
          }])));
          return Effect.void;
        }
        evaluation.checkedRun.hostCalls++;
        evaluation.checkedRun.callCounts.set(descriptor.name, currentCount + 1);
      }
      const journalParent: JournalParentContext | undefined = evaluation.journalRuntime
        ? {
            runtime: evaluation.journalRuntime,
            evaluationPath: evaluation.evaluationPath,
            nextChild: () => evaluation.nextChildIndex++,
          }
        : undefined;
      const projectedArgs = args.map((arg) =>
        this.#projectValue(
          evaluation.session,
          arg,
          "functions",
          (callArgs) => apply(arg, callArgs),
          journalParent,
        ),
      );
      const actualJournalArgs = evaluation.journalRuntime
        ? journalArgsFromProjections(projectedArgs)
        : undefined;
      if (evaluation.journalRuntime?.isReplaying) {
        const step = evaluation.journalRuntime.matchReplayCall(
          evaluation.evaluationPath,
          descriptor.handler.effect,
          descriptor.name,
          actualJournalArgs!,
          span,
        );
        if (step.action === "fail") {
          resume(Effect.fail(hostCallDiagnosticsErrorFromDiagnostics([step.diagnostic])));
          return Effect.void;
        }
        if (step.action === "resume") {
          if (step.entry.outcome.ok) {
            try {
              const decoded = valueProjectionFromJournal(step.entry.outcome.value);
              resume(Effect.succeed(kValueFromProjection(decoded, evaluation.session)));
            } catch (error) {
              resume(Effect.fail(hostCallDiagnosticsErrorFromDiagnostics([{
                code: "journal/invalid",
                severity: "error",
                message: error instanceof Error ? error.message : String(error),
                phase: "host-effect",
                ...(span ? { span } : {}),
              }])));
            }
          } else {
            const diagnostics = span
              ? step.entry.outcome.diagnostics.map((d) => (d.span ? d : { ...d, span }))
              : step.entry.outcome.diagnostics;
            resume(Effect.fail(hostCallDiagnosticsErrorFromDiagnostics(diagnostics)));
          }
          return Effect.void;
        }
      }
      const call: HostCall = {
        evaluationId: evaluation.evaluationId,
        callId: `ts-call-${this.#nextCallId++}`,
        effect: descriptor.handler.effect,
        name: descriptor.name,
        args: projectedArgs,
        ...(span ? { span } : {}),
        ...(evaluation.checkedRun ? { mode: evaluation.checkedRun.grants.get(descriptor.name)?.mode ?? "ask" } : {}),
      };
      const pendingCall: TsPendingHostCall = {
        call,
        resume: (result) => {
          // Time spent waiting on the host does not count against the evaluation deadline.
          if (evaluation.pausedAtMs !== undefined && evaluation.deadlineMs !== undefined) {
            evaluation.deadlineMs += Date.now() - evaluation.pausedAtMs;
          }
          evaluation.pausedAtMs = undefined;
          if (!evaluation.aborted && evaluation.journalRuntime?.isRecording) {
            try {
              evaluation.journalRuntime.recordCall(
                evaluation.evaluationPath,
                descriptor.handler.effect,
                descriptor.name,
                actualJournalArgs!,
                result,
              );
            } catch (error) {
              resume(Effect.fail(hostCallDiagnosticsErrorFromDiagnostics([{
                code: "journal/invalid",
                severity: "error",
                message: error instanceof Error ? error.message : String(error),
                phase: "host-effect",
                ...(span ? { span } : {}),
              }])));
              return;
            }
          }
          if (result.ok) {
            resume(Effect.succeed(kValueFromProjection(result.value, evaluation.session)));
          } else {
            const diagnostics = span
              ? result.diagnostics.map((d) => (d.span ? d : { ...d, span }))
              : result.diagnostics;
            resume(Effect.fail(hostCallDiagnosticsErrorFromDiagnostics(diagnostics)));
          }
        },
      };
      evaluation.pendingCall = pendingCall;
      evaluation.pausedAtMs = Date.now();
      enqueueHostCall(evaluation, call);
      return Effect.sync(() => {
        if (evaluation.pendingCall === pendingCall) {
          evaluation.pendingCall = undefined;
        }
      });
    });
  }

  #projectValue(
    session: TsSession,
    value: KValue,
    retainValues: EvaluateInSessionRequest["retainValues"] | undefined,
    apply?: ((args: readonly KValue[]) => Effect.Effect<KValue, KernelError>) | undefined,
    journalParent?: JournalParentContext | undefined,
  ): ValueProjection {
    if (Evaluator.isKKeyword(value) || Evaluator.isKSymbol(value)) {
      return this.#maybeRetainProjectedValue(session,value,{kind:Evaluator.isKKeyword(value) ? "keyword" : "symbol",value:value.name},retainValues);
    }
    if (value === null) {
      return this.#maybeRetainProjectedValue(session, value, { kind: "nil" }, retainValues);
    }
    if (typeof value === "boolean") {
      return this.#maybeRetainProjectedValue(session, value, { kind: "bool", value }, retainValues);
    }
    if (Evaluator.isKFloat(value)) return this.#maybeRetainProjectedValue(session, value, { kind: "float", value: floatProjectionValue(value.value) }, retainValues);
    if (typeof value === "number") {
      return this.#maybeRetainProjectedValue(
        session,
        value,
        { kind: "int", value },
        retainValues,
      );
    }
    if (typeof value === "string") {
      return this.#maybeRetainProjectedValue(
        session,
        value,
        { kind: "string", value },
        retainValues,
      );
    }
    if (Array.isArray(value)) {
      return this.#maybeRetainProjectedValue(
        session,
        value,
        {
          kind: "list",
          items: value.map((item) => this.#projectValue(session, item, retainValues, undefined, journalParent)),
        },
        retainValues,
      );
    }
    if (Evaluator.isKMap(value)) {
      return this.#maybeRetainProjectedValue(
        session,
        value,
        {
          kind: "map",
          entries: [...value.entries()].map(([key, nested]) => ({
            key: this.#maybeRetainProjectedValue(
              session,
              key,
              mapKeyProjection(key),
              retainValues,
            ),
            value: this.#projectValue(session, nested, retainValues, undefined, journalParent),
          })),
        },
        retainValues,
      );
    }
    if (Evaluator.isKFn(value)) {
      if (retainValues === "functions" || retainValues === "all") {
        const valueRef = this.#retainValue(
          session,
          value,
          apply,
          this.#callableValueInvoker(session, value, journalParent),
        );
        return { kind: "function", valueRef, display: Evaluator.printKValue(value) };
      }
      return valueProjection(value);
    }
    const projected = valueProjection(value);
    return this.#maybeRetainProjectedValue(session, value, projected, retainValues);
  }

  #projectRetainedValue(value: KValue, valueRef: string): ValueProjection {
    if (Evaluator.isKFn(value)) {
      return { kind: "function", valueRef, display: Evaluator.printKValue(value) };
    }
    return { ...valueProjection(value), valueRef };
  }

  #maybeRetainProjectedValue(
    session: TsSession,
    value: KValue,
    projected: ValueProjection,
    retainValues: EvaluateInSessionRequest["retainValues"] | undefined,
  ): ValueProjection {
    if (retainValues !== "all") return projected;
    if (projected.kind === "function") return projected;
    return { ...projected, valueRef: this.#retainValue(session, value) };
  }

  #retainValue(
    session: TsSession,
    value: KValue,
    apply?: ((args: readonly KValue[]) => Effect.Effect<KValue, KernelError>) | undefined,
    invoke?: ((request: CallValueRequest) => Promise<EvaluationState>) | undefined,
  ): string {
    const valueRef = `ts-value-${this.#nextValueRefId++}`;
    session.valueRefs.set(valueRef, {
      value,
      ...(apply ? { apply } : {}),
      ...(invoke ? { invoke } : {}),
    });
    return valueRef;
  }

  #callableValueInvoker(
    session: TsSession,
    value: KValue,
    journalParent?: JournalParentContext | undefined,
  ): ((request: CallValueRequest) => Promise<EvaluationState>) | undefined {
    if (!Evaluator.isKFn(value)) return undefined;
    return (request) => this.#invokeCallableValue(session, value, request, journalParent);
  }

  async #invokeCallableValue(
    session: TsSession,
    value: KFn,
    request: CallValueRequest,
    journalParent?: JournalParentContext | undefined,
  ): Promise<EvaluationState> {
    const sourceId = "value-ref";
    const evaluationId = request.evaluationId ?? `ts-eval-${this.#nextEvaluationId++}`;
    let journalRuntime: JournalRuntime | undefined;
    let evaluationPath: readonly number[] = [];
    let ownsJournal = false;
    if (request.journal) {
      const prepared = this.#prepareJournalRuntime(
        session,
        sourceId,
        "",
        session.hostBuiltins,
        request.journal,
        request.onJournalEntry,
      );
      if (!prepared.ok) {
        return { status: "failed", diagnostics: prepared.diagnostics };
      }
      journalRuntime = prepared.runtime;
      ownsJournal = true;
    } else if (journalParent) {
      journalRuntime = journalParent.runtime;
      evaluationPath = [...journalParent.evaluationPath, journalParent.nextChild()];
      journalRuntime.markPathEntered(evaluationPath);
    }
    const evaluation = createPendingEvaluation(
      session,
      evaluationId,
      sourceId,
      undefined,
      undefined,
      journalRuntime,
      evaluationPath,
    );
    const builtins = {
      ...Builtins.defaultBuiltins,
      ...this.#hostBuiltinFns(evaluation, session.hostBuiltins),
    };
    const args = request.args.map((arg) => kValueFromProjection(arg, session));
    const completion = Effect.runPromise(
      Evaluator.withGensymScope(Effect.gen(function* () {
        if (VM.getVMClosure(value)) {
          const stepCounter = yield* Ref.make(0);
          const builtinRegistry = new VM.BuiltinRegistry(builtins);
          const runtime = {
            builtins: builtinRegistry.toArray(builtins),
            builtinLookup: builtinRegistry.toMap(builtins),
            globals: [],
            stepLimit: request.stepLimit ?? session.defaultStepLimit,
            strictGlobals: true,
            stepCounter,
          };
          return yield* value.apply!(args, runtime);
        }

        const counter = yield* Ref.make(0);
        const runtime = {
          builtins,
          counter,
          stepLimit: request.stepLimit ?? session.defaultStepLimit,
        };
        return yield* Evaluator.applyKFn(value, args, runtime);
      })),
    )
      .then(
        (value): EvaluationState => {
          const journalDiagnostics = ownsJournal ? (journalRuntime?.completionDiagnostics(true) ?? []) : [];
          const terminalJournal = ownsJournal ? journalRuntime?.toJournal() : undefined;
          return {
            status: "completed",
            result: {
              value: this.#projectValue(session, value, request.retainValues),
              printed: Evaluator.printKValue(value),
              diagnostics: [...journalDiagnostics],
            },
            ...(terminalJournal ? { journal: terminalJournal } : {}),
          };
        },
      )
      .catch(
        (error): EvaluationState => {
          const journalWarnings = ownsJournal ? (journalRuntime?.completionDiagnostics(false) ?? []) : [];
          const terminalJournal = ownsJournal ? journalRuntime?.toJournal() : undefined;
          return {
            status: "failed",
            diagnostics: [
              ...journalWarnings,
              diagnosticLocator(id => session.language.sourceText(id))(Engine.diagnosticFromUnknown(error, "evaluate", sourceId)),
            ],
            ...(terminalJournal ? { journal: terminalJournal } : {}),
          };
        },
      );
    Object.assign(evaluation, { completion });
    session.evaluations.set(evaluationId, evaluation);
    return (await this.#nextEvaluationState(evaluation)) as EvaluationState;
  }

  async #nextEvaluationState(evaluation: TsPendingEvaluation): Promise<EvaluationState | CheckedRunState> {
    const state = await Promise.race([
      evaluation.completion.then((state) => ({ kind: "completion" as const, state })),
      waitForHostCall(evaluation).then((call) => ({ kind: "host-call" as const, call })),
    ]);
    if (state.kind === "host-call") {
      return { status: "host-call", call: state.call };
    }
    evaluation.completed = true;
    evaluation.session.evaluations.delete(evaluation.evaluationId);
    return state.state;
  }
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const utf8Encoder = new TextEncoder();

/** Runtime-neutral synchronous SHA-256 (FIPS 180-4) returning lowercase hex. */
function sha256(text: string): string {
  const data = utf8Encoder.encode(text);
  const bitLen = data.length * 8;
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15]! >>> 7) | (w[i - 15]! << 25)) ^ ((w[i - 15]! >>> 18) | (w[i - 15]! << 14)) ^ (w[i - 15]! >>> 3);
      const s1 = ((w[i - 2]! >>> 17) | (w[i - 2]! << 15)) ^ ((w[i - 2]! >>> 19) | (w[i - 2]! << 13)) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((n) => n.toString(16).padStart(8, "0")).join("");
}

function formatTypeScheme(scheme?: TypeSchemeExpr): string {
  if (!scheme) return "Unknown";
  switch (scheme.kind) {
    case "any": return "Unknown";
    case "type": return scheme.name;
    case "list": return `(List ${formatTypeScheme(scheme.item)})`;
    case "map": return `(Map ${formatTypeScheme(scheme.key)} ${formatTypeScheme(scheme.value)})`;
    case "function":
      return `(-> ${[...scheme.params.map(formatTypeScheme), formatTypeScheme(scheme.result)].join(" ")})`;
    case "variadic-function":
      return `(-> ${[...scheme.params.map(formatTypeScheme), `& ${formatTypeScheme(scheme.rest)}`, formatTypeScheme(scheme.result)].join(" ")})`;
  }
}

function mapCheckedRunDiagnostic(
  diagnostic: Diagnostic,
  locate: (d: Diagnostic) => Diagnostic,
): readonly Diagnostic[] {
  const details = diagnostic.details as { readonly hostDiagnostics?: readonly Diagnostic[]; readonly limit?: number } | undefined;
  if (Array.isArray(details?.hostDiagnostics) && details.hostDiagnostics.length > 0) {
    return details.hostDiagnostics.map((d) => locate(d.span ? d : (diagnostic.span ? { ...d, span: diagnostic.span } : d)));
  }
  if (diagnostic.code === "StepLimitExceeded") {
    return [locate({
      ...diagnostic,
      code: "limit/steps",
    })];
  }
  return [locate(diagnostic)];
}

function checkedRunFailureStage(diagnostics: readonly Diagnostic[]): "evaluate" | "limit" | "denied" | "aborted" {
  if (diagnostics.some((d) => d.code.startsWith("limit/") || d.code === "StepLimitExceeded")) return "limit";
  if (diagnostics.some((d) => d.code === "capability/denied")) return "denied";
  if (diagnostics.some((d) => d.code === "evaluation/aborted")) return "aborted";
  return "evaluate";
}

function hostSpan(sourceId: string, span: { readonly start: number; readonly end: number }) {
  return { sourceId, startOffset: span.start, endOffset: span.end };
}

function definitionProjection(definition: Editor.SymbolDefinition): SymbolDefinition {
  const { sourceId, span, ...rest } = definition;
  return { ...rest, span: hostSpan(sourceId, span) };
}

function referenceProjection(reference: Editor.SymbolReference): SymbolReference {
  const { sourceId, span, ...rest } = reference;
  return { ...rest, span: hostSpan(sourceId, span) };
}

function failedEvaluation(code: string, message: string): EvaluationState {
  return {
    status: "failed",
    diagnostics: [
      {
        code,
        severity: "error",
        message,
        phase: code.startsWith("host-effect/") ? "host-effect" : "evaluate",
      },
    ],
  };
}

interface BudgetLimits {
  readonly timeoutMs?: number | undefined;
  readonly maxExpansionSteps?: number | undefined;
  readonly maxResultBytes?: number | undefined;
}

interface ResolvedBudget {
  readonly timeoutMs?: number | undefined;
  /** Wall-clock deadline (epoch ms) counted from when the run started. */
  readonly deadlineMs?: number | undefined;
  readonly maxExpansionSteps?: number | undefined;
  readonly maxResultBytes: number;
}

/** Resolve limits; `defaults` applies the RFC 0012 defaults to omitted budgets. */
function resolveBudget(limits: BudgetLimits | undefined, defaults: boolean): ResolvedBudget {
  const timeoutMs = limits?.timeoutMs ?? (defaults ? DEFAULT_TIMEOUT_MS : undefined);
  return {
    timeoutMs,
    deadlineMs: timeoutMs !== undefined ? Date.now() + timeoutMs : undefined,
    maxExpansionSteps: limits?.maxExpansionSteps ?? (defaults ? DEFAULT_MAX_EXPANSION_STEPS : undefined),
    maxResultBytes: limits?.maxResultBytes ?? (defaults ? DEFAULT_MAX_RESULT_BYTES : Number.POSITIVE_INFINITY),
  };
}

function expansionBudget(budget: ResolvedBudget): Expander.ExpansionBudget {
  return {
    maxExpansionSteps: budget.maxExpansionSteps,
    deadlineMs: budget.deadlineMs,
    timeoutMs: budget.timeoutMs,
  };
}

function applyBudget(evaluation: TsPendingEvaluation, budget: ResolvedBudget): void {
  evaluation.deadlineMs = budget.deadlineMs;
  evaluation.timeoutMs = budget.timeoutMs;
}

function resultSizeDiagnostic(text: string, limit: number): Diagnostic | undefined {
  if (!Number.isFinite(limit)) return undefined;
  const actual = utf8Encoder.encode(text).length;
  if (actual <= limit) return undefined;
  return {
    code: "limit/result-size",
    severity: "error",
    message: `Result size (${actual} bytes) exceeds the limit of ${limit} bytes.`,
    phase: "evaluate",
    details: { limit, actual },
  };
}

/**
 * Expand under the expansion budget, then evaluate with cooperative deadline and
 * abort control checked inside the VM loop. Rejects (never throws) on failure.
 */
function runBudgeted(
  expressions: readonly Reader.SExpr[],
  options: { readonly stepLimit: number; readonly builtins: Record<string, BuiltinFn>; readonly env: Env },
  evaluation: TsPendingEvaluation,
  budget: ResolvedBudget,
): Promise<Evaluator.KernelResult> {
  try {
    const gensym = { next: 0 };
    const expanded = Expander.withExpansionBudget(expansionBudget(budget), () =>
      Effect.runSync(
        Evaluator.expandExprs(expressions, options).pipe(Effect.provideService(Evaluator.GensymScope, gensym)),
      ),
    );
    const control: VM.VMExecutionControl = {
      get deadlineMs() { return evaluation.deadlineMs; },
      timeoutMs: budget.timeoutMs,
      shouldAbort: () => (evaluation.aborted ? (evaluation.abortReason ?? true) : undefined),
      yieldToEventLoop: true,
    };
    return Effect.runPromise(
      Evaluator.evaluateExpandedExprs(expanded, options).pipe(
        Effect.provideService(VM.VMExecutionControlScope, control),
      ),
    );
  } catch (error) {
    return Promise.reject(error);
  }
}

function createPendingEvaluation(
  session: TsSession,
  evaluationId: string,
  sourceId: string,
  sourceText?: string,
  checkedRun?: CheckedRunContext,
  journalRuntime?: JournalRuntime,
  evaluationPath: readonly number[] = [],
): TsPendingEvaluation {
  return {
    session,
    evaluationId,
    sourceId,
    ...(sourceText !== undefined ? { sourceText } : {}),
    ...(checkedRun !== undefined ? { checkedRun } : {}),
    ...(journalRuntime !== undefined ? { journalRuntime } : {}),
    evaluationPath,
    nextChildIndex: 0,
    completed: false,
    aborted: false,
    callQueue: [],
    callWaiters: [],
    completion: Promise.resolve(
      failedEvaluation("evaluation/not-started", "TS evaluation has not started"),
    ),
  };
}

function enqueueHostCall(evaluation: TsPendingEvaluation, call: HostCall): void {
  const waiter = evaluation.callWaiters.shift();
  if (waiter) {
    waiter(call);
  } else {
    evaluation.callQueue.push(call);
  }
}

function waitForHostCall(evaluation: TsPendingEvaluation): Promise<HostCall> {
  const queued = evaluation.callQueue.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve) => {
    evaluation.callWaiters.push(resolve);
  });
}

function hostCallDiagnosticsError(code: string, message: string): KernelTypeError {
  return new KernelTypeError({
    message,
    expected: "successful host call",
    got: code,
  });
}

/** A failed resume keeps the host's first code and every diagnostic it returned. */
function hostCallDiagnosticsErrorFromDiagnostics(
  diagnostics: readonly Diagnostic[],
): KernelTypeError {
  const first = diagnostics[0];
  const code = first?.code ?? "host-effect/failed";
  return new KernelTypeError({
    message: first?.message ?? "Host call failed",
    expected: "successful host call",
    got: code,
    ...(first?.span
      ? {
          loc: {
            sourceId: first.span.sourceId,
            start: first.span.startOffset,
            end: first.span.endOffset,
            line: first.span.startLine ?? 1,
            col: first.span.startColumn ?? 1,
          },
        }
      : {}),
    details: { ...(first?.details ?? {}), code, hostDiagnostics: diagnostics },
  });
}

function variablesToBindings(
  variables: readonly {
    readonly name: string;
    readonly value: ValueProjection;
  }[],
): Record<string, KValue> {
  return Object.fromEntries(
    variables.map((variable) => [variable.name, kValueFromProjection(variable.value)]),
  );
}

/**
 * Decode a projection into a kernel value. A function or opaque projection
 * whose `valueRef` is retained in `session` decodes to the retained value;
 * without one it decodes to its display text.
 */
function kValueFromProjection(value: ValueProjection, session?: TsSession): KValue {
  const decode = (nested: ValueProjection) => kValueFromProjection(nested, session);
  switch (value.kind) {
    case "nil":
      return null;
    case "float": return new Evaluator.KFloat(Number(value.value));
    case "int": return Evaluator.checkedInt(value.value, "host Int projection");
    case "bool":
    case "string": return value.value;
    case "keyword": return Evaluator.KKeyword(value.value);
    case "symbol": return Evaluator.KSymbol(value.value);
    case "list":
    case "vector":
      return value.items.map(decode);
    case "map":
      return new Map(
        value.entries.map((entry) => [
          Evaluator.mapKey(decode(entry.key)) ?? keyStringFromProjection(entry.key),
          decode(entry.value),
        ]),
      );
    case "function":
    case "opaque": {
      const retained = value.valueRef ? session?.valueRefs.get(value.valueRef) : undefined;
      return retained ? retained.value : value.display ?? value.kind;
    }
  }
}

function editorParseProjection(sourceId: string, source: string): EditorAnalysisResult["parse"] {
  const result = Reader.parse(source);
  return {
    errors: result.errors.map((error) => ({
      message: error.message,
      ...(error.loc ? { span: spanFromReaderLoc(sourceId, error.loc) } : {}),
    })),
    greenTree: serializeGreenNode(sourceId, result.greenTree, source),
    redTree: serializeRedNode(sourceId, result.redTree),
  };
}

function serializeGreenNode(
  sourceId: string,
  node: ReturnType<typeof Reader.parse>["greenTree"],
  source: string,
  offset = 0,
  depth = 0,
): SyntaxTreeProjection {
  if (depth > 6) {
    return {
      kind: `${node.kind} (max-depth)`,
      span: { sourceId, startOffset: offset, endOffset: offset },
    };
  }

  let cursor = offset;
  return {
    kind: node.kind,
    span: { sourceId, startOffset: offset, endOffset: offset + node.width },
    text: source.slice(offset, offset + node.width),
    children: node.children.map((child) => {
      const childOffset = cursor;
      cursor += child.width;
      if (Reader.isGreenNode(child)) {
        return serializeGreenNode(sourceId, child, source, childOffset, depth + 1);
      }
      return {
        kind: "Token",
        tokenType: child.tokenType,
        span: {
          sourceId,
          startOffset: childOffset,
          endOffset: childOffset + child.width,
        },
        text: `${child.leadingTrivia.map((trivia) => trivia.text).join("")}${child.text}`,
      };
    }),
  };
}

function serializeRedNode(
  sourceId: string,
  node: ReturnType<typeof Reader.parse>["redTree"],
  depth = 0,
): SyntaxTreeProjection {
  if (depth > 6) {
    const fullSpan = node.fullSpan();
    return {
      kind: `${node.kind()} (max-depth)`,
      span: {
        sourceId,
        startOffset: fullSpan.start,
        endOffset: fullSpan.end,
      },
    };
  }

  const fullSpan = node.fullSpan();
  return {
    kind: node.kind(),
    span: {
      sourceId,
      startOffset: fullSpan.start,
      endOffset: fullSpan.end,
    },
    text: node.fullText(),
    children: node.children().map((child) => {
      if (Reader.isRedNode(child)) {
        return serializeRedNode(sourceId, child, depth + 1);
      }
      const span = child.fullSpan();
      return {
        kind: "Token",
        tokenType: child.tokenType(),
        span: {
          sourceId,
          startOffset: span.start,
          endOffset: span.end,
        },
        text: child.fullText(),
      };
    }),
  };
}

function spanFromReaderLoc(sourceId: string, loc: Reader.Loc) {
  return {
    sourceId,
    startOffset: loc.start,
    endOffset: loc.end,
    startLine: loc.line,
    startColumn: loc.col,
  };
}
