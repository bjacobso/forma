/** Shared, versioned contract for the TypeScript host and JSON process boundary. */
import { Schema } from "effect";
import * as Engine from "@formalang/ts/engine";
import type { TypeSchemeExpr, ValueProjection, OutlineItem } from "./types.js";
import type { TsLanguageHost } from "./ts-host.js";

export const HOST_ABI_VERSION = "0.2.0";
// SemVer 2.0: numeric prerelease identifiers cannot have leading zeroes.
export const semverVersion = Schema.String.check(Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u));
const id = Schema.String.check(Schema.isMinLength(1));
const optionalString = Schema.optionalKey(Schema.String);
const offsetSpan = Schema.Struct({ start: Schema.Int, end: Schema.Int });
const identity = Schema.Struct({
  version: Schema.Literal(1), idPrefix: Schema.String, nextId: Schema.Int,
  nodes: Schema.Array(Schema.Struct({
    id, kind: Schema.Literals(["List", "Vector", "Map", "Set", "Symbol", "String", "Number", "Boolean", "ReaderMacro", "Error", "Comment"]),
    span: offsetSpan, parent: Schema.Union([Schema.String, Schema.Null]), index: Schema.Int,
  })),
  errors: Schema.Array(Schema.Struct({ message: Schema.String, span: offsetSpan })),
});
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
const packages = Schema.optionalKey(Schema.Struct({
  packages: Schema.Array(Schema.Struct({
    name: id, version: optionalString, exports: Schema.Record(Schema.String, Schema.String),
    dependencies: Schema.optionalKey(Schema.Array(id)), prelude: optionalString,
  })),
  dependencies: Schema.optionalKey(Schema.Array(id)),
}));
const source = { source: Schema.String, sourceId: optionalString };
const sessionSource = { source: optionalString, sourceId: optionalString, sessionId: optionalString };
const session = { sessionId: id };
const document = Schema.Struct({ ...source, sourceId: id, kind: Schema.optionalKey(Schema.Literals(["source", "prelude", "generated"])) });
const stepLimit = Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0)));
const resultProjection = Schema.optionalKey(Schema.Array(Schema.Literals(["printed", "plain-json", "triple-value", "truthy", "summary"])));
const observe = Schema.optionalKey(Schema.Struct({
  identity: Schema.optionalKey(identity),
  maxRecords: Schema.optionalKey(Schema.Int), maxItems: Schema.optionalKey(Schema.Int),
  maxDepth: Schema.optionalKey(Schema.Int), maxStringLength: Schema.optionalKey(Schema.Int),
}));
const evaluation = { ...session, variables, stepLimit, observe, resultProjection, evaluationId: optionalString,
  retainValues: Schema.optionalKey(Schema.Literals(["none", "functions", "all"])) };
const artifact = { ...session, sourceId: optionalString, sourceIds: Schema.optionalKey(Schema.Array(id)), backend: optionalString };
const span = Schema.Struct({ sourceId: Schema.String, startOffset: Schema.Number, endOffset: Schema.Number,
  startLine: Schema.optional(Schema.Number), startColumn: Schema.optional(Schema.Number), endLine: Schema.optional(Schema.Number), endColumn: Schema.optional(Schema.Number) });
export const JsonDiagnostic = Schema.Struct({
  code: Schema.String, severity: Schema.Literals(["error", "warning", "info"]), message: Schema.String,
  phase: Schema.optional(Schema.String), span: Schema.optional(span), details: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  help: Schema.optional(Schema.String),
  fix: Schema.optional(Schema.Array(Schema.Struct({span, newText:Schema.String}))),
});
/** Payloads are operation-specific host projections or engine debug trees. */
export const JsonResponse = Schema.Struct({
  ok: Schema.Boolean, value: Schema.optionalKey(Schema.Unknown), type: optionalString,
  typedCore: Schema.optionalKey(Schema.Unknown), diagnostics: Schema.Array(JsonDiagnostic),
});
export type JsonResponse = typeof JsonResponse.Type;
const envelope = (value: unknown, diagnostics: readonly Engine.Diagnostic[] = []): JsonResponse => ({ ok: !diagnostics.some(d => d.severity === "error"), value, diagnostics });

