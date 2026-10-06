/**
 * Type checking for mechanics programs.
 *
 * The checker reads the portable mechanics IR produced by either engine and
 * proves the properties the Effect TypeScript target relies on: values match
 * their schemas, every failure an operation can raise is declared, every
 * service it touches is a declared requirement, matches are exhaustive,
 * catches are possible, finalizers cannot fail, and layers implement their
 * services. Each diagnostic points at the source span of the expression that
 * introduced the problem.
 *
 * It also records the types the generator needs for type-directed output
 * (for example whether a value in effect position is itself an effect).
 *
 * @module
 */
import type { JsonValue, PackageableDeclaration } from "../artifact/artifact.js";
import { arithmeticOperators, builtins, type BuiltinOverload } from "./builtins.js";
import { isEffectFormName } from "./artifact.js";
import { inlineBrands, schemaReferences } from "./effect-schema.js";
import { camelIdentifier, effectModules, generatedGlobals, typeName } from "./naming.js";
import {
  applySubstitution,
  arrayItems,
  coversRequirement,
  effectOf,
  emptySet,
  isAssignable,
  isRecord,
  join,
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
  union,
  unionSets,
  widenDeep,
  widenLiteral,
  containsLiterals,
  type LayerType,
  type MField,
  type MType,
  type Provenance,
  type Substitution,
  type TypeEnvironment,
} from "./types.js";

export interface MechanicsCheckDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly span?: MechanicsSourceSpan;
}

export interface MechanicsSourceSpan {
  readonly sourceId: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export type EffectType = MType & { readonly kind: "effect" };

/** How a value-position application was resolved. */
export type ResolvedCall =
  | { readonly kind: "builtin"; readonly name: string; readonly overload: BuiltinOverload }
  | { readonly kind: "arithmetic"; readonly operator: string }
  | { readonly kind: "equality"; readonly operator: "=" | "!=" }
  | { readonly kind: "special"; readonly name: string }
  | { readonly kind: "get"; readonly access: "field" | "optional-field" | "map" }
  | { readonly kind: "assoc"; readonly access: "field" | "map" | "class" }
  | { readonly kind: "class"; readonly name: string }
  | { readonly kind: "stream"; readonly name: string }
  | { readonly kind: "error"; readonly name: string }
  | { readonly kind: "brand"; readonly name: string }
  | { readonly kind: "construct"; readonly name: string }
  | { readonly kind: "function"; readonly name: string }
  | { readonly kind: "operation"; readonly name: string }
  | { readonly kind: "service"; readonly service: string; readonly method: string }
  | { readonly kind: "local"; readonly name: string };

export type MatchShape =
  | { readonly kind: "option" }
  | { readonly kind: "result" }
  | { readonly kind: "literal" }
  | { readonly kind: "tagged"; readonly discriminator: string };

export interface ServiceMethodSignature {
  readonly value?: boolean;
  readonly name: string;
  readonly params: readonly { readonly name: string; readonly type: MType }[];
  readonly effect: EffectType;
}

export interface CallableSignature {
  readonly params: readonly { readonly name: string; readonly type: MType }[];
  readonly result: MType;
}

export interface LayerInfo {
  readonly type: LayerType;
  /** Services that operation calls inside methods need from the captured context. */
  readonly contextServices: readonly string[];
}

export interface CheckInfo {
  readonly env: TypeEnvironment;
  readonly errorFields: ReadonlyMap<string, readonly MField[]>;
  readonly services: ReadonlyMap<string, ReadonlyMap<string, ServiceMethodSignature>>;
  readonly operations: ReadonlyMap<string, CallableSignature & { readonly result: EffectType }>;
  readonly functions: ReadonlyMap<string, CallableSignature>;
  readonly constants: ReadonlyMap<string, MType>;
  readonly layers: ReadonlyMap<string, LayerInfo>;
  readonly valueTypes: WeakMap<object, MType>;
  readonly effectTypes: WeakMap<object, EffectType>;
  readonly calls: WeakMap<object, ResolvedCall>;
  readonly matches: WeakMap<object, MatchShape>;
  /** Record literals checked against a named schema type. */
  readonly recordTargets: WeakMap<object, MType>;
  /** Literal syntax (strings, numbers, booleans, keywords, records, vectors) checked against a type with literal types. */
  readonly literalTargets: WeakMap<object, MType>;
  /** Operation calls inside layer methods that must be given the layer's captured context. */
  readonly contextCalls: WeakSet<object>;
}

export interface MechanicsCheckResult {
  readonly ok: boolean;
  readonly diagnostics: readonly MechanicsCheckDiagnostic[];
  readonly info: CheckInfo;
}

/** Errors that Effect itself can raise from the combinators Forma exposes. */
export const builtinErrors: ReadonlyMap<string, string> = new Map([
  ["TimeoutError", "Cause.TimeoutError"],
  ["ConfigError", "Config.ConfigError"],
  ["SchemaError", "Schema.SchemaError"],
]);

/** Requirements that are not services. */
export const builtinRequirements: ReadonlySet<string> = new Set(["Scope"]);

type Scope = ReadonlyMap<string, MType>;

type JsonRecord = Readonly<Record<string, JsonValue>>;

interface ValueOptions {
  /** Skip the expected-type check when the value turns out to be an effect. */
  readonly allowEffect?: boolean;
}

interface LayerContext {
  readonly name: string;
  readonly contextCalls: Set<object>;
}

export function checkMechanicsDeclarations(
  declarations: readonly PackageableDeclaration[],
): MechanicsCheckResult {
  return new Checker(declarations).run();
}

class Checker {
  private readonly diagnostics: MechanicsCheckDiagnostic[] = [];
  private readonly schemas = new Map<string, MType>();
  private readonly errorNames = new Set<string>(builtinErrors.keys());
  private readonly classes = new Map<string, readonly MField[]>();
  private readonly env: TypeEnvironment = { schemas: this.schemas, errors: this.errorNames, classes: this.classes };
  private readonly errorFields = new Map<string, readonly MField[]>();
  private readonly services = new Map<string, Map<string, ServiceMethodSignature>>();
  private readonly operations = new Map<string, CallableSignature & { readonly result: EffectType }>();
  private readonly functions = new Map<string, CallableSignature>();
  private readonly constants = new Map<string, MType>();
  private readonly layerPayloads = new Map<string, { readonly payload: JsonRecord; readonly span: JsonValue | undefined }>();
  private readonly layers = new Map<string, LayerInfo>();
  private readonly layersInProgress = new Set<string>();
  private readonly info: CheckInfo;
  private layerContext: LayerContext | undefined;
  /** Set while checking a function or constant, which cannot reach services. */
  private pureOwner: string | undefined;

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

  run(): MechanicsCheckResult {
    this.collect();
    for (const declaration of this.declarations) {
      const payload = declaration.payload;
      if (!isRecord(payload)) continue;
      const span = declarationSpan(declaration);
      switch (payload["kind"]) {
        case "SchemaDef":
        case "ErrorDef":
        case "ClassDef":
          this.checkTypeReferences(payload["schema"], span);
          this.checkSchemaShape(payload["schema"], String(payload["kind"]), span);
          break;
        case "ServiceDef":
          this.checkService(payload, span);
          break;
        case "EffectDef":
          this.checkOperation(payload, span);
          break;
        case "FunctionDef":
          this.checkFunction(payload, span);
          break;
        case "ValueDef": {
          this.checkTypeReferences(payload["type"], span);
          const type = this.constants.get(String(payload["name"]));
          this.pureOwner = `Constant ${String(payload["name"])}`;
          if (type) this.value(payload["value"], new Map(), type);
          this.pureOwner = undefined;
          break;
        }
        case "LayerDef":
          this.layerInfo(String(payload["name"]), span);
          break;
        default:
          break;
      }
    }
    return {
      ok: !this.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
      diagnostics: this.diagnostics,
      info: this.info,
    };
  }

  // -------------------------------------------------------------------------
  // Declarations
  // -------------------------------------------------------------------------

  private collect(): void {
    const seen = new Map<string, string>();
    const claim = (name: string, kind: string, span: JsonValue | undefined): boolean => {
      const previous = seen.get(name);
      if (previous) {
        this.error(span, "mechanics/duplicate-name", `${name} is already defined as a ${previous}.`);
        return false;
      }
      seen.set(name, kind);
      return true;
    };
    for (const name of builtinErrors.keys()) {
      seen.set(name, "built-in error");
      this.errorFields.set(name, []);
    }

    for (const declaration of this.declarations) {
      const payload = declaration.payload;
      if (!isRecord(payload) || typeof payload["name"] !== "string") continue;
      const name = payload["name"];
      const span = declarationSpan(declaration);
      switch (payload["kind"]) {
        case "SchemaDef":
          if (claim(name, "schema", span)) this.schemas.set(name, tUnknown);
          break;
        case "ErrorDef":
          if (claim(name, "error", span)) this.errorNames.add(name);
          break;
        case "ClassDef":
          if (claim(name, "class", span)) this.classes.set(name, []);
          break;
        case "ServiceDef":
          claim(name, "service", span);
          break;
        case "EffectDef":
          claim(name, "operation", span);
          break;
        case "FunctionDef":
          claim(name, "function", span);
          break;
        case "ValueDef":
          claim(name, "constant", span);
          break;
        case "LayerDef":
          if (claim(name, "layer", span)) this.layerPayloads.set(name, { payload, span });
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
        case "SchemaDef":
          this.schemas.set(name, typeFromJson(payload["schema"], this.env));
          break;
        case "ErrorDef":
        case "ClassDef": {
          const struct = typeFromJson(payload["schema"], this.env);
          const fields = struct.kind === "struct" ? struct.fields : [];
          if (payload["kind"] === "ErrorDef") this.errorFields.set(name, fields);
          else this.classes.set(name, fields);
          break;
        }
        default:
          break;
      }
    }

    this.checkSchemaCycles();
    this.checkGeneratedNames();
    this.checkConstantCycles();

    for (const declaration of this.declarations) {
      const payload = declaration.payload;
      if (!isRecord(payload) || typeof payload["name"] !== "string") continue;
      const name = payload["name"];
      switch (payload["kind"]) {
        case "ServiceDef": {
          const methods = new Map<string, ServiceMethodSignature>();
          for (const method of arrayItems(payload["methods"])) {
            if (!isRecord(method) || typeof method["name"] !== "string") continue;
            const effect = this.effectTypeFromJson(method["effect"]);
            const own = `${name}.${method["name"]}`;
            methods.set(method["name"], {
              name: method["name"],
              ...(method["value"] === true ? { value: true } : {}),
              params: this.paramsFromJson(method["params"]),
              effect: effectOf(
                effect.success,
                effect.errors,
                new Map([...effect.requirements].filter(([requirement]) => requirement !== own)),
              ),
            });
          }
          this.services.set(name, methods);
          break;
        }
        case "EffectDef":
          this.operations.set(name, {
            params: this.paramsFromJson(payload["params"]),
            result: this.effectTypeFromJson(payload["effect"]),
          });
          break;
        case "FunctionDef":
          this.functions.set(name, {
            params: this.paramsFromJson(payload["params"]),
            result: typeFromJson(payload["returns"], this.env),
          });
          break;
        case "ValueDef":
          this.constants.set(name, typeFromJson(payload["type"], this.env));
          break;
        default:
          break;
      }
    }
  }

  /** Parameters whose TypeScript names coincide (`a-b` and `aB`) cannot share a signature. */
  private checkParamNames(params: JsonValue | undefined, owner: string, span: JsonValue | undefined): void {
    const seen = new Map<string, string>();
    for (const param of arrayItems(params)) {
      const name = isRecord(param) ? param["name"] : param;
      if (typeof name !== "string") continue;
      const identifier = camelIdentifier(name);
      const previous = seen.get(identifier);
      if (previous !== undefined) {
        this.error(
          span,
          "mechanics/name-collision",
          previous === name
            ? `${owner} has two parameters named ${name}.`
            : `${owner} has parameters ${previous} and ${name}, which both become ${identifier} in TypeScript.`,
        );
      }
      seen.set(identifier, name);
    }
  }

  /**
   * Distinct Forma names can map to the same TypeScript identifier
   * (`foo-bar` and `fooBar`), and some identifiers are taken by the Effect
   * modules and globals the generated module uses.
   */
  private checkGeneratedNames(): void {
    const reserved = new Set([...effectModules, ...generatedGlobals]);
    const taken = new Map<string, string>();
    const claim = (formaName: string, identifier: string, span: JsonValue | undefined): void => {
      if (reserved.has(identifier)) {
        this.error(
          span,
          "mechanics/reserved-name",
          `${formaName} becomes the TypeScript name ${identifier}, which the generated module needs for Effect or JavaScript; rename it.`,
        );
        return;
      }
      const previous = taken.get(identifier);
      if (previous !== undefined && previous !== formaName) {
        this.error(span, "mechanics/name-collision", `${previous} and ${formaName} both become the TypeScript name ${identifier}; rename one.`);
      }
      taken.set(identifier, formaName);
    };
    const declared = new Set<string>();
    for (const declaration of this.declarations) {
      const payload = declaration.payload;
      if (!isRecord(payload) || typeof payload["name"] !== "string") continue;
      const name = payload["name"];
      const span = declarationSpan(declaration);
      declared.add(name);
      const pascal = ["SchemaDef", "ErrorDef", "ClassDef", "ServiceDef", "LayerDef"].includes(String(payload["kind"]));
      claim(name, pascal ? typeName(name) : camelIdentifier(name), span);
      if (payload["kind"] === "ServiceDef") {
        const methods = new Map<string, string>();
        for (const method of arrayItems(payload["methods"])) {
          if (!isRecord(method) || typeof method["name"] !== "string") continue;
          const identifier = camelIdentifier(method["name"]);
          const previous = methods.get(identifier);
          if (previous !== undefined) {
            this.error(span, "mechanics/name-collision", `Service ${name} has methods ${previous} and ${method["name"]}, which both become ${identifier}.`);
          }
          methods.set(identifier, method["name"]);
          this.checkParamNames(method["params"], `${name}.${method["name"]}`, span);
        }
      }
    }
    for (const brand of inlineBrands(this.declarations.map((declaration) => declaration.payload))) {
      if (!declared.has(brand.name)) claim(brand.name, typeName(brand.name), spanOf(brand.schema));
    }
  }

