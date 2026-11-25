/**
 * Shared semantic boundary over mechanics IR backed by the single HM checker
 * (`type/effect-check.ts`) plus solver-neutral IR metadata annotation for
 * Effect TypeScript / Schema codegen.
 *
 * The IR objects and check tables belong to one result: cloning/reprojecting
 * them invalidates the WeakMap keys. No source or check result is cached here.
 *
 * This module has zero dependency on `mechanics/check.ts` or `mechanics/builtins.ts`.
 */
import type { JsonValue, PackageableDeclaration } from "../artifact/artifact.js";
import type { Diagnostic, Span } from "../diagnostic/diagnostic.js";
import type { Loc, SExpr } from "../reader/types.js";
import { checkEffectForms, type CheckedEffectProgram as HmCheckedEffectProgram } from "../type/effect-check.js";
import {
  builtinArithmeticOperators,
  builtinEmissions,
  builtinErrors,
  constantDependencies,
  keywordName,
  parsePattern,
  recordKey,
  type BuiltinEmission,
  type CallableSignature,
  type CheckedEffectDiagnostic,
  type CheckedEffectInfo,
  type CheckedEffectSourceSpan,
  type CheckedOperationSignature,
  type EffectType,
  type LayerInfo,
  type MatchShape,
  type ResolvedCall,
  type ServiceMethodSignature,
} from "./checked-contract.js";
import { inlineBrands, recursiveSchemaNames, schemaReferences } from "./effect-schema.js";
import {
  applySubstitution,
  arrayItems,
  containsLiterals,
  effectOf,
  emptySet,
  isAssignable,
  isRecord,
  join,
  prim,
  requirementService,
  resolve,
  setOf,
  showType,
  stringItems,
  tBool,
  tInt,
  tNever,
  tNumber,
  tString,
  tUnit,
  tUnknown,
  typeFromJson,
  unionSets,
  widenDeep,
  widenLiteral,
  type MField,
  type MType,
  type Provenance,
  type Substitution,
  type TypeEnvironment,
} from "./types.js";

export interface MechanicsTypedSpan {
  readonly span: Span;
  readonly display: string;
  readonly exprTag: string;
}

export interface CheckedMechanicsDeclarations {
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
  readonly check: CheckedEffectInfo;
  readonly typedSpans: readonly MechanicsTypedSpan[];
  readonly bindingTypes: ReadonlyMap<string, string>;
}

type JsonRecord = Readonly<Record<string, JsonValue>>;
type ValueScope = ReadonlyMap<string, MType>;

interface LayerContext {
  readonly name: string;
  readonly contextCalls: Set<object>;
  readonly contextServices: Set<string>;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Annotates projected mechanics declarations with the `CheckedEffectInfo`
 * metadata tables consumed by Effect TypeScript codegen and checks the
 * IR-projection-only rules (`mechanics/constant-cycle`, `mechanics/recursive-schema`).
 */
export function annotateEffectDeclarations(
  declarations: readonly PackageableDeclaration[],
): {
  readonly info: CheckedEffectInfo;
  readonly diagnostics: readonly CheckedEffectDiagnostic[];
  readonly typedSpans: readonly MechanicsTypedSpan[];
  readonly bindingTypes: ReadonlyMap<string, string>;
} {
  const annotator = new IrAnnotator(declarations);
  const { info, diagnostics } = annotator.run();
  const { typedSpans, bindingTypes } = collectTypedSpansAndBindings(declarations, info);
  return { info, diagnostics, typedSpans, bindingTypes };
}

interface CheckedBatchRecord {
  readonly members: ReadonlySet<PackageableDeclaration>;
  readonly hm: HmCheckedEffectProgram;
}

/**
 * Links each declaration from an HM-checked batch to that batch's result.
 * Reused ONLY when a subsequent `checkMechanicsProgram(context)` call passes
 * the exact same set of declaration object identities (never across edits or
 * swapped dependencies).
 */
const checkedBatches = new WeakMap<PackageableDeclaration, CheckedBatchRecord>();

function lookupCheckedBatch(declarations: readonly PackageableDeclaration[]): HmCheckedEffectProgram | undefined {
  const first = declarations[0];
  if (!first) return undefined;
  const record = checkedBatches.get(first);
  if (!record || record.members.size !== declarations.length) return undefined;
  for (const decl of declarations) {
    if (!record.members.has(decl)) return undefined;
  }
  return record.hm;
}

/**
 * Checks mechanics declarations through the unified HM checker (`checkEffectForms`)
 * and builds the `CheckedEffectInfo` metadata tables for Effect TypeScript codegen.
 *
 * When `hm` is supplied (e.g. from `elaborateEffectForms` or `analyzeMechanicsSources`),
 * it reuses that HM check result directly; otherwise it reuses an exact batch match
 * or reconstructs SExprs from the declarations' portable IR (preserving spans) and
 * runs `checkEffectForms`.
 */
export function checkMechanicsProgram(
  declarations: readonly PackageableDeclaration[],
  hm?: HmCheckedEffectProgram,
  defaultSourceId?: string,
): CheckedMechanicsDeclarations {
  const fallbackSourceId = defaultSourceId ?? declarations[0]?.sourceId ?? "program.lisp";
  const hmResult =
    hm ??
    lookupCheckedBatch(declarations) ??
    (declarations.length === 0
      ? undefined
      : checkEffectForms(declarationsToSExprs(declarations), "", { sourceId: fallbackSourceId }));
  if (hm && declarations.length > 0) {
    const members = new Set(declarations);
    const record: CheckedBatchRecord = { members, hm };
    for (const decl of declarations) checkedBatches.set(decl, record);
  }
  const annotated = annotateEffectDeclarations(declarations);

  const diagnostics: Diagnostic[] = [];
  if (hmResult) {
    for (const d of hmResult.diagnostics) {
      const spanSourceId =
        d.span && "sourceId" in d.span && typeof (d.span as { readonly sourceId?: unknown }).sourceId === "string"
          ? (d.span as { readonly sourceId: string }).sourceId
          : fallbackSourceId;
      const span = d.span
        ? {
            sourceId: spanSourceId,
            startOffset: d.span.start,
            endOffset: d.span.end,
          }
        : undefined;
      diagnostics.push({
        code: d.code ?? "typecheck/error",
        message: d.message,
        severity: d.severity,
        phase: "typecheck",
        ...(d.details ? { details: d.details } : {}),
        ...(span ? { span } : {}),
        ...(d.help ? { help: d.help } : {}),
        ...(d.related ? { related: d.related } : {}),
        ...(d.fix ? { fix: d.fix } : {}),
      });
    }
  }
  for (const d of annotated.diagnostics) {
    diagnostics.push({
      ...d,
      phase: "typecheck",
    });
  }

  const ok = !diagnostics.some((d) => d.severity === "error");
  return {
    ok,
    declarations,
    diagnostics,
    check: annotated.info,
    typedSpans: annotated.typedSpans,
    bindingTypes: annotated.bindingTypes,
  };
}

function collectTypedSpansAndBindings(
  declarations: readonly PackageableDeclaration[],
  info: CheckedEffectInfo,
): { readonly typedSpans: readonly MechanicsTypedSpan[]; readonly bindingTypes: ReadonlyMap<string, string> } {
  const typedSpans: MechanicsTypedSpan[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    const type = info.effectTypes.get(value) ?? info.valueTypes.get(value);
    const span = value["span"];
    if (
      type &&
      type.kind !== "unknown" &&
      isRecord(span) &&
      typeof span["sourceId"] === "string" &&
      typeof span["startOffset"] === "number" &&
      typeof span["endOffset"] === "number"
    ) {
      typedSpans.push({
        span: { sourceId: span["sourceId"], startOffset: span["startOffset"], endOffset: span["endOffset"] },
        display: showType(type),
        exprTag: `Mechanics.${String(value["kind"] ?? "Expression")}`,
      });
    }
    for (const [key, child] of Object.entries(value)) if (key !== "span") visit(child);
  };
  declarations.forEach((d) => visit(d.payload));

  const bindingTypes = new Map<string, string>();
  for (const [name, signature] of [...info.operations, ...info.functions]) {
    bindingTypes.set(
      name,
      signature.params.length || info.functions.has(name)
        ? `(-> ${[...signature.params.map((p) => showType(p.type)), showType(signature.result)].join(" ")})`
        : showType(signature.result),
    );
  }
  for (const [name, type] of info.constants) bindingTypes.set(name, showType(type));
  for (const [name, layer] of info.layers) bindingTypes.set(name, showType({ kind: "layer", layer: layer.type }));
  for (const declaration of declarations) {
    const display = declaration.summary.name && bindingTypes.get(declaration.summary.name);
    if (display && declaration.span) {
      typedSpans.push({ span: declaration.span, display, exprTag: "Mechanics.Declaration" });
    }
  }
  return { typedSpans, bindingTypes };
}

// ---------------------------------------------------------------------------
// IR metadata annotator (populates CheckedEffectInfo for Effect TS codegen)
// ---------------------------------------------------------------------------

class IrAnnotator {
  private readonly diagnostics: CheckedEffectDiagnostic[] = [];
  private readonly schemas = new Map<string, MType>();
  private readonly errorNames = new Set<string>(builtinErrors.keys());
  private readonly classes = new Map<string, readonly MField[]>();
  private readonly env: TypeEnvironment = { schemas: this.schemas, errors: this.errorNames, classes: this.classes };
  private readonly functionEnv: TypeEnvironment = { ...this.env, variables: new Map() };
  private readonly errorFields = new Map<string, readonly MField[]>();
  private readonly services = new Map<string, Map<string, ServiceMethodSignature>>();
  private readonly operations = new Map<string, CheckedOperationSignature>();
  private readonly functions = new Map<string, CallableSignature>();
  private readonly constants = new Map<string, MType>();
  private readonly layerPayloads = new Map<string, { readonly payload: JsonRecord; readonly span: JsonValue | undefined }>();
  private readonly layers = new Map<string, LayerInfo>();
  private readonly layersInProgress = new Set<string>();
  private readonly info: CheckedEffectInfo;
  private layerContext: LayerContext | undefined;

  constructor(private readonly declarations: readonly PackageableDeclaration[]) {
    this.info = {
      env: this.env,
      errorFields: this.errorFields,
      services: this.services,
      operations: this.operations,
      functions: this.functions,
      constants: this.constants,
      layers: this.layers,
      valueTypes: new WeakMap(),
      effectTypes: new WeakMap(),
      calls: new WeakMap(),
      matches: new WeakMap(),
      recordTargets: new WeakMap(),
      literalTargets: new WeakMap(),
      contextCalls: new WeakSet(),
    };
  }

  run(): { readonly info: CheckedEffectInfo; readonly diagnostics: readonly CheckedEffectDiagnostic[] } {
    this.collect();
    this.checkIrProjectionRules();
    for (const declaration of this.declarations) {
      const payload = declaration.payload;
      if (!isRecord(payload)) continue;
      switch (payload["kind"]) {
        case "EffectDef":
          this.annotateOperation(payload);
          break;
        case "FunctionDef":
          this.annotateFunction(payload);
          break;
        case "ValueDef": {
          const type = this.constants.get(String(payload["name"]));
          if (type) this.value(payload["value"], new Map(), type);
          break;
        }
        case "LayerDef":
          this.layerInfo(String(payload["name"]));
          break;
        default:
          break;
      }
    }
    return { info: this.info, diagnostics: this.diagnostics };
  }

  private collect(): void {
    for (const name of builtinErrors.keys()) this.errorFields.set(name, []);

    for (const declaration of this.declarations) {
      const payload = declaration.payload;
      if (!isRecord(payload) || typeof payload["name"] !== "string") continue;
      const name = payload["name"];
      switch (payload["kind"]) {
        case "SchemaDef":
          this.schemas.set(name, tUnknown);
          break;
        case "ErrorDef":
          this.errorNames.add(name);
          break;
        case "ClassDef":
          this.classes.set(name, []);
          break;
        default:
          break;
      }
    }

    for (const declaration of this.declarations) {
      const payload = declaration.payload;
      if (!isRecord(payload) || typeof payload["name"] !== "string") continue;
      const name = payload["name"];
      switch (payload["kind"]) {
        case "SchemaDef": {
          const schema = payload["schema"];
          this.schemas.set(name, typeFromJson(schema, this.env));
          if (schema !== undefined) {
            for (const brand of inlineBrands([schema])) {
              if (!this.schemas.has(brand.name)) {
                this.schemas.set(brand.name, typeFromJson(brand.schema, this.env));
              }
            }
          }
          break;
        }
        case "ErrorDef":
          this.errorFields.set(name, this.structFields(payload["schema"]));
          break;
        case "ClassDef":
          this.classes.set(name, this.structFields(payload["schema"]));
          break;
        case "ServiceDef":
          this.collectService(name, payload);
          break;
        case "EffectDef":
          this.collectOperation(name, payload);
          break;
        case "FunctionDef":
          this.collectFunction(name, payload);
          break;
        case "ValueDef":
          this.functionEnv.variables!.clear();
          this.constants.set(name, typeFromJson(payload["type"], this.functionEnv));
          break;
        case "LayerDef":
          this.layerPayloads.set(name, { payload, span: declarationSpan(declaration) });
          break;
        default:
          break;
      }
    }
  }

  private structFields(schema: JsonValue | undefined): readonly MField[] {
    const resolved = typeFromJson(schema, this.env);
    return resolved.kind === "struct" ? resolved.fields : [];
  }

  private collectService(name: string, payload: JsonRecord): void {
    const methods = new Map<string, ServiceMethodSignature>();
    for (const item of arrayItems(payload["methods"])) {
      if (!isRecord(item) || typeof item["name"] !== "string") continue;
      const effect = typeFromJson(item["effect"], this.env);
      methods.set(item["name"], {
        ...(item["value"] === true ? { value: true } : {}),
        name: item["name"],
        params: this.paramsFromJson(item["params"], this.env),
        effect: effect.kind === "effect" ? effectOf(effect.success, effect.errors, emptySet) : effectOf(tUnknown),
      });
    }
    this.services.set(name, methods);
  }

