/** JSON boundary for process embeddings. One host instance owns daemon sessions. */
import { Schema } from "effect";
import * as Engine from "@formalang/ts/engine";
import type { TypeSchemeExpr, ValueProjection } from "./types.js";
import { TsLanguageHost } from "./ts-host.js";

const id = Schema.String.check(Schema.isMinLength(1));
const optionalString = Schema.optionalKey(Schema.String);
export const TypeScheme: Schema.Codec<TypeSchemeExpr> = Schema.suspend(() => Schema.Union([
  Schema.Struct({ kind: Schema.Literal("type"), name: id }),
  Schema.Struct({ kind: Schema.Literal("any") }),
  Schema.Struct({ kind: Schema.Literal("function"), params: Schema.Array(TypeScheme), result: TypeScheme }),
  Schema.Struct({ kind: Schema.Literal("variadic-function"), params: Schema.Array(TypeScheme), rest: TypeScheme, result: TypeScheme }),
  Schema.Struct({ kind: Schema.Literal("list"), item: TypeScheme }),
  Schema.Struct({ kind: Schema.Literal("map"), key: TypeScheme, value: TypeScheme }),
]));
const policy = Schema.Struct({
  defaultBuiltinScheme: Schema.optionalKey(Schema.Literals(["kernel", "none"])),
  unboundSymbols: Schema.optionalKey(Schema.Array(Schema.Struct({
    match: Schema.Struct({ kind: Schema.Literals(["exact", "prefix"]), value: Schema.String }),
    type: TypeScheme, reason: optionalString,
  }))),
});
const builtin = Schema.Struct({ name: id, typeScheme: Schema.optionalKey(TypeScheme),
  arity: Schema.optionalKey(Schema.Union([Schema.Int, Schema.Struct({min: Schema.Int, max: Schema.optionalKey(Schema.Int)})])),
  handler: Schema.optionalKey(Schema.Struct({ kind: Schema.Literal("host-effect"), effect: id })),
  purity: Schema.optionalKey(Schema.Literals(["pure", "read", "write", "service"])),
});
const hostBuiltins = (input: readonly (typeof builtin.Type)[] | undefined) => input?.map(b => ({...b, arity:b.arity ?? {min:0}, handler:b.handler ?? {kind:"host-effect" as const, effect:b.name}}));
export const JsonValueProjection: Schema.Codec<ValueProjection> = Schema.suspend(() => Schema.Union([
  Schema.Struct({ kind: Schema.Literal("nil"), valueRef: optionalString }),
  Schema.Struct({ kind: Schema.Literal("bool"), valueRef: optionalString, value: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal("int"), valueRef: optionalString, value: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal("float"), valueRef: optionalString, value: Schema.Union([Schema.Number, Schema.Literals(["NaN", "Infinity", "-Infinity", "-0"])]) }),
  Schema.Struct({ kind: Schema.Literals(["string", "symbol", "keyword"]), valueRef: optionalString, value: Schema.String }),
  Schema.Struct({ kind: Schema.Literals(["list", "vector"]), valueRef: optionalString, items: Schema.Array(value) }),
  Schema.Struct({ kind: Schema.Literal("map"), valueRef: optionalString, entries: Schema.Array(Schema.Struct({ key: value, value })) }),
  Schema.Struct({ kind: Schema.Literal("opaque"), valueRef: optionalString, tag: Schema.String, display: optionalString }),
  Schema.Struct({ kind: Schema.Literal("function"), valueRef: id, display: optionalString }),
]));
const value = JsonValueProjection;
const configuration = { hostBuiltins: Schema.optionalKey(Schema.Array(builtin)), typePolicy: Schema.optionalKey(policy) };
const variables = Schema.optionalKey(Schema.Array(Schema.Struct({ name: id, value })));
const projects = Schema.optionalKey(Schema.Array(Schema.Struct({ id, base: id, prelude: optionalString, modules: Schema.optionalKey(Schema.Array(id)) })));
const source = { source: Schema.String, sourceId: optionalString };
const sessionSource = { source: optionalString, sourceId: optionalString, sessionId: optionalString };
const session = { sessionId: id };
const document = Schema.Struct({ ...source, sourceId: id, kind: Schema.optionalKey(Schema.Literals(["source", "prelude", "generated"])) });
const operation = <N extends string, F extends Schema.Struct.Fields>(op: N, fields: F) => Schema.Struct({ op: Schema.Literal(op), ...fields });
const stepLimit = Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0)));
const observe = Schema.optionalKey(Schema.Struct({
  maxRecords: Schema.optionalKey(Schema.Int), maxItems: Schema.optionalKey(Schema.Int),
  maxDepth: Schema.optionalKey(Schema.Int), maxStringLength: Schema.optionalKey(Schema.Int),
}));
/** Unsupported operations return abi/unsupported-op; known operations decode strictly. */
export const JsonRequest = Schema.Union([
  operation("version", {}), operation("openSession", { defaultStepLimit: stepLimit }),
  operation("configureSession", { ...session, ...configuration, variables, projects }),
  operation("loadSource", { ...session, ...document.fields, timings: Schema.optionalKey(Schema.Boolean) }),
  operation("loadSourceBundle", { ...session, sources: Schema.Array(document), timings: Schema.optionalKey(Schema.Boolean) }),
  ...(["closeSession", "resetSession", "sessionInfo"] as const).map(op => operation(op, session)),
  ...(["parse", "parseAst", "parseSummary", "incrementalSummary"] as const).map(op => operation(op, source)),
  operation("expand", sessionSource),
  ...(["typecheck", "typecheckCore", "typecheckCoreTyped", "lowerCore"] as const).map(op => operation(op, { ...sessionSource, ...configuration, result: Schema.optionalKey(Schema.Literals(["summary", "per-expression"])) })),
  operation("evaluate", { ...source, variables, stepLimit, observe }),
  operation("evaluateInSession", { ...sessionSource, ...session, variables, stepLimit, observe, evaluationId: optionalString, retainValues: Schema.optionalKey(Schema.Literals(["none", "functions", "all"])) }),
  operation("callValue", { ...session, valueRef: id, args: Schema.Array(value), stepLimit, evaluationId: optionalString }),
  operation("resumeHostCall", { ...session, evaluationId: id, callId: id, result: Schema.Union([
    Schema.Struct({ok: Schema.Literal(true), value}),
    Schema.Struct({ok: Schema.Literal(false), diagnostics: Schema.Array(Schema.Struct({code:id, severity:Schema.Literal("error"), message:Schema.String}))}),
  ]) }),
  operation("abortEvaluation", {...session, evaluationId:id}),
  operation("projectValue", {sessionId:optionalString, valueRef:optionalString, value:Schema.optionalKey(value), projections:Schema.Array(Schema.Literals(["printed", "plain-json", "triple-value", "truthy", "summary"]))}),
  operation("releaseValue", {...session, valueRefs:Schema.Array(id)}),
  ...(["moduleGraph", "linkEffectModules"] as const).map(op => operation(op, { ...session, sourceId: id, source: optionalString, projects })),
]);
export type JsonRequest = typeof JsonRequest.Type;
const span = Schema.Struct({ sourceId: Schema.String, startOffset: Schema.Number, endOffset: Schema.Number });
export const JsonDiagnostic = Schema.Struct({
  code: Schema.String, severity: Schema.Literals(["error", "warning", "info"]), message: Schema.String,
  phase: Schema.optional(Schema.String), span: Schema.optional(span), details: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
/** Payloads are operation-specific host projections or engine debug trees. */
export const JsonResponse = Schema.Struct({
  ok: Schema.Boolean, value: Schema.optionalKey(Schema.Unknown), type: optionalString,
  typedCore: Schema.optionalKey(Schema.Unknown), diagnostics: Schema.Array(JsonDiagnostic),
});
export type JsonResponse = typeof JsonResponse.Type;
const errorResponse = (code: string, message: string): JsonResponse => ({ ok: false, diagnostics: [{ code, severity: "error", message }] });
const envelope = (value: unknown, diagnostics: readonly Engine.Diagnostic[] = []): JsonResponse => ({ ok: !diagnostics.some(d => d.severity === "error"), value, diagnostics });

export class JsonAbi {
  private readonly sessions = new Set<string>();
  constructor(readonly host = new TsLanguageHost()) {}

  async handleJson(text: string): Promise<JsonResponse> {
    let input: unknown;
    try { input = JSON.parse(text); } catch (error) { return errorResponse("abi/invalid-json", String(error)); }
    const op = input && typeof input === "object" && "op" in input ? input.op : undefined;
    if (typeof op !== "string") return errorResponse("abi/missing-op", "Request JSON must include a string op field.");
    if (input && typeof input === "object") {
      const config = input as {hostBuiltins?:unknown; typePolicy?:unknown; source?:unknown; sourceId?:unknown};
      try { Engine.validateHostTypes(config, typeof config.source === "string" ? config.source : ""); }
      catch (error) { return {ok:false, diagnostics:[Engine.diagnosticFromUnknown(error,"typecheck",typeof config.sourceId === "string" ? config.sourceId : "request")]}; }
    }
    let request: JsonRequest;
    try { request = Schema.decodeUnknownSync(JsonRequest)(input, { onExcessProperty: "error" }); }
    catch (error) {
      const supported = ["version", "openSession", "configureSession", "loadSource", "loadSourceBundle", "closeSession", "resetSession", "sessionInfo", "parse", "parseAst", "parseSummary", "incrementalSummary", "expand", "typecheck", "typecheckCore", "typecheckCoreTyped", "lowerCore", "evaluate", "evaluateInSession", "moduleGraph", "linkEffectModules", "callValue", "resumeHostCall", "abortEvaluation", "projectValue", "releaseValue"];
      return errorResponse(supported.includes(op) ? "abi/invalid-request" : "abi/unsupported-op", String(error));
    }
    if ("sessionId" in request && request.sessionId) {
      if (!this.sessions.has(request.sessionId)) return errorResponse("abi/unknown-session", `Unknown session ${request.sessionId}. Open a session first.`);
    }
    try { return Schema.decodeUnknownSync(JsonResponse)(await this.dispatch(request)); }
    catch (error) { return errorResponse("internal/error", `Internal error while handling ${op}: ${String(error)}`); }
  }

  private async dispatch(request: JsonRequest): Promise<JsonResponse> {
    switch (request.op) {
      case "version": return envelope(await this.host.version());
      case "openSession": { const result = await this.host.openSession(request); this.sessions.add(result.sessionId); return envelope(result); }
      case "configureSession": return envelope(await this.host.configureSession({...request, hostBuiltins:hostBuiltins(request.hostBuiltins)}));
      case "loadSource": { const result = await this.host.loadSource(request); return envelope(result, result.diagnostics); }
      case "loadSourceBundle": { const result = await this.host.loadSourceBundle(request); return envelope(result, result.diagnostics); }
      case "closeSession": { const result = await this.host.closeSession(request); this.sessions.delete(request.sessionId); return envelope(result); }
      case "resetSession": return envelope(await this.host.resetSession(request));
      case "sessionInfo": return envelope(await this.host.sessionInfo(request));
      case "parse": case "parseAst": case "parseSummary": case "incrementalSummary": {
        const result = await this.host.parse(request);
        if (request.op === "parseSummary") return envelope({ formCount: result.ast.length }, result.diagnostics);
        if (request.op === "incrementalSummary") {
          const {diagnostics, ...summary} = Engine.incrementalSummary(request);
          return envelope(summary, diagnostics);
        }
        return envelope(result.ast, result.diagnostics);
      }
      case "expand": { const result = await this.host.expand(request); return envelope(result.ast, result.diagnostics); }
      case "typecheck": {
        const result = await this.host.typecheck({...request, hostBuiltins:hostBuiltins(request.hostBuiltins)});
        return { ...envelope(result, result.diagnostics), ...(result.display ? { type: result.display } : {}) };
      }
      case "lowerCore": case "typecheckCore": case "typecheckCoreTyped": {
        const result = await this.host.debugCore({...request, hostBuiltins:hostBuiltins(request.hostBuiltins)}, request.op);
        return { ...envelope(result.core, result.diagnostics), ...(result.display ? {type: result.display} : {}), ...(result.typedCore ? {typedCore: result.typedCore} : {}) };
      }
      case "evaluate": { const result = await this.host.evaluate(request); return envelope(result.value, result.diagnostics); }
      case "evaluateInSession": {
        const result = await this.host.evaluateInSession(request);
        return envelope(result, result.status === "failed" ? result.diagnostics : result.status === "completed" ? result.result.diagnostics : []);
      }
      case "callValue": case "resumeHostCall": {
        const result = request.op === "callValue" ? await this.host.callValue(request) : await this.host.resumeHostCall(request);
        return envelope(result, result.status === "failed" ? result.diagnostics : result.status === "completed" ? result.result.diagnostics : []);
      }
      case "abortEvaluation": return envelope(await this.host.abortEvaluation(request));
      case "projectValue": {const result = await this.host.projectValue(request); return envelope(result, result.diagnostics);}
      case "releaseValue": return envelope(await this.host.releaseValue(request));
      case "moduleGraph": { const result = await this.host.moduleGraph(request); return envelope(result, result.diagnostics); }
      case "linkEffectModules": { const result = await this.host.linkEffectModules(request); return envelope(result, result.diagnostics); }
    }
  }
}