  /** Field lists that TypeScript or Effect cannot represent faithfully. */
  private checkSchemaShape(schema: JsonValue | undefined, kind: string, span: JsonValue | undefined): void {
    const visit = (node: JsonValue | undefined, top: boolean): void => {
      if (Array.isArray(node)) {
        node.forEach((item) => visit(item, false));
        return;
      }
      if (!isRecord(node)) return;
      const location = node["span"] ?? span;
      if (node["kind"] === "Annotated" && isRecord(node["metadata"])) {
        for (const key of Object.keys(node["metadata"])) if (!["doc", "description", "title", "identifier", "pattern"].includes(key)) this.error(location, "mechanics/schema-metadata", `Unknown schema metadata :${key}.`);
      }
      if (node["kind"] === "Map" && node["key"] !== undefined) {
        const key = resolve(typeFromJson(node["key"], this.env), this.env);
        const valid = (t: MType): boolean => t.kind === "prim" && t.name === "String" || t.kind === "brand" && valid(t.base) || t.kind === "literal" && typeof t.value === "string" || t.kind === "union" && t.members.every(valid);
        if (!valid(key)) this.error(location, "mechanics/map-key", "Map keys must be String, a String brand, or a union of string or keyword literals.");
      }
      if (node["kind"] === "Struct") {
        const names = new Set<string>();
        for (const field of arrayItems(node["fields"])) {
          if (!isRecord(field) || typeof field["name"] !== "string") continue;
          const name = field["name"];
          const fieldSpan = field["span"] ?? location;
          if (names.has(name)) this.error(fieldSpan, "mechanics/duplicate-key", `The schema has the field ${name} twice.`);
          names.add(name);
          if (name === "__proto__") this.error(fieldSpan, "mechanics/record-key", "__proto__ cannot be a field: JavaScript treats it as the prototype.");
          if (top && kind === "ErrorDef" && name === "_tag") {
            this.error(fieldSpan, "mechanics/error-tag", "Errors get their _tag from their name; a field cannot be called _tag.");
          }
        }
      }
      if (node["kind"] === "TaggedUnion" && typeof node["discriminator"] === "string") {
        for (const variant of arrayItems(node["variants"])) {
          const body = isRecord(variant) ? variant["schema"] : undefined;
          if (isRecord(body) && body["kind"] === "Struct" && arrayItems(body["fields"]).some((field) => isRecord(field) && field["name"] === node["discriminator"])) {
            this.error(
              isRecord(variant) ? variant["span"] ?? location : location,
              "mechanics/discriminator-field",
              `Variant ${String(isRecord(variant) ? variant["tag"] : "")} has a field named ${node["discriminator"]}, which is the union's tag.`,
            );
          }
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (key !== "span") visit(value, false);
      }
    };
    visit(schema, true);
  }

  /** A constant cannot need itself while the module loads, even through functions. */
  private checkConstantCycles(): void {
    const dependencies = constantDependencies(this.declarations);
    const spans = new Map(
      this.declarations.flatMap((declaration) =>
        isRecord(declaration.payload) && declaration.payload["kind"] === "ValueDef"
          ? [[String(declaration.payload["name"]), declarationSpan(declaration)] as const]
          : [],
      ),
    );
    const state = new Map<string, "visiting" | "done">();
    const visit = (name: string, path: readonly string[]): void => {
      if (state.get(name) === "done") return;
      if (state.get(name) === "visiting") {
        const cycle = [...path.slice(path.indexOf(name)), name];
        this.error(spans.get(name), "mechanics/constant-cycle", `Constant ${name} needs itself while the module loads (${cycle.join(" -> ")}).`);
        return;
      }
      state.set(name, "visiting");
      for (const dependency of dependencies.get(name) ?? []) visit(dependency, [...path, name]);
      state.set(name, "done");
    };
    for (const name of dependencies.keys()) visit(name, []);
  }

  /** Generated schema constants refer to each other eagerly, so cycles are rejected. */
  private checkSchemaCycles(): void {
    const data = new Map<string, { readonly schema: JsonValue | undefined; readonly span: JsonValue | undefined }>();
    for (const declaration of this.declarations) {
      const payload = declaration.payload;
      if (!isRecord(payload) || typeof payload["name"] !== "string") continue;
      if (["SchemaDef", "ErrorDef", "ClassDef"].includes(String(payload["kind"]))) {
        data.set(payload["name"], { schema: payload["schema"], span: declarationSpan(declaration) });
      }
    }
    const state = new Map<string, "visiting" | "done">();
    const visit = (name: string, path: readonly string[]): void => {
      const current = state.get(name);
      if (current === "done") return;
      if (current === "visiting") {
        const cycle = [...path.slice(path.indexOf(name)), name];
        this.error(
          data.get(name)?.span,
          "mechanics/recursive-schema",
          `Recursive schemas are not supported yet (${cycle.join(" -> ")}); Effect needs Schema.suspend for them.`,
        );
        return;
      }
      state.set(name, "visiting");
      for (const reference of schemaReferences(data.get(name)?.schema)) {
        if (data.has(reference) && reference !== name) visit(reference, [...path, name]);
        else if (reference === name) {
          this.error(data.get(name)?.span, "mechanics/recursive-schema", `Recursive schemas are not supported yet (${name} -> ${name}); Effect needs Schema.suspend for them.`);
        }
      }
      state.set(name, "done");
    };
    for (const name of data.keys()) visit(name, []);
  }

  private paramsFromJson(value: JsonValue | undefined): readonly { readonly name: string; readonly type: MType }[] {
    return arrayItems(value).flatMap((param) =>
      isRecord(param) && typeof param["name"] === "string"
        ? [{ name: param["name"], type: typeFromJson(param["type"], this.env) }]
        : [],
    );
  }

  private effectTypeFromJson(value: JsonValue | undefined): EffectType {
    const type = typeFromJson(value, this.env);
    return type.kind === "effect" ? type : effectOf(tUnknown);
  }

  /** Every name used in a type must be a schema, an error, or a built-in. */
  private checkTypeReferences(value: JsonValue | undefined, span: JsonValue | undefined): void {
    if (Array.isArray(value)) {
      for (const item of value) this.checkTypeReferences(item, span);
      return;
    }
    if (!isRecord(value)) return;
    const location = value["span"] ?? span;
    if (["Array", "Map", "Option", "RefCell"].includes(String(value["kind"]))) {
      const item = value["kind"] === "Map" ? value["value"] : value["item"];
      if (isRecord(item) && item["kind"] === "Primitive" && item["name"] === "Unit") {
        this.error(location, "mechanics/unit-collection", `(${value["kind"] === "RefCell" ? "Ref" : String(value["kind"])} Unit) cannot tell a stored nil from a missing value; use Bool or an Option.`);
      }
    }
    if (value["kind"] === "Ref" && typeof value["name"] === "string") {
      const name = value["name"];
      if (!this.schemas.has(name) && !this.errorNames.has(name) && !this.classes.has(name) && name !== "Duration") {
        this.error(location, "mechanics/unknown-type", `Unknown type ${name}. Declare it with type or error.`);
      }
    }
    if (value["kind"] === "Effect") {
      for (const error of stringItems(value["errors"])) {
        if (!this.errorNames.has(error)) {
          this.error(location, "mechanics/unknown-error", `Unknown error type ${error} in an Effect type. Declare it with error.`);
        }
      }
      for (const requirement of stringItems(value["requirements"])) {
        this.checkRequirementName(requirement, location);
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (key !== "span") this.checkTypeReferences(item, location);
    }
  }

  private checkRequirementName(requirement: string, span: JsonValue | undefined): void {
    if (builtinRequirements.has(requirement)) return;
    const [service, method] = requirement.split(".", 2);
    const methods = service ? this.services.get(service) : undefined;
    if (!methods) {
      this.error(span, "mechanics/unknown-requirement", `Unknown requirement ${requirement}. Requirements name a service, a Service.method capability, or Scope.`);
      return;
    }
    if (method !== undefined && !methods.has(method)) {
      this.error(span, "mechanics/unknown-requirement", `Service ${service} has no method ${method}.`);
    }
  }

  private checkService(payload: JsonRecord, span: JsonValue | undefined): void {
    const name = String(payload["name"]);
    for (const method of arrayItems(payload["methods"])) {
      if (!isRecord(method)) continue;
      this.checkTypeReferences(method, span);
      const own = `${name}.${String(method["name"])}`;
      const effect = this.effectTypeFromJson(method["effect"]);
      for (const requirement of effect.requirements.keys()) {
        if (requirement === own) continue;
        this.error(
          spanOf(method["effect"]) ?? span,
          "mechanics/service-method-requirement",
          `Service method ${own} cannot require ${requirement}. Service methods are requirement-free in Effect; give the implementing layer the dependency instead.`,
        );
      }
    }
  }

  private checkOperation(payload: JsonRecord, span: JsonValue | undefined): void {
    const name = String(payload["name"]);
    this.checkTypeReferences(payload["params"], span);
    this.checkTypeReferences(payload["effect"], span);
    const signature = this.operations.get(name);
    if (!signature) return;
    const scope: Scope = new Map(signature.params.map((param) => [param.name, param.type]));
    this.checkParamNames(payload["params"], `Operation ${name}`, span);
    const body = this.effect(payload["body"], scope, signature.result.success);
    this.checkEffectAgainst(body, signature.result, `operation ${name}`, payload["body"], span);
  }

  /** Inferred errors and requirements must be declared by the signature. */
  private checkEffectAgainst(
    actual: EffectType,
    declared: EffectType,
    owner: string,
    body: JsonValue | undefined,
    fallbackSpan: JsonValue | undefined,
  ): void {
    for (const [error, span] of actual.errors) {
      if (declared.errors.has(error) || !this.errorNames.has(error)) continue;
      const declaredErrors = [...declared.errors.keys()];
      this.error(
        span ?? spanOf(body) ?? fallbackSpan,
        "mechanics/undeclared-error",
        `${capitalize(owner)} can fail with ${error}, but its signature declares ${declaredErrors.length === 0 ? "no errors" : `only [${declaredErrors.join(" ")}]`}.`,
      );
    }
    for (const [requirement, span] of actual.requirements) {
      if (coversRequirement(declared.requirements, requirement)) continue;
      const declaredRequirements = [...declared.requirements.keys()];
      this.error(
        span ?? spanOf(body) ?? fallbackSpan,
        "mechanics/undeclared-requirement",
        `${capitalize(owner)} requires ${requirement}, but its signature declares ${declaredRequirements.length === 0 ? "no requirements" : `only [${declaredRequirements.join(" ")}]`}.`,
      );
    }
  }

  private checkFunction(payload: JsonRecord, span: JsonValue | undefined): void {
    const name = String(payload["name"]);
    this.checkTypeReferences(payload["params"], span);
    this.checkTypeReferences(payload["returns"], span);
    const signature = this.functions.get(name);
    if (!signature) return;
    const scope: Scope = new Map(signature.params.map((param) => [param.name, param.type]));
    this.checkParamNames(payload["params"], `Function ${name}`, span);
    this.pureOwner = `Function ${name}`;
    const type = this.value(payload["body"], scope, signature.result);
    this.pureOwner = undefined;
    if (type.kind === "effect") {
      this.error(spanOf(payload["body"]) ?? span, "mechanics/function-effect", `Function ${name} returns an effect; give its define an Effect return signature.`);
    }
  }

  // -------------------------------------------------------------------------
  // Layers
  // -------------------------------------------------------------------------

  private layerInfo(name: string, useSpan: JsonValue | undefined): LayerInfo | undefined {
    const existing = this.layers.get(name);
    if (existing) return existing;
    const entry = this.layerPayloads.get(name);
    if (!entry) {
      this.error(useSpan, "mechanics/unknown-layer", `Unknown layer ${name}. Define it with __layer.`);
      return undefined;
    }
    if (this.layersInProgress.has(name)) {
      this.error(useSpan, "mechanics/layer-cycle", `Layer ${name} depends on itself.`);
      return undefined;
    }
    this.layersInProgress.add(name);
    const implementation = entry.payload["implementation"];
    let info: LayerInfo | undefined;
    if (isRecord(implementation) && implementation["kind"] === "Service") {
      info = this.checkServiceLayer(name, implementation, entry.span);
    } else if (isRecord(implementation) && implementation["kind"] === "Compose") {
      const type = this.layerExprType(implementation["layer"], entry.span);
      info = type ? { type, contextServices: [] } : undefined;
    }
    this.layersInProgress.delete(name);
    if (!info) return undefined;
    const signature = entry.payload["signature"];
    if (isRecord(signature)) info = this.checkLayerSignature(name, info, signature, entry.span);
    this.layers.set(name, info);
    return info;
  }

  private checkLayerSignature(
    name: string,
    info: LayerInfo,
    signature: JsonRecord,
    span: JsonValue | undefined,
  ): LayerInfo {
    const location = signature["span"] ?? span;
    const provides = stringItems(signature["provides"]);
    const errors = setOf(stringItems(signature["errors"]), location);
    const requirements = setOf(stringItems(signature["requirements"]), location);
    for (const service of provides) {
      if (!this.services.has(service)) {
        this.error(location, "mechanics/unknown-service", `Unknown service ${service} in the signature of layer ${name}.`);
      }
    }
    const missing = provides.filter((service) => !info.type.provides.includes(service));
    const extra = info.type.provides.filter((service) => !provides.includes(service));
    if (missing.length > 0 || extra.length > 0) {
      this.error(
        location,
        "mechanics/layer-signature",
        `Layer ${name} provides [${info.type.provides.join(" ")}], but its signature declares [${provides.join(" ")}].`,
      );
    }
    for (const [error, errorSpan] of info.type.errors) {
      if (!errors.has(error)) {
        this.error(errorSpan ?? location, "mechanics/undeclared-error", `Layer ${name} can fail with ${error}, but its signature does not declare it.`);
      }
    }
    for (const [requirement, requirementSpan] of info.type.requirements) {
      if (!coversRequirement(requirements, requirement)) {
        this.error(
          requirementSpan ?? location,
          "mechanics/undeclared-requirement",
          `Layer ${name} requires ${requirement}, but its signature does not declare it.`,
        );
      }
    }
    return {
      ...info,
      type: {
        provides,
        errors,
        requirements: new Map([...requirements].map(([requirement, requirementSpan]) => [requirementService(requirement), requirementSpan])),
      },
    };
  }

  private layerExprType(expr: JsonValue | undefined, span: JsonValue | undefined): LayerType | undefined {
    if (!isRecord(expr)) return undefined;
    const location = expr["span"] ?? span;
    switch (expr["kind"]) {
      case "LayerRef":
        return this.layerInfo(String(expr["name"]), location)?.type;
      case "LayerMerge": {
        const layers = arrayItems(expr["layers"]).map((layer) => this.layerExprType(layer, location));
        if (layers.some((layer) => layer === undefined)) return undefined;
        return mergeLayers(layers as readonly LayerType[]);
      }
      case "LayerProvide":
      case "LayerProvideMerge": {
        const target = this.layerExprType(expr["layer"], location);
        const dependencies = arrayItems(expr["dependencies"]).map((layer) => this.layerExprType(layer, location));
        if (!target || dependencies.some((layer) => layer === undefined)) return undefined;
        const provided = mergeLayers(dependencies as readonly LayerType[]);
        const unused = provided.provides.filter((service) => !target.requirements.has(service));
        if (unused.length === provided.provides.length) {
          this.warning(
            location,
            "mechanics/unused-layer",
            `None of [${provided.provides.join(" ")}] is required by the layer being provided.`,
          );
        }
        return {
          provides:
            expr["kind"] === "LayerProvide"
              ? target.provides
              : [...new Set([...target.provides, ...provided.provides])],
          errors: unionSets(target.errors, provided.errors),
          requirements: unionSets(
            new Map([...target.requirements].filter(([service]) => !provided.provides.includes(service))),
            provided.requirements,
          ),
        };
      }
      default:
        return undefined;
    }
  }

  private checkServiceLayer(name: string, implementation: JsonRecord, span: JsonValue | undefined): LayerInfo | undefined {
    const service = String(implementation["service"]);
    const methods = this.services.get(service);
    if (!methods) {
      this.error(span, "mechanics/unknown-service", `Layer ${name} provides unknown service ${service}.`);
      return undefined;
    }
    const context: LayerContext = { name, contextCalls: new Set() };
    const previous = this.layerContext;
    // Setup runs inside the layer's own effect, so its requirements flow into
    // the layer; only method bodies run later and need the captured context.
    this.layerContext = undefined;

    let scope: Scope = new Map();
    let setupErrors: Provenance = emptySet;
    let setupRequirements: Provenance = emptySet;
    for (const binding of arrayItems(implementation["setup"])) {
      if (!isRecord(binding)) continue;
      const effect = this.effect(binding["value"], scope);
      setupErrors = unionSets(setupErrors, effect.errors);
      setupRequirements = unionSets(setupRequirements, effect.requirements);
      if (typeof binding["name"] === "string" && binding["name"] !== "_") {
        scope = extend(scope, binding["name"], effect.success);
      }
    }

    this.layerContext = context;
    let methodRequirements: Provenance = emptySet;
    const implemented = new Set<string>();
    for (const method of arrayItems(implementation["methods"])) {
      if (!isRecord(method)) continue;
      const methodName = String(method["name"]);
      const methodSpan = method["span"] ?? span;
      const signature = methods.get(methodName);
      if (!signature) {
        this.error(methodSpan, "mechanics/unknown-method", `Service ${service} has no method ${methodName}.`);
        continue;
      }
      if (implemented.has(methodName)) {
        this.error(methodSpan, "mechanics/duplicate-name", `Layer ${name} implements ${service}.${methodName} twice.`);
      }
      implemented.add(methodName);
      const params = stringItems(method["params"]);
      if (params.length !== signature.params.length) {
        this.error(
          methodSpan,
          "mechanics/arity",
          `${service}.${methodName} takes ${signature.params.length} parameter(s), but the layer binds ${params.length}.`,
        );
        continue;
      }
      let methodScope = scope;
      params.forEach((param, index) => {
        methodScope = extend(methodScope, param, signature.params[index]!.type);
      });
      const body = this.effect(method["body"], methodScope, signature.effect.success);
      for (const [error, errorSpan] of body.errors) {
        if (!signature.effect.errors.has(error)) {
          this.error(
            errorSpan ?? methodSpan,
            "mechanics/undeclared-error",
            `${service}.${methodName} can fail with ${error} here, but the service declares ${signature.effect.errors.size === 0 ? "no errors" : `only [${[...signature.effect.errors.keys()].join(" ")}]`} for it.`,
          );
        }
      }
      for (const [requirement, requirementSpan] of body.requirements) {
        if (requirement === "Scope") {
          this.error(
            requirementSpan ?? methodSpan,
            "mechanics/method-scope",
            `${service}.${methodName} would require Scope from its caller; acquire resources in the layer's :setup or wrap the method body in scoped.`,
          );
        } else if (requirementService(requirement) === service) {
          this.error(requirementSpan ?? methodSpan, "mechanics/layer-cycle", `Layer ${name} cannot use ${service} while implementing it.`);
        }
      }
      methodRequirements = unionSets(methodRequirements, body.requirements);
      if (!isAssignable(body.success, signature.effect.success, this.env)) {
        this.error(
          spanOf(method["body"]) ?? methodSpan,
          "mechanics/type-mismatch",
          `${service}.${methodName} must succeed with ${showType(signature.effect.success)}, but its body succeeds with ${showType(body.success)}.`,
        );
      }
    }
    for (const methodName of methods.keys()) {
      if (!implemented.has(methodName)) {
        this.error(span, "mechanics/missing-method", `Layer ${name} does not implement ${service}.${methodName}.`);
      }
    }
    this.layerContext = previous;
    for (const call of context.contextCalls) this.info.contextCalls.add(call);

    const contextServices = new Set<string>();
    for (const call of context.contextCalls) {
      const type = this.info.effectTypes.get(call);
      for (const requirement of type?.requirements.keys() ?? []) {
        if (requirement !== "Scope") contextServices.add(requirementService(requirement));
      }
    }
    const requirements = new Map<string, JsonValue | undefined>();
    for (const [requirement, requirementSpan] of [...setupRequirements, ...methodRequirements]) {
      if (requirement === "Scope" || requirementService(requirement) === service) continue;
      const serviceName = requirementService(requirement);
      if (!requirements.has(serviceName)) requirements.set(serviceName, requirementSpan);
    }
    return {
      type: { provides: [service], errors: setupErrors, requirements },
      contextServices: [...contextServices].filter((item) => item !== service).sort(),
    };
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  private effect(node: JsonValue | undefined, scope: Scope, expected?: MType): EffectType {
    const type = this.effectInner(node, scope, expected);
    if (isRecord(node)) this.info.effectTypes.set(node, type);
    return type;
  }

  private effectInner(node: JsonValue | undefined, scope: Scope, expected?: MType): EffectType {
    if (!isRecord(node)) return effectOf(tUnknown);
    const span = node["span"];
    switch (node["kind"]) {
      case "Succeed": {
        // Without an expected type TypeScript infers the value and widens its literals.
        const type = this.value(node["value"], scope, expected);
        return effectOf(expected ? type : widenDeep(type));
      }
      case "Pure": {
        const type = this.value(node["value"], scope, expected, { allowEffect: true });
        if (type.kind === "effect") {
          this.expectSuccess(type, expected, node["value"]);
          return type;
        }
        return effectOf(expected ? type : widenDeep(type));
      }
      case "Fail":
        return this.fail(node["error"], scope, span);
      case "ServiceCall": {
        const type = this.serviceCall(String(node["service"]), String(node["method"]), arrayItems(node["args"]), scope, span);
        this.expectSuccess(type, expected, node);
        return type;
      }
      case "OperationCall": {
        const type = this.operationCall(String(node["operation"]), arrayItems(node["args"]), scope, span);
        if (this.layerContext && type.requirements.size > 0) this.layerContext.contextCalls.add(node);
        this.expectSuccess(type, expected, node);
        return type;
      }
      case "Bind":
        return this.effect(node["value"], scope, expected);
      case "Do":
      case "Let":
        return this.sequence(node, scope, expected);
      case "If": {
        this.condition(node["condition"], scope);
        const thenType = this.effect(node["then"], scope, expected);
        const elseType = this.effect(node["else"], scope, expected);
        return this.joinEffects([thenType, elseType]);
      }
      case "When":
      case "Unless": {
        this.condition(node["condition"], scope);
        const body = this.effect(node["body"], scope);
        return effectOf(tUnit, body.errors, body.requirements);
      }
      case "Cond":
        return this.cond(node, scope, expected);
      case "Match":
        return this.match(node, scope, expected);
      case "Catch":
        return this.catchTags(
          node,
          [{ errorType: String(node["errorType"]), binding: String(node["binding"]), handler: node["handler"], span }],
          scope,
          expected,
        );
      case "CatchTags":
        return this.catchTags(
          node,
          arrayItems(node["handlers"]).flatMap((handler) =>
            isRecord(handler)
              ? [{ errorType: String(handler["errorType"]), binding: String(handler["binding"]), handler: handler["handler"], span: handler["span"] ?? span }]
              : [],
          ),
          scope,
          expected,
        );
      case "CatchAll":
        return this.catchAll(node, scope, expected);
      case "Combinator":
        return this.combinator(node, scope, expected);
      default:
        this.error(span, "mechanics/unsupported", `Unsupported effect form ${String(node["kind"])}.`);
        return effectOf(tUnknown);
    }
  }

  private expectSuccess(type: EffectType, expected: MType | undefined, node: JsonValue | undefined): void {
    if (!expected || isAssignable(type.success, expected, this.env)) return;
    this.error(
      spanOf(node),
      "mechanics/type-mismatch",
      `Expected an effect that succeeds with ${showType(expected)}, but this succeeds with ${showType(type.success)}.`,
    );
  }

  private sequence(node: JsonRecord, scope: Scope, expected: MType | undefined): EffectType {
    let current = scope;
    let errors: Provenance = emptySet;
    let requirements: Provenance = emptySet;
    const isLet = node["kind"] === "Let";
    for (const binding of arrayItems(node["bindings"])) {
      if (!isRecord(binding)) continue;
      const value = binding["value"];
      if (isLet && isRecord(value) && value["kind"] !== "Pure" && value["kind"] !== "Succeed") {
        this.error(
          value["span"] ?? binding["span"],
          "mechanics/let-effect",
          `let binds values; use do! to run ${describeEffectNode(value)} and bind its result.`,
        );
      }
      if (binding["pure"] === true && isRecord(value)) {
        const pureType = this.value(value["value"], current);
        if (pureType.kind === "effect") this.error(value["span"] ?? binding["span"], "mechanics/pure-binding", ":let binds pure values; bind effects directly in do!.");
      }
      const effect = this.effect(value, current);
      errors = unionSets(errors, effect.errors);
      requirements = unionSets(requirements, effect.requirements);
      if (typeof binding["name"] === "string" && binding["name"] !== "_") {
        current = extend(current, binding["name"], effect.success);
      }
    }
    let result: EffectType;
    if (node["body"] !== undefined) {
      result = this.effect(node["body"], current, expected);
    } else {
      const forms = arrayItems(node["forms"]);
      result = effectOf(tUnit);
      forms.forEach((form, index) => {
        const effect = this.effect(form, current, index === forms.length - 1 ? expected : undefined);
        errors = unionSets(errors, effect.errors);
        requirements = unionSets(requirements, effect.requirements);
        if (index === forms.length - 1) result = effect;
      });
    }
    return effectOf(result.success, unionSets(errors, result.errors), unionSets(requirements, result.requirements));
  }

  private joinEffects(effects: readonly EffectType[]): EffectType {
    let success: MType | undefined;
    for (const effect of effects) {
      success = success === undefined ? effect.success : join(success, effect.success, this.env);
    }
    return effectOf(
      success ?? tNever,
      unionSets(...effects.map((effect) => effect.errors)),
      unionSets(...effects.map((effect) => effect.requirements)),
    );
  }

  private condition(node: JsonValue | undefined, scope: Scope): void {
    const type = this.value(node, scope);
    if (type.kind !== "unknown" && !isAssignable(type, tBool, this.env)) {
      this.error(spanOf(node), "mechanics/condition", `Conditions must be Bool, but this is ${showType(type)}.`);
    }
  }

  private cond(node: JsonRecord, scope: Scope, expected: MType | undefined): EffectType {
    const clauses = arrayItems(node["clauses"]).filter(isRecord);
    const effects: EffectType[] = [];
    let exhaustive = false;
    clauses.forEach((clause, index) => {
      if (isElse(clause["condition"])) {
        exhaustive = true;
        if (index !== clauses.length - 1) {
          this.error(clause["span"] ?? node["span"], "mechanics/cond-else", "An always-true cond clause (:else or true) must be the last clause.");
        }
      } else {
        this.condition(clause["condition"], scope);
      }
      effects.push(this.effect(clause["body"], scope, expected));
    });
    const joined = this.joinEffects(effects);
    if (!exhaustive && !isAssignable(tUnit, joined.success, this.env)) {
      this.error(
        node["span"],
        "mechanics/cond-fallthrough",
        `cond can fall through without a value; add a final :else clause.`,
      );
    }
    return exhaustive ? joined : effectOf(join(joined.success, tUnit, this.env), joined.errors, joined.requirements);
  }

  private fail(error: JsonValue | undefined, scope: Scope, span: JsonValue | undefined): EffectType {
    if (typeof error === "string") return effectOf(tNever, setOf([error], span));
    if (isRecord(error) && error["kind"] === "Error") {
      const name = String(error["errorType"]);
      const type = this.constructError(name, error["payload"] === undefined ? [] : [error["payload"]], scope, error["span"] ?? span);
      if (type.kind === "error") return effectOf(tNever, setOf([name], error["span"] ?? span));
      return effectOf(tNever);
    }
    const type = this.value(error, scope);
    const names = errorNamesOf(type, this.env);
    if (!names) {
      this.error(spanOf(error) ?? span, "mechanics/fail-value", `fail expects an error declared with error, but this is ${showType(type)}.`);
      return effectOf(tNever);
    }
    return effectOf(tNever, setOf(names, spanOf(error) ?? span));
  }

  private serviceCall(
    service: string,
    method: string,
    args: readonly JsonValue[],
    scope: Scope,
    span: JsonValue | undefined,
  ): EffectType {
    if (this.pureOwner) {
      this.error(
        span,
        "mechanics/pure-service",
        `${this.pureOwner} cannot call ${service}.${method}: functions and constants have no services in scope. Give its define an Effect return signature.`,
      );
    }
    const methods = this.services.get(service);
    const signature = methods?.get(method);
    if (!methods) {
      this.error(span, "mechanics/unknown-service", `Unknown service ${service}. Declare it with service.`);
      args.forEach((arg) => this.value(arg, scope));
      return effectOf(tUnknown);
    }
    if (!signature) {
      this.error(span, "mechanics/unknown-method", `Service ${service} has no method ${method}.`);
      args.forEach((arg) => this.value(arg, scope));
      return effectOf(tUnknown);
    }
    this.arguments(`${service}.${method}`, signature.params, args, scope, span);
    return effectOf(
      signature.effect.success,
      reprovenance(signature.effect.errors, span),
      setOf([`${service}.${method}`], span),
    );
  }

  private operationCall(name: string, args: readonly JsonValue[], scope: Scope, span: JsonValue | undefined): EffectType {
    const signature = this.operations.get(name);
    if (!signature) {
      this.error(span, "mechanics/unknown-operation", `Unknown operation ${name}.`);
      return effectOf(tUnknown);
    }
    this.arguments(name, signature.params, args, scope, span);
    return effectOf(
      signature.result.success,
      reprovenance(signature.result.errors, span),
      reprovenance(signature.result.requirements, span),
    );
  }

  private arguments(
    callee: string,
    params: readonly { readonly name: string; readonly type: MType }[],
    args: readonly JsonValue[],
    scope: Scope,
    span: JsonValue | undefined,
  ): void {
    if (params.length !== args.length) {
      this.error(span, "mechanics/arity", `${callee} expects ${params.length} argument(s), received ${args.length}.`);
    }
    args.forEach((arg, index) => {
      const param = params[index];
      this.value(arg, scope, param?.type);
    });
  }

  private match(node: JsonRecord, scope: Scope, expected: MType | undefined): EffectType {
    const scrutinee = this.value(node["value"], scope);
    const arms = arrayItems(node["arms"]).filter(isRecord);
    const plan = this.matchPlan(scrutinee, node, arms.map((arm) => arm["pattern"] ?? null));
    if (!plan) {
      arms.forEach((arm) => this.effect(arm["body"], bindPatternsUnknown(scope, arm["pattern"]), expected));
      return effectOf(tUnknown);
    }
    this.info.matches.set(node, plan.shape);
    const effects = arms.map((arm, index) => {
      const bindings = plan.bindings[index] ?? [];
      let armScope = scope;
      for (const [name, type] of bindings) armScope = extend(armScope, name, type);
      return this.effect(arm["body"], armScope, expected);
    });
    return this.joinEffects(effects);
  }

  /**
   * Resolves match patterns against the scrutinee type and reports missing,
   * unknown, and unreachable cases.
   */
  private matchPlan(
    scrutinee: MType,
    node: JsonRecord,
    patterns: readonly JsonValue[],
  ):
    | { readonly shape: MatchShape; readonly bindings: readonly (readonly (readonly [string, MType])[])[] }
    | undefined {
    const resolved = resolve(scrutinee, this.env);
    const span = node["span"];
    if (resolved.kind === "unknown") return undefined;
    let cases: readonly { readonly tag: string; readonly payload: MType | undefined }[];
    let shape: MatchShape;
    let open: MType | undefined;
    if (resolved.kind === "option") {
      shape = { kind: "option" };
      cases = [
        { tag: "some", payload: resolved.item },
        { tag: "none", payload: undefined },
      ];
    } else if (resolved.kind === "result") {
      shape = { kind: "result" };
      cases = [
        { tag: "success", payload: resolved.success },
        { tag: "failure", payload: resolved.failure },
      ];
    } else if (resolved.kind === "prim" && ["String", "Int", "Number", "Bool"].includes(resolved.name)) {
      // Primitive values match literal patterns; only Bool has finitely many cases.
      shape = { kind: "literal" };
      open = resolved.name === "Bool" ? undefined : resolved;
      cases = resolved.name === "Bool" ? [{ tag: "true", payload: undefined }, { tag: "false", payload: undefined }] : [];
    } else {
      const members = resolved.kind === "union" ? resolved.members.map((member) => resolve(member, this.env)) : [resolved];
      if (members.every((member) => member.kind === "literal")) {
        shape = { kind: "literal" };
        cases = members.map((member) => ({ tag: String((member as { readonly value: string | number | boolean }).value), payload: undefined }));
      } else if (members.every((member) => member.kind === "error")) {
        // Tagged errors are matched by their _tag, as in a catch-all handler.
        shape = { kind: "tagged", discriminator: "_tag" };
        cases = members.map((member) => ({ tag: (member as { readonly name: string }).name, payload: member }));
      } else {
        const discriminator = taggedDiscriminator(members);
        if (!discriminator) {
          this.error(
            spanOf(node["value"]) ?? span,
            "mechanics/match-type",
            `match works on Option, Result, enums, tagged unions, tagged errors, strings, numbers, and booleans, but this is ${showType(scrutinee)}.`,
          );
          return undefined;
        }
        shape = { kind: "tagged", discriminator };
        cases = members.map((member) => ({
          tag: String(literalField(member, discriminator)),
          payload: member,
        }));
      }
    }

    const covered = new Set<string>();
    let wildcard = false;
    const bindings = patterns.map((pattern): readonly (readonly [string, MType])[] => {
      const parsed = parsePattern(pattern,shape.kind);
      const patternSpan = spanOf(pattern) ?? span;
      if (!parsed) {
        this.error(patternSpan, "mechanics/match-pattern", "Match patterns are a tag, (tag binding), a string, or _.");
        return [];
      }
      if (wildcard) {
        this.error(patternSpan, "mechanics/unreachable-pattern", "This pattern is unreachable after _.");
      }
      if (parsed.tag === "_") {
        if (!open && cases.length > 0 && cases.every((candidate) => covered.has(candidate.tag))) {
          this.error(patternSpan, "mechanics/unreachable-pattern", "This _ is unreachable: every case is already matched.");
        }
        wildcard = true;
        return parsed.binding ? [[parsed.binding, scrutinee]] : [];
      }
      if (open) {
        if (parsed.binding !== undefined || parsed.value === undefined || !isAssignable({ kind: "literal", value: parsed.value }, open, this.env)) {
          this.error(patternSpan, "mechanics/match-pattern", `Patterns for ${showType(scrutinee)} are ${showType(scrutinee)} literals or _.`);
          return [];
        }
        if (covered.has(parsed.tag)) this.error(patternSpan, "mechanics/unreachable-pattern", `${parsed.tag} is already matched above.`);
        covered.add(parsed.tag);
        return [];
      }
      const found = cases.find((candidate) => candidate.tag === parsed.tag);
      if (!found) {
        this.error(
          patternSpan,
          "mechanics/match-pattern",
          `${parsed.tag} is not a case of ${showType(scrutinee)}; expected one of ${cases.map((candidate) => candidate.tag).join(", ")}.`,
        );
        return [];
      }
      if (covered.has(parsed.tag)) {
        this.error(patternSpan, "mechanics/unreachable-pattern", `${parsed.tag} is already matched above.`);
      }
      covered.add(parsed.tag);
      if (parsed.binding === undefined) return [];
      if (found.payload === undefined) {
        this.error(patternSpan, "mechanics/match-pattern", `${parsed.tag} carries no value to bind.`);
        return [];
      }
      return parsed.binding === "_" ? [] : [[parsed.binding, found.payload] as const];
    });
    if (open && !wildcard) {
      this.error(span, "mechanics/non-exhaustive-match", `match on ${showType(scrutinee)} needs a final _ arm.`);
    }
    const missing = cases.filter((candidate) => !covered.has(candidate.tag)).map((candidate) => candidate.tag);
    if (!wildcard && missing.length > 0) {
      this.error(span, "mechanics/non-exhaustive-match", `match does not handle ${missing.join(", ")}.`);
    }
    return { shape, bindings };
  }

  private catchTags(
    node: JsonRecord,
    handlers: readonly {
      readonly errorType: string;
      readonly binding: string;
      readonly handler: JsonValue | undefined;
      readonly span: JsonValue | undefined;
    }[],
    scope: Scope,
    expected: MType | undefined,
  ): EffectType {
    const body = this.effect(node["body"], scope, expected);
    let remaining = new Map(body.errors);
    const handled: EffectType[] = [];
    for (const handler of handlers) {
      if (!this.errorNames.has(handler.errorType)) {
        this.error(handler.span, "mechanics/unknown-error", `Unknown error type ${handler.errorType}. Declare it with error.`);
      } else if (!body.errors.has(handler.errorType)) {
        const errors = [...body.errors.keys()];
        this.error(
          handler.span,
          "mechanics/impossible-catch",
          `Impossible catch: this effect cannot fail with ${handler.errorType} (it can fail with ${errors.length === 0 ? "nothing" : `[${errors.join(" ")}]`}).`,
        );
      }
      remaining.delete(handler.errorType);
      const handlerScope = handler.binding === "_" ? scope : extend(scope, handler.binding, { kind: "error", name: handler.errorType });
      handled.push(this.effect(handler.handler, handlerScope, expected));
    }
    remaining = new Map(remaining);
    const joined = this.joinEffects([effectOf(body.success, remaining, body.requirements), ...handled]);
    return joined;
  }

  private catchAll(node: JsonRecord, scope: Scope, expected: MType | undefined): EffectType {
    const body = this.effect(node["body"], scope, expected);
    if (body.errors.size === 0) {
      this.error(node["span"], "mechanics/impossible-catch", "Impossible catch: this effect cannot fail.");
    }
    const errorType = union([...body.errors.keys()].map((name) => ({ kind: "error" as const, name })));
    const binding = String(node["binding"]);
    const handler = this.effect(node["handler"], binding === "_" ? scope : extend(scope, binding, errorType), expected);
    return this.joinEffects([effectOf(body.success, emptySet, body.requirements), handler]);
  }

  // -------------------------------------------------------------------------
  // Combinators
  // -------------------------------------------------------------------------

  private combinator(node: JsonRecord, scope: Scope, expected: MType | undefined): EffectType {
    const type = this.combinatorInner(node, scope, expected);
    // Combinators build their success type from their parts; check it like a call's.
    this.expectSuccess(type, expected, node);
    return type;
  }

  private combinatorInner(node: JsonRecord, scope: Scope, expected: MType | undefined): EffectType {
    const name = String(node["name"]);
    const args = arrayItems(node["args"]);
    const span = node["span"];
    const option = (key: string): JsonValue | undefined => {
      for (const entry of arrayItems(node["options"])) {
        if (isRecord(entry) && entry["key"] === key) return entry["value"];
      }
      return undefined;
    };
    switch (name) {
      case "scoped": {
        const body = this.effect(args[0], scope, expected);
        if (!body.requirements.has("Scope")) {
          this.warning(span, "mechanics/scope-unused", "scoped wraps an effect that does not require Scope.");
        }
        return effectOf(body.success, body.errors, without(body.requirements, "Scope"));
      }
      case "acquire-release": {
        const acquire = this.effect(args[0], scope, expected);
        const release = this.lambda(args[1], [acquire.success], scope);
        this.noFailure(release, "The release action of acquire-release", args[1]);
        return effectOf(
          acquire.success,
          acquire.errors,
          unionSets(acquire.requirements, release?.requirements ?? emptySet, setOf(["Scope"], span)),
        );
      }
      case "ensuring": {
        const body = this.effect(args[0], scope, expected);
        const finalizer = this.effect(args[1], scope);
        this.noFailure(finalizer, "An ensuring finalizer", args[1]);
        return effectOf(body.success, body.errors, unionSets(body.requirements, finalizer.requirements));
      }
      case "add-finalizer": {
        const finalizer = this.effect(args[0], scope);
        this.noFailure(finalizer, "A finalizer", args[0]);
        return effectOf(tUnit, emptySet, unionSets(finalizer.requirements, setOf(["Scope"], span)));
      }
      case "all": {
        this.concurrency(option("concurrency"), scope);
        const collection = args[0];
        if (!isRecord(collection)) return effectOf(tUnknown);
        if (collection["kind"] === "EffectRecord") {
          const entries = arrayItems(collection["entries"]).filter(isRecord);
          const expectedFields = expected ? resolve(expected, this.env) : undefined;
          const effects = entries.map((entry) =>
            this.effect(entry["value"], scope, expectedFields?.kind === "struct" ? expectedFields.fields.find((field) => field.name === entry["key"])?.type : undefined),
          );
          return effectOf(
            { kind: "struct", fields: entries.map((entry, index) => ({ name: String(entry["key"]), optional: false, type: effects[index]!.success })) },
            unionSets(...effects.map((effect) => effect.errors)),
            unionSets(...effects.map((effect) => effect.requirements)),
          );
        }
        const expectedItems = expected ? resolve(expected, this.env) : undefined;
        const effects = arrayItems(collection["items"]).map((item, index) =>
          this.effect(
            item,
            scope,
            expectedItems?.kind === "tuple" ? expectedItems.items[index] : expectedItems?.kind === "array" ? expectedItems.item : undefined,
          ),
        );
        return effectOf(
          { kind: "tuple", items: effects.map((effect) => effect.success) },
          unionSets(...effects.map((effect) => effect.errors)),
          unionSets(...effects.map((effect) => effect.requirements)),
        );
      }
      case "for-each": {
        this.concurrency(option("concurrency"), scope);
        const items = this.value(args[0], scope);
        const resolved = resolve(items, this.env);
        const item = resolved.kind === "array" ? resolved.item : resolved.kind === "unknown" ? tUnknown : undefined;
        if (item === undefined) {
          this.error(spanOf(args[0]) ?? span, "mechanics/type-mismatch", `for-each expects an Array, but this is ${showType(items)}.`);
        }
        const expectedArray = expected ? resolve(expected, this.env) : undefined;
        const body = this.lambda(args[1], [item ?? tUnknown], scope, expectedArray?.kind === "array" ? expectedArray.item : undefined);
        return effectOf({ kind: "array", item: body?.success ?? tUnknown }, body?.errors, body?.requirements);
      }
      case "race": {
        const left = this.effect(args[0], scope, expected);
        const right = this.effect(args[1], scope, expected);
        return this.joinEffects([left, right]);
      }
      case "fork": {
        const expectedFiber = expected ? resolve(expected, this.env) : undefined;
        const body = this.effect(args[0], scope, expectedFiber?.kind === "fiber" ? expectedFiber.success : undefined);
        return effectOf({ kind: "fiber", success: body.success, errors: body.errors }, emptySet, body.requirements);
      }
      case "join":
      case "interrupt": {
        const fiber = this.value(args[0], scope);
        if (fiber.kind !== "fiber") {
          if (fiber.kind !== "unknown") {
            this.error(spanOf(args[0]) ?? span, "mechanics/type-mismatch", `${name} expects a Fiber from fork, but this is ${showType(fiber)}.`);
          }
          return effectOf(tUnknown);
        }
        return name === "join"
          ? effectOf(fiber.success, reprovenance(fiber.errors, span))
          : effectOf(tUnit);
      }
      case "sleep":
        this.duration(args[0], scope);
        return effectOf(tUnit);
      case "timeout": {
        const body = this.effect(args[0], scope, expected);
        this.duration(args[1], scope);
        return effectOf(body.success, unionSets(body.errors, setOf(["TimeoutError"], span)), body.requirements);
      }
      case "retry":
      case "repeat": {
        const body = this.effect(args[0], scope, expected);
        const times = option("times");
        const schedule = option("schedule");
        if (times === undefined && schedule === undefined) {
          this.error(span, "mechanics/retry-policy", `${name} needs a policy such as :times 3 or :schedule (spaced 100).`);
        }
        if (times !== undefined) this.value(times, scope, tInt);
        if (schedule !== undefined) this.value(schedule, scope, { kind: "prim", name: "Schedule" });
        return body;
      }
      case "map-error": {
        const body = this.effect(args[0], scope, expected);
        const errorType = union([...body.errors.keys()].map((error) => ({ kind: "error" as const, name: error })));
        if (body.errors.size === 0) {
          this.error(span, "mechanics/impossible-catch", "map-error wraps an effect that cannot fail.");
        }
        const mapped = this.value(args[1], scope, { kind: "function", params: [errorType], result: tUnknown });
        const result = mapped.kind === "function" ? mapped.result : tUnknown;
        const names = errorNamesOf(result, this.env);
        if (!names && result.kind !== "unknown") {
          this.error(spanOf(args[1]) ?? span, "mechanics/fail-value", `map-error must return an error declared with error, but returns ${showType(result)}.`);
        }
        return effectOf(body.success, setOf(names ?? [], spanOf(args[1]) ?? span), body.requirements);
      }
      case "or-else-succeed": {
        const body = this.effect(args[0], scope, expected);
        const fallback = this.value(args[1], scope, expected ?? body.success);
        if (body.errors.size === 0) {
          this.error(span, "mechanics/impossible-catch", "or-else-succeed wraps an effect that cannot fail.");
        }
        return effectOf(join(body.success, fallback, this.env), emptySet, body.requirements);
      }
      case "or-die": {
        const body = this.effect(args[0], scope, expected);
        return effectOf(body.success, emptySet, body.requirements);
      }
      case "option": {
        const body = this.effect(args[0], scope);
        return effectOf({ kind: "option", item: body.success }, emptySet, body.requirements);
      }
      case "result": {
        const body = this.effect(args[0], scope);
        const failure = union([...body.errors.keys()].map((error) => ({ kind: "error" as const, name: error })));
        return effectOf({ kind: "result", success: body.success, failure }, emptySet, body.requirements);
      }
      case "provide": {
        // The provided effect resolves its services inside the provided
        // layer, so calls within it never use a layer method's captured context.
        const layerContext = this.layerContext;
        this.layerContext = undefined;
        const body = this.effect(args[0], scope, expected);
        this.layerContext = layerContext;
        const layerNode = args[1];
        const layerName = isRecord(layerNode) && layerNode["kind"] === "Var" ? String(layerNode["name"]) : undefined;
        if (!layerName) {
          this.error(spanOf(layerNode) ?? span, "mechanics/provide", "provide expects the name of a layer defined with __layer.");
          return body;
        }
        const layer = this.layerInfo(layerName, spanOf(layerNode) ?? span);
        if (!layer) return body;
        if (isRecord(layerNode)) this.info.valueTypes.set(layerNode, { kind: "layer", layer: layer.type });
        const provided = effectOf(
          body.success,
          unionSets(body.errors, reprovenance(layer.type.errors, spanOf(layerNode))),
          unionSets(
            new Map([...body.requirements].filter(([requirement]) => !layer.type.provides.includes(requirementService(requirement)))),
            reprovenance(layer.type.requirements, spanOf(layerNode)),
          ),
        );
        if (this.layerContext && provided.requirements.size > 0) this.layerContext.contextCalls.add(node);
        return provided;
      }
      case "log":
        for (const arg of args) this.value(arg, scope);
        return effectOf(tUnit);
      case "ref-make": {
        const expectedRef = expected ? resolve(expected, this.env) : undefined;
        const value = this.value(args[0], scope, expectedRef?.kind === "ref" ? expectedRef.item : undefined);
        return effectOf({ kind: "ref", item: expectedRef?.kind === "ref" ? expectedRef.item : widenDeep(value) });
      }
      case "ref-get":
      case "ref-set":
      case "ref-update": {
        const ref = this.value(args[0], scope);
        if (ref.kind !== "ref") {
          if (ref.kind !== "unknown") {
            this.error(spanOf(args[0]) ?? span, "mechanics/type-mismatch", `${name} expects a Ref from ref-make, but this is ${showType(ref)}.`);
          }
          return effectOf(tUnknown);
        }
        if (name === "ref-get") return effectOf(ref.item);
        if (name === "ref-set") this.value(args[1], scope, ref.item);
        else this.value(args[1], scope, { kind: "function", params: [ref.item], result: ref.item });
        return effectOf(tUnit);
      }
      case "config": {
        const type = this.typeArg(args[0]);
        const valid = type.kind === "prim" && ["String", "Int", "Number", "Bool"].includes(type.name);
        if (!valid) {
          this.error(spanOf(args[0]) ?? span, "mechanics/config-type", `config reads String, Int, Number, or Bool values, not ${showType(type)}.`);
        }
        this.value(args[1], scope, tString);
        const fallback = option("default");
        if (fallback !== undefined) this.value(fallback, scope, type);
        return effectOf(type, setOf(["ConfigError"], span));
      }
      case "decode": {
        const type = this.typeArg(args[0]);
        if (type.kind !== "named" || !this.schemas.has(type.name)) {
          this.error(spanOf(args[0]) ?? span, "mechanics/decode-schema", "decode expects the name of a schema defined with __schema.");
        }
        this.value(args[1], scope);
        return effectOf(type, setOf(["SchemaError"], span));
      }
      default:
        this.error(span, "mechanics/unsupported", `Unknown combinator ${name}.`);
        return effectOf(tUnknown);
    }
  }

  private typeArg(node: JsonValue | undefined): MType {
    if (!isRecord(node) || node["kind"] !== "TypeArg") return tUnknown;
    this.checkTypeReferences(node["type"], node["span"]);
    return typeFromJson(node["type"], this.env);
  }

  private lambda(node: JsonValue | undefined, params: readonly MType[], scope: Scope, expected?: MType): EffectType | undefined {
    if (!isRecord(node) || node["kind"] !== "Lambda") return undefined;
    const names = stringItems(node["params"]);
    this.checkParamNames(node["params"], "This fn", node["span"]);
    if (names.length !== params.length) {
      this.error(node["span"], "mechanics/arity", `This fn should take ${params.length} parameter(s), but takes ${names.length}.`);
    }
    let lambdaScope = scope;
    names.forEach((name, index) => {
      lambdaScope = extend(lambdaScope, name, params[index] ?? tUnknown);
    });
    const body = this.effect(node["body"], lambdaScope, expected);
    this.info.effectTypes.set(node, body);
    return body;
  }

  private noFailure(effect: EffectType | undefined, what: string, node: JsonValue | undefined): void {
    if (!effect || effect.errors.size === 0) return;
    this.error(
      spanOf(node),
      "mechanics/finalizer-failure",
      `${what} must not fail, but it can fail with [${[...effect.errors.keys()].join(" ")}]; recover with catch or or-die.`,
    );
  }

  private concurrency(node: JsonValue | undefined, scope: Scope): void {
    if (node === undefined) return;
    if (isRecord(node) && node["kind"] === "Expr") {
      const keyword = keywordName(node);
      if (keyword === "unbounded" || keyword === "inherit") return;
    }
    const type = this.value(node, scope);
    if (!isAssignable(type, tInt, this.env) && !isAssignable(type, union([{ kind: "literal", value: "unbounded" }, { kind: "literal", value: "inherit" }]), this.env)) {
      this.error(spanOf(node), "mechanics/concurrency", `:concurrency is an Int, :unbounded, or :inherit, not ${showType(type)}.`);
    }
  }

  private duration(node: JsonValue | undefined, scope: Scope): void {
    const type = this.value(node, scope);
    if (!isAssignable(type, union([tNumber, { kind: "prim", name: "Duration" }]), this.env)) {
      this.error(spanOf(node), "mechanics/duration", `Durations are milliseconds or (seconds n), not ${showType(type)}.`);
    }
  }

  // -------------------------------------------------------------------------
  // Values
  // -------------------------------------------------------------------------

  private value(node: JsonValue | undefined, scope: Scope, expected?: MType, options: ValueOptions = {}): MType {
    const type = this.valueInner(node, scope, expected);
    if (isRecord(node)) this.info.valueTypes.set(node, type);
    // Literal syntax checked against a type with literals: TypeScript must not widen it.
    if (expected && isRecord(node) && isLiteralSyntax(node) && containsLiterals(expected, this.env)) {
      this.info.literalTargets.set(node, expected);
    }
    if (expected && !(options.allowEffect && type.kind === "effect") && !isAssignable(type, expected, this.env)) {
      this.error(spanOf(node), "mechanics/type-mismatch", `Expected ${showType(expected)}, but this is ${showType(type)}.`);
      // Reported here; enclosing expressions should not report it again.
      return tUnknown;
    }
    return type;
  }

  private valueInner(node: JsonValue | undefined, scope: Scope, expected: MType | undefined): MType {
    if (!isRecord(node)) return tUnknown;
    const span = node["span"];
    switch (node["kind"]) {
      case "Literal": {
        const value = node["value"];
        if (value === null) return tUnit;
        if (typeof value === "number" && !Number.isFinite(value)) {
          this.error(span, "mechanics/number", "This number is too large for a JavaScript number.");
          return tUnknown;
        }
        if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) {
          this.error(span, "mechanics/number", "This integer is outside JavaScript's safe range (±9007199254740991) and would lose precision.");
          return tUnknown;
        }
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          return { kind: "literal", value };
        }
        return tUnknown;
      }
      case "Var":
        return this.variable(String(node["name"]), scope, expected, span, node);
      case "Expr": {
        const keyword = keywordName(node);
        if (keyword !== undefined) return { kind: "literal", value: keyword };
        const source = node["source"];
        if (isRecord(source) && source["kind"] === "Nil") return tUnit;
        this.error(span, "mechanics/unsupported", "Unsupported value expression.");
        return tUnknown;
      }
      case "Record":
        return this.record(node, scope, expected);
      case "Vector":
        return this.vector(node, scope, expected);
      case "List":
        return this.application(node, scope, expected);
      default:
        this.error(span, "mechanics/unsupported", `Unsupported value form ${String(node["kind"])}.`);
        return tUnknown;
    }
  }

  private variable(name: string, scope: Scope, expected: MType | undefined, span: JsonValue | undefined, node?: JsonRecord): MType {
    const local = scope.get(name);
    if (local) return local;
    switch (name) {
      case "nil":
        return tUnit;
      case "true":
      case "false":
        return tBool;
      case "none": {
        const resolved = expected ? resolve(expected, this.env) : undefined;
        return { kind: "option", item: resolved?.kind === "option" ? resolved.item : tNever };
      }
      default:
        break;
    }
    const constant = this.constants.get(name);
    if (constant) return constant;
    const fn = this.functions.get(name);
    if (fn) return { kind: "function", params: fn.params.map((param) => param.type), result: fn.result };
    const operation = this.operations.get(name);
    if (operation) {
      const value = this.declarations.some(d => isRecord(d.payload) && d.payload["kind"] === "EffectDef" && d.payload["name"] === name && d.payload["value"] === true);
      return value ? operation.result : { kind: "function", params: operation.params.map((param) => param.type), result: operation.result };
    }
    if (this.layerPayloads.has(name)) {
      const layer = this.layerInfo(name, span);
      return layer ? { kind: "layer", layer: layer.type } : tUnknown;
    }
    const overloads = builtins.get(name);
    if (overloads) {
      // A builtin passed as a value, as in (map upcase names): it needs one monomorphic signature.
      const [overload] = overloads;
      if (overloads.length === 1 && overload && !overload.params.some(hasVariables) && !hasVariables(overload.result)) {
        if (node) this.info.calls.set(node, { kind: "builtin", name, overload });
        return { kind: "function", params: overload.params, result: overload.result };
      }
      this.error(span, "mechanics/builtin-value", `${name} is generic or overloaded; wrap it in (fn [x] (${name} x)) to pass it as a function.`);
      return tUnknown;
    }
    const callableOnly =
      arithmeticOperators.has(name) ||
      this.schemas.has(name) ||
      this.errorNames.has(name) ||
      this.classes.has(name) ||
      ["str", "some", "and", "or", "=", "!=", "get", "assoc", "if", "cond", "let", "match", "fn"].includes(name);
    if (callableOnly) {
      this.error(span, "mechanics/builtin-value", `${name} can only be called, not passed as a value; wrap it in (fn [x] (${name} x)).`);
      return tUnknown;
    }
    this.error(span, "mechanics/unbound-name", `Unknown name ${name}.`);
    return tUnknown;
  }

  private record(node: JsonRecord, scope: Scope, expected: MType | undefined): MType {
    const entries = arrayItems(node["entries"]).filter(isRecord);
    const target = expected ? resolve(expected, this.env) : undefined;
    if (target?.kind === "map") {
      const seen = new Set<string>();
      for (const entry of entries) {
        const key = recordKey(entry["key"]);
        if (key !== undefined && seen.has(key)) {
          this.error(spanOf(entry["key"]) ?? node["span"], "mechanics/duplicate-key", `The map has the key ${JSON.stringify(key)} twice.`);
        }
        if (key === "__proto__") {
          this.error(spanOf(entry["key"]) ?? node["span"], "mechanics/record-key", "__proto__ cannot be a map key: JavaScript treats it as the prototype.");
        }
        if (key !== undefined) seen.add(key);
        this.value(entry["value"], scope, target.value);
      }
      return expected!;
    }
    const struct = target?.kind === "struct" ? target : target?.kind === "union" ? structMemberFor(target, entries, this.env) : undefined;
    const fields: MField[] = [];
    const seenKeys = new Set<string>();
    for (const entry of entries) {
      const key = recordKey(entry["key"]);
      if (key === undefined) {
        this.error(spanOf(entry["key"]) ?? node["span"], "mechanics/record-key", "Record keys must be keywords or strings.");
        continue;
      }
      if (seenKeys.has(key)) {
        this.error(spanOf(entry["key"]) ?? node["span"], "mechanics/duplicate-key", `The record has :${key} twice.`);
      }
      seenKeys.add(key);
      if (key === "__proto__") {
        this.error(spanOf(entry["key"]) ?? node["span"], "mechanics/record-key", "__proto__ cannot be a record key: JavaScript treats it as the prototype.");
      }
      const field = struct?.fields.find((candidate) => candidate.name === key);
      if (struct && !field) {
        this.error(
          spanOf(entry["key"]) ?? spanOf(entry["value"]) ?? node["span"],
          "mechanics/unknown-field",
          `${expected ? showType(expected) : "This record"} has no field :${key}.`,
        );
      }
      const type = this.value(entry["value"], scope, field?.type);
      fields.push({ name: key, optional: false, type });
    }
    if (struct) {
      const missing = struct.fields.filter((field) => !field.optional && !fields.some((candidate) => candidate.name === field.name));
      if (missing.length > 0) {
        this.error(
          node["span"],
          "mechanics/missing-field",
          `${showType(expected!)} requires ${missing.map((field) => `:${field.name}`).join(" ")}.`,
        );
        return tUnknown;
      }
      if (fields.some((field) => !struct.fields.some((candidate) => candidate.name === field.name))) return tUnknown;
      // Field values were checked against the schema above; report nothing twice.
      if (expected!.kind === "named") this.info.recordTargets.set(node, expected!);
      return expected!;
    }
    // Like TypeScript, a record literal without a target type widens its fields.
    return { kind: "struct", fields: fields.map((field) => ({ ...field, type: widenDeep(field.type) })) };
  }

  private vector(node: JsonRecord, scope: Scope, expected: MType | undefined): MType {
    const items = arrayItems(node["items"]);
    const target = expected ? resolve(expected, this.env) : undefined;
    if (target?.kind === "tuple") {
      if (items.length !== target.items.length) {
        this.error(node["span"], "mechanics/type-mismatch", `Expected ${target.items.length} item(s) for ${showType(expected!)}, received ${items.length}.`);
      }
      return { kind: "tuple", items: items.map((item, index) => this.value(item, scope, target.items[index])) };
    }
    const itemExpected = target?.kind === "array" ? target.item : undefined;
    let item: MType = tNever;
    for (const element of items) {
      // Like TypeScript, an uncontextual array literal widens its elements.
      item = join(item, widenDeep(this.value(element, scope, itemExpected)), this.env);
    }
    if (isUnitType(item, this.env)) {
      this.error(node["span"], "mechanics/unit-collection", "An Array cannot hold Unit values (nil); use Bool or an Option.");
    }
    return { kind: "array", item: itemExpected ?? item };
  }

  private application(node: JsonRecord, scope: Scope, expected: MType | undefined): MType {
    const items = arrayItems(node["items"]);
    const head = items[0];
    const args = items.slice(1);
    const span = node["span"];
    const name = calleeName(head);
    if (name === undefined) {
      this.error(span, "mechanics/call", "Only named functions can be called.");
      return tUnknown;
    }
    const resolveAs = (call: ResolvedCall): void => {
      this.info.calls.set(node, call);
    };

    const local = scope.get(name);
    if (local) {
      if (local.kind !== "function") {
        this.error(span, "mechanics/call", `${name} is ${showType(local)}, not a function.`);
        return tUnknown;
      }
      resolveAs({ kind: "local", name });
      return this.callFunction(name, local.params, local.result, args, scope, span);
    }

    switch (name) {
      case "fn":
        resolveAs({ kind: "special", name });
        return this.valueLambda(node, args, scope, expected);
      case "if": {
        resolveAs({ kind: "special", name });
        if (args.length !== 3) {
          this.error(span, "mechanics/arity", "if expects a condition, a then value, and an else value.");
          return tUnknown;
        }
        this.condition(args[0], scope);
        return join(this.value(args[1], scope, expected), this.value(args[2], scope, expected), this.env);
      }
      case "cond": {
        resolveAs({ kind: "special", name });
        let result: MType = tNever;
        let exhaustive = false;
        if (args.length % 2 !== 0) this.error(span, "mechanics/arity", "cond expects condition/value pairs.");
        for (let index = 0; index + 1 < args.length; index += 2) {
          if (isElse(args[index])) {
            exhaustive = true;
            if (index + 2 < args.length) {
              this.error(spanOf(args[index]) ?? span, "mechanics/cond-else", "An always-true cond clause (:else or true) must be the last clause.");
            }
          } else this.condition(args[index], scope);
          result = join(result, this.value(args[index + 1], scope, expected), this.env);
        }
        if (!exhaustive) this.error(span, "mechanics/cond-fallthrough", "cond can fall through without a value; add a final :else clause.");
        return result;
      }
      case "let": {
        resolveAs({ kind: "special", name });
        const bindings = args[0];
        let letScope = scope;
        if (!isRecord(bindings) || bindings["kind"] !== "Vector" || args.length !== 2) {
          this.error(span, "mechanics/arity", "let expects a binding vector and one body value.");
          return tUnknown;
        }
        const pairs = arrayItems(bindings["items"]);
        for (let index = 0; index + 1 < pairs.length; index += 2) {
          const binding = pairs[index];
          const bindingName = isRecord(binding) && binding["kind"] === "Var" ? String(binding["name"]) : undefined;
          const type = this.value(pairs[index + 1], letScope);
          if (bindingName) letScope = extend(letScope, bindingName, type);
        }
        return this.value(args[1], letScope, expected);
      }
      case "and":
      case "or":
      case "not":
        if (name !== "not") {
          resolveAs({ kind: "special", name });
          for (const arg of args) this.value(arg, scope, tBool);
          return tBool;
        }
        break;
      case "=":
      case "!=":
        resolveAs({ kind: "equality", operator: name });
        return this.equality(name, args, scope, span);
      case "str":
        resolveAs({ kind: "special", name });
        for (const arg of args) {
          const type = this.value(arg, scope);
          if (!isPrintable(type, this.env)) {
            this.error(spanOf(arg) ?? span, "mechanics/str", `str joins strings, numbers, and booleans, not ${showType(type)}.`);
          }
        }
        return tString;
      case "get":
        return this.get(node, args, scope, span);
      case "assoc":
        return this.assoc(node, args, scope, span);
      case ":": {
        resolveAs({ kind: "special", name });
        const type = typeFromValueSyntax(args[1], this.env);
        if (!type) {
          this.error(spanOf(args[1]) ?? span, "mechanics/type-syntax", "Expected a type after the value in (: value Type).");
          return tUnknown;
        }
        this.value(args[0], scope, type);
        if (isRecord(args[1])) this.info.valueTypes.set(args[1], type);
        return type;
      }
      case "match": {
        resolveAs({ kind: "special", name });
        if (args.length < 3 || (args.length - 1) % 2 !== 0) {
          this.error(span, "mechanics/arity", "match expects a value and pattern/value pairs.");
          return tUnknown;
        }
        const scrutinee = this.value(args[0], scope);
        const patterns = args.filter((_, index) => index % 2 === 1);
        const bodies = args.filter((_, index) => index > 0 && index % 2 === 0);
        const plan = this.matchPlan(scrutinee, { span: span ?? null, value: args[0] ?? null }, patterns);
        if (!plan) {
          bodies.forEach((body, index) => this.value(body, bindPatternsUnknown(scope, patterns[index]), expected));
          return tUnknown;
        }
        this.info.matches.set(node, plan.shape);
        let result: MType = tNever;
        bodies.forEach((body, index) => {
          let armScope = scope;
          for (const [binding, type] of plan.bindings[index] ?? []) armScope = extend(armScope, binding, type);
          result = join(result, this.value(body, armScope, expected), this.env);
        });
        return result;
      }
      case "some": {
        resolveAs({ kind: "special", name });
        if (args.length !== 1) {
          this.error(span, "mechanics/arity", "some expects one value.");
          return tUnknown;
        }
        const target = expected ? resolve(expected, this.env) : undefined;
        const item = this.value(args[0], scope, target?.kind === "option" ? target.item : undefined);
        return { kind: "option", item: target?.kind === "option" ? target.item : widenDeep(item) };
      }
      default:
        break;
    }

    if (name.includes(".") && !name.startsWith(".")) {
      const [service, method] = name.split(".", 2) as [string, string];
      resolveAs({ kind: "service", service, method });
      return this.serviceCall(service, method, args, scope, span);
    }
    if (this.errorNames.has(name)) {
      resolveAs({ kind: "error", name });
      return this.constructError(name, args, scope, span);
    }
    const classFields = this.classes.get(name);
    if (classFields) {
      resolveAs({ kind: "class", name });
      if (args.length !== 1) {
        this.error(span, "mechanics/arity", `(${name} {...}) expects one record with its fields.`);
        return tUnknown;
      }
      this.value(args[0], scope, { kind: "struct", fields: classFields });
      return { kind: "class", name };
    }
    const schema = this.schemas.get(name);
    if (schema) {
      if (args.length !== 1) {
        this.error(span, "mechanics/arity", `(${name} value) expects exactly one value.`);
        return tUnknown;
      }
      if (schema.kind === "brand") {
        resolveAs({ kind: "brand", name });
        this.value(args[0], scope, schema.base);
        return { kind: "named", name };
      }
      resolveAs({ kind: "construct", name });
      this.value(args[0], scope, { kind: "named", name });
      return { kind: "named", name };
    }
    const fn = this.functions.get(name);
    if (fn) {
      resolveAs({ kind: "function", name });
      return this.callFunction(name, fn.params.map((param) => param.type), fn.result, args, scope, span);
    }
    const operation = this.operations.get(name);
    if (operation) {
      resolveAs({ kind: "operation", name });
      const type = this.operationCall(name, args, scope, span);
      if (this.layerContext && type.requirements.size > 0) this.layerContext.contextCalls.add(node);
      this.info.effectTypes.set(node, type);
      return type;
    }
    if (name.startsWith("stream-")) {
      resolveAs({ kind: "stream", name });
      return this.stream(name, args, scope, span);
    }
    const operator = arithmeticOperators.get(name);
    if (operator) {
      resolveAs({ kind: "arithmetic", operator });
      if (args.length < (name === "-" ? 1 : 2)) {
        this.error(span, "mechanics/arity", `${name} expects at least ${name === "-" ? 1 : 2} operands.`);
      }
      let allInt = true;
      for (const arg of args) {
        const type = this.value(arg, scope, tNumber);
        if (!isAssignable(type, tInt, this.env)) allInt = false;
      }
      return allInt ? tInt : tNumber;
    }
    const overloads = builtins.get(name);
    if (overloads) return this.builtin(node, name, overloads, args, scope, span, expected);

    if (isEffectFormName(name)) {
      this.error(
        span,
        "mechanics/effect-in-value",
        `${name} builds an effect, so it belongs in an effect body (an operation, a layer method, or an effect (fn ...) argument). In a value, call an operation instead.`,
      );
      return tUnknown;
    }
    this.error(span, "mechanics/unbound-name", `Unknown function ${name}.`);
    for (const arg of args) this.value(arg, scope);
    return tUnknown;
  }

  /**
   * Stream constructors, transformers, and runners. Streams are lazy
   * descriptions whose type carries the errors and requirements of every
   * effect folded into them; runners turn them into effects.
   */
  private stream(name: string, args: readonly JsonValue[], scope: Scope, span: JsonValue | undefined): MType {
    const arity: Readonly<Record<string, readonly number[]>> = {
      "stream-of": [1],
      "stream-range": [2],
      "stream-map": [2],
      "stream-filter": [2],
      "stream-take": [2],
      "stream-map-effect": [2, 3],
      "stream-run-collect": [1],
      "stream-run-fold": [3],
      "stream-run-for-each": [2],
    };
    const expectedArity = arity[name];
    if (!expectedArity) {
      this.error(span, "mechanics/unbound-name", `Unknown stream function ${name}.`);
      return tUnknown;
    }
    if (!expectedArity.includes(args.length)) {
      this.error(span, "mechanics/arity", `${name} expects ${expectedArity.join(" or ")} argument(s), received ${args.length}.`);
      return tUnknown;
    }
    if (name === "stream-of") {
      const items = resolve(this.value(args[0], scope), this.env);
      if (items.kind === "unknown") return tUnknown;
      if (items.kind !== "array") {
        this.error(spanOf(args[0]) ?? span, "mechanics/type-mismatch", `stream-of expects an Array, but this is ${showType(items)}.`);
        return tUnknown;
      }
      return { kind: "stream", item: items.item, errors: emptySet, requirements: emptySet };
    }
    if (name === "stream-range") {
      this.value(args[0], scope, tInt);
      this.value(args[1], scope, tInt);
      return { kind: "stream", item: tInt, errors: emptySet, requirements: emptySet };
    }
    const source = this.value(args[0], scope);
    if (source.kind !== "stream") {
      if (source.kind !== "unknown") {
        this.error(spanOf(args[0]) ?? span, "mechanics/type-mismatch", `${name} expects a Stream, but this is ${showType(source)}.`);
      }
      args.slice(1).forEach((arg) => this.value(arg, scope));
      return tUnknown;
    }
    const effectful = (fn: JsonValue | undefined, params: readonly MType[]): EffectType | undefined => {
      const type = this.value(fn, scope, { kind: "function", params, result: tUnknown });
      if (type.kind !== "function") return undefined;
      if (type.result.kind !== "effect") {
        if (type.result.kind !== "unknown") {
          this.error(spanOf(fn) ?? span, "mechanics/type-mismatch", `${name} expects a function returning an effect, but it returns ${showType(type.result)}.`);
        }
        return undefined;
      }
      return type.result;
    };
    switch (name) {
      case "stream-map": {
        const fn = this.value(args[1], scope, { kind: "function", params: [source.item], result: tUnknown });
        return { ...source, item: fn.kind === "function" ? fn.result : tUnknown };
      }
      case "stream-filter":
        this.value(args[1], scope, { kind: "function", params: [source.item], result: tBool });
        return source;
      case "stream-take":
        this.value(args[1], scope, tInt);
        return source;
      case "stream-map-effect": {
        if (args[2] !== undefined) this.value(args[2], scope, tInt);
        const effect = effectful(args[1], [source.item]);
        return {
          kind: "stream",
          item: effect?.success ?? tUnknown,
          errors: unionSets(source.errors, effect?.errors ?? emptySet),
          requirements: unionSets(source.requirements, effect?.requirements ?? emptySet),
        };
      }
      case "stream-run-collect":
        return effectOf({ kind: "array", item: source.item }, reprovenance(source.errors, span), reprovenance(source.requirements, span));
      case "stream-run-fold": {
        const initial = widenDeep(this.value(args[1], scope));
        this.value(args[2], scope, { kind: "function", params: [initial, source.item], result: initial });
        return effectOf(initial, reprovenance(source.errors, span), reprovenance(source.requirements, span));
      }
      default: {
        const effect = effectful(args[1], [source.item]);
        return effectOf(
          tUnit,
          unionSets(reprovenance(source.errors, span), effect?.errors ?? emptySet),
          unionSets(reprovenance(source.requirements, span), effect?.requirements ?? emptySet),
        );
      }
    }
  }

  private callFunction(
    name: string,
    params: readonly MType[],
    result: MType,
    args: readonly JsonValue[],
    scope: Scope,
    span: JsonValue | undefined,
  ): MType {
    if (params.length !== args.length) {
      this.error(span, "mechanics/arity", `${name} expects ${params.length} argument(s), received ${args.length}.`);
    }
    args.forEach((arg, index) => this.value(arg, scope, params[index]));
    return result;
  }

  private valueLambda(node: JsonRecord, args: readonly JsonValue[], scope: Scope, expected: MType | undefined): MType {
    const paramsNode = args[0];
    const body = args[1];
    const names =
      isRecord(paramsNode) && paramsNode["kind"] === "Vector"
        ? arrayItems(paramsNode["items"]).map((item) => (isRecord(item) && item["kind"] === "Var" ? String(item["name"]) : "_"))
        : undefined;
    if (!names || args.length !== 2) {
      this.error(node["span"], "mechanics/fn", "fn expects a parameter vector and one body value.");
      return tUnknown;
    }
    this.checkParamNames(names.filter((name) => name !== "_"), "This fn", node["span"]);
    const target = expected ? resolve(expected, this.env) : undefined;
    if (target?.kind !== "function") {
      this.error(
        node["span"],
        "mechanics/fn",
        "Cannot infer this fn's parameter types; pass it where a function is expected or ascribe it with (: (fn ...) (-> A B)).",
      );
      return tUnknown;
    }
    if (target.params.length !== names.length) {
      this.error(node["span"], "mechanics/arity", `This fn should take ${target.params.length} parameter(s), but takes ${names.length}.`);
    }
    let lambdaScope = scope;
    names.forEach((name, index) => {
      lambdaScope = extend(lambdaScope, name, target.params[index] ?? tUnknown);
    });
    const resultExpected = target.result.kind === "var" || target.result.kind === "unknown" ? undefined : target.result;
    const result = this.value(body, lambdaScope, resultExpected, { allowEffect: resultExpected === undefined });
    // A body that missed its expected result was reported above; don't report the fn too.
    return { kind: "function", params: target.params, result: resultExpected ?? result };
  }

  private builtin(
    node: JsonRecord,
    name: string,
    overloads: readonly BuiltinOverload[],
    args: readonly JsonValue[],
    scope: Scope,
    span: JsonValue | undefined,
    expected?: MType,
  ): MType {
    // Lambdas and record/vector literals take their types from the other
    // arguments, the way TypeScript contextually types them.
    const isContextual = (arg: JsonValue | undefined): boolean => {
      if (!isRecord(arg)) return false;
      if (arg["kind"] === "Record" || arg["kind"] === "Vector") return true;
      const first = arg["kind"] === "List" ? arrayItems(arg["items"])[0] : undefined;
      return isRecord(first) && first["kind"] === "Var" && first["name"] === "fn";
    };
    const argTypes = args.map((arg) => (isContextual(arg) ? undefined : this.value(arg, scope)));
    if (argTypes.some((type) => type?.kind === "unknown")) {
      for (const arg of args) if (isContextual(arg)) this.value(arg, scope);
      return tUnknown;
    }
    for (const overload of overloads) {
      if (overload.params.length !== args.length) continue;
      const subst: Substitution = new Map();
      const { params, result } = instantiate(overload);
      const matches = argTypes.every((type, index) => type === undefined || isAssignable(type, params[index]!, this.env, subst));
      if (!matches) continue;
      // A deferred literal must still fit this overload's shape (a record cannot be a String).
      const shapes = args.every((arg, index) => {
        if (argTypes[index] !== undefined || !isRecord(arg)) return true;
        const param = resolve(applySubstitution(params[index]!, subst), this.env);
        if (arg["kind"] === "Record") return ["struct", "map", "union", "var", "named"].includes(param.kind);
        if (arg["kind"] === "Vector") return ["array", "tuple", "var"].includes(param.kind);
        return param.kind === "function" || param.kind === "var";
      });
      if (!shapes) continue;
      // Like TypeScript, an expected result type is an inference site: (map f xs)
      // returned as (Array Shape) types f's result as Shape.
      if (expected && hasVariables(applySubstitution(result, subst))) {
        const trial: Substitution = new Map(subst);
        if (isAssignable(result, expected, this.env, trial)) for (const [id, type] of trial) subst.set(id, type);
      }
      this.info.calls.set(node, { kind: "builtin", name, overload });
      this.builtinRestrictions(name, argTypes, args, span);
      args.forEach((arg, index) => {
        if (argTypes[index] !== undefined) return;
        const expectedParam = applySubstitution(params[index]!, subst);
        if (expectedParam.kind === "function") {
          const lambdaType = this.value(arg, scope, { ...expectedParam, result: hasVariables(expectedParam.result) ? tUnknown : expectedParam.result });
          if (lambdaType.kind === "function") isAssignable(lambdaType.result, expectedParam.result, this.env, subst);
        } else if (hasVariables(expectedParam)) {
          isAssignable(this.value(arg, scope), expectedParam, this.env, subst);
        } else {
          this.value(arg, scope, expectedParam);
        }
      });
      const resolved = applySubstitution(result, subst);
      return hasVariables(resolved) ? eraseVariables(resolved) : resolved;
    }
    this.error(
      span,
      "mechanics/no-overload",
      `${name} does not accept (${argTypes.map((type, index) => (type ? showType(type) : describeLiteral(args[index]))).join(" ")}).`,
    );
    return tUnknown;
  }

  /** Builtins whose TypeScript translation compares by reference or stringifies objects. */
  private builtinRestrictions(
    name: string,
    argTypes: readonly (MType | undefined)[],
    args: readonly JsonValue[],
    span: JsonValue | undefined,
  ): void {
    const [first, second] = argTypes;
    if (name === "includes?" && first && resolve(first, this.env).kind === "array" && second && !isPrimitiveLike(second, this.env)) {
      this.error(
        spanOf(args[1]) ?? span,
        "mechanics/equality",
        `includes? compares strings, numbers, booleans, and enums; ${showType(second)} would be compared by reference in TypeScript.`,
      );
    }
    if (name === "to-string" && first && !isPrintable(first, this.env)) {
      this.error(spanOf(args[0]) ?? span, "mechanics/str", `to-string converts strings, numbers, and booleans, not ${showType(first)}.`);
    }
  }

  private equality(name: string, args: readonly JsonValue[], scope: Scope, span: JsonValue | undefined): MType {
    if (args.length !== 2) {
      this.error(span, "mechanics/arity", `${name} compares exactly two values.`);
      return tBool;
    }
    const left = this.value(args[0], scope);
    const right = this.value(args[1], scope);
    for (const [type, arg] of [[left, args[0]], [right, args[1]]] as const) {
      if (!isPrimitiveLike(type, this.env)) {
        this.error(
          spanOf(arg) ?? span,
          "mechanics/equality",
          `${name} compares strings, numbers, booleans, and enums; ${showType(type)} would be compared by reference in TypeScript.`,
        );
        return tBool;
      }
    }
    if (!isAssignable(left, widenLiteral(right), this.env) && !isAssignable(right, widenLiteral(left), this.env) && !overlaps(left, right, this.env)) {
      this.error(span, "mechanics/equality", `${showType(left)} and ${showType(right)} never compare equal.`);
    }
    return tBool;
  }

  private get(node: JsonRecord, args: readonly JsonValue[], scope: Scope, span: JsonValue | undefined): MType {
    if (args.length !== 2) {
      this.error(span, "mechanics/arity", "get expects a value and a field.");
      return tUnknown;
    }
    const target = this.value(args[0], scope);
    const resolved = resolve(target, this.env);
    const key = recordKey(args[1]);
    if (resolved.kind === "map") {
      this.info.calls.set(node, { kind: "get", access: "map" });
      this.value(args[1], scope, tString);
      return { kind: "option", item: resolved.value };
    }
    if (key === undefined) {
      this.error(spanOf(args[1]) ?? span, "mechanics/record-key", "get expects a :field keyword.");
      return tUnknown;
    }
    if (isRecord(args[1])) this.info.valueTypes.set(args[1], { kind: "literal", value: key });
    const fields = fieldsOf(resolved, this.env, this.errorFields);
    if (!fields) {
      if (resolved.kind !== "unknown") {
        this.error(spanOf(args[0]) ?? span, "mechanics/field", `${showType(target)} has no fields.`);
      }
      return tUnknown;
    }
    const field = fields.get(key);
    if (!field) {
      this.error(spanOf(args[1]) ?? span, "mechanics/unknown-field", `${showType(target)} has no field :${key}.`);
      return tUnknown;
    }
    this.info.calls.set(node, { kind: "get", access: field.optional ? "optional-field" : "field" });
    return field.optional ? { kind: "option", item: field.type } : field.type;
  }

  private assoc(node: JsonRecord, args: readonly JsonValue[], scope: Scope, span: JsonValue | undefined): MType {
    if (args.length !== 3) {
      this.error(span, "mechanics/arity", "assoc expects a value, a key, and a new value.");
      return tUnknown;
    }
    const target = this.value(args[0], scope);
    const resolved = resolve(target, this.env);
    if (resolved.kind === "map") {
      this.info.calls.set(node, { kind: "assoc", access: "map" });
      this.value(args[1], scope, tString);
      this.value(args[2], scope, resolved.value);
      return target;
    }
    const key = recordKey(args[1]);
    if (key === undefined) {
      this.error(spanOf(args[1]) ?? span, "mechanics/record-key", "assoc expects a :field keyword.");
      return tUnknown;
    }
    const fields = resolved.kind === "struct" ? resolved.fields : resolved.kind === "class" ? this.classes.get(resolved.name) : undefined;
    const field = fields?.find((candidate) => candidate.name === key);
    if (!field) {
      if (resolved.kind !== "unknown") {
        this.error(spanOf(args[1]) ?? span, "mechanics/unknown-field", `${showType(target)} has no field :${key}.`);
      }
      return tUnknown;
    }
    this.info.calls.set(node, { kind: "assoc", access: resolved.kind === "class" ? "class" : "field" });
    this.value(args[2], scope, field.type);
    return target;
  }

  private constructError(name: string, args: readonly JsonValue[], scope: Scope, span: JsonValue | undefined): MType {
    if (!this.errorNames.has(name)) {
      this.error(span, "mechanics/unknown-error", `Unknown error type ${name}. Declare it with error before using fail.`);
      return tUnknown;
    }
    if (builtinErrors.has(name)) {
      this.error(span, "mechanics/builtin-error", `${name} is raised by Effect itself and cannot be constructed.`);
      return tUnknown;
    }
    const fields = this.errorFields.get(name) ?? [];
    if (args.length > 1 || (args.length === 0 && fields.some((field) => !field.optional))) {
      this.error(span, "mechanics/arity", `(${name} {...}) expects one record with its fields.`);
      return tUnknown;
    }
    if (args.length === 1) this.value(args[0], scope, { kind: "struct", fields });
    return { kind: "error", name };
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  private error(span: JsonValue | undefined, code: string, message: string): void {
    this.push("error", span, code, message);
  }

  private warning(span: JsonValue | undefined, code: string, message: string): void {
    this.push("warning", span, code, message);
  }

  private push(severity: "error" | "warning", span: JsonValue | undefined, code: string, message: string): void {
    const location = toSourceSpan(span);
    if (
      this.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === code &&
          diagnostic.message === message &&
          diagnostic.span?.startOffset === location?.startOffset,
      )
    ) {
      return;
    }
    this.diagnostics.push({ code, message, severity, ...(location ? { span: location } : {}) });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The constants each constant needs while the module loads: those it names
 * directly and those named by any function it can reach (functions run when
 * called, so a constant that calls `scale` needs what `scale` reads).
 */
export function constantDependencies(declarations: readonly PackageableDeclaration[]): ReadonlyMap<string, ReadonlySet<string>> {
  const constants = new Map<string, JsonValue | undefined>();
  const functions = new Map<string, JsonValue | undefined>();
  for (const declaration of declarations) {
    const payload = declaration.payload;
    if (!isRecord(payload) || typeof payload["name"] !== "string") continue;
    if (payload["kind"] === "ValueDef") constants.set(payload["name"], payload["value"]);
    if (payload["kind"] === "FunctionDef") functions.set(payload["name"], payload["body"]);
  }
  const mentioned = (node: JsonValue | undefined, names = new Set<string>()): Set<string> => {
    if (Array.isArray(node)) node.forEach((item) => mentioned(item, names));
    else if (isRecord(node)) {
      if (node["kind"] === "Var" && typeof node["name"] === "string") names.add(node["name"]);
      for (const [key, value] of Object.entries(node)) if (key !== "span" && key !== "effect") mentioned(value, names);
    }
    return names;
  };
  const result = new Map<string, ReadonlySet<string>>();
  for (const [name, value] of constants) {
    const needed = new Set<string>();
    const visitedFunctions = new Set<string>();
    const queue = [...mentioned(value)];
    while (queue.length > 0) {
      const next = queue.pop()!;
      if (constants.has(next)) needed.add(next);
      if (functions.has(next) && !visitedFunctions.has(next)) {
        visitedFunctions.add(next);
        queue.push(...mentioned(functions.get(next)));
      }
    }
    result.set(name, needed);
  }
  return result;
}

/** Pattern variables of a match that could not be planned are bound to Unknown to avoid cascades. */
function bindPatternsUnknown(scope: Scope, pattern: JsonValue | undefined): Scope {
  const binding = parsePattern(pattern)?.binding;
  return binding && binding !== "_" ? extend(scope, binding, tUnknown) : scope;
}

function isLiteralSyntax(node: JsonRecord): boolean {
  switch (node["kind"]) {
    case "Literal":
      return typeof node["value"] === "string" || typeof node["value"] === "number" || typeof node["value"] === "boolean";
    case "Expr":
      return keywordName(node) !== undefined;
    case "Record":
    case "Vector":
      return true;
    default:
      return false;
  }
}

function isUnitType(type: MType, env: TypeEnvironment): boolean {
  const resolved = resolve(type, env);
  return resolved.kind === "prim" && resolved.name === "Unit";
}

function describeLiteral(node: JsonValue | undefined): string {
  if (!isRecord(node)) return "?";
  if (node["kind"] === "Record") return "{...}";
  if (node["kind"] === "Vector") return "[...]";
  return "fn";
}

function extend(scope: Scope, name: string, type: MType): Scope {
  const next = new Map(scope);
  next.set(name, type);
  return next;
}

function without(set: Provenance, name: string): Provenance {
  return new Map([...set].filter(([item]) => item !== name));
}

function reprovenance(set: Provenance, span: JsonValue | undefined): Provenance {
  return new Map([...set.keys()].map((name) => [name, span]));
}

function mergeLayers(layers: readonly LayerType[]): LayerType {
  return {
    provides: [...new Set(layers.flatMap((layer) => layer.provides))],
    errors: unionSets(...layers.map((layer) => layer.errors)),
    requirements: unionSets(...layers.map((layer) => layer.requirements)),
  };
}

function declarationSpan(declaration: PackageableDeclaration): JsonValue | undefined {
  const span = declaration.span;
  if (!span) return undefined;
  return { sourceId: span.sourceId, startOffset: span.startOffset, endOffset: span.endOffset };
}

export function spanOf(node: JsonValue | undefined): JsonValue | undefined {
  return isRecord(node) ? node["span"] : undefined;
}

function toSourceSpan(span: JsonValue | undefined): MechanicsSourceSpan | undefined {
  if (!isRecord(span)) return undefined;
  const { sourceId, startOffset, endOffset } = span;
  if (typeof sourceId !== "string" || typeof startOffset !== "number" || typeof endOffset !== "number") {
    return undefined;
  }
  return { sourceId, startOffset, endOffset };
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function describeEffectNode(node: JsonRecord): string {
  switch (node["kind"]) {
    case "ServiceCall":
      return `${String(node["service"])}.${String(node["method"])}`;
    case "OperationCall":
      return String(node["operation"]);
    case "Combinator":
      return String(node["name"]);
    default:
      return "this effect";
  }
}

/** The called name of an application head; `(: value Type)` reads `:` as a keyword. */
export function calleeName(head: JsonValue | undefined): string | undefined {
  if (!isRecord(head)) return undefined;
  if (head["kind"] === "Var") return String(head["name"]);
  const source = head["source"];
  if (head["kind"] === "Expr" && isRecord(source) && source["kind"] === "Symbol" && source["name"] === ":") return ":";
  return undefined;
}

export function keywordName(node: JsonValue | undefined): string | undefined {
  if (!isRecord(node) || node["kind"] !== "Expr") return undefined;
  const source = node["source"];
  if (isRecord(source) && source["kind"] === "Symbol" && typeof source["name"] === "string" && source["name"].startsWith(":")) {
    return source["name"].slice(1);
  }
  return undefined;
}

function isElse(node: JsonValue | undefined): boolean {
  if (keywordName(node) === "else") return true;
  return isRecord(node) && node["kind"] === "Literal" && node["value"] === true;
}

export function recordKey(node: JsonValue | undefined): string | undefined {
  if (!isRecord(node)) return undefined;
  const keyword = keywordName(node);
  if (keyword !== undefined) return keyword;
  if (node["kind"] === "Literal" && typeof node["value"] === "string") return node["value"].replace(/^:/, "");
  return undefined;
}

function errorNamesOf(type: MType, env: TypeEnvironment): readonly string[] | undefined {
  const resolved = resolve(type, env);
  if (resolved.kind === "error") return [resolved.name];
  if (resolved.kind === "never") return [];
  if (resolved.kind === "union" && resolved.members.every((member) => member.kind === "error")) {
    return resolved.members.map((member) => (member as { readonly name: string }).name);
  }
  return undefined;
}

function fieldsOf(
  type: MType,
  env: TypeEnvironment,
  errorFields: ReadonlyMap<string, readonly MField[]>,
): ReadonlyMap<string, MField> | undefined {
  const resolved = resolve(type, env);
  if (resolved.kind === "struct") return new Map(resolved.fields.map((field) => [field.name, field]));
  if (resolved.kind === "error") {
    const tag: MField = { name: "_tag", optional: false, type: { kind: "literal", value: resolved.name } };
    return new Map([tag, ...(errorFields.get(resolved.name) ?? [])].map((field) => [field.name, field]));
  }
  if (resolved.kind === "class") return new Map((env.classes.get(resolved.name) ?? []).map((field) => [field.name, field]));
  if (resolved.kind === "union") {
    const members = resolved.members.map((member) => fieldsOf(member, env, errorFields));
    if (members.some((member) => member === undefined)) return undefined;
    const [first, ...rest] = members as ReadonlyMap<string, MField>[];
    const shared = new Map<string, MField>();
    for (const [name, field] of first ?? []) {
      const others = rest.map((member) => member.get(name));
      if (others.some((other) => other === undefined)) continue;
      shared.set(name, {
        name,
        optional: field.optional || others.some((other) => other!.optional),
        type: union([field.type, ...others.map((other) => other!.type)]),
      });
    }
    return shared;
  }
  return undefined;
}

function structMemberFor(
  target: MType & { readonly kind: "union" },
  entries: readonly JsonRecord[],
  env: TypeEnvironment,
): (MType & { readonly kind: "struct" }) | undefined {
  const members = target.members.map((member) => resolve(member, env)).filter((member): member is MType & { readonly kind: "struct" } => member.kind === "struct");
  const discriminator = taggedDiscriminator(members);
  if (!discriminator) return undefined;
  const entry = entries.find((candidate) => recordKey(candidate["key"]) === discriminator);
  const tag = entry && isRecord(entry["value"]) ? (entry["value"]["kind"] === "Literal" ? entry["value"]["value"] : keywordName(entry["value"])) : undefined;
  return members.find((member) => literalField(member, discriminator) === tag);
}

function taggedDiscriminator(members: readonly MType[]): string | undefined {
  const structs = members.filter((member): member is MType & { readonly kind: "struct" } => member.kind === "struct");
  if (structs.length !== members.length || structs.length === 0) return undefined;
  for (const field of structs[0]!.fields) {
    const tags = structs.map((member) => literalField(member, field.name));
    if (tags.every((tag) => tag !== undefined) && new Set(tags).size === tags.length) return field.name;
  }
  return undefined;
}

function literalField(member: MType, name: string): string | number | boolean | undefined {
  if (member.kind !== "struct") return undefined;
  const field = member.fields.find((candidate) => candidate.name === name);
  return field?.type.kind === "literal" ? field.type.value : undefined;
}

export interface Pattern {
  /** The case it names, as text (`"some"`, `"admin"`, `"1"`, `"true"`). */
  readonly tag: string;
  /** For literal patterns, the literal itself. */
  readonly value?: string | number | boolean;
  readonly binding?: string;
}

export function parsePattern(pattern: JsonValue | undefined, kind?: string): Pattern | undefined {
  const parsed = parseRawPattern(pattern);
  if (!parsed) return undefined;
  const standard: Record<string,string> = kind === "option" ? {Some:"some",None:"none","Option.Some":"some","Option.None":"none"} : kind === "result" ? {Ok:"success",Err:"failure","Result.Ok":"success","Result.Err":"failure"} : {};
  if (standard[parsed.tag]) return {...parsed,tag:standard[parsed.tag]!};
  return parsed;
}
function parseRawPattern(pattern: JsonValue | undefined): Pattern | undefined {
  if (!isRecord(pattern)) return undefined;
  switch (pattern["kind"]) {
    case "Var": {
      const name = String(pattern["name"]);
      if (name === "true" || name === "false") return { tag: name, value: name === "true" };
      return { tag: name, value: name };
    }
    case "Literal": {
      const value = pattern["value"];
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? { tag: String(value), value }
        : undefined;
    }
    case "Expr": {
      const keyword = keywordName(pattern);
      return keyword === undefined ? undefined : { tag: keyword, value: keyword };
    }
    case "List": {
      const items = arrayItems(pattern["items"]);
      const head = items[0];
      const binding = items[1];
      if (items.length !== 2 || !isRecord(head) || !isRecord(binding) || binding["kind"] !== "Var") return undefined;
      const tag = head["kind"] === "Var" ? String(head["name"]) : keywordName(head);
      return tag === undefined ? undefined : { tag, binding: String(binding["name"]) };
    }
    default:
      return undefined;
  }
}

function isPrimitiveLike(type: MType, env: TypeEnvironment): boolean {
  const resolved = resolve(type, env);
  switch (resolved.kind) {
    case "prim":
      return resolved.name !== "Json";
    case "literal":
    case "brand":
    case "unknown":
    case "never":
      return true;
    case "union":
      return resolved.members.every((member) => isPrimitiveLike(member, env));
    default:
      return false;
  }
}

function isPrintable(type: MType, env: TypeEnvironment): boolean {
  const resolved = resolve(type, env);
  if (resolved.kind === "prim") return resolved.name !== "Unit" && resolved.name !== "Json" && resolved.name !== "Bytes";
  return isPrimitiveLike(resolved, env);
}

function overlaps(left: MType, right: MType, env: TypeEnvironment): boolean {
  const l = resolve(left, env);
  const r = resolve(right, env);
  if (l.kind === "union") return l.members.some((member) => overlaps(member, r, env));
  if (r.kind === "union") return r.members.some((member) => overlaps(l, member, env));
  return isAssignable(l, r, env) || isAssignable(r, l, env) || isAssignable(widenLiteral(l), widenLiteral(r), env);
}

function hasVariables(type: MType): boolean {
  switch (type.kind) {
    case "var":
      return true;
    case "array":
    case "option":
    case "ref":
      return hasVariables(type.item);
    case "map":
      return hasVariables(type.value);
    case "tuple":
      return type.items.some(hasVariables);
    case "union":
      return type.members.some(hasVariables);
    case "function":
      return type.params.some(hasVariables) || hasVariables(type.result);
    case "result":
      return hasVariables(type.success) || hasVariables(type.failure);
    default:
      return false;
  }
}

function eraseVariables(type: MType): MType {
  const subst: Substitution = new Map();
  const collect = (item: MType): void => {
    if (item.kind === "var") subst.set(item.id, tNever);
    else if (item.kind === "array" || item.kind === "option" || item.kind === "ref") collect(item.item);
    else if (item.kind === "map") collect(item.value);
    else if (item.kind === "tuple") item.items.forEach(collect);
    else if (item.kind === "union") item.members.forEach(collect);
    else if (item.kind === "function") {
      item.params.forEach(collect);
      collect(item.result);
    }
  };
  collect(type);
  return applySubstitution(type, subst);
}

let variableCounter = 1000;

/** Renames a signature's variables so each call gets fresh ones. */
function instantiate(overload: BuiltinOverload): { readonly params: readonly MType[]; readonly result: MType } {
  const fresh = new Map<number, MType>();
  const rename = (item: MType): MType => {
    if (item.kind !== "var") return item;
    let next = fresh.get(item.id);
    if (!next) {
      next = { kind: "var", id: variableCounter++ };
      fresh.set(item.id, next);
    }
    return next;
  };
  return {
    params: overload.params.map((param) => mapType(param, rename)),
    result: mapType(overload.result, rename),
  };
}

function mapType(type: MType, f: (type: MType) => MType): MType {
  const mapped = f(type);
  if (mapped !== type) return mapped;
  switch (type.kind) {
    case "array":
      return { kind: "array", item: mapType(type.item, f) };
    case "option":
      return { kind: "option", item: mapType(type.item, f) };
    case "ref":
      return { kind: "ref", item: mapType(type.item, f) };
    case "map":
      return { kind: "map", value: mapType(type.value, f) };
    case "tuple":
      return { kind: "tuple", items: type.items.map((item) => mapType(item, f)) };
    case "union":
      return union(type.members.map((member) => mapType(member, f)));
    case "function":
      return { kind: "function", params: type.params.map((param) => mapType(param, f)), result: mapType(type.result, f) };
    case "result":
      return { kind: "result", success: mapType(type.success, f), failure: mapType(type.failure, f) };
    default:
      return type;
  }
}

/**
 * Reads a type written in value position, as in `(: [] (Array User))`.
 */
export function typeFromValueSyntax(node: JsonValue | undefined, env: TypeEnvironment): MType | undefined {
  if (!isRecord(node)) return undefined;
  if (node["kind"] === "Var") {
    const name = String(node["name"]);
    const json: JsonValue = ["String", "Int", "Float", "Number", "Bool", "Unit", "Json", "Bytes", "DateTime"].includes(name)
      ? { kind: "Primitive", name }
      : { kind: "Ref", name };
    return typeFromJson(json, env);
  }
  if (node["kind"] !== "List") return undefined;
  const items = arrayItems(node["items"]);
  const head = items[0];
  const headName = calleeName(head);
  if (headName === "Map" && keywordName(items[2]) === "key") {
    const value = typeFromValueSyntax(items[1],env);
    return value ? {kind:"map",value} : undefined;
  }
  const parts = items.slice(1).map((item) => typeFromValueSyntax(item, env));
  if (parts.some((part) => part === undefined)) return undefined;
  const [first, second] = parts as MType[];
  switch (headName) {
    case "->":
      return parts.length > 0 ? { kind: "function", params: (parts as MType[]).slice(0, -1), result: (parts as MType[]).at(-1)! } : undefined;
    case "Array":
    case "List":
      return first ? { kind: "array", item: first } : undefined;
    case "Map":
      return first ? { kind: "map", value: first } : undefined;
    case "Option":
      return first ? { kind: "option", item: first } : undefined;
    case "Ref":
      return first ? { kind: "ref", item: first } : undefined;
    case "Tuple":
      return { kind: "tuple", items: parts as MType[] };
    case "Union":
      return union(parts as MType[]);
    case "Result":
      return first && second ? { kind: "result", success: first, failure: second } : undefined;
    default:
      return undefined;
  }
}