  private collectOperation(name: string, payload: JsonRecord): void {
    this.functionEnv.variables!.clear();
    const effect = typeFromJson(payload["effect"], this.functionEnv);
    this.operations.set(name, {
      params: this.paramsFromJson(payload["params"], this.functionEnv),
      result: effect.kind === "effect" ? effect : effectOf(tUnknown),
    });
  }

  private collectFunction(name: string, payload: JsonRecord): void {
    this.functionEnv.variables!.clear();
    this.functions.set(name, {
      params: this.paramsFromJson(payload["params"], this.functionEnv),
      result: typeFromJson(payload["returns"], this.functionEnv),
    });
  }

  private paramsFromJson(json: JsonValue | undefined, env: TypeEnvironment): readonly { readonly name: string; readonly type: MType }[] {
    return arrayItems(json).flatMap((param) => {
      if (!isRecord(param) || typeof param["name"] !== "string") return [];
      return [{ name: param["name"], type: typeFromJson(param["type"], env) }];
    });
  }

  // -------------------------------------------------------------------------
  // IR-projection-only validation (constant load-order cycles & recursive schemas)
  // -------------------------------------------------------------------------

  private checkIrProjectionRules(): void {
    this.checkConstantCycles();
    this.checkRecursiveSchemas();
    this.checkSchemaRefinements();
  }

  private checkSchemaRefinements(): void {
    const visit = (schema: JsonValue | undefined, fallbackSpan: JsonValue | undefined): void => {
      if (!isRecord(schema)) return;
      const span = schema["span"] ?? fallbackSpan;
      if (schema["kind"] === "Annotated" && isRecord(schema["metadata"])) {
        const inner = schema["schema"];
        const resolved = typeFromJson(inner, this.env);
        const unwrapped = resolve(resolved, this.env);
        const meta = schema["metadata"];
        if (meta["pattern"] !== undefined && !(unwrapped.kind === "prim" && unwrapped.name === "String")) {
          this.error(span, "mechanics/refinement", ":pattern applies to String.");
        }
        if (
          (meta["min-length"] !== undefined || meta["max-length"] !== undefined) &&
          !(unwrapped.kind === "prim" && unwrapped.name === "String") &&
          unwrapped.kind !== "array"
        ) {
          const key = meta["min-length"] !== undefined ? ":min-length" : ":max-length";
          this.error(span, "mechanics/refinement", `${key} applies to String and List.`);
        }
        if (
          (meta["min"] !== undefined || meta["max"] !== undefined) &&
          !(unwrapped.kind === "prim" && (unwrapped.name === "Int" || unwrapped.name === "Float"))
        ) {
          const key = meta["min"] !== undefined ? ":min" : ":max";
          this.error(span, "mechanics/refinement", `${key} applies to Int and Float.`);
        }
        if (meta["finite"] !== undefined && !(unwrapped.kind === "prim" && unwrapped.name === "Float")) {
          this.error(span, "mechanics/refinement", ":finite applies to Float.");
        }
        visit(inner, span);
        return;
      }
      for (const [k, v] of Object.entries(schema)) {
        if (k === "span") continue;
        if (Array.isArray(v)) v.forEach((item) => visit(item, span));
        else visit(v, span);
      }
    };
    for (const d of this.declarations) {
      const payload = d.payload;
      if (!isRecord(payload)) continue;
      if (payload["schema"] !== undefined) visit(payload["schema"], declarationSpan(d));
    }
  }

  private checkConstantCycles(): void {
    const deps = constantDependencies(this.declarations);
    const spans = new Map<string, JsonValue | undefined>();
    for (const d of this.declarations) {
      if (isRecord(d.payload) && d.payload["kind"] === "ValueDef" && typeof d.payload["name"] === "string") {
        spans.set(d.payload["name"], declarationSpan(d));
      }
    }
    const reported = new Set<string>();
    for (const start of deps.keys()) {
      const path: string[] = [];
      const visiting = new Set<string>();
      const dfs = (current: string): boolean => {
        if (visiting.has(current)) {
          const index = path.indexOf(current);
          const cycle = [...path.slice(index), current];
          const key = [...new Set(cycle)].sort().join(",");
          if (!reported.has(key)) {
            reported.add(key);
            this.error(
              spans.get(current),
              "mechanics/constant-cycle",
              `Constant ${current} needs itself while the module loads (${cycle.join(" -> ")}).`,
            );
          }
          return true;
        }
        visiting.add(current);
        path.push(current);
        for (const next of deps.get(current) ?? []) {
          if (dfs(next)) return true;
        }
        path.pop();
        visiting.delete(current);
        return false;
      };
      dfs(start);
    }
  }

  private checkRecursiveSchemas(): void {
    const schemaDecls: { readonly name: string; readonly kind: string; readonly schema: JsonValue; readonly span: JsonValue | undefined }[] = [];
    for (const d of this.declarations) {
      const payload = d.payload;
      if (!isRecord(payload) || typeof payload["name"] !== "string" || payload["schema"] === undefined) continue;
      const kind = String(payload["kind"]);
      if (kind === "SchemaDef" || kind === "ClassDef" || kind === "ErrorDef") {
        schemaDecls.push({ name: payload["name"], kind, schema: payload["schema"], span: declarationSpan(d) });
      }
    }
    const recursive = recursiveSchemaNames(schemaDecls.map((s) => ({ name: s.name, schema: s.schema })));
    if (recursive.size === 0) return;

    const byName = new Map(schemaDecls.map((s) => [s.name, s]));
    const hasBrand = (schema: JsonValue | undefined): boolean => {
      if (!isRecord(schema)) return false;
      if (schema["kind"] === "Brand") return true;
      for (const value of Object.values(schema)) {
        if (Array.isArray(value) ? value.some(hasBrand) : hasBrand(value)) return true;
      }
      return false;
    };

    for (const decl of schemaDecls) {
      if (!recursive.has(decl.name)) continue;
      if (decl.kind === "ClassDef" || decl.kind === "ErrorDef") {
        const label = decl.kind === "ClassDef" ? "Class" : "Error";
        this.error(
          decl.span,
          "mechanics/recursive-schema",
          `${label} ${decl.name} is recursive; recursive classes and errors are not supported yet.`,
        );
        continue;
      }
      // Walk reachable declarations from this recursive schema to check for Brand or Class.
      const visited = new Set<string>([decl.name]);
      const queue = [...schemaReferences(decl.schema)];
      if (hasBrand(decl.schema)) {
        this.error(
          decl.span,
          "mechanics/recursive-schema",
          `Recursive schema ${decl.name} reaches a brand in ${decl.name}; recursion through brands and classes is not supported yet.`,
        );
        continue;
      }
      while (queue.length > 0) {
        const ref = queue.shift()!;
        if (visited.has(ref)) continue;
        visited.add(ref);
        const target = byName.get(ref);
        if (!target) continue;
        if (target.kind === "ClassDef") {
          this.error(
            decl.span,
            "mechanics/recursive-schema",
            `Recursive schema ${decl.name} reaches the class ${target.name}; recursion through brands and classes is not supported yet.`,
          );
          break;
        }
        if (hasBrand(target.schema)) {
          this.error(
            decl.span,
            "mechanics/recursive-schema",
            `Recursive schema ${decl.name} reaches a brand in ${target.name}; recursion through brands and classes is not supported yet.`,
          );
          break;
        }
        for (const next of schemaReferences(target.schema)) {
          if (!visited.has(next)) queue.push(next);
        }
      }
    }
  }

  private error(span: JsonValue | undefined, code: string, message: string): void {
    const located = toSpan(span);
    this.diagnostics.push({
      code,
      message,
      severity: "error",
      ...(located ? { span: located } : {}),
    });
  }

  // -------------------------------------------------------------------------
  // Operations, functions, layers
  // -------------------------------------------------------------------------

  private annotateOperation(payload: JsonRecord): void {
    const name = String(payload["name"]);
    const signature = this.operations.get(name);
    if (!signature) return;
    const scope = new Map(signature.params.map((p) => [p.name, p.type]));
    const expectedSuccess =
      signature.result.success.kind === "named" && signature.result.success.name === "__Infer"
        ? undefined
        : signature.result.success;
    this.effect(payload["body"], scope, expectedSuccess);
  }

  private annotateFunction(payload: JsonRecord): void {
    const name = String(payload["name"]);
    const signature = this.functions.get(name);
    if (!signature) return;
    const scope = new Map(signature.params.map((p) => [p.name, p.type]));
    this.value(payload["body"], scope, signature.result);
  }

  private layerInfo(name: string): LayerInfo | undefined {
    const existing = this.layers.get(name);
    if (existing) return existing;
    const entry = this.layerPayloads.get(name);
    if (!entry || this.layersInProgress.has(name)) return undefined;
    this.layersInProgress.add(name);
    const info = this.computeLayer(name, entry.payload);
    this.layersInProgress.delete(name);
    if (info) this.layers.set(name, info);
    return info;
  }

  private computeLayer(name: string, payload: JsonRecord): LayerInfo | undefined {
    const impl = payload["implementation"];
    if (!isRecord(impl)) return undefined;
    if (impl["kind"] === "Compose") {
      const composed = this.layerExpr(impl["layer"]);
      return composed ? { type: composed, contextServices: [] } : undefined;
    }
    if (impl["kind"] !== "Service") return undefined;

    const serviceName = String(impl["service"] ?? "");
    const serviceMethods = this.services.get(serviceName);
    const scope = new Map<string, MType>();
    let errors: Provenance = emptySet;
    let requirements: Provenance = emptySet;

    // Setup bindings ({ name, value } where value is an effect node, e.g. Pure or ServiceCall)
    // Layer.effect provides its own Scope to setup, so Scope is discharged from setup requirements.
    for (const binding of arrayItems(impl["setup"]).filter(isRecord)) {
      const eff = this.effect(binding["value"], scope);
      errors = unionSets(errors, eff.errors);
      for (const [req, span] of eff.requirements) {
        const svc = requirementService(req);
        if (svc !== "Scope") requirements = unionSets(requirements, setOf([svc], span));
      }
      if (typeof binding["name"] === "string" && binding["name"] !== "_") {
        scope.set(binding["name"], eff.success);
      }
    }

    const context: LayerContext = { name, contextCalls: new Set(), contextServices: new Set() };
    this.layerContext = context;

    for (const method of arrayItems(impl["methods"])) {
      if (!isRecord(method) || typeof method["name"] !== "string") continue;
      const sig = serviceMethods?.get(method["name"]);
      const methodScope = new Map(scope);
      const paramNames = stringItems(method["params"]);
      paramNames.forEach((paramName, i) => {
        methodScope.set(paramName, sig?.params[i]?.type ?? tUnknown);
      });
      const bodyEff = this.effect(method["body"], methodScope, sig?.effect.success);
      for (const req of bodyEff.requirements.keys()) {
        const svc = requirementService(req);
        if (svc !== "Scope") {
          requirements = unionSets(requirements, setOf([svc], bodyEff.requirements.get(req)));
        }
      }
    }

    this.layerContext = undefined;
    for (const call of context.contextCalls) this.info.contextCalls.add(call);

    // Normalize requirements to service-level names
    const normalizedReqs = new Map<string, JsonValue | undefined>();
    for (const [req, span] of requirements) {
      const svc = requirementService(req);
      if (svc !== "Scope" && !normalizedReqs.has(svc)) normalizedReqs.set(svc, span);
    }

    return {
      type: {
        provides: serviceName ? [serviceName] : [],
        errors,
        requirements: normalizedReqs,
      },
      contextServices: [...context.contextServices].sort(),
    };
  }

