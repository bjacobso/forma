import { validateHostTypes, hostTypeNames } from "./type-policy.js";
import { bootstrapFromSources, type BootstrappedPrelude } from "../descriptor/bootstrap.js";
import { elaborateSources } from "../descriptor/elaborate.js";
import { head } from "../surface/effect.js";
import { parse as parseSurface, toSExprMany } from "../reader/index.js";
import { Effect } from "effect";
import * as Builtins from "../Builtins.js";
import type { Env } from "../Env.js";
import * as Evaluator from "../Evaluator.js";
import * as Reader from "../Reader.js";
import type { LanguageSession } from "../Session.js";
import * as Type from "../Type.js";
import { resolveModuleGraph, sourceModuleResolver, normalizeModuleId, type ModuleGraph } from "../modules/graph.js";
import { checkModuleGraph, moduleResultDisplay } from "../modules/check.js";
import { ModuleRuntime } from "../modules/runtime.js";
import { diagnosticFromUnknown, type Diagnostic, type DiagnosticPhase, type Span } from "../diagnostic/diagnostic.js";

export type { Diagnostic, DiagnosticPhase, Span } from "../diagnostic/diagnostic.js";
export { diagnosticFromUnknown } from "../diagnostic/diagnostic.js";

export type PassName = "parse" | "expand" | "typecheck" | "evaluate";

export interface PassResult {
  readonly pass: PassName;
  readonly sourceId: string;
  readonly diagnostics: readonly Diagnostic[];
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
  readonly typeScheme?: TypeSchemeExpr | undefined;
}

export interface TypePolicy {
  readonly unboundSymbols?: readonly {
    readonly match: { readonly kind: "exact" | "prefix"; readonly value: string };
    readonly type: TypeSchemeExpr;
    readonly reason?: string | undefined;
  }[];
  readonly defaultBuiltinScheme?: "kernel" | "none" | undefined;
}

export interface ParseRequest {
  readonly sourceId?: string | undefined;
  readonly source: string;
}

export interface ParseResult extends PassResult {
  readonly pass: "parse";
  readonly ast: readonly AstNode[];
}

export interface ParsedSource extends ParseResult {
  readonly exprs: readonly Reader.SExpr[];
}

export interface ExpandRequest {
  readonly session?: LanguageSession | undefined;
  readonly sourceId?: string | undefined;
  readonly source?: string | undefined;
}

export interface ExpandResult extends PassResult {
  readonly pass: "expand";
  readonly ast: readonly AstNode[];
}

export interface TypecheckRequest {
  readonly session?: LanguageSession | undefined;
  readonly sourceId?: string | undefined;
  readonly source?: string | undefined;
  readonly hostBuiltins?: readonly HostBuiltinDescriptor[] | undefined;
  readonly typePolicy?: TypePolicy | undefined;
  readonly result?: "summary" | "per-expression" | undefined;
}

export interface TypecheckResult extends PassResult {
  readonly pass: "typecheck";
  readonly type?: TypeProjection | undefined;
  readonly display?: string | undefined;
  readonly expressionTypes?: readonly ExpressionType[] | undefined;
}

export interface EvaluateRequest {
  readonly sourceId?: string | undefined;
  readonly source: string;
  readonly env?: Env | undefined;
  readonly stepLimit?: number | undefined;
  /** Record the last value, count, and failure of each author-written expression. */
  readonly observe?: Evaluator.ObservationOptions | undefined;
}

/** Observations with failures projected to diagnostics. */
export interface ObservationReport {
  readonly records: readonly ExpressionObservation[];
  readonly truncated: boolean;
  readonly maxRecords: number;
}

export interface ExpressionObservation extends Omit<Evaluator.ExpressionObservation, "failure"> {
  readonly failure?: Diagnostic | undefined;
}

export interface EvaluateResult extends PassResult {
  readonly pass: "evaluate";
  readonly value: Evaluator.KValue;
  readonly printed?: string | undefined;
  readonly steps?: number | undefined;
  readonly env?: Env | undefined;
  /** Present when the request asked to observe, including after a failure. */
  readonly observations?: ObservationReport | undefined;
}

export interface EvaluateInSessionRequest {
  readonly session: LanguageSession;
  readonly sourceId?: string | undefined;
  readonly source?: string | undefined;
  readonly env?: Env | undefined;
  readonly stepLimit?: number | undefined;
  readonly observe?: Evaluator.ObservationOptions | undefined;
}