const optionalIdentity = Schema.optionalKey(identity);
const base = Schema.Struct({ source: Schema.String, identity });
const outlineItem: Schema.Codec<OutlineItem> = Schema.suspend(() => Schema.Struct({
  id: Schema.String, text: Schema.String, children: Schema.Array(outlineItem),
}));
const symbolInput = { ...source, identity: optionalIdentity, sessionId: optionalString,
  documents: Schema.optionalKey(Schema.Array(Schema.Struct({ ...document.fields, identity: optionalIdentity }))) };
const position = { offset: Schema.optionalKey(Schema.Int), nodeId: optionalString };

// Structural results are described explicitly; engine debug trees remain open JSON.
const diagnostics = Schema.Array(JsonDiagnostic);
const nodeDescription = Schema.Struct({
  id, kind: Schema.Literals(["List", "Vector", "Map", "Set", "Symbol", "String", "Number", "Boolean", "ReaderMacro", "Error", "Comment"]), text: Schema.String,
  parent: Schema.Union([Schema.String, Schema.Null]), head: optionalString,
  path: Schema.Array(Schema.String), topLevel: Schema.Struct({ id, text: Schema.String }),
});
const definition = Schema.Struct({
  key: Schema.String, name: Schema.String,
  kind: Schema.Literals(["value", "function", "macro", "type", "constructor", "method", "declaration", "parameter", "local"]),
  scope: Schema.Literals(["global", "local"]), nodeId: id, span, form: Schema.String,
  formNodeId: optionalString, scopeNodeId: optionalString,
});
const reference = Schema.Struct({
  name: Schema.String, nodeId: id, span,
  resolution: Schema.Literals(["definition", "builtin", "form", "unresolved"]), definition: optionalString,
});
const editPlace = Schema.Union([
  Schema.Struct({ before: id }), Schema.Struct({ after: id }),
  Schema.Struct({ parent: Schema.Union([Schema.String, Schema.Null]), index: Schema.optionalKey(Schema.Int) }),
]);
const insertion = Schema.Struct({ at: editPlace, text: Schema.String, cursor: Schema.Int });
const outlineErrors = Schema.Array(Schema.Struct({ id: Schema.String, message: Schema.String }));
const typeProjection = Schema.Struct({ kind: Schema.String, display: Schema.String });
const evaluationResult = Schema.Struct({
  value, printed: optionalString, type: Schema.optionalKey(typeProjection),
  projected: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)), steps: Schema.optionalKey(Schema.Number), diagnostics,
  observations: Schema.optionalKey(Schema.Struct({
    records: Schema.Array(Schema.Struct({ nodeId: id, span, count: Schema.Int,
      value: Schema.optionalKey(value), failure: Schema.optionalKey(JsonDiagnostic) })),
    truncated: Schema.Boolean,
    limits: Schema.Struct({ maxRecords: Schema.Int, maxItems: Schema.Int, maxDepth: Schema.Int, maxStringLength: Schema.Int }),
  })),
});
const editResult = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), sourceId: Schema.String, source: Schema.String, identity,
    changes: Schema.Struct({ added: Schema.Array(id), removed: Schema.Array(id), moved: Schema.Array(id), edited: Schema.Array(id) }),
    forms: Schema.Array(Schema.Struct({ id, before: optionalString, after: optionalString })),
  }),
  Schema.Struct({ ok: Schema.Literal(false), sourceId: Schema.String,
    errors: Schema.Array(Schema.Struct({ op: Schema.Int, code: Schema.String, message: Schema.String })),
  }),
]);
const formSlotsResult = Schema.Struct({
  sourceId: Schema.String,
  form: Schema.optionalKey(Schema.Struct({ name: Schema.String, nodeId: id, span, phase: Schema.Literals(["meta", "domain"]), doc: optionalString })),
  identifiers: Schema.Array(Schema.Struct({ name: Schema.String, kind: Schema.Literals(["Symbol", "String", "Value"]), declaration: Schema.Boolean,
    doc: optionalString, nodeId: optionalString, span: Schema.optionalKey(span), insertion: Schema.optionalKey(insertion) })),
  slots: Schema.Array(Schema.Struct({
    name: Schema.String, mode: Schema.Literals(["value", "expr", "form"]), required: Schema.Boolean, many: Schema.Boolean,
    type: optionalString, doc: optionalString, aliases: Schema.Array(Schema.String), childForm: optionalString,
    childForms: Schema.optionalKey(Schema.Array(Schema.String)),
    occurrences: Schema.Array(Schema.Struct({ nodeId: id, span, values: Schema.Array(Schema.Struct({ nodeId: id, span })) })),
    empty: Schema.Boolean, missing: Schema.Boolean, available: Schema.Boolean, placeholder: Schema.String, insertion,
  })),
  activeSlot: optionalString, unknownSlots: Schema.Array(Schema.Struct({ name: Schema.String, nodeId: id })),
});
const response = (payload: Schema.Codec<unknown>) => Schema.Struct({ ...JsonResponse.fields, value: Schema.optionalKey(payload) });