  private layerExpr(expr: JsonValue | undefined): LayerInfo["type"] | undefined {
    if (!isRecord(expr)) return undefined;
    switch (expr["kind"]) {
      case "LayerRef":
        return this.layerInfo(String(expr["name"]))?.type;
      case "LayerMerge":
      case "Merge": {
        const parts = arrayItems(expr["layers"]).map((l) => this.layerExpr(l)).filter((l): l is LayerInfo["type"] => l !== undefined);
        const provides = [...new Set(parts.flatMap((p) => p.provides))];
        const errors = unionSets(...parts.map((p) => p.errors));
        const requirements = unionSets(...parts.map((p) => p.requirements));
        return { provides, errors, requirements };
      }
      case "LayerProvide":
      case "LayerProvideMerge":
      case "Provide":
      case "ProvideMerge": {
        const target = this.layerExpr(expr["layer"] ?? expr["target"]);
        const deps = expr["dependencies"] !== undefined
          ? arrayItems(expr["dependencies"]).map((d) => this.layerExpr(d)).filter((l): l is LayerInfo["type"] => l !== undefined)
          : (() => {
              const s = this.layerExpr(expr["source"]);
              return s ? [s] : [];
            })();
        if (!target) return deps[0];
        const source: LayerInfo["type"] = {
          provides: [...new Set(deps.flatMap((d) => d.provides))],
          errors: unionSets(...deps.map((d) => d.errors)),
          requirements: unionSets(...deps.map((d) => d.requirements)),
        };
        const provided = new Set(source.provides);
        const remaining = new Map<string, JsonValue | undefined>();
        for (const [req, span] of target.requirements) {
          if (!provided.has(requirementService(req))) remaining.set(req, span);
        }
        const isMerge = expr["kind"] === "LayerProvideMerge" || expr["kind"] === "ProvideMerge";
        const provides = isMerge
          ? [...new Set([...target.provides, ...source.provides])]
          : target.provides;
        return {
          provides,
          errors: unionSets(target.errors, source.errors),
          requirements: unionSets(remaining, source.requirements),
        };
      }
      default:
        return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  private effect(node: JsonValue | undefined, scope: ValueScope, expectedSuccess?: MType): EffectType {
    if (!isRecord(node)) return effectOf(tUnknown);
    const result = this.effectInner(node, scope, expectedSuccess);
    this.info.effectTypes.set(node, result);
    return result;
  }

  private effectInner(node: JsonRecord, scope: ValueScope, expectedSuccess?: MType): EffectType {
    switch (node["kind"]) {
      case "Succeed": {
        const success = this.value(node["value"], scope, expectedSuccess);
        return effectOf(success);
      }
      case "Pure":
      case "Value": {
        const val = node["value"];
        const type = this.value(val, scope, expectedSuccess);
        if (type.kind === "effect") {
          if (this.layerContext && type.requirements.size > 0 && isRecord(val)) {
            this.layerContext.contextCalls.add(val);
            for (const req of type.requirements.keys()) {
              const svc = requirementService(req);
              if (svc !== "Scope") this.layerContext.contextServices.add(svc);
            }
          }
          return type;
        }
        return effectOf(type);
      }
      case "Bind":
        return this.effect(node["value"], scope, expectedSuccess);
      case "Fail": {
        const errNode = node["error"];
        if (typeof errNode === "string") {
          return effectOf(tNever, setOf([errNode], node["span"]));
        }
        if (isRecord(errNode) && errNode["kind"] === "Error") {
          const errName = String(errNode["errorType"] ?? "");
          const fields = this.errorFields.get(errName) ?? [];
          if (errNode["payload"] !== undefined) {
            this.value(errNode["payload"], scope, { kind: "struct", fields });
          }
          return effectOf(tNever, errName ? setOf([errName], node["span"]) : emptySet);
        }
        const err = this.value(errNode, scope);
        const errors = err.kind === "error" ? setOf([err.name], node["span"]) : emptySet;
        return effectOf(tNever, errors);
      }
      case "ServiceCall": {
        const service = String(node["service"] ?? "");
        const method = String(node["method"] ?? "");
        const sig = this.services.get(service)?.get(method);
        if (sig?.value === true && node["value"] !== true) {
          this.error(
            node["span"],
            "mechanics/service-member-use",
            `${service}.${method} is an Effect value, not a function; write ${service}.${method} instead of (${service}.${method}).`,
          );
        }
        const args = arrayItems(node["args"]);
        args.forEach((arg, i) => this.value(arg, scope, sig?.params[i]?.type));
        const capability = `${service}.${method}`;
        return effectOf(
          sig?.effect.success ?? tUnknown,
          sig?.effect.errors ?? emptySet,
          setOf([capability], node["span"]),
        );
      }
      case "OperationCall": {
        const opName = String(node["operation"] ?? "");
        const sig = this.operations.get(opName);
        const args = arrayItems(node["args"]);
        if (!sig) {
          args.forEach((arg) => this.value(arg, scope));
          return effectOf(tUnknown);
        }
        const res = this.callSignature(
          sig.params.map((p) => p.type),
          sig.result,
          args,
          scope,
          expectedSuccess ? effectOf(expectedSuccess) : undefined,
        );
        const eff = res.kind === "effect" ? res : effectOf(res);
        if (this.layerContext && eff.requirements.size > 0) {
          this.layerContext.contextCalls.add(node);
          for (const req of eff.requirements.keys()) {
            const svc = requirementService(req);
            if (svc !== "Scope") this.layerContext.contextServices.add(svc);
          }
        }
        return eff;
      }
      case "Do":
      case "Let": {
        const inner = new Map(scope);
        let errors: Provenance = emptySet;
        let requirements: Provenance = emptySet;
        for (const binding of arrayItems(node["bindings"]).filter(isRecord)) {
          const eff = this.effect(binding["value"], inner);
          errors = unionSets(errors, eff.errors);
          requirements = unionSets(requirements, eff.requirements);
          if (typeof binding["name"] === "string" && binding["name"] !== "_") {
            inner.set(binding["name"], eff.success);
          }
        }
        if (node["body"] !== undefined) {
          const body = this.effect(node["body"], inner, expectedSuccess);
          return effectOf(body.success, unionSets(errors, body.errors), unionSets(requirements, body.requirements));
        }
        const forms = arrayItems(node["forms"]);
        let last: EffectType = effectOf(tUnit);
        forms.forEach((form, i) => {
          last = this.effect(form, inner, i === forms.length - 1 ? expectedSuccess : undefined);
          errors = unionSets(errors, last.errors);
          requirements = unionSets(requirements, last.requirements);
        });
        return effectOf(last.success, errors, requirements);
      }
      case "If": {
        this.value(node["condition"], scope, tBool);
        const thenEff = this.effect(node["then"], scope, expectedSuccess);
        const elseEff = this.effect(node["else"], scope, expectedSuccess);
        return effectOf(
          join(thenEff.success, elseEff.success, this.env),
          unionSets(thenEff.errors, elseEff.errors),
          unionSets(thenEff.requirements, elseEff.requirements),
        );
      }
      case "When":
      case "Unless": {
        this.value(node["condition"], scope, tBool);
        const body = this.effect(node["body"], scope);
        return effectOf(tUnit, body.errors, body.requirements);
      }
      case "Cond": {
        const clauses = arrayItems(node["clauses"]).filter(isRecord);
        let success: MType = tNever;
        let errors: Provenance = emptySet;
        let requirements: Provenance = emptySet;
        for (const clause of clauses) {
          if (!isElseCondition(clause["condition"])) this.value(clause["condition"], scope, tBool);
          const eff = this.effect(clause["body"], scope, expectedSuccess);
          success = success.kind === "never" ? eff.success : join(success, eff.success, this.env);
          errors = unionSets(errors, eff.errors);
          requirements = unionSets(requirements, eff.requirements);
        }
        return effectOf(success, errors, requirements);
      }
      case "Match":
        return this.effectMatch(node, scope, expectedSuccess);
      case "Catch": {
        const body = this.effect(node["body"], scope, expectedSuccess);
        const remaining = new Map(body.errors);
        const errType = typeof node["errorType"] === "string" ? node["errorType"] : undefined;
        const binding = typeof node["binding"] === "string" ? node["binding"] : undefined;
        if (errType) remaining.delete(errType);
        const handlerScope = new Map(scope);
        if (binding && binding !== "_") {
          handlerScope.set(binding, errType ? { kind: "error", name: errType } : tUnknown);
        }
        const handled = this.effect(node["handler"], handlerScope, expectedSuccess);
        return effectOf(
          join(body.success, handled.success, this.env),
          unionSets(remaining, handled.errors),
          unionSets(body.requirements, handled.requirements),
        );
      }
      case "CatchTags": {
        const body = this.effect(node["body"], scope, expectedSuccess);
        const remaining = new Map(body.errors);
        let success = body.success;
        let errors: Provenance = emptySet;
        let requirements = body.requirements;
        for (const handler of arrayItems(node["handlers"]).filter(isRecord)) {
          const errName = typeof handler["errorType"] === "string" ? handler["errorType"] : undefined;
          const binding = typeof handler["binding"] === "string" ? handler["binding"] : undefined;
          const handlerScope = new Map(scope);
          if (errName && errName !== "_") {
            remaining.delete(errName);
            if (binding && binding !== "_") handlerScope.set(binding, { kind: "error", name: errName });
          } else {
            remaining.clear();
            if (binding && binding !== "_") handlerScope.set(binding, tUnknown);
          }
          const handled = this.effect(handler["handler"], handlerScope, expectedSuccess);
          success = join(success, handled.success, this.env);
          errors = unionSets(errors, handled.errors);
          requirements = unionSets(requirements, handled.requirements);
        }
        return effectOf(success, unionSets(remaining, errors), requirements);
      }
      case "CatchAll": {
        const body = this.effect(node["body"], scope, expectedSuccess);
        const binding = typeof node["binding"] === "string" ? node["binding"] : undefined;
        const handlerScope = new Map(scope);
        if (binding && binding !== "_") {
          const errUnion: MType =
            body.errors.size === 1
              ? { kind: "error", name: [...body.errors.keys()][0]! }
              : body.errors.size > 1
                ? { kind: "union", members: [...body.errors.keys()].map((n) => ({ kind: "error" as const, name: n })) }
                : tUnknown;
          handlerScope.set(binding, errUnion);
        }
        const handled = this.effect(node["handler"], handlerScope, expectedSuccess);
        return effectOf(
          join(body.success, handled.success, this.env),
          handled.errors,
          unionSets(body.requirements, handled.requirements),
        );
      }
      case "Combinator":
        return this.combinator(node, scope, expectedSuccess);
      default:
        return effectOf(tUnknown);
    }
  }

  private effectMatch(node: JsonRecord, scope: ValueScope, expectedSuccess?: MType): EffectType {
    const subjectType = this.value(node["value"], scope);
    const shape = this.matchShape(subjectType);
    this.info.matches.set(node, shape);
    let success: MType = tNever;
    let errors: Provenance = emptySet;
    let requirements: Provenance = emptySet;
    for (const arm of arrayItems(node["arms"]).filter(isRecord)) {
      const pattern = parsePattern(arm["pattern"], shape.kind);
      const armScope = this.matchArmScope(scope, subjectType, shape, pattern);
      const eff = this.effect(arm["body"], armScope, expectedSuccess);
      success = success.kind === "never" ? eff.success : join(success, eff.success, this.env);
      errors = unionSets(errors, eff.errors);
      requirements = unionSets(requirements, eff.requirements);
    }
    return effectOf(success, errors, requirements);
  }

  private combinator(node: JsonRecord, scope: ValueScope, expectedSuccess?: MType): EffectType {
    const name = String(node["name"] ?? "");
    const args = arrayItems(node["args"]);
    const optionEntries = arrayItems(node["options"]).filter(isRecord);
    const option = (key: string): JsonValue | undefined => {
      for (const entry of optionEntries) if (entry["key"] === key) return entry["value"];
      return undefined;
    };
    const effectCallback = (cb: JsonValue | undefined, paramType: MType, expectedRes?: MType): EffectType => {
      if (isRecord(cb) && cb["kind"] === "Lambda") {
        const inner = new Map(scope);
        const paramName = stringItems(cb["params"])[0];
        if (paramName && paramName !== "_") inner.set(paramName, paramType);
        return this.effect(cb["body"], inner, expectedRes);
      }
      const cbType = this.value(cb, scope, { kind: "function", params: [paramType], result: effectOf(expectedRes ?? tUnknown) });
      return cbType.kind === "function" && cbType.result.kind === "effect" ? cbType.result : effectOf(tUnknown);
    };
    switch (name) {
      case "scoped": {
        const inner = this.effect(args[0], scope, expectedSuccess);
        const reqs = new Map(inner.requirements);
        reqs.delete("Scope");
        return effectOf(inner.success, inner.errors, reqs);
      }
      case "acquire-release": {
        const acq = this.effect(args[0], scope, expectedSuccess);
        const rel = effectCallback(args[1], acq.success, tUnit);
        return effectOf(
          acq.success,
          acq.errors,
          unionSets(acq.requirements, rel.requirements, setOf(["Scope"], node["span"])),
        );
      }
      case "ensuring": {
        const body = this.effect(args[0], scope, expectedSuccess);
        const fin = this.effect(args[1], scope, tUnit);
        return effectOf(body.success, body.errors, unionSets(body.requirements, fin.requirements));
      }
      case "add-finalizer": {
        const fin = this.effect(args[0], scope, tUnit);
        return effectOf(tUnit, emptySet, unionSets(fin.requirements, setOf(["Scope"], node["span"])));
      }
      case "all": {
        const target = args[0];
        const conc = option("concurrency");
        if (conc !== undefined) this.value(conc, scope);
        if (isRecord(target) && (target["kind"] === "EffectRecord" || target["kind"] === "Record")) {
          const fields: MField[] = [];
          let errors: Provenance = emptySet;
          let requirements: Provenance = emptySet;
          for (const entry of arrayItems(target["entries"]).filter(isRecord)) {
            const key = typeof entry["key"] === "string" ? entry["key"] : recordKey(entry["key"]);
            const eff = this.effect(entry["value"], scope);
            errors = unionSets(errors, eff.errors);
            requirements = unionSets(requirements, eff.requirements);
            if (key !== undefined) fields.push({ name: key, type: eff.success, optional: false });
          }
          return effectOf({ kind: "struct", fields }, errors, requirements);
        }
        if (isRecord(target) && (target["kind"] === "EffectVector" || target["kind"] === "Vector")) {
          const expectedTuple = expectedSuccess ? resolve(expectedSuccess, this.env) : undefined;
          const items: MType[] = [];
          let errors: Provenance = emptySet;
          let requirements: Provenance = emptySet;
          arrayItems(target["items"]).forEach((item, index) => {
            const expectedItem = expectedTuple?.kind === "tuple" ? expectedTuple.items[index] : undefined;
            const eff = this.effect(item, scope, expectedItem);
            errors = unionSets(errors, eff.errors);
            requirements = unionSets(requirements, eff.requirements);
            items.push(eff.success);
          });
          return effectOf({ kind: "tuple", items }, errors, requirements);
        }
        return effectOf(tUnknown);
      }
      case "for-each": {
        const conc = option("concurrency");
        if (conc !== undefined) this.value(conc, scope);
        const listType = resolve(this.value(args[0], scope), this.env);
        const itemType = listType.kind === "array" ? listType.item : tUnknown;
        const expectedItem = expectedSuccess && resolve(expectedSuccess, this.env).kind === "array"
          ? (resolve(expectedSuccess, this.env) as MType & { kind: "array" }).item
          : undefined;
        const cbResult = effectCallback(args[1], itemType, expectedItem);
        return effectOf({ kind: "array", item: cbResult.success }, cbResult.errors, cbResult.requirements);
      }
      case "race": {
        const left = this.effect(args[0], scope, expectedSuccess);
        const right = this.effect(args[1], scope, expectedSuccess);
        return effectOf(
          join(left.success, right.success, this.env),
          unionSets(left.errors, right.errors),
          unionSets(left.requirements, right.requirements),
        );
      }
      case "fork": {
        const inner = this.effect(args[0], scope);
        return effectOf({ kind: "fiber", success: inner.success, errors: inner.errors }, emptySet, inner.requirements);
      }
      case "join": {
        const fiber = resolve(this.value(args[0], scope), this.env);
        return fiber.kind === "fiber" ? effectOf(fiber.success, fiber.errors) : effectOf(tUnknown);
      }
      case "interrupt": {
        this.value(args[0], scope);
        return effectOf(tUnit);
      }
      case "sleep": {
        this.value(args[0], scope);
        return effectOf(tUnit);
      }
      case "timeout": {
        const inner = this.effect(args[0], scope, expectedSuccess);
        this.value(args[1], scope);
        return effectOf(inner.success, unionSets(inner.errors, setOf(["TimeoutError"], node["span"])), inner.requirements);
      }
      case "retry":
      case "repeat": {
        const inner = this.effect(args[0], scope, expectedSuccess);
        for (const entry of optionEntries) this.value(entry["value"], scope);
        return inner;
      }
      case "map-error": {
        const inner = this.effect(args[0], scope, expectedSuccess);
        const errUnion: MType = inner.errors.size === 1
          ? { kind: "error", name: [...inner.errors.keys()][0]! }
          : inner.errors.size > 1
            ? { kind: "union", members: [...inner.errors.keys()].map((n) => ({ kind: "error" as const, name: n })) }
            : tUnknown;
        const cb = this.value(args[1], scope, { kind: "function", params: [errUnion], result: tUnknown });
        const outErrors = cb.kind === "function" && cb.result.kind === "error" ? setOf([cb.result.name], node["span"]) : emptySet;
        return effectOf(inner.success, outErrors, inner.requirements);
      }
      case "or-else-succeed": {
        const inner = this.effect(args[0], scope, expectedSuccess);
        const fallback = this.value(args[1], scope, expectedSuccess ?? inner.success);
        return effectOf(expectedSuccess ?? join(inner.success, fallback, this.env), emptySet, inner.requirements);
      }
      case "or-die": {
        const inner = this.effect(args[0], scope, expectedSuccess);
        return effectOf(inner.success, emptySet, inner.requirements);
      }
      case "option": {
        const inner = this.effect(args[0], scope);
        return effectOf({ kind: "option", item: inner.success }, emptySet, inner.requirements);
      }
      case "result": {
        const inner = this.effect(args[0], scope);
        const failType: MType = inner.errors.size === 0
          ? tNever
          : inner.errors.size === 1
            ? { kind: "error", name: [...inner.errors.keys()][0]! }
            : { kind: "union", members: [...inner.errors.keys()].map((n) => ({ kind: "error" as const, name: n })) };
        return effectOf({ kind: "result", success: inner.success, failure: failType }, emptySet, inner.requirements);
      }
      case "provide": {
        const savedContext = this.layerContext;
        this.layerContext = undefined;
        const inner = this.effect(args[0], scope, expectedSuccess);
        this.layerContext = savedContext;
        const layerVal = this.value(args[1], scope);
        const layer = layerVal.kind === "layer" ? layerVal.layer : undefined;
        const provided = new Set(layer?.provides ?? []);
        const remaining = new Map<string, JsonValue | undefined>();
        for (const [req, span] of inner.requirements) {
          if (!provided.has(requirementService(req))) remaining.set(req, span);
        }
        const combinedReqs = unionSets(remaining, layer?.requirements ?? emptySet);
        if (this.layerContext && combinedReqs.size > 0) {
          this.layerContext.contextCalls.add(node);
          for (const req of combinedReqs.keys()) {
            const svc = requirementService(req);
            if (svc !== "Scope") this.layerContext.contextServices.add(svc);
          }
        }
        return effectOf(inner.success, unionSets(inner.errors, layer?.errors ?? emptySet), combinedReqs);
      }
      case "log": {
        for (const arg of args) this.value(arg, scope);
        return effectOf(tUnit);
      }
      case "ref-make": {
        const expectedItem = expectedSuccess && resolve(expectedSuccess, this.env).kind === "ref"
          ? (resolve(expectedSuccess, this.env) as MType & { kind: "ref" }).item
          : undefined;
        const init = this.value(args[0], scope, expectedItem);
        return effectOf({ kind: "ref", item: expectedItem ?? widenDeep(init) });
      }
      case "ref-get": {
        const refType = resolve(this.value(args[0], scope), this.env);
        return effectOf(refType.kind === "ref" ? refType.item : tUnknown);
      }
      case "ref-set": {
        const refType = resolve(this.value(args[0], scope), this.env);
        this.value(args[1], scope, refType.kind === "ref" ? refType.item : undefined);
        return effectOf(tUnit);
      }
      case "ref-update": {
        const refType = resolve(this.value(args[0], scope), this.env);
        const item = refType.kind === "ref" ? refType.item : tUnknown;
        this.value(args[1], scope, { kind: "function", params: [item], result: item });
        return effectOf(tUnit);
      }
      case "config": {
        const typeNode = isRecord(args[0]) ? typeFromJson(args[0]["type"], this.env) : tString;
        this.value(args[1], scope, tString);
        const def = option("default");
        if (def !== undefined) this.value(def, scope, typeNode);
        return effectOf(typeNode, def !== undefined ? emptySet : setOf(["ConfigError"], node["span"]));
      }
      case "decode": {
        const typeNode = isRecord(args[0]) ? typeFromJson(args[0]["type"], this.env) : tUnknown;
        this.value(args[1], scope);
        return effectOf(typeNode, setOf(["SchemaError"], node["span"]));
      }
      default:
        return effectOf(tUnknown);
    }
  }

  // -------------------------------------------------------------------------
  // Values
  // -------------------------------------------------------------------------

  private value(node: JsonValue | undefined, scope: ValueScope, expected?: MType): MType {
    if (!isRecord(node)) return tUnknown;
    const type = this.valueInner(node, scope, expected);
    this.info.valueTypes.set(node, type);
    return type;
  }

  private valueInner(node: JsonRecord, scope: ValueScope, expected?: MType): MType {
    switch (node["kind"]) {
      case "Literal": {
        const val = node["value"];
        if (val === null) return tUnit;
        const litType: MType = {
          kind: "literal",
          value: val as string | number | boolean,
          ...(typeof val === "number" ? { numericKind: Number.isInteger(val) ? "int" : "float" } : {}),
        };
        if (expected && containsLiterals(expected, this.env)) this.info.literalTargets.set(node, expected);
        return expected && containsLiterals(expected, this.env) ? litType : widenLiteral(litType);
      }
      case "Expr": {
        const kw = keywordName(node);
        if (kw !== undefined) {
          if (expected && containsLiterals(expected, this.env)) this.info.literalTargets.set(node, expected);
          return { kind: "literal", value: kw };
        }
        const source = node["source"];
        if (isRecord(source) && source["kind"] === "Nil") return tUnit;
        return tUnknown;
      }
      case "Var":
        return this.resolveVar(node, String(node["name"] ?? ""), scope, expected);
      case "Record":
        return this.recordLiteral(node, scope, expected);
      case "Vector":
        return this.vectorLiteral(node, scope, expected);
      case "List":
        return this.application(node, scope, expected);
      default:
        return tUnknown;
    }
  }

  private resolveVar(node: JsonRecord, name: string, scope: ValueScope, expected?: MType): MType {
    const local = scope.get(name);
    if (local) return local;
    if (name === "nil") return tUnit;
    if (name === "true" || name === "false") {
      if (expected && containsLiterals(expected, this.env)) this.info.literalTargets.set(node, expected);
      return expected && containsLiterals(expected, this.env) ? { kind: "literal", value: name === "true" } : tBool;
    }
    if (name === "none") {
      const resolved = expected ? resolve(expected, this.env) : undefined;
      return resolved?.kind === "option" ? resolved : { kind: "option", item: tNever };
    }
    const tagged = this.findTaggedConstructor(name);
    if (tagged) {
      this.info.calls.set(node, {
        kind: "tagged-constructor",
        owner: tagged.owner,
        name: tagged.name,
        nullary: tagged.nullary,
      });
      return tagged.nullary
        ? { kind: "named", name: tagged.owner }
        : { kind: "function", params: [tagged.payload], result: { kind: "named", name: tagged.owner } };
    }
    const constant = this.constants.get(name);
    if (constant) return constant;
    const layer = this.layerInfo(name);
    if (layer) return { kind: "layer", layer: layer.type };
    const fn = this.functions.get(name);
    if (fn) return { kind: "function", params: fn.params.map((p) => p.type), result: fn.result };
    const op = this.operations.get(name);
    if (op) {
      if (op.params.length === 0) return op.result;
      return { kind: "function", params: op.params.map((p) => p.type), result: op.result };
    }
    const dot = name.indexOf(".");
    if (dot > 0) {
      const svc = name.slice(0, dot);
      const method = name.slice(dot + 1);
      const sig = this.services.get(svc)?.get(method);
      if (sig) {
        this.info.calls.set(node, { kind: "service", service: svc, method });
        return sig.value
          ? effectOf(sig.effect.success, sig.effect.errors, setOf([name], node["span"]))
          : { kind: "function", params: sig.params.map((p) => p.type), result: effectOf(sig.effect.success, sig.effect.errors, setOf([name], node["span"])) };
      }
    }
    // Builtin or arithmetic operator used as a first-class value (e.g. passed to map/reduce)
    const arithOp = builtinArithmeticOperators.get(name);
    if (arithOp) {
      this.info.calls.set(node, { kind: "arithmetic", operator: arithOp });
      return expected?.kind === "function" ? expected : { kind: "function", params: [tNumber, tNumber], result: tNumber };
    }
    const overloads = builtinEmissions.get(name);
    if (overloads) {
      const resolved = this.resolveBuiltinValue(overloads, expected);
      this.info.calls.set(node, { kind: "builtin", name, overload: resolved });
      return { kind: "function", params: resolved.params, result: resolved.result };
    }
    return tUnknown;
  }

  private resolveBuiltinValue(overloads: readonly BuiltinEmission[], expected?: MType): BuiltinEmission {
    if (expected?.kind === "function") {
      for (const overload of overloads) {
        if (overload.params.length !== expected.params.length) continue;
        const subst: Substitution = new Map();
        let ok = true;
        for (let i = 0; i < overload.params.length; i++) {
          if (!unifyPattern(overload.params[i]!, expected.params[i]!, subst, this.env)) {
            ok = false;
            break;
          }
        }
        if (ok) {
          unifyPattern(overload.result, expected.result, subst, this.env);
          return {
            ...overload,
            params: overload.params.map((p) => applySubstitution(p, subst)),
            result: applySubstitution(overload.result, subst),
          };
        }
      }
    }
    return overloads[0]!;
  }

  private recordLiteral(node: JsonRecord, scope: ValueScope, expected?: MType): MType {
    const entries = arrayItems(node["entries"]).filter(isRecord);
    const resolvedExpected = expected ? resolve(expected, this.env) : undefined;
    const targetStruct = this.selectRecordTarget(entries, resolvedExpected);
    if (targetStruct) this.info.recordTargets.set(node, targetStruct);
    if (expected && containsLiterals(expected, this.env)) this.info.literalTargets.set(node, expected);

    const fields: MField[] = [];
    for (const entry of entries) {
      const key = recordKey(entry["key"]);
      const expectedField =
        targetStruct?.kind === "struct"
          ? targetStruct.fields.find((f) => f.name === key)
          : resolvedExpected?.kind === "map"
            ? { name: key ?? "", type: resolvedExpected.value, optional: false }
            : undefined;
      const valNode = entry["value"];
      const fieldExpected =
        expectedField?.optional && isSomeOrNoneNode(valNode)
          ? ({ kind: "option", item: expectedField.type } as MType)
          : expectedField?.type;
      const valType = this.value(valNode, scope, fieldExpected);
      if (key !== undefined) fields.push({ name: key, type: valType, optional: false });
    }
    if (expected?.kind === "named") return expected;
    if (resolvedExpected?.kind === "map") return resolvedExpected;
    return { kind: "struct", fields };
  }

  private selectRecordTarget(entries: readonly JsonRecord[], resolvedExpected: MType | undefined): MType | undefined {
    if (!resolvedExpected) return undefined;
    if (resolvedExpected.kind === "struct") return resolvedExpected;
    if (resolvedExpected.kind === "union") {
      // Pick matching variant in a tagged union if discriminator literal matches
      for (const member of resolvedExpected.members) {
        const m = resolve(member, this.env);
        if (m.kind !== "struct") continue;
        let matches = true;
        for (const f of m.fields) {
          if (f.type.kind !== "literal") continue;
          const entry = entries.find((e) => recordKey(e["key"]) === f.name);
          const ev = entry?.["value"];
          const lit = isRecord(ev) && ev["kind"] === "Literal" ? ev["value"] : keywordName(ev);
          if (lit !== f.type.value) {
            matches = false;
            break;
          }
        }
        if (matches) return m;
      }
    }
    return undefined;
  }

  private vectorLiteral(node: JsonRecord, scope: ValueScope, expected?: MType): MType {
    const items = arrayItems(node["items"]);
    const resolved = expected ? resolve(expected, this.env) : undefined;
    if (expected && containsLiterals(expected, this.env)) this.info.literalTargets.set(node, expected);
    if (resolved?.kind === "tuple") {
      const elemTypes = items.map((item, i) => this.value(item, scope, resolved.items[i]));
      return { kind: "tuple", items: elemTypes };
    }
    const expectedItem = resolved?.kind === "array" ? resolved.item : undefined;
    let itemType: MType = tNever;
    for (const item of items) {
      const t = this.value(item, scope, expectedItem);
      itemType = itemType.kind === "never" ? t : join(itemType, t, this.env);
    }
    return { kind: "array", item: expectedItem ?? (itemType.kind === "never" ? tNever : widenDeep(itemType)) };
  }

  private application(node: JsonRecord, scope: ValueScope, expected?: MType): MType {
    const items = arrayItems(node["items"]);
    const headNode = items[0];
    const args = items.slice(1);
    const name =
      isRecord(headNode) && headNode["kind"] === "Var"
        ? String(headNode["name"])
        : isRecord(headNode) &&
            headNode["kind"] === "Expr" &&
            isRecord(headNode["source"]) &&
            headNode["source"]["kind"] === "Symbol" &&
            typeof headNode["source"]["name"] === "string"
          ? headNode["source"]["name"]
          : undefined;

    if (!name) {
      const fnType = this.value(headNode, scope);
      const paramTypes = fnType.kind === "function" ? fnType.params : [];
      args.forEach((arg, i) => this.value(arg, scope, paramTypes[i]));
      return fnType.kind === "function" ? fnType.result : tUnknown;
    }

    const resolveAs = (call: ResolvedCall): void => {
      this.info.calls.set(node, call);
    };

    // Special forms
    switch (name) {
      case "fn": {
        resolveAs({ kind: "special", name });
        const paramNodes = isRecord(args[0]) ? arrayItems(args[0]["items"]) : [];
        const fnScope = new Map(scope);
        const expectedFn = expected ? resolve(expected, this.env) : undefined;
        const expectedParams = expectedFn?.kind === "function" ? expectedFn.params : [];
        const paramTypes = paramNodes.map((p, i) => {
          const pName = isRecord(p) ? String(p["name"]) : "_";
          const pType = expectedParams[i] ?? tUnknown;
          fnScope.set(pName, pType);
          return pType;
        });
        const expectedRes = expectedFn?.kind === "function" ? expectedFn.result : undefined;
        const bodyType = this.value(args[1], fnScope, expectedRes);
        return { kind: "function", params: paramTypes, result: bodyType };
      }
      case "if": {
        resolveAs({ kind: "special", name });
        this.value(args[0], scope, tBool);
        const t = this.value(args[1], scope, expected);
        const e = this.value(args[2], scope, expected);
        return join(t, e, this.env);
      }
      case "cond": {
        resolveAs({ kind: "special", name });
        let result: MType = tNever;
        for (let i = 0; i + 1 < args.length; i += 2) {
          if (!isElseCondition(args[i])) this.value(args[i], scope, tBool);
          const branch = this.value(args[i + 1], scope, expected);
          result = result.kind === "never" ? branch : join(result, branch, this.env);
        }
        return result;
      }
      case "let": {
        resolveAs({ kind: "special", name });
        const pairs = isRecord(args[0]) ? arrayItems(args[0]["items"]) : [];
        const inner = new Map(scope);
        for (let i = 0; i + 1 < pairs.length; i += 2) {
          const binder = pairs[i];
          const val = this.value(pairs[i + 1], inner);
          if (isRecord(binder) && binder["kind"] === "Var" && typeof binder["name"] === "string") {
            inner.set(binder["name"], val);
          }
        }
        return this.value(args[1], inner, expected);
      }
      case "and":
      case "or": {
        resolveAs({ kind: "special", name });
        for (const arg of args) this.value(arg, scope, tBool);
        return tBool;
      }
      case "str": {
        resolveAs({ kind: "special", name });
        for (const arg of args) this.value(arg, scope);
        return tString;
      }
      case ":": {
        resolveAs({ kind: "special", name });
        const target = typeFromValueSyntax(args[1], this.env) ?? expected;
        this.value(args[0], scope, target);
        if (target && isRecord(args[1])) this.info.valueTypes.set(args[1], target);
        return target ?? tUnknown;
      }
      case "some": {
        resolveAs({ kind: "special", name });
        const resolved = expected ? resolve(expected, this.env) : undefined;
        const inner = this.value(args[0], scope, resolved?.kind === "option" ? resolved.item : undefined);
        return { kind: "option", item: inner };
      }
      case "match": {
        resolveAs({ kind: "special", name });
        const subjectType = this.value(args[0], scope);
        const shape = this.matchShape(subjectType);
        this.info.matches.set(node, shape);
        let result: MType = tNever;
        for (let i = 1; i + 1 < args.length; i += 2) {
          const pattern = parsePattern(args[i], shape.kind);
          const armScope = this.matchArmScope(scope, subjectType, shape, pattern);
          const armType = this.value(args[i + 1], armScope, expected);
          result = result.kind === "never" ? armType : join(result, armType, this.env);
        }
        return result;
      }
      case "=":
      case "!=": {
        resolveAs({ kind: "equality", operator: name });
        this.value(args[0], scope);
        this.value(args[1], scope);
        return tBool;
      }
      case "get": {
        const target = this.value(args[0], scope);
        const resolved = resolve(target, this.env);
        if (resolved.kind === "map") {
          resolveAs({ kind: "get", access: "map" });
          this.value(args[1], scope, resolved.key ?? tString);
          return { kind: "option", item: resolved.value };
        }
        const key = recordKey(args[1]);
        const fields =
          resolved.kind === "struct"
            ? resolved.fields
            : resolved.kind === "class"
              ? (this.classes.get(resolved.name) ?? [])
              : resolved.kind === "error"
                ? (this.errorFields.get(resolved.name) ?? [])
                : [];
        const field = fields.find((f) => f.name === key);
        if (field?.optional) {
          resolveAs({ kind: "get", access: "optional-field" });
          return { kind: "option", item: field.type };
        }
        resolveAs({ kind: "get", access: "field" });
        return field?.type ?? tUnknown;
      }
      case "assoc": {
        const target = this.value(args[0], scope);
        const resolved = resolve(target, this.env);
        if (resolved.kind === "map") {
          resolveAs({ kind: "assoc", access: "map" });
          this.value(args[1], scope, resolved.key ?? tString);
          this.value(args[2], scope, resolved.value);
          return target;
        }
        if (resolved.kind === "class") {
          resolveAs({ kind: "assoc", access: "class" });
          const key = recordKey(args[1]);
          const field = (this.classes.get(resolved.name) ?? []).find((f) => f.name === key);
          this.value(args[2], scope, field?.type);
          return target;
        }
        resolveAs({ kind: "assoc", access: "field" });
        const key = recordKey(args[1]);
        const field = resolved.kind === "struct" ? resolved.fields.find((f) => f.name === key) : undefined;
        this.value(args[2], scope, field?.type);
        return target;
      }
      default:
        break;
    }

    // Stream operations
    if (name.startsWith("stream-")) {
      resolveAs({ kind: "stream", name });
      return this.streamApplication(name, args, scope, expected);
    }

    // Local callable
    const local = scope.get(name);
    if (local) {
      resolveAs({ kind: "local", name });
      const paramTypes = local.kind === "function" ? local.params : [];
      args.forEach((arg, i) => this.value(arg, scope, paramTypes[i]));
      return local.kind === "function" ? local.result : tUnknown;
    }

    // Error constructor
    if (this.errorNames.has(name)) {
      resolveAs({ kind: "error", name });
      const fields = this.errorFields.get(name) ?? [];
      if (args[0]) this.value(args[0], scope, { kind: "struct", fields });
      return { kind: "error", name };
    }

    // Class constructor
    if (this.classes.has(name)) {
      resolveAs({ kind: "class", name });
      const fields = this.classes.get(name) ?? [];
      if (args[0]) this.value(args[0], scope, { kind: "struct", fields });
      return { kind: "class", name };
    }

    // Tagged union constructor
    const tagged = this.findTaggedConstructor(name);
    if (tagged) {
      resolveAs({ kind: "tagged-constructor", owner: tagged.owner, name: tagged.name, nullary: tagged.nullary });
      if (args[0]) this.value(args[0], scope, tagged.payload);
      return { kind: "named", name: tagged.owner };
    }

    // Schema / Brand constructor
    const schema = this.schemas.get(name);
    if (schema) {
      if (schema.kind === "brand") {
        resolveAs({ kind: "brand", name });
        if (args[0]) this.value(args[0], scope, schema.base);
        return { kind: "named", name };
      }
      resolveAs({ kind: "construct", name });
      if (args[0]) this.value(args[0], scope, { kind: "named", name });
      return { kind: "named", name };
    }

    // Pure function
    const fn = this.functions.get(name);
    if (fn) {
      resolveAs({ kind: "function", name });
      return this.callSignature(fn.params.map((p) => p.type), fn.result, args, scope, expected);
    }

    // Constant holding a function value
    const constVal = this.constants.get(name);
    if (constVal) {
      const resolvedConst = resolve(constVal, this.env);
      if (resolvedConst.kind === "function") {
        resolveAs({ kind: "function", name });
        return this.callSignature(resolvedConst.params, resolvedConst.result, args, scope, expected);
      }
    }

    // Operation
    const op = this.operations.get(name);
    if (op) {
      resolveAs({ kind: "operation", name });
      const res = this.callSignature(op.params.map((p) => p.type), op.result, args, scope, expected);
      if (this.layerContext && res.kind === "effect" && res.requirements.size > 0) {
        this.layerContext.contextCalls.add(node);
        for (const req of res.requirements.keys()) {
          const svc = requirementService(req);
          if (svc !== "Scope") this.layerContext.contextServices.add(svc);
        }
      }
      return res;
    }

    // Service method in value position
    const dot = name.indexOf(".");
    if (dot > 0) {
      const svc = name.slice(0, dot);
      const method = name.slice(dot + 1);
      const sig = this.services.get(svc)?.get(method);
      if (sig) {
        resolveAs({ kind: "service", service: svc, method });
        args.forEach((arg, i) => this.value(arg, scope, sig.params[i]?.type));
        return effectOf(sig.effect.success, sig.effect.errors, setOf([name], node["span"]));
      }
    }

    // reduce with arithmetic operator
    const reducer = args[0];
    if (
      name === "reduce" &&
      args.length === 3 &&
      isRecord(reducer) &&
      reducer["kind"] === "Var" &&
      builtinArithmeticOperators.has(String(reducer["name"]))
    ) {
      const seed = widenDeep(this.value(args[1], scope, tNumber));
      const list = resolve(this.value(args[2], scope), this.env);
      if (list.kind === "array") {
        const item = widenDeep(list.item);
        const result = reducer["name"] === "/" || (seed.kind === "prim" && seed.name === "Float") ? tNumber : item;
        this.value(reducer, scope, { kind: "function", params: [result, item], result });
        this.info.calls.set(node, { kind: "builtin", name, overload: builtinEmissions.get(name)![0]! });
        return result;
      }
    }

    // Arithmetic operators
    const arithOp = builtinArithmeticOperators.get(name);
    if (arithOp) {
      resolveAs({ kind: "arithmetic", operator: arithOp });
      let allInt = true;
      let numericVar: MType | undefined;
      let floatOperand = false;
      for (const arg of args) {
        const type = this.value(arg, scope, tNumber);
        if (type.kind === "var" && !type.numeric) {
          this.error(isRecord(arg) ? arg["span"] : node["span"], "typecheck/type-mismatch", "Expected Int or Float, found a generic type variable.");
        }
        if (type.kind === "var" && type.numeric) numericVar = type;
        else if (!isAssignable(type, tInt, this.env)) floatOperand = true;
        if (!isAssignable(type, tInt, this.env)) allInt = false;
      }
      if (name !== "/" && numericVar && !floatOperand) return numericVar;
      return name === "/" ? tNumber : allInt ? tInt : tNumber;
    }

    // Builtins
    const overloads = builtinEmissions.get(name);
    if (overloads) {
      return this.resolveBuiltinCall(node, name, overloads, args, scope, expected);
    }

    for (const arg of args) this.value(arg, scope);
    return tUnknown;
  }

  private streamApplication(name: string, args: readonly JsonValue[], scope: ValueScope, expected?: MType): MType {
    switch (name) {
      case "stream-of": {
        const list = resolve(this.value(args[0], scope), this.env);
        return { kind: "stream", item: list.kind === "array" ? list.item : tUnknown, errors: emptySet, requirements: emptySet };
      }
      case "stream-range": {
        this.value(args[0], scope, tInt);
        this.value(args[1], scope, tInt);
        return { kind: "stream", item: tInt, errors: emptySet, requirements: emptySet };
      }
      case "stream-map": {
        const st = resolve(this.value(args[0], scope), this.env);
        const item = st.kind === "stream" ? st.item : tUnknown;
        const cb = this.value(args[1], scope, { kind: "function", params: [item], result: tUnknown });
        const outItem = cb.kind === "function" ? cb.result : tUnknown;
        return { kind: "stream", item: outItem, errors: st.kind === "stream" ? st.errors : emptySet, requirements: st.kind === "stream" ? st.requirements : emptySet };
      }
      case "stream-filter": {
        const st = resolve(this.value(args[0], scope), this.env);
        const item = st.kind === "stream" ? st.item : tUnknown;
        this.value(args[1], scope, { kind: "function", params: [item], result: tBool });
        return st;
      }
      case "stream-take": {
        const st = resolve(this.value(args[0], scope), this.env);
        this.value(args[1], scope, tInt);
        return st;
      }
      case "stream-map-effect": {
        const st = resolve(this.value(args[0], scope), this.env);
        const item = st.kind === "stream" ? st.item : tUnknown;
        const cb = this.value(args[1], scope, { kind: "function", params: [item], result: effectOf(tUnknown) });
        if (args[2] !== undefined) this.value(args[2], scope, tInt);
        const eff = cb.kind === "function" && cb.result.kind === "effect" ? cb.result : effectOf(tUnknown);
        return {
          kind: "stream",
          item: eff.success,
          errors: unionSets(st.kind === "stream" ? st.errors : emptySet, eff.errors),
          requirements: unionSets(st.kind === "stream" ? st.requirements : emptySet, eff.requirements),
        };
      }
      case "stream-run-collect": {
        const st = resolve(this.value(args[0], scope), this.env);
        return effectOf(
          { kind: "array", item: st.kind === "stream" ? st.item : tUnknown },
          st.kind === "stream" ? st.errors : emptySet,
          st.kind === "stream" ? st.requirements : emptySet,
        );
      }
      case "stream-run-fold": {
        const st = resolve(this.value(args[0], scope), this.env);
        const item = st.kind === "stream" ? st.item : tUnknown;
        const expectedAcc = expected?.kind === "effect" ? expected.success : undefined;
        const init = this.value(args[1], scope, expectedAcc);
        const acc = expectedAcc ?? widenDeep(init);
        const cb = this.value(args[2], scope, { kind: "function", params: [acc, item], result: acc });
        const resultAcc = expectedAcc ?? (cb.kind === "function" ? cb.result : acc);
        return effectOf(
          resultAcc,
          st.kind === "stream" ? st.errors : emptySet,
          st.kind === "stream" ? st.requirements : emptySet,
        );
      }
      case "stream-run-for-each": {
        const st = resolve(this.value(args[0], scope), this.env);
        const item = st.kind === "stream" ? st.item : tUnknown;
        const cb = this.value(args[1], scope, { kind: "function", params: [item], result: effectOf(tUnit) });
        const eff = cb.kind === "function" && cb.result.kind === "effect" ? cb.result : effectOf(tUnit);
        return effectOf(
          tUnit,
          unionSets(st.kind === "stream" ? st.errors : emptySet, eff.errors),
          unionSets(st.kind === "stream" ? st.requirements : emptySet, eff.requirements),
        );
      }
      default:
        return tUnknown;
    }
  }

  private callSignature(
    params: readonly MType[],
    result: MType,
    args: readonly JsonValue[],
    scope: ValueScope,
    expected?: MType,
  ): MType {
    const subst: Substitution = new Map();
    if (expected) unifyPattern(result, expected, subst, this.env);
    // Check non-lambda arguments first so lambda params get contextual types
    const deferred: number[] = [];
    args.forEach((arg, i) => {
      if (isFnNode(arg)) {
        deferred.push(i);
        return;
      }
      const param = params[i] ? applySubstitution(params[i]!, subst) : undefined;
      const argType = this.value(arg, scope, param);
      if (params[i]) unifyPattern(params[i]!, argType, subst, this.env);
    });
    for (const i of deferred) {
      const param = params[i] ? applySubstitution(params[i]!, subst) : undefined;
      const argType = this.value(args[i], scope, param);
      if (params[i]) unifyPattern(params[i]!, argType, subst, this.env);
    }
    return applySubstitution(result, subst);
  }

  private resolveBuiltinCall(
    node: JsonRecord,
    name: string,
    overloads: readonly BuiltinEmission[],
    args: readonly JsonValue[],
    scope: ValueScope,
    expected?: MType,
  ): MType {
    const isContextual = (arg: JsonValue | undefined): boolean => {
      if (!isRecord(arg)) return false;
      if (arg["kind"] === "Record" || arg["kind"] === "Vector") return true;
      return isFnNode(arg);
    };
    const argTypes: (MType | undefined)[] = args.map((arg) => (isContextual(arg) ? undefined : this.value(arg, scope)));
    let chosen = overloads[0]!;
    let bestSubst: Substitution = new Map();

    for (const overload of overloads) {
      if (overload.params.length !== args.length) continue;
      const subst: Substitution = new Map();
      let ok = true;
      for (let i = 0; i < args.length; i++) {
        const at = argTypes[i];
        if (at !== undefined && !unifyPattern(overload.params[i]!, at, subst, this.env)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        chosen = overload;
        bestSubst = subst;
        break;
      }
    }

    if (expected) unifyPattern(chosen.result, expected, bestSubst, this.env);

    const contextual = chosen.contextualArgs ?? [];
    for (let i = 0; i < args.length; i++) {
      if (isContextual(args[i]) || contextual.includes(i)) {
        const expectedArg = applySubstitution(chosen.params[i]!, bestSubst);
        const actual = this.value(args[i], scope, expectedArg);
        unifyPattern(chosen.params[i]!, actual, bestSubst, this.env);
      }
    }

    const instantiated: BuiltinEmission = {
      ...chosen,
      params: chosen.params.map((p) => applySubstitution(p, bestSubst)),
      result: applySubstitution(chosen.result, bestSubst),
    };
    this.info.calls.set(node, { kind: "builtin", name, overload: instantiated });
    return expected && instantiated.result.kind === "var" ? expected : instantiated.result;
  }

  private findTaggedConstructor(
    name: string,
  ): { readonly owner: string; readonly name: string; readonly nullary: boolean; readonly payload: MType } | undefined {
    const dot = name.indexOf(".");
    if (dot <= 0) return undefined;
    const owner = name.slice(0, dot);
    const variant = name.slice(dot + 1);
    const schema = this.schemas.get(owner);
    if (!schema) return undefined;
    const resolved = resolve(schema, this.env);
    if (resolved.kind !== "union") return undefined;
    const disc = taggedDiscriminator(resolved.members, this.env);
    if (!disc) return undefined;
    for (const member of resolved.members) {
      const m = resolve(member, this.env);
      if (m.kind !== "struct") continue;
      const tagField = m.fields.find((f) => f.name === disc);
      if (tagField?.type.kind === "literal" && String(tagField.type.value) === variant) {
        const payloadFields = m.fields.filter((f) => f.name !== disc);
        return {
          owner,
          name: variant,
          nullary: payloadFields.length === 0,
          payload: { kind: "struct", fields: payloadFields },
        };
      }
    }
    return undefined;
  }

  private matchShape(subject: MType): MatchShape {
    const resolved = resolve(subject, this.env);
    if (resolved.kind === "option") return { kind: "option" };
    if (resolved.kind === "result") return { kind: "result" };
    if (resolved.kind === "error") return { kind: "tagged", discriminator: "_tag" };
    if (resolved.kind === "union") {
      if (resolved.members.length > 0 && resolved.members.every((m) => resolve(m, this.env).kind === "error")) {
        return { kind: "tagged", discriminator: "_tag" };
      }
      const disc = taggedDiscriminator(resolved.members, this.env);
      if (disc) return { kind: "tagged", discriminator: disc };
    }
    return { kind: "literal" };
  }

  private matchArmScope(
    scope: ValueScope,
    subject: MType,
    shape: MatchShape,
    pattern: ReturnType<typeof parsePattern>,
  ): ValueScope {
    if (!pattern?.binding || pattern.binding === "_") return scope;
    const resolved = resolve(subject, this.env);
    const inner = new Map(scope);
    if (shape.kind === "option" && resolved.kind === "option" && pattern.tag === "some") {
      inner.set(pattern.binding, resolved.item);
    } else if (shape.kind === "result" && resolved.kind === "result") {
      inner.set(pattern.binding, pattern.tag === "success" ? resolved.success : resolved.failure);
    } else if (shape.kind === "tagged" && resolved.kind === "union") {
      const matched = resolved.members.find((m) => {
        const r = resolve(m, this.env);
        return (
          r.kind === "struct" &&
          r.fields.some((f) => f.name === shape.discriminator && f.type.kind === "literal" && String(f.type.value) === pattern.tag)
        );
      });
      inner.set(pattern.binding, matched ?? subject);
    } else {
      inner.set(pattern.binding, subject);
    }
    return inner;
  }
}

// ---------------------------------------------------------------------------
// Helpers for IrAnnotator
// ---------------------------------------------------------------------------

function taggedDiscriminator(members: readonly MType[], env: TypeEnvironment): string | undefined {
  const structs = members.map((m) => resolve(m, env));
  if (structs.length === 0 || !structs.every((s) => s.kind === "struct")) return undefined;
  const first = structs[0] as MType & { kind: "struct" };
  for (const field of first.fields) {
    if (field.type.kind !== "literal" || typeof field.type.value !== "string") continue;
    const values = new Set<string>();
    let valid = true;
    for (const s of structs as (MType & { kind: "struct" })[]) {
      const f = s.fields.find((candidate) => candidate.name === field.name);
      if (!f || f.optional || f.type.kind !== "literal" || typeof f.type.value !== "string" || values.has(f.type.value)) {
        valid = false;
        break;
      }
      values.add(f.type.value);
    }
    if (valid) return field.name;
  }
  return undefined;
}

function unifyPattern(pattern: MType, actual: MType, subst: Substitution, env: TypeEnvironment): boolean {
  const p = applySubstitution(pattern, subst);
  const a = resolve(actual, env);
  if (a.kind === "var" && a.numeric) {
    if (p.kind === "var") {
      if (a.id === p.id) return true;
      subst.set(p.id, a);
      return true;
    }
    return p.kind === "prim" && p.name === "Float";
  }
  if (p.kind === "var") {
    if (actual.kind === "var" && actual.id === p.id) return true;
    if (p.numeric && a.kind === "prim" && a.name !== "Int" && a.name !== "Float") return false;
    subst.set(p.id, widenDeep(actual));
    return true;
  }
  if (p.kind === "array" && a.kind === "array") return unifyPattern(p.item, a.item, subst, env);
  if (p.kind === "option" && a.kind === "option") return unifyPattern(p.item, a.item, subst, env);
  if (p.kind === "map" && a.kind === "map") return unifyPattern(p.value, a.value, subst, env);
  if (p.kind === "function" && a.kind === "function" && p.params.length === a.params.length) {
    return (
      p.params.every((param, i) => unifyPattern(param, a.params[i]!, subst, env)) &&
      unifyPattern(p.result, a.result, subst, env)
    );
  }
  if (p.kind === "effect" && a.kind === "effect") return unifyPattern(p.success, a.success, subst, env);
  return isAssignable(actual, p, env);
}

function isFnNode(node: JsonValue | undefined): boolean {
  if (!isRecord(node) || node["kind"] !== "List") return false;
  const head = arrayItems(node["items"])[0];
  return isRecord(head) && head["kind"] === "Var" && head["name"] === "fn";
}

function isSomeOrNoneNode(node: JsonValue | undefined): boolean {
  if (!isRecord(node)) return false;
  if (node["kind"] === "Var" && node["name"] === "none") return true;
  if (node["kind"] === "List") {
    const head = arrayItems(node["items"])[0];
    return isRecord(head) && head["kind"] === "Var" && head["name"] === "some";
  }
  return false;
}

function typeFromValueSyntax(node: JsonValue | undefined, env: TypeEnvironment): MType | undefined {
  if (!isRecord(node)) return undefined;
  if (node["kind"] === "Type") return typeFromJson(node["type"], env);
  if (node["kind"] === "Var" && typeof node["name"] === "string") {
    const name = node["name"];
    if (["String", "Int", "Float", "Bool", "Unit", "Null", "Json", "Bytes", "DateTime", "Duration", "Schedule"].includes(name)) {
      return prim(name as "String");
    }
    if (env.errors.has(name)) return { kind: "error", name };
    if (env.classes.has(name)) return { kind: "class", name };
    if (env.schemas.has(name)) return { kind: "named", name };
    return { kind: "named", name };
  }
  if (node["kind"] === "List") {
    const items = arrayItems(node["items"]);
    const head = items[0];
    const name = isRecord(head) && head["kind"] === "Var" ? String(head["name"]) : undefined;
    if (!name) return undefined;
    const args = items.slice(1);
    if ((name === "Array" || name === "List") && args.length === 1) {
      const item = typeFromValueSyntax(args[0], env);
      return item ? { kind: "array", item } : undefined;
    }
    if (name === "Option" && args.length === 1) {
      const item = typeFromValueSyntax(args[0], env);
      return item ? { kind: "option", item } : undefined;
    }
    if (name === "Map" && args.length >= 1) {
      if (args.length === 1) {
        const value = typeFromValueSyntax(args[0], env);
        return value ? { kind: "map", value } : undefined;
      }
      if (keywordName(args[1]) === "key" && args.length === 3) {
        const value = typeFromValueSyntax(args[0], env);
        const key = typeFromValueSyntax(args[2], env);
        return value ? { kind: "map", value, ...(key ? { key } : {}) } : undefined;
      }
      const key = typeFromValueSyntax(args[0], env);
      const value = typeFromValueSyntax(args[1], env);
      return key && value ? { kind: "map", key, value } : undefined;
    }
    if (name === "Tuple") {
      const elems = args.map((a) => typeFromValueSyntax(a, env)).filter((t): t is MType => t !== undefined);
      return elems.length === args.length ? { kind: "tuple", items: elems } : undefined;
    }
    if (name === "Result" && args.length === 2) {
      const s = typeFromValueSyntax(args[0], env);
      const f = typeFromValueSyntax(args[1], env);
      return s && f ? { kind: "result", success: s, failure: f } : undefined;
    }
    if (name === "Union") {
      const members = args.map((a) => typeFromValueSyntax(a, env)).filter((t): t is MType => t !== undefined);
      return members.length === args.length ? { kind: "union", members } : undefined;
    }
  }
  if (node["kind"] === "Record") {
    const fields: MField[] = [];
    for (const entry of arrayItems(node["entries"]).filter(isRecord)) {
      const key = recordKey(entry["key"]);
      const val = entry["value"];
      if (key === undefined) continue;
      const optional =
        isRecord(val) &&
        val["kind"] === "List" &&
        isRecord(arrayItems(val["items"])[0]) &&
        (arrayItems(val["items"])[0] as JsonRecord)["kind"] === "Var" &&
        (arrayItems(val["items"])[0] as JsonRecord)["name"] === "Optional";
      const fieldType = optional
        ? typeFromValueSyntax(arrayItems((val as JsonRecord)["items"])[1], env)
        : typeFromValueSyntax(val, env);
      if (fieldType) fields.push({ name: key, type: fieldType, optional });
    }
    return { kind: "struct", fields };
  }
  return undefined;
}

function isElseCondition(node: JsonValue | undefined): boolean {
  return keywordName(node) === "else" || (isRecord(node) && node["kind"] === "Var" && node["name"] === "else");
}

function declarationSpan(declaration: PackageableDeclaration): JsonValue | undefined {
  if (declaration.span) return declaration.span as unknown as JsonValue;
  return isRecord(declaration.payload) ? declaration.payload["span"] : undefined;
}

function toSpan(value: JsonValue | undefined): CheckedEffectSourceSpan | undefined {
  if (!isRecord(value)) return undefined;
  const sourceId = value["sourceId"];
  const startOffset = value["startOffset"];
  const endOffset = value["endOffset"];
  if (typeof sourceId === "string" && typeof startOffset === "number" && typeof endOffset === "number") {
    return { sourceId, startOffset, endOffset };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Portable IR -> SExpr reconstruction (for declaration-only checkMechanicsProgram callers)
// ---------------------------------------------------------------------------

function locOf(span: JsonValue | undefined, fallbackSourceId?: string): Loc {
  const s = toSpan(span);
  return {
    start: s?.startOffset ?? 0,
    end: s?.endOffset ?? 0,
    line: 1,
    col: 1,
    ...(s?.sourceId ? { sourceId: s.sourceId } : fallbackSourceId ? { sourceId: fallbackSourceId } : {}),
  };
}

const sym = (name: string, loc: Loc): SExpr => ({ _tag: "Sym", name, loc });
const list = (items: readonly SExpr[], loc: Loc): SExpr => ({ _tag: "List", items, loc });
const vec = (items: readonly SExpr[], loc: Loc): SExpr => ({ _tag: "Vector", items, loc });
const str = (value: string, loc: Loc): SExpr => ({ _tag: "Str", value, loc });
const num = (value: number, loc: Loc): SExpr => ({
  _tag: "Num",
  value,
  numericKind: Number.isInteger(value) ? "int" : "float",
  loc,
});
const bool = (value: boolean, loc: Loc): SExpr => ({ _tag: "Bool", value, loc });
const mapExpr = (pairs: readonly (readonly [SExpr, SExpr])[], loc: Loc): SExpr => ({ _tag: "Map", pairs, loc });

/**
 * Reconstructs SExpr forms from portable mechanics `PackageableDeclaration[]`
 * preserving every IR node's span as `SExpr.loc`, so callers that only hold
 * `PackageableDeclaration[]` still check through the single HM checker.
 */
export function declarationsToSExprs(declarations: readonly PackageableDeclaration[]): readonly SExpr[] {
  const out: SExpr[] = [];
  const effectValueNames = new Set<string>();
  const declaredTypes = new Set<string>();
  for (const decl of declarations) {
    const payload = decl.payload;
    if (!isRecord(payload) || typeof payload["name"] !== "string") continue;
    if (payload["kind"] === "SchemaDef") declaredTypes.add(payload["name"]);
    if (payload["kind"] === "EffectDef") effectValueNames.add(payload["name"]);
  }
  const emittedBrands = new Set<string>(declaredTypes);
  for (const decl of declarations) {
    const payload = decl.payload;
    if (!isRecord(payload) || typeof payload["name"] !== "string") continue;
    const loc = locOf(declarationSpan(decl), decl.sourceId);
    const name = payload["name"];
    const sid = decl.sourceId;
    switch (payload["kind"]) {
      case "SchemaDef": {
        const schema = payload["schema"];
        if (schema !== undefined) {
          for (const brand of inlineBrands([schema])) {
            if (!emittedBrands.has(brand.name)) {
              emittedBrands.add(brand.name);
              const base = isRecord(brand.schema) && brand.schema["kind"] === "Brand" ? brand.schema["schema"] : brand.schema;
              out.push(list([sym("type", loc), sym(brand.name, loc), list([sym("Brand", loc), typeJsonToSExpr(base, loc)], loc)], loc));
            }
          }
        }
        out.push(list([sym("type", loc), sym(name, loc), schemaJsonToSExpr(schema, loc, true)], loc));
        break;
      }
      case "ErrorDef":
        out.push(list([sym("error", loc), sym(name, loc), schemaJsonToSExpr(payload["schema"], loc, true)], loc));
        break;
      case "ClassDef":
        out.push(list([sym("class", loc), sym(name, loc), schemaJsonToSExpr(payload["schema"], loc, true)], loc));
        break;
      case "ServiceDef": {
        const methods = arrayItems(payload["methods"])
          .filter(isRecord)
          .map((m) => {
            const mLoc = locOf(m["span"], sid);
            const mName = String(m["name"]);
            const params = arrayItems(m["params"]).filter(isRecord).map((p) => typeJsonToSExpr(p["type"], mLoc));
            const eff = typeJsonToSExpr(m["effect"], mLoc, false, true);
            const sigType = m["value"] === true ? eff : list([sym("->", mLoc), ...params, eff], mLoc);
            return list([sym(":", mLoc), sym(mName, mLoc), sigType], mLoc);
          });
        out.push(list([sym("service", loc), sym(name, loc), ...methods], loc));
        break;
      }
      case "EffectDef": {
        const params = arrayItems(payload["params"]).filter(isRecord);
        const paramTypes = params.map((p) => typeJsonToSExpr(p["type"], loc));
        const effType = typeJsonToSExpr(payload["effect"], loc);
        const sigType = payload["value"] === true ? effType : list([sym("->", loc), ...paramTypes, effType], loc);
        out.push(list([sym(":", loc), sym(name, loc), sigType], loc));
        const body = effectJsonToSExpr(payload["body"], loc, sid, effectValueNames);
        const defVal =
          payload["value"] === true
            ? body
            : list([sym("fn", loc), vec(params.map((p) => sym(String(p["name"]), loc)), loc), body], loc);
        out.push(list([sym("define", loc), sym(name, loc), defVal], loc));
        break;
      }
      case "FunctionDef": {
        const params = arrayItems(payload["params"]).filter(isRecord);
        const paramTypes = params.map((p) => typeJsonToSExpr(p["type"], loc));
        const resType = typeJsonToSExpr(payload["returns"], loc);
        out.push(list([sym(":", loc), sym(name, loc), list([sym("->", loc), ...paramTypes, resType], loc)], loc));
        const body = valueJsonToSExpr(payload["body"], loc, sid, effectValueNames);
        out.push(
          list(
            [sym("define", loc), sym(name, loc), list([sym("fn", loc), vec(params.map((p) => sym(String(p["name"]), loc)), loc), body], loc)],
            loc,
          ),
        );
        break;
      }
      case "ValueDef": {
        out.push(list([sym(":", loc), sym(name, loc), typeJsonToSExpr(payload["type"], loc)], loc));
        out.push(list([sym("define", loc), sym(name, loc), valueJsonToSExpr(payload["value"], loc, sid, effectValueNames)], loc));
        break;
      }
      case "LayerDef": {
        const impl = payload["implementation"];
        if (isRecord(impl) && impl["kind"] === "Compose") {
          out.push(list([sym("define", loc), sym(name, loc), layerJsonToSExpr(impl["layer"], loc, sid)], loc));
        } else if (isRecord(impl) && impl["kind"] === "Service") {
          const items: SExpr[] = [sym("layer", loc), sym(name, loc), sym(":provides", loc), sym(String(impl["service"]), loc)];
          const setup = arrayItems(impl["setup"]).filter(isRecord);
          if (setup.length > 0) {
            const bindings: SExpr[] = [];
            for (const binding of setup) {
              const sLoc = binding["span"] ? locOf(binding["span"], sid) : loc;
              const val = binding["value"];
              if (isRecord(val) && val["kind"] === "Pure" && !isEffectNodeValue(val["value"], effectValueNames)) {
                bindings.push(sym(":let", sLoc), vec([sym(String(binding["name"] ?? "_"), sLoc), valueJsonToSExpr(val["value"], sLoc, sid, effectValueNames)], sLoc));
              } else {
                bindings.push(sym(String(binding["name"] ?? "_"), sLoc), effectJsonToSExpr(val, sLoc, sid, effectValueNames));
              }
            }
            items.push(sym(":setup", loc), vec(bindings, loc));
          }
          for (const method of arrayItems(impl["methods"]).filter(isRecord)) {
            const mLoc = locOf(method["span"], sid);
            const mParams = stringItems(method["params"]).map((p) => sym(p, mLoc));
            const mBody = effectJsonToSExpr(method["body"], mLoc, sid, effectValueNames);
            if (method["value"] === true) {
              items.push(list([sym("define", mLoc), sym(String(method["name"]), mLoc), mBody], mLoc));
            } else {
              items.push(list([sym("define", mLoc), sym(String(method["name"]), mLoc), vec(mParams, mLoc), mBody], mLoc));
            }
          }
          out.push(list(items, loc));
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function isEffectNodeValue(node: JsonValue | undefined, effectValueNames: ReadonlySet<string>): boolean {
  if (!isRecord(node)) return false;
  if (node["kind"] === "Var" && typeof node["name"] === "string") {
    return effectValueNames.has(node["name"]) || node["name"].includes(".");
  }
  if (node["kind"] === "List") {
    const head = arrayItems(node["items"])[0];
    if (isRecord(head) && head["kind"] === "Var" && typeof head["name"] === "string") {
      return effectValueNames.has(head["name"]) || head["name"].startsWith("stream-run-") || head["name"].includes(".");
    }
  }
  return false;
}

function schemaJsonToSExpr(node: JsonValue | undefined, loc: Loc, top = false): SExpr {
  return typeJsonToSExpr(node, loc, top);
}

function typeJsonToSExpr(node: JsonValue | undefined, loc: Loc, top = false, stripReqs = false): SExpr {
  if (!isRecord(node)) return sym("Unknown", loc);
  switch (node["kind"]) {
    case "Primitive":
      return sym(String(node["name"]), loc);
    case "Ref":
      return sym(String(node["name"]), loc);
    case "Brand":
      if (!top && typeof node["name"] === "string") return sym(node["name"], loc);
      return list([sym("Brand", loc), typeJsonToSExpr(node["schema"], loc)], loc);
    case "Struct": {
      const pairs = arrayItems(node["fields"])
        .filter(isRecord)
        .map((f): readonly [SExpr, SExpr] => [sym(`:${String(f["name"])}`, loc), typeJsonToSExpr(f["schema"], loc)]);
      return mapExpr(pairs, loc);
    }
    case "Optional":
    case "Option":
      return list([sym("Option", loc), typeJsonToSExpr(node["item"], loc)], loc);
    case "Result":
      return list([sym("Result", loc), typeJsonToSExpr(node["success"], loc), typeJsonToSExpr(node["failure"], loc)], loc);
    case "Array":
      return list([sym("List", loc), typeJsonToSExpr(node["item"], loc)], loc);
    case "Map":
      return node["key"]
        ? list([sym("Map", loc), typeJsonToSExpr(node["key"], loc), typeJsonToSExpr(node["value"], loc)], loc)
        : list([sym("Map", loc), sym("String", loc), typeJsonToSExpr(node["value"], loc)], loc);
    case "Tuple":
      return list([sym("Tuple", loc), ...arrayItems(node["items"]).map((i) => typeJsonToSExpr(i, loc))], loc);
    case "Literal": {
      const values = arrayItems(node["values"]).map((v) =>
        typeof v === "string" ? str(v, loc) : typeof v === "number" ? num(v, loc) : bool(Boolean(v), loc),
      );
      if (values.length === 1) return values[0]!;
      return list([sym("Union", loc), ...values], loc);
    }
    case "Union":
      return list([sym("Union", loc), ...arrayItems(node["variants"]).map((v) => typeJsonToSExpr(v, loc))], loc);
    case "TaggedUnion": {
      const disc = String(node["discriminator"] ?? "_tag");
      const variants = arrayItems(node["variants"])
        .filter(isRecord)
        .map((v) => {
          const tag = String(v["tag"]);
          const inner = v["schema"];
          const fields = isRecord(inner) && inner["kind"] === "Struct" ? arrayItems(inner["fields"]).filter(isRecord) : [];
          if (fields.length === 0) return sym(tag, loc);
          const pairs: (readonly [SExpr, SExpr])[] = fields.map((f): readonly [SExpr, SExpr] => [
            sym(`:${String(f["name"])}`, loc),
            typeJsonToSExpr(f["schema"], loc),
          ]);
          return list([sym(tag, loc), mapExpr(pairs, loc)], loc);
        });
      return disc === "_tag"
        ? list([sym("Tagged", loc), ...variants], loc)
        : list([sym("Tagged", loc), sym(":tag", loc), sym(disc, loc), ...variants], loc);
    }
    case "Annotated": {
      const base = typeJsonToSExpr(node["schema"], loc, top);
      const meta = isRecord(node["metadata"]) ? node["metadata"] : {};
      const opts: SExpr[] = [];
      for (const [k, v] of Object.entries(meta)) {
        if (typeof v === "number") opts.push(sym(`:${k}`, loc), num(v, loc));
        else if (typeof v === "string") opts.push(sym(`:${k}`, loc), str(v, loc));
      }
      return opts.length > 0 ? list([base, ...opts], loc) : base;
    }
    case "Effect": {
      const errNames = [
        ...stringItems(node["errors"]),
        ...arrayItems(node["errorVariables"]).flatMap((v) => (isRecord(v) && typeof v["name"] === "string" ? [v["name"]] : [])),
      ];
      const reqNames = stripReqs
        ? []
        : [
            ...stringItems(node["requirements"]),
            ...arrayItems(node["requirementVariables"]).flatMap((v) => (isRecord(v) && typeof v["name"] === "string" ? [v["name"]] : [])),
          ];
      return list(
        [
          sym("Effect", loc),
          typeJsonToSExpr(node["success"], loc),
          vec(errNames.map((e) => sym(e, loc)), loc),
          vec(reqNames.map((r) => sym(r, loc)), loc),
        ],
        loc,
      );
    }
    case "Function":
      return list(
        [sym("->", loc), ...arrayItems(node["params"]).map((p) => typeJsonToSExpr(p, loc)), typeJsonToSExpr(node["result"], loc)],
        loc,
      );
    case "RefCell":
      return list([sym("Ref", loc), typeJsonToSExpr(node["item"], loc)], loc);
    case "Fiber":
      return list([sym("Fiber", loc), typeJsonToSExpr(node["success"], loc), vec(stringItems(node["errors"]).map((e) => sym(e, loc)), loc)], loc);
    case "Stream":
      return list(
        [
          sym("Stream", loc),
          typeJsonToSExpr(node["item"], loc),
          vec(stringItems(node["errors"]).map((e) => sym(e, loc)), loc),
          vec(stringItems(node["requirements"]).map((r) => sym(r, loc)), loc),
        ],
        loc,
      );
    case "Layer":
      return list(
        [
          sym("Layer", loc),
          vec(stringItems(node["provides"]).map((p) => sym(p, loc)), loc),
          vec(stringItems(node["errors"]).map((e) => sym(e, loc)), loc),
          vec(stringItems(node["requirements"]).map((r) => sym(r, loc)), loc),
        ],
        loc,
      );
    case "Numeric":
      return typeJsonToSExpr(node["type"], loc);
    default:
      return sym("Unknown", loc);
  }
}

function layerJsonToSExpr(node: JsonValue | undefined, fallback: Loc, sid?: string): SExpr {
  if (!isRecord(node)) return sym("nil", fallback);
  const loc = node["span"] ? locOf(node["span"], sid) : fallback;
  switch (node["kind"]) {
    case "LayerRef":
      return sym(String(node["name"]), loc);
    case "LayerMerge":
    case "Merge":
      return list([sym("layer-merge", loc), ...arrayItems(node["layers"]).map((l) => layerJsonToSExpr(l, loc, sid))], loc);
    case "LayerProvide":
    case "LayerProvideMerge": {
      const fn = node["kind"] === "LayerProvide" ? "layer-provide" : "layer-provide-merge";
      const deps = arrayItems(node["dependencies"]).map((d) => layerJsonToSExpr(d, loc, sid));
      const depExpr = deps.length === 1 ? deps[0]! : list([sym("layer-merge", loc), ...deps], loc);
      return list([sym(fn, loc), layerJsonToSExpr(node["layer"], loc, sid), depExpr], loc);
    }
    case "Provide":
      return list([sym("layer-provide", loc), layerJsonToSExpr(node["target"], loc, sid), layerJsonToSExpr(node["source"], loc, sid)], loc);
    case "ProvideMerge":
      return list([sym("layer-provide-merge", loc), layerJsonToSExpr(node["target"], loc, sid), layerJsonToSExpr(node["source"], loc, sid)], loc);
    default:
      return sym("nil", loc);
  }
}

function effectJsonToSExpr(
  node: JsonValue | undefined,
  fallback: Loc,
  sid?: string,
  effectValueNames: ReadonlySet<string> = new Set(),
): SExpr {
  if (!isRecord(node)) return sym("nil", fallback);
  const loc = node["span"] ? locOf(node["span"], sid) : fallback;
  switch (node["kind"]) {
    case "Succeed":
      return list([sym("succeed", loc), valueJsonToSExpr(node["value"], loc, sid, effectValueNames)], loc);
    case "Pure":
    case "Value": {
      const val = node["value"];
      if (isEffectNodeValue(val, effectValueNames)) {
        return valueJsonToSExpr(val, loc, sid, effectValueNames);
      }
      return list([sym("succeed", loc), valueJsonToSExpr(val, loc, sid, effectValueNames)], loc);
    }
    case "Bind":
      return effectJsonToSExpr(node["value"], loc, sid, effectValueNames);
    case "Fail": {
      const errNode = node["error"];
      if (typeof errNode === "string") {
        return list([sym("fail", loc), list([sym(errNode, loc), mapExpr([], loc)], loc)], loc);
      }
      if (isRecord(errNode) && errNode["kind"] === "Error") {
        const errLoc = errNode["span"] ? locOf(errNode["span"], sid) : loc;
        const errName = String(errNode["errorType"] ?? "");
        const payload = errNode["payload"] !== undefined ? valueJsonToSExpr(errNode["payload"], errLoc, sid, effectValueNames) : mapExpr([], errLoc);
        return list([sym("fail", loc), list([sym(errName, errLoc), payload], errLoc)], loc);
      }
      return list([sym("fail", loc), valueJsonToSExpr(errNode, loc, sid, effectValueNames)], loc);
    }
    case "ServiceCall": {
      const target = sym(`${String(node["service"])}.${String(node["method"])}`, loc);
      return node["value"] === true
        ? target
        : list([target, ...arrayItems(node["args"]).map((a) => valueJsonToSExpr(a, loc, sid, effectValueNames))], loc);
    }
    case "OperationCall":
      return list(
        [sym(String(node["operation"]), loc), ...arrayItems(node["args"]).map((a) => valueJsonToSExpr(a, loc, sid, effectValueNames))],
        loc,
      );
    case "Do":
    case "Let": {
      const bindings: SExpr[] = [];
      for (const binding of arrayItems(node["bindings"]).filter(isRecord)) {
        const sLoc = binding["span"] ? locOf(binding["span"], sid) : loc;
        const val = binding["value"];
        if (isRecord(val) && val["kind"] === "Pure" && !isEffectNodeValue(val["value"], effectValueNames)) {
          bindings.push(sym(":let", sLoc), vec([sym(String(binding["name"] ?? "_"), sLoc), valueJsonToSExpr(val["value"], sLoc, sid, effectValueNames)], sLoc));
        } else {
          bindings.push(sym(String(binding["name"] ?? "_"), sLoc), effectJsonToSExpr(val, sLoc, sid, effectValueNames));
        }
      }
      if (node["body"] !== undefined) {
        return list([sym("do!", loc), vec(bindings, loc), effectJsonToSExpr(node["body"], loc, sid, effectValueNames)], loc);
      }
      const forms = arrayItems(node["forms"]).map((f) => effectJsonToSExpr(f, loc, sid, effectValueNames));
      if (forms.length === 0) {
        return list([sym("do!", loc), vec(bindings, loc), list([sym("succeed", loc), sym("nil", loc)], loc)], loc);
      }
      for (let i = 0; i < forms.length - 1; i++) {
        bindings.push(sym("_", loc), forms[i]!);
      }
      return list([sym("do!", loc), vec(bindings, loc), forms.at(-1)!], loc);
    }
    case "If":
      return list(
        [sym("if", loc), valueJsonToSExpr(node["condition"], loc, sid, effectValueNames), effectJsonToSExpr(node["then"], loc, sid, effectValueNames), effectJsonToSExpr(node["else"], loc, sid, effectValueNames)],
        loc,
      );
    case "When":
      return list(
        [sym("if", loc), valueJsonToSExpr(node["condition"], loc, sid, effectValueNames), effectJsonToSExpr(node["body"], loc, sid, effectValueNames), list([sym("succeed", loc), sym("nil", loc)], loc)],
        loc,
      );
    case "Unless":
      return list(
        [sym("if", loc), valueJsonToSExpr(node["condition"], loc, sid, effectValueNames), list([sym("succeed", loc), sym("nil", loc)], loc), effectJsonToSExpr(node["body"], loc, sid, effectValueNames)],
        loc,
      );
    case "Cond": {
      const items: SExpr[] = [sym("cond", loc)];
      for (const clause of arrayItems(node["clauses"]).filter(isRecord)) {
        items.push(valueJsonToSExpr(clause["condition"], loc, sid, effectValueNames), effectJsonToSExpr(clause["body"], loc, sid, effectValueNames));
      }
      return list(items, loc);
    }
    case "Match": {
      const items: SExpr[] = [sym("match", loc), valueJsonToSExpr(node["value"], loc, sid, effectValueNames)];
      for (const arm of arrayItems(node["arms"]).filter(isRecord)) {
        items.push(valueJsonToSExpr(arm["pattern"], loc, sid, effectValueNames), effectJsonToSExpr(arm["body"], loc, sid, effectValueNames));
      }
      return list(items, loc);
    }
    case "Catch": {
      const errName = String(node["errorType"] ?? "_");
      const binding = typeof node["binding"] === "string" ? node["binding"] : undefined;
      const pat = errName === "_" ? sym("_", loc) : binding ? list([sym(errName, loc), sym(binding, loc)], loc) : sym(errName, loc);
      return list([sym("catch", loc), effectJsonToSExpr(node["body"], loc, sid, effectValueNames), pat, effectJsonToSExpr(node["handler"], loc, sid, effectValueNames)], loc);
    }
    case "CatchTags": {
      const items: SExpr[] = [sym("catch", loc), effectJsonToSExpr(node["body"], loc, sid, effectValueNames)];
      for (const h of arrayItems(node["handlers"]).filter(isRecord)) {
        const hLoc = h["span"] ? locOf(h["span"], sid) : loc;
        const errName = String(h["errorType"] ?? "_");
        const binding = typeof h["binding"] === "string" ? h["binding"] : undefined;
        const pat = errName === "_" ? sym("_", hLoc) : binding ? list([sym(errName, hLoc), sym(binding, hLoc)], hLoc) : sym(errName, hLoc);
        items.push(pat, effectJsonToSExpr(h["handler"], hLoc, sid, effectValueNames));
      }
      return list(items, loc);
    }
    case "CatchAll": {
      const binding = typeof node["binding"] === "string" ? node["binding"] : "_";
      return list(
        [sym("catch", loc), effectJsonToSExpr(node["body"], loc, sid, effectValueNames), sym(binding, loc), effectJsonToSExpr(node["handler"], loc, sid, effectValueNames)],
        loc,
      );
    }
    case "Lambda":
      return list(
        [sym("fn", loc), vec(stringItems(node["params"]).map((p) => sym(p, loc)), loc), effectJsonToSExpr(node["body"], loc, sid, effectValueNames)],
        loc,
      );
    case "Combinator": {
      const name = String(node["name"]);
      const args = arrayItems(node["args"]).map((a, i) => combinatorArgToSExpr(name, i, a, loc, sid, effectValueNames));
      const optExprs: SExpr[] = [];
      for (const entry of arrayItems(node["options"]).filter(isRecord)) {
        const optVal = entry["value"];
        const kw = keywordName(optVal);
        optExprs.push(
          sym(`:${String(entry["key"])}`, loc),
          kw !== undefined && kw.length > 0 ? sym(`:${kw}`, loc) : valueJsonToSExpr(optVal, loc, sid, effectValueNames),
        );
      }
      return list([sym(name, loc), ...args, ...optExprs], loc);
    }
    default:
      return sym("nil", loc);
  }
}

function combinatorArgToSExpr(
  name: string,
  index: number,
  arg: JsonValue,
  loc: Loc,
  sid?: string,
  effectValueNames: ReadonlySet<string> = new Set(),
): SExpr {
  if (isRecord(arg) && (arg["kind"] === "Type" || arg["kind"] === "TypeArg")) return typeJsonToSExpr(arg["type"], loc);
  if (isRecord(arg) && arg["kind"] === "Lambda") return effectJsonToSExpr(arg, loc, sid, effectValueNames);
  if (name === "all" && isRecord(arg) && (arg["kind"] === "EffectRecord" || arg["kind"] === "Record")) {
    return mapExpr(
      arrayItems(arg["entries"])
        .filter(isRecord)
        .map((e): readonly [SExpr, SExpr] => [
          typeof e["key"] === "string" ? sym(`:${e["key"]}`, loc) : valueJsonToSExpr(e["key"], loc, sid, effectValueNames),
          effectJsonToSExpr(e["value"], loc, sid, effectValueNames),
        ]),
      loc,
    );
  }
  if (name === "all" && isRecord(arg) && (arg["kind"] === "EffectVector" || arg["kind"] === "Vector")) {
    return vec(arrayItems(arg["items"]).map((i) => effectJsonToSExpr(i, loc, sid, effectValueNames)), loc);
  }
  const effectArgIndices: Record<string, readonly number[]> = {
    scoped: [0],
    "acquire-release": [0],
    ensuring: [0, 1],
    "add-finalizer": [0],
    race: [0, 1],
    fork: [0],
    timeout: [0],
    retry: [0],
    repeat: [0],
    "map-error": [0],
    "or-else-succeed": [0],
    "or-die": [0],
    option: [0],
    result: [0],
    provide: [0],
  };
  if (effectArgIndices[name]?.includes(index)) return effectJsonToSExpr(arg, loc, sid, effectValueNames);
  return valueJsonToSExpr(arg, loc, sid, effectValueNames);
}

function valueJsonToSExpr(
  node: JsonValue | undefined,
  fallback: Loc,
  sid?: string,
  effectValueNames: ReadonlySet<string> = new Set(),
): SExpr {
  if (!isRecord(node)) return sym("nil", fallback);
  const loc = node["span"] ? locOf(node["span"], sid) : fallback;
  switch (node["kind"]) {
    case "Literal": {
      const val = node["value"];
      if (val === null) return sym("nil", loc);
      if (typeof val === "string") return str(val, loc);
      if (typeof val === "number") return num(val, loc);
      return bool(Boolean(val), loc);
    }
    case "Var": {
      const n = String(node["name"]);
      return sym(n === "none" ? "None" : n, loc);
    }
    case "Type":
      return typeJsonToSExpr(node["type"], loc);
    case "Expr": {
      const src = node["source"];
      if (isRecord(src) && src["kind"] === "Symbol" && typeof src["name"] === "string") {
        if (src["name"].length > 1 && src["name"].startsWith(":")) return str(src["name"].slice(1), loc);
        return sym(src["name"], loc);
      }
      return sym("nil", loc);
    }
    case "Record":
      return mapExpr(
        arrayItems(node["entries"])
          .filter(isRecord)
          .map((e): readonly [SExpr, SExpr] => {
            const k = keywordName(e["key"]);
            const keyExpr = k !== undefined ? sym(`:${k}`, loc) : valueJsonToSExpr(e["key"], loc, sid, effectValueNames);
            return [keyExpr, valueJsonToSExpr(e["value"], loc, sid, effectValueNames)];
          }),
        loc,
      );
    case "Vector":
      return vec(arrayItems(node["items"]).map((i) => valueJsonToSExpr(i, loc, sid, effectValueNames)), loc);
    case "List": {
      const rawItems = arrayItems(node["items"]);
      const headRaw = rawItems[0];
      const headName = isRecord(headRaw) && headRaw["kind"] === "Var" ? String(headRaw["name"]) : undefined;
      const items = rawItems.map((item, idx) => {
        if ((headName === "get" || headName === "assoc") && idx === 2) {
          const k = keywordName(item);
          if (k !== undefined) return sym(`:${k}`, loc);
        }
        if (headName === "cond" && idx >= 1 && idx % 2 === 1 && keywordName(item) === "else") {
          return sym(":else", loc);
        }
        return valueJsonToSExpr(item, loc, sid, effectValueNames);
      });
      if (items[0]?._tag === "Sym" && items[0].name === "some") {
        return list([sym("Some", items[0].loc), ...items.slice(1)], loc);
      }
      if (items[0]?._tag === "Sym" && items[0].name === ":" && items.length === 3) {
        return list([items[0], items[1]!, normalizeValueTypeSExpr(items[2]!)], loc);
      }
      return list(items, loc);
    }
    default:
      return effectJsonToSExpr(node, loc, sid, effectValueNames);
  }
}

function normalizeValueTypeSExpr(expr: SExpr): SExpr {
  if (expr._tag === "List" && expr.items[0]?._tag === "Sym") {
    const head = expr.items[0].name;
    if (head === "Array") {
      return list([sym("List", expr.items[0].loc), ...expr.items.slice(1).map(normalizeValueTypeSExpr)], expr.loc);
    }
    if (head === "Map" && expr.items.length === 2) {
      return list([expr.items[0], sym("String", expr.loc), normalizeValueTypeSExpr(expr.items[1]!)], expr.loc);
    }
    if (head === "Map" && expr.items.length === 4 && expr.items[2]?._tag === "Sym" && expr.items[2].name === ":key") {
      return list([expr.items[0], normalizeValueTypeSExpr(expr.items[3]!), normalizeValueTypeSExpr(expr.items[1]!)], expr.loc);
    }
    if (head === "Optional") {
      return list([sym("Option", expr.items[0].loc), ...expr.items.slice(1).map(normalizeValueTypeSExpr)], expr.loc);
    }
    return list([expr.items[0], ...expr.items.slice(1).map(normalizeValueTypeSExpr)], expr.loc);
  }
  if (expr._tag === "Map") {
    return mapExpr(expr.pairs.map(([k, v]) => [k, normalizeValueTypeSExpr(v)] as const), expr.loc);
  }
  return expr;
}