export function parse(request: ParseRequest): ParseResult {
  const { exprs: _exprs, ...result } = parseSource(request);
  return result;
}

export function parseSource(request: ParseRequest): ParsedSource {
  const sourceId = request.sourceId ?? "source";
  try {
    const exprs = Effect.runSync(Reader.parseManyToSExpr(request.source));
    return {
      sourceId,
      pass: "parse",
      exprs,
      ast: exprs.map((expr) => astFromSExpr(sourceId, expr)),
      diagnostics: [],
    };
  } catch (error) {
    return {
      sourceId,
      pass: "parse",
      exprs: [],
      ast: [],
      diagnostics: [diagnosticFromUnknown(error, "parse", sourceId)],
    };
  }
}

export function expand(request: ExpandRequest): ExpandResult {
  const sourceId = request.sourceId ?? (!request.source && request.session?.orderedSources("source").length === 1
    ? request.session.orderedSources("source")[0]!.id : "source");
  const source = sourceFromRequest(request);
  if (source === undefined) {
    return {
      sourceId,
      pass: "expand",
      ast: [],
      diagnostics: [
        {
          code: "session/source-not-found",
          severity: "error",
          message: `No loaded source found for ${request.sourceId ?? "source"}`,
          phase: "expand",
          span: {
            sourceId,
            startOffset: 0,
            endOffset: 0,
          },
        },
      ],
    };
  }

  try {
    const module =
      request.session?.projects.length || /\((?:import|export|export-from)\s/.test(source) ? graphFromRequest(request,sourceId,source).modules.at(-1)
        : undefined;
    const exprs =
      module?.expressions ?? Effect.runSync(Reader.parseManyToSExpr(source));
    const expanded =
      module?.compileTime?.expand(exprs) ??
      Evaluator.expandKernelExprsSync(exprs, {
      builtins: Builtins.defaultBuiltins,
      ...(request.session ? { env: request.session.env } : {}),
    }).expanded;
    return {
      sourceId,
      pass: "expand",
      ast: expanded.map((expr) => astFromSExpr(sourceId, expr)),
      diagnostics: [],
    };
  } catch (error) {
    return {
      sourceId,
      pass: "expand",
      ast: [],
      diagnostics: [moduleDiagnostic(error, "expand", sourceId)],
    };
  }
}

const typecheckPreludes = new WeakMap<LanguageSession, {fingerprint: string; prelude: BootstrappedPrelude}>();
function formDiagnostics(request: TypecheckRequest, sourceId: string, source: string): readonly Diagnostic[] {
  if (!request.session) return [];
  const session = request.session, fingerprint = session.preludeFingerprint();
  let cached = typecheckPreludes.get(session);
  if (!cached || cached.fingerprint !== fingerprint) {
    cached = {fingerprint, prelude: bootstrapFromSources("", "", {additionalSources: session.orderedSources("prelude").map(source=>source.text)})};
    typecheckPreludes.set(session, cached);
  }
  const expressions = toSExprMany(parseSurface(source).redTree);
  if (!expressions.some(e => cached!.prelude.descriptions.get(head(e) ?? "")?.surface || head(e) === "form" || head(e) === ":" && e._tag === "List" && (head(e.items[2]) === "Action" || e.items[2]?._tag === "List" && head(e.items[2]) === "->" && head(e.items[2].items.at(-1)) === "Action"))) return [];
  return elaborateSources([{sourceId,source}], {prelude:cached.prelude}).diagnostics.filter(d=>d.span?.sourceId === sourceId);
}

export function typecheck(request: TypecheckRequest): TypecheckResult {
  const sourceId = request.sourceId ?? (!request.source && request.session?.orderedSources("source").length === 1
    ? request.session.orderedSources("source")[0]!.id : "source");
  const source = sourceFromRequest(request);
  try { validateHostTypes(request, source); } catch (error) {
    return { sourceId, pass: "typecheck", diagnostics: [diagnosticFromUnknown(error, "typecheck", sourceId)] };
  }
  if (source !== undefined && (request.session?.projects.length || /\((?:import|export|export-from)\s/.test(source))) {
    try {
      const graph = graphFromRequest(request, sourceId, source);
      const checked = checkModuleGraph(graph,moduleCheckOptions(request));
      const display = moduleResultDisplay(checked, graph.entry);
      return { sourceId, pass:"typecheck", display, type:typeProjection(display), diagnostics:checked.diagnostics };
    } catch (error) {
      return { sourceId, pass:"typecheck", diagnostics:[moduleDiagnostic(error,"typecheck",sourceId)] };
    }
  }
  if (source === undefined) {
    return {
      sourceId,
      pass: "typecheck",
      diagnostics: [
        {
          code: "session/source-not-found",
          severity: "error",
          message: `No loaded source found for ${request.sourceId ?? "session"}`,
          phase: "typecheck",
          span: {
            sourceId,
            startOffset: 0,
            endOffset: 0,
          },
        },
      ],
    };
  }
  const mergedRequest = typecheckRequestWithSession(request);
  const mergedSource = mergedRequest.source ?? source;
  try {
    const formErrors = formDiagnostics(request, sourceId, source);
    if (formErrors.some(d=>d.severity === "error")) return {sourceId, pass:"typecheck", diagnostics:formErrors};
    const inferOptions = typeInferOptions(mergedRequest);
    const result =
      mergedRequest.result === "per-expression"
        ? Effect.runSync(Type.inferSourceAll(mergedSource, inferOptions))
        : Effect.runSync(Type.inferSource(mergedSource, inferOptions));
    const displays =
      "types" in result
        ? result.types.map((type) => Type.showType(type))
        : [Type.showType(result.type)];
    const diagnostics = result.diagnostics.map(
      (diagnostic): Diagnostic => ({
        code: "typecheck/diagnostic",
        severity: diagnostic.severity,
        message: diagnostic.message,
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
      }),
    );
    const display = displays.at(-1) ?? "Unit";
    return {
      sourceId,
      pass: "typecheck",
      type: typeProjection(display),
      display,
      diagnostics: [...formErrors, ...diagnostics],
      ...(mergedRequest.result === "per-expression"
        ? {
            expressionTypes: expressionTypesFromSource(sourceId, displays),
          }
        : {}),
    };
  } catch (error) {
    return {
      sourceId,
      pass: "typecheck",
      diagnostics: [diagnosticFromUnknown(error, "typecheck", sourceId)],
    };
  }
}

export async function evaluate(request: EvaluateRequest): Promise<EvaluateResult> {
  const sourceId = request.sourceId ?? "source";
  if (request.observe) {
    return evaluateObserved(request, request.observe, Builtins.defaultBuiltins);
  }
  try {
    const result = await Effect.runPromise(
      Effect.provide(
        Evaluator.evaluate(request.source, {
          stepLimit: request.stepLimit ?? 50_000,
          builtins: Builtins.defaultBuiltins,
          ...(request.env ? { env: request.env } : {}),
        }),
        Evaluator.makePreludeLayer(Builtins.defaultBuiltins),
      ),
    );
    return {
      sourceId,
      pass: "evaluate",
      value: result.value,
      printed: Evaluator.printKValue(result.value),
      steps: result.steps,
      env: result.env,
      diagnostics: [],
    };
  } catch (error) {
    return {
      sourceId,
      pass: "evaluate",
      value: null,
      diagnostics: [diagnosticFromUnknown(error, "evaluate", sourceId)],
    };
  }
}

export async function evaluateInSession(
  request: EvaluateInSessionRequest,
): Promise<EvaluateResult> {
  const sourceId = request.sourceId ?? (request.source ? "session" : (request.session.orderedSources("source")[0]?.id ?? "session"));
  const source = sourceFromRequest(request);
  if (source === undefined) {
    return {
      sourceId,
      pass: "evaluate",
      value: null,
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

  if (
    !request.session.projects.length &&
    !/\((?:import|export|export-from)\s/.test(source)
  ) {
    return evaluate({
      ...request,
      source,
      sourceId,
      env: request.env ?? request.session.env,
    });
  }
  try {
    const core = request.env ?? request.session.configurationEnv;
    let cached = moduleRuntimes.get(request.session);
    if (!cached || cached.core !== core) {
      cached = { core, runtime:new ModuleRuntime(core) };
      moduleRuntimes.set(request.session,cached);
    }
    const graph = graphFromRequest(request,sourceId,source);
    const { result,collector } = await cached.runtime.evaluate(graph,request.stepLimit,request.observe);
    return { sourceId, pass:"evaluate", value:result.value, env:result.env, printed:Evaluator.printKValue(result.value), steps:result.steps, diagnostics:[], ...(collector ? {observations:observationReport(collector)} : {}) };
  } catch (error) {
    return { sourceId, pass:"evaluate", value:null, diagnostics:[moduleDiagnostic(error,"evaluate",sourceId)] };
  }
}

const moduleRuntimes = new WeakMap<LanguageSession,{core:Env;runtime:ModuleRuntime}>();
export async function prepareModuleImports(request:EvaluateInSessionRequest,sourceId:string,source:string,core:Env):Promise<{expressions:readonly Reader.SExpr[];env:Env}> {
  if (!request.session.projects.length && !/\((?:import|export|export-from)\s/.test(source)) {
    return {expressions:Effect.runSync(Reader.parseManyToSExpr(source)),env:core};
  }
  let cached=moduleRuntimes.get(request.session);
  if (!cached || cached.core!==core) {cached={core,runtime:new ModuleRuntime(core)};moduleRuntimes.set(request.session,cached);}
  const graph=graphFromRequest(request,sourceId,source);
  return {expressions:graph.modules.find((m) =>m.id===graph.entry)!.expressions,env:await cached.runtime.imports(graph,request.stepLimit)};
}
function graphFromRequest(request:{readonly session?:LanguageSession|undefined},sourceId:string,source:string):ModuleGraph {
  return resolveModuleGraph({id:sourceId,source},sourceModuleResolver(request.session?.orderedSources("source").map((s) =>({id:s.id,source:s.text})) ?? []),moduleCoreOptions(request.session));
}
/** Only host configuration contributes names to the implicit core. */
export function moduleCoreOptions(session?:LanguageSession):import("../modules/graph.js").ModuleCoreOptions {
  return {
    bindings: new Set(session?.configurationEnv.bindingNames() ?? []),
    projects: session?.projects ?? [],
  };
}
function moduleDiagnostic(error:unknown,phase:DiagnosticPhase,sourceId:string):Diagnostic {
  return error instanceof Error && "diagnostic" in error ? (error as {diagnostic:Diagnostic}).diagnostic : diagnosticFromUnknown(error,phase,sourceId);
}

/**
 * Evaluate with observation. Failures are attributed to the innermost
 * author-written expression that contains their span, and the records
 * computed before a failure are returned with it.
 */
export async function evaluateObserved(
  request: EvaluateRequest,
  observe: Evaluator.ObservationOptions,
  builtins: Record<string, Evaluator.BuiltinFn>,
  resolvedExpressions?:readonly Reader.SExpr[],
): Promise<EvaluateResult> {
  const sourceId = request.sourceId ?? "source";
  const prepared=resolvedExpressions ? new Evaluator.ObservationCollector(request.source,resolvedExpressions,observe) : undefined;
  const { collector, evaluation } = prepared ? {collector:prepared,evaluation:Evaluator.evaluateExprs(resolvedExpressions!,{stepLimit:request.stepLimit ?? 50_000,builtins,...(request.env ? {env:request.env} : {}),observer:prepared})} : Evaluator.observeEvaluation(
    request.source,
    {
      stepLimit: request.stepLimit ?? 50_000,
      builtins,
      ...(request.env ? { env: request.env } : {}),
    },
    observe,
  );
  try {
    const result = await Effect.runPromise(evaluation);
    return {
      sourceId,
      pass: "evaluate",
      value: result.value,
      printed: Evaluator.printKValue(result.value),
      steps: result.steps,
      env: result.env,
      diagnostics: [],
      observations: observationReport(collector),
    };
  } catch (error) {
    const diagnostic = diagnosticFromUnknown(error, "evaluate", sourceId);
    if (diagnostic.span) {
      collector.fail(diagnostic, {
        start: diagnostic.span.startOffset,
        end: diagnostic.span.endOffset,
      });
    }
    return {
      sourceId,
      pass: "evaluate",
      value: null,
      diagnostics: [diagnostic],
      observations: observationReport(collector),
    };
  }
}

function observationReport(collector: Evaluator.ObservationCollector): ObservationReport {
  const report = collector.report();
  return {
    ...report,
    records: report.records.map(({ failure, ...record }) =>
      failure === undefined ? record : { ...record, failure: failure as Diagnostic },
    ),
  };
}

function expressionTypesFromSource(
  sourceId: string,
  topLevelDisplays: readonly string[],
): readonly ExpressionType[] {
  return topLevelDisplays.map((item, index) => ({
    expressionId: `${sourceId}:${index}`,
    formIndex: index,
    display: item,
    type: typeProjection(item),
  }));
}

export function typeProjection(display: string): TypeProjection {
  const named = new Set([
    "Int",
    "Float",
    "Bool",
    "Str",
    "String",
    "Unit",
    "Nil",
    "Keyword",
    "Symbol",
    "Syntax",
    "Any",
    "Map",
    "List",
    "Vector",
    "Declaration",
  ]);
  if (named.has(display)) {
    return { kind: "named", name: display === "String" ? "Str" : display, display };
  }
  return { kind: "display", display };
}

function spanFromLoc(sourceId: string, loc: Reader.Loc): Span {
  return {
    sourceId:loc.sourceId ?? sourceId,
    startOffset: loc.start,
    endOffset: loc.end,
    startLine: loc.line,
    startColumn: loc.col,
  };
}

function astFromSExpr(sourceId: string, expr: Reader.SExpr): AstNode {
  switch (expr._tag) {
    case "Sym":
      if (expr.name === "nil") return {kind:"nil",span:spanFromLoc(sourceId,expr.loc)};
      return expr.name.startsWith(":")
        ? { kind: "keyword", value: expr.name, span: spanFromLoc(sourceId, expr.loc) }
        : { kind: "symbol", value: expr.name, span: spanFromLoc(sourceId, expr.loc) };
    case "Str":
      return { kind: "string", value: expr.value, span: spanFromLoc(sourceId, expr.loc) };
    case "Num":
      return {
        kind: Number.isInteger(expr.value) ? "int" : "float",
        value: expr.value,
        span: spanFromLoc(sourceId, expr.loc),
      };
    case "Bool":
      return { kind: "bool", value: expr.value, span: spanFromLoc(sourceId, expr.loc) };
    case "Vector":
      return {
        kind: "vector",
        items: expr.items.map((item) => astFromSExpr(sourceId, item)),
        span: spanFromLoc(sourceId, expr.loc),
      };
    case "List":
      return {
        kind: "list",
        items: expr.items.map((item) => astFromSExpr(sourceId, item)),
        span: spanFromLoc(sourceId, expr.loc),
      };
    case "Map":
      return {
        kind: "map",
        entries: expr.pairs.map(([key, value]) => ({
          key: astFromSExpr(sourceId, key),
          value: astFromSExpr(sourceId, value),
        })),
        span: spanFromLoc(sourceId, expr.loc),
      };
    case "Set":
      return {
        kind: "set",
        items: expr.items.map((item) => astFromSExpr(sourceId, item)),
        span: spanFromLoc(sourceId, expr.loc),
      };
    case "Error":
      return {
        kind: "error",
        message: expr.message,
        span: spanFromLoc(sourceId, expr.loc),
      };
  }
}

function sourceFromRequest(
  request: ExpandRequest | TypecheckRequest | EvaluateInSessionRequest,
): string | undefined {
  return (
    request.source ??
    (request.sourceId !== undefined
      ? request.session?.sourceText(normalizeModuleId(request.sourceId))
      : request.session !== undefined
        ? request.session.orderedSources("source").length === 1 ? request.session.orderedSources("source")[0]?.text : undefined
        : undefined)
  );
}

function typecheckRequestWithSession(request: TypecheckRequest): TypecheckRequest {
  if (!request.session) return request;
  return {
    ...request,
    source: sourceFromRequest(request) ?? "",
    typePolicy: typePolicyWithSessionBindings(
      request.typePolicy,
      request.session.env.bindingNames(),
    ),
  };
}

function typePolicyWithSessionBindings(
  policy: TypePolicy | undefined,
  bindingNames: readonly string[],
): TypePolicy | undefined {
  if (bindingNames.length === 0) return policy;
  return {
    ...policy,
    unboundSymbols: [
      ...(policy?.unboundSymbols ?? []),
      ...bindingNames.map((name) => ({
        match: { kind: "exact" as const, value: name },
        type: { kind: "any" as const },
        reason: "session binding",
      })),
    ],
  };
}

export function moduleCheckOptions(request: TypecheckRequest): import("../modules/check.js").ModuleCheckOptions {
  const env = request.session?.configurationEnv;
  const coreExpressions = env
    ?.bindingNames()
    .map((name) => ({
      _tag: "List" as const,
      loc: { start: 0, end: 0, line: 1, col: 1 },
      items: [
        {
          _tag: "Sym" as const,
          name: "define",
          loc: { start: 0, end: 0, line: 1, col: 1 },
        },
        {
          _tag: "Sym" as const,
          name,
          loc: { start: 0, end: 0, line: 1, col: 1 },
        },
        Evaluator.kValueToSExpr(env.lookup(name)!),
      ],
    }));
  return {
    ...typeInferOptions(request),
    ...(coreExpressions ? { coreExpressions } : {})};
}

/** How the type checker sees host builtins and names a type policy covers. */
export function typeInferOptions(
  request: Pick<TypecheckRequest, "hostBuiltins" | "typePolicy">,
): Type.InferOptions {
  validateHostTypes(request);
  const builtinScheme = builtinSchemeFromRequest(request);
  const unboundSymbolType = unboundSymbolTypeFromPolicy(request.typePolicy);
  return {
    ...(builtinScheme ? { builtinScheme } : {}),
    ...(unboundSymbolType ? { unboundSymbolType } : {}),
  };
}

function builtinSchemeFromRequest(
  request: Pick<TypecheckRequest, "hostBuiltins" | "typePolicy">,
): Type.BuiltinSchemeProvider | undefined {
  if (!request.hostBuiltins && request.typePolicy?.defaultBuiltinScheme !== "none") {
    return undefined;
  }

  const hostBuiltins = new Map(
    (request.hostBuiltins ?? [])
      .filter(
        (builtin): builtin is HostBuiltinDescriptor & { readonly typeScheme: TypeSchemeExpr } =>
          builtin.typeScheme !== undefined,
      )
      .map((builtin) => [builtin.name, Type.mono(typeFromSchemeExpr(builtin.typeScheme))] as const),
  );

  return (name) => {
    const hostScheme = hostBuiltins.get(name);
    if (hostScheme) return hostScheme;
    if (request.typePolicy?.defaultBuiltinScheme === "none") return undefined;
    return Type.builtinScheme(name);
  };
}

function unboundSymbolTypeFromPolicy(
  policy: TypePolicy | undefined,
): ((name: string) => Type.Type | undefined) | undefined {
  if (!policy?.unboundSymbols) return undefined;
  return (name) => {
    for (const entry of policy.unboundSymbols ?? []) {
      const matches =
        entry.match.kind === "exact"
          ? name === entry.match.value
          : name.startsWith(entry.match.value);
      if (matches) return typeFromSchemeExpr(entry.type);
    }
    return undefined;
  };
}

function typeFromSchemeExpr(expr: TypeSchemeExpr): Type.Type {
  switch (expr.kind) {
    case "type":
      return primitiveType(expr.name);
    case "function":
      return Type.fnType(expr.params.map(typeFromSchemeExpr), typeFromSchemeExpr(expr.result));
    case "variadic-function":
      return Type.variadicFnType(
        expr.params.map(typeFromSchemeExpr),
        typeFromSchemeExpr(expr.rest),
        typeFromSchemeExpr(expr.result),
      );
    case "list":
      return Type.TApp(Type.tList, [typeFromSchemeExpr(expr.item)]);
    case "map":
      return Type.TApp(Type.TCon("Map"), [
        typeFromSchemeExpr(expr.key),
        typeFromSchemeExpr(expr.value),
      ]);
    case "any":
      return Type.tUnknown;
  }
}

function primitiveType(name: string): Type.Type {
  switch (name) {
    case "Number":
    case "Num":
    case "Int":
    case "Float":
      return Type.tNum;
    case "String":
    case "Str":
      return Type.tStr;
    case "Boolean":
    case "Bool":
      return Type.tBool;
    case "Unit":
    case "Nil":
      return Type.tNil;
    case "Any":
    case "Unknown":
      return Type.tUnknown;
    default:
      if (!hostTypeNames.has(name)) throw new Type.InferenceError({ message: `Unknown host type ${name}`, details: { code: "typecheck/host-builtin" } });
      return Type.TCon(name);
  }
}