interface OperationContext { readonly host: TsLanguageHost; readonly sessions: Set<string> }
const operation = <N extends string, F extends Schema.Struct.Fields>(
  name: N, fields: F,
  project: (context: OperationContext, request: Schema.Struct.Type<F>) => Promise<JsonResponse>,
  payload: Schema.Codec<unknown> = Schema.Unknown,
) => ({
  name,
  request: Schema.Struct({ op: Schema.Literal(name), abiVersion: Schema.optionalKey(semverVersion), ...fields }),
  response: response(payload),
  sessionScope: "sessionId" in fields ? (fields.sessionId === id ? "required" : "optional") : "none",
  // Called only after decoding the discriminated request union at the boundary.
  project: (context: OperationContext, request: unknown) => project(context, request as Schema.Struct.Type<F>),
});
const stateResponse = (result: Awaited<ReturnType<TsLanguageHost["evaluateInSession"]>>) => ({
  ...envelope(result, result.status === "failed" ? result.diagnostics : result.status === "completed" ? result.result.diagnostics : []),
  ...(result.status === "completed" && result.result.type ? { type: result.result.type.display } : {}),
});

/** The only operation registry: schemas, dispatch/projection, and session scope. */
export const HOST_OPERATIONS = [
  operation("version", {}, async ({host}) => envelope(await host.version())),
  operation("openSession", { defaultStepLimit: stepLimit, astKeywordContract: Schema.optionalKey(Schema.Literal("keyword")) }, async ({host, sessions}, request) => {
    const result = await host.openSession(request); sessions.add(result.sessionId); return envelope(result);
  }),
  operation("configureSession", { ...session, ...configuration, variables, projects, packages }, async ({host}, request) =>
    envelope(await host.configureSession({...request, hostBuiltins: hostBuiltins(request.hostBuiltins)}))),
  operation("loadSource", { ...session, ...document.fields, timings: Schema.optionalKey(Schema.Boolean) }, async ({host}, request) => {
    const result = await host.loadSource(request); return envelope(result, result.diagnostics);
  }),
  operation("loadSourceBundle", { ...session, sources: Schema.Array(document), timings: Schema.optionalKey(Schema.Boolean) }, async ({host}, request) => {
    const result = await host.loadSourceBundle(request); return envelope(result, result.diagnostics);
  }),
  operation("closeSession", session, async ({host, sessions}, request) => {
    const result = await host.closeSession(request); sessions.delete(request.sessionId); return envelope(result);
  }),
  operation("resetSession", session, async ({host}, request) => envelope(await host.resetSession(request))),
  operation("sessionInfo", session, async ({host}, request) => envelope(await host.sessionInfo(request))),
  ...(["parse", "parseAst", "parseSummary", "incrementalSummary"] as const).map(name => operation(name, source, async ({host}, request) => {
    if (name === "incrementalSummary") { const {diagnostics, ...summary} = Engine.incrementalSummary(request); return envelope(summary, diagnostics); }
    const result = await host.parse(request);
    return envelope(name === "parseSummary" ? { formCount: result.ast.length } : result.ast, result.diagnostics);
  })),
  operation("expand", sessionSource, async ({host}, request) => {
    const result = await host.expand(request); return envelope(result.ast, result.diagnostics);
  }),
  ...(["typecheck", "typecheckCore", "typecheckCoreTyped", "lowerCore"] as const).map(name => operation(name,
    { ...sessionSource, ...configuration, result: Schema.optionalKey(Schema.Literals(["summary", "per-expression"])) }, async ({host}, request) => {
      const input = {...request, hostBuiltins: hostBuiltins(request.hostBuiltins)};
      if (name === "typecheck") {
        const result = await host.typecheck(input);
        return { ...envelope(result, result.diagnostics), ...(result.display ? { type: result.display } : {}) };
      }
      const result = await host.debugCore(input, name);
      return { ...envelope(result.core, result.diagnostics), ...(result.display ? {type: result.display} : {}), ...(result.typedCore ? {typedCore: result.typedCore} : {}) };
    })),
  operation("evaluate", { ...source, variables, stepLimit, observe, resultProjection, typePolicy: Schema.optionalKey(policy) }, async ({host}, request) => {
    const result = await host.evaluate(request); return envelope(result.value, result.diagnostics);
  }),
  operation("observe", { ...source, variables, stepLimit, observe, resultProjection, typePolicy: Schema.optionalKey(policy) }, async ({host}, request) => {
    const result = await host.observe(request); return envelope(result, result.diagnostics);
  }, evaluationResult),
  operation("evaluateInSession", { ...sessionSource, ...evaluation }, async ({host}, request) => stateResponse(await host.evaluateInSession(request))),
  operation("replSubmit", { ...source, ...evaluation }, async ({host}, request) => stateResponse(await host.replSubmit(request))),
  operation("emit", { ...artifact, source: optionalString }, async ({host}, request) => {
    const result = await host.emit(request); return envelope(result, result.diagnostics);
  }),
  operation("emitMany", artifact, async ({host}, request) => {
    const result = await host.emitMany(request); return envelope(result, result.results.flatMap(r => r.diagnostics));
  }),
  operation("artifactSummary", artifact, async ({host}, request) => {
    const result = await host.artifactSummary(request); return envelope(result, result.diagnostics);
  }),
  operation("emitBackends", {}, async ({host}) => envelope(await host.emitBackends())),
  operation("callValue", { ...session, valueRef: id, args: Schema.Array(value), stepLimit, evaluationId: optionalString,
    retainValues: Schema.optionalKey(Schema.Literals(["none", "functions", "all"])),
    resultProjection: Schema.optionalKey(Schema.Array(Schema.Literals(["printed", "plain-json", "triple-value", "truthy", "summary"]))) },
    async ({host}, request) => stateResponse(await host.callValue(request))),
  operation("resumeHostCall", { ...session, evaluationId: id, callId: id, result: Schema.Union([
    Schema.Struct({ok: Schema.Literal(true), value, hostEffects: Schema.optionalKey(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)))}),
    Schema.Struct({ok: Schema.Literal(false), diagnostics: Schema.Array(Schema.Struct({code:id, severity:Schema.Literal("error"), message:Schema.String}))}),
  ]) }, async ({host}, request) => stateResponse(await host.resumeHostCall(request))),
  operation("abortEvaluation", {...session, evaluationId:id, reason: optionalString}, async ({host}, request) => envelope(await host.abortEvaluation(request))),
  operation("projectValue", {sessionId:optionalString, valueRef:optionalString, value:Schema.optionalKey(value), projections:Schema.Array(Schema.Literals(["printed", "plain-json", "triple-value", "truthy", "summary"]))}, async ({host}, request) => {
    const result = await host.projectValue(request); return envelope(result, result.diagnostics);
  }),
  operation("releaseValue", {...session, valueRefs:Schema.Array(id)}, async ({host}, request) => envelope(await host.releaseValue(request))),
  ...(["moduleGraph", "linkEffectModules"] as const).map(name => operation(name, { ...session, sourceId: id, source: optionalString, projects }, async ({host}, request) => {
    const result = await host[name](request); return envelope(result, result.diagnostics);
  })),
  operation("identifySyntax", { ...source, previous: Schema.optionalKey(base), idPrefix: optionalString,
    changes: Schema.optionalKey(Schema.Array(Schema.Struct({ start: Schema.Int, end: Schema.Int, text: Schema.String }))),
    anchors: Schema.optionalKey(Schema.Array(Schema.Struct({ id, span: offsetSpan }))) }, async ({host}, request) => {
    const result = await host.identifySyntax(request); return envelope(result, result.diagnostics);
  }, Schema.Struct({ sourceId: Schema.String, identity, diagnostics })),
  operation("symbolIndex", symbolInput, async ({host}, request) => {
    const result = await host.symbolIndex(request); return envelope(result, result.diagnostics);
  }, Schema.Struct({ sourceId: Schema.String, definitions: Schema.Array(definition), references: Schema.Array(reference), diagnostics })),
  operation("findReferences", { ...symbolInput, ...position }, async ({host}, request) => {
    const result = await host.findReferences(request); return envelope(result, result.diagnostics);
  }, Schema.Struct({ sourceId: Schema.String, definition: Schema.optionalKey(definition), references: Schema.Array(reference), diagnostics })),
  operation("applyEditScript", { ...source, identity: optionalIdentity, script: Schema.Unknown, sessionId: optionalString }, async ({host}, request) => {
    const result = await host.applyEditScript(request);
    return envelope(result, result.ok ? [] : result.errors.map(error => ({ code: error.code, severity: "error" as const, message: error.message })));
  }, editResult),
  operation("describeNodes", { source: Schema.String, identity, ids: Schema.Array(id) }, async ({host}, request) => envelope(await host.describeNodes(request)), Schema.Struct({ nodes: Schema.Array(nodeDescription) })),
  operation("editScriptSchema", {}, async ({host}) => envelope(await host.editScriptSchema())),
  operation("sourceToOutline", { ...source, identity: optionalIdentity }, async ({host}, request) => envelope(await host.sourceToOutline(request)), Schema.Struct({ sourceId: Schema.String, items: Schema.Array(outlineItem), identity, errors: outlineErrors })),
  operation("outlineToSource", { sourceId: optionalString, items: Schema.Array(outlineItem), base: Schema.optionalKey(base),
    brokenRows: Schema.optionalKey(Schema.Literals(["verbatim", "comment"])), idPrefix: optionalString }, async ({host}, request) => envelope(await host.outlineToSource(request)), Schema.Struct({ sourceId: Schema.String, source: Schema.String, identity, rows: Schema.Array(Schema.Struct({ id: Schema.String, span: offsetSpan })), errors: outlineErrors })),
  operation("formSlots", { ...source, identity: optionalIdentity, ...position, sessionId: optionalString,
    descriptorSources: Schema.optionalKey(Schema.Array(document)) }, async ({host}, request) => envelope(await host.formSlots(request)), formSlotsResult),
  operation("analyzeEditor", { ...source, ...configuration, sessionId: optionalString }, async ({host}, request) => {
    const result = await host.analyzeEditor({...request, hostBuiltins: hostBuiltins(request.hostBuiltins)});
    return envelope(result, result.diagnostics);
  }),
] as const;
export const HOST_CAPABILITIES = HOST_OPERATIONS.map(operation => operation.name);
export const JsonRequest = Schema.Union(HOST_OPERATIONS.map(operation => operation.request));
export type JsonRequest = typeof JsonRequest.Type;

/** JSON Schema documents use the same strict excess-property policy as the decoder.
 * Payloads retain the host's JSON projections; debug trees are intentionally open.
 */
export function hostAbiSchema() {
  return {
    abiVersion: HOST_ABI_VERSION,
    requests: Schema.toJsonSchemaDocument(JsonRequest, { onExcessProperty: "error" }),
    responses: Object.fromEntries(HOST_OPERATIONS.map(operation => [operation.name, Schema.toJsonSchemaDocument(operation.response)])),
    operations: HOST_OPERATIONS.map(({name, sessionScope}) => ({ name, sessionScope })),
  };
}
