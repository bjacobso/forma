/**
 * Generates a Go package from checked mechanics declarations, targeting the
 * effect-go runtime prototype in `prototypes/effect-go` (RFC 0019).
 *
 * This is a prototype second consumer of the same checked IR as the Effect
 * TypeScript generator. Schemas become Go structs and named types, errors
 * become structs implementing `error`, services become structs of
 * functions with a context tag, pure functions become plain Go functions,
 * operations become functions returning `effect.Gen` programs, and layers
 * become `*effect.Layer` values.
 *
 * Go's types carry only an effect's success type. The checker has already
 * proven the error and requirement sets closed, which Go cannot express.
 * Generation throws on a construct it cannot translate; it never emits a
 * placeholder.
 *
 * @module
 */
import type { JsonValue, PackageableDeclaration } from "../artifact/artifact.js";
import type { GoEmitNaming } from "../descriptor/form-emitter.js";
import { checkMechanicsDeclarations, keywordName, parsePattern, recordKey, type CheckInfo } from "./check.js";
import { inlineBrands } from "./effect-schema.js";
import { bindingSteps, freeIn, isElseCondition, isFnLiteral, isUnitLiteral, letSteps, referencedIn, type Step } from "./effect-typescript.js";
import { typeName } from "./naming.js";
import { arrayItems, isRecord, resolve, showType, stringItems, typeFromJson, type MField, type MType } from "./types.js";

export interface MechanicsEffectGoOptions {
  /** The Go package name. */
  readonly packageName: string;
  /** Check results to reuse; the generator runs the checker when omitted. */
  readonly check?: CheckInfo;
  /** Module path of the runtime; defaults to the prototype's. */
  readonly runtimeModule?: string;
  /** Further runtime packages that appended domain code uses, such as `httpapi`. */
  readonly runtimePackages?: readonly string[];
}

export interface MechanicsEffectGoModule {
  readonly code: string;
  readonly operationNames: readonly string[];
  /** Go names and types for `go/*` emit primitives in prelude templates. */
  readonly naming: GoEmitNaming;
  /** Every top-level Go name the module declares. */
  readonly declaredNames: ReadonlySet<string>;
}

/** A construct the Go prototype does not translate yet. */
export class EffectGoUnsupportedError extends Error {}

const defaultRuntimeModule = "github.com/bjacobso/forma/prototypes/effect-go";

export function generateMechanicsEffectGoModule(
  declarations: readonly PackageableDeclaration[],
  options: MechanicsEffectGoOptions,
): MechanicsEffectGoModule {
  const info = options.check ?? checkMechanicsDeclarations(declarations).info;
  return new GoGenerator(declarations, info, options).module();
}

type JsonRecord = Readonly<Record<string, JsonValue>>;
type Mode = "return" | "discard";
type Import = "effect" | "forma" | "strings" | "time";

const goKeywords = new Set([
  "break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough", "for", "func", "go", "goto",
  "if", "import", "interface", "map", "package", "range", "return", "select", "struct", "switch", "type", "var",
]);
const goPredeclared = new Set([
  "any", "bool", "byte", "comparable", "error", "float32", "float64", "int", "int8", "int16", "int32", "int64", "rune",
  "string", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr", "true", "false", "iota", "nil", "append", "cap",
  "clear", "close", "complex", "copy", "delete", "imag", "len", "make", "max", "min", "new", "panic", "print",
  "println", "real", "recover",
]);
/** Identifiers generated code uses: the fiber parameter and the imported packages. */
const runtimeNames = ["f", "effect", "forma", "strings", "time"];

/** `find-by-email` → `FindByEmail`. */
function exportedName(name: string): string {
  return typeName(name.replace(/\?$/, ""));
}

/** `find-by-email` → `findByEmail`, never a Go keyword or predeclared name. */
function localName(name: string): string {
  const exported = exportedName(name);
  const local = `${exported.charAt(0).toLowerCase()}${exported.slice(1)}`;
  return goKeywords.has(local) || goPredeclared.has(local) ? `${local}Value` : local;
}

/** Forma field name → exported Go field name. */
function fieldName(name: string): string {
  return exportedName(name);
}

class Names {
  private readonly bindings: Map<string, string>;
  private readonly taken: Set<string>;

  constructor(parent?: Names, reserved: Iterable<string> = []) {
    this.bindings = new Map(parent?.bindings);
    this.taken = new Set([...(parent?.taken ?? []), ...reserved]);
  }

  child(): Names {
    return new Names(this);
  }

  bind(name: string, preferred = localName(name)): string {
    let candidate = preferred;
    let index = 2;
    while (this.taken.has(candidate)) candidate = `${preferred}${index++}`;
    this.taken.add(candidate);
    this.bindings.set(name, candidate);
    return candidate;
  }

  lookup(name: string): string | undefined {
    return this.bindings.get(name);
  }
}

class GoGenerator {
  private readonly imports = new Set<Import>();
  private readonly runtimeModule: string;
  /** Go names of top-level declarations by Forma name and kind. */
  private readonly typeNames = new Map<string, string>();
  private readonly functionNames = new Map<string, string>();
  private readonly layerNames = new Map<string, string>();
  private readonly constantNames = new Map<string, string>();
  private readonly taken = new Set<string>();
  /** Declared struct schemas, for giving record literals a nominal type. */
  private readonly structSchemas: { readonly name: string; readonly fields: readonly MField[] }[] = [];
  /** Package-level struct types hoisted for records no schema declares. */
  private readonly hoisted = new Map<string, { readonly name: string; readonly fields: readonly MField[]; readonly types: readonly string[] }>();
  private serviceVars = new Map<string, string>();
  private contextVar: string | undefined;
  private nameHint: string | undefined;

  constructor(
    private readonly declarations: readonly PackageableDeclaration[],
    private readonly info: CheckInfo,
    private readonly options: MechanicsEffectGoOptions,
  ) {
    this.runtimeModule = options.runtimeModule ?? defaultRuntimeModule;
  }

  module(): MechanicsEffectGoModule {
    const payloads = this.declarations.map((declaration) => declaration.payload).filter(isRecord);
    const of = (kind: string): readonly JsonRecord[] => payloads.filter((payload) => payload["kind"] === kind);
    const schemas = of("SchemaDef");
    const errors = of("ErrorDef");
    const classes = of("ClassDef");
    const services = of("ServiceDef");
    const functions = of("FunctionDef");
    const constants = of("ValueDef");
    const operations = of("EffectDef");
    const layers = of("LayerDef");
    for (const payload of of("StreamDef")) throw new EffectGoUnsupportedError(`stream ${String(payload["name"])}`);

    const declared = new Set([...schemas, ...errors, ...classes].map((payload) => String(payload["name"])));
    const brands = inlineBrands(payloads).filter((brand) => !declared.has(brand.name));
    const claim = (name: string, suffix: string): string => {
      let candidate = exportedName(name);
      if (this.taken.has(candidate)) candidate = `${candidate}${suffix}`;
      let index = 2;
      const base = candidate;
      while (this.taken.has(candidate)) candidate = `${base}${index++}`;
      this.taken.add(candidate);
      return candidate;
    };
    for (const name of [...brands.map((brand) => brand.name), ...declared]) this.typeNames.set(name, claim(name, "Type"));
    for (const service of services) {
      const name = String(service["name"]);
      this.typeNames.set(name, claim(name, "Service"));
      this.taken.add(`${this.typeNames.get(name)!}Tag`);
    }
    for (const fn of functions) this.functionNames.set(String(fn["name"]), claim(String(fn["name"]), "Fn"));
    for (const operation of operations) this.functionNames.set(String(operation["name"]), claim(String(operation["name"]), "Op"));
    for (const constant of constants) this.constantNames.set(String(constant["name"]), claim(String(constant["name"]), "Value"));
    for (const layer of layers) this.layerNames.set(String(layer["name"]), claim(String(layer["name"]), "Layer"));
    for (const payload of [...schemas, ...classes]) {
      const type = typeFromJson(payload["schema"], this.info.env);
      if (type.kind === "struct") this.structSchemas.push({ name: String(payload["name"]), fields: type.fields });
    }

    const sections: string[][] = [];
    for (const brand of brands) sections.push(this.schemaLines(brand.name, brand.schema));
    for (const schema of schemas) sections.push(this.schemaLines(String(schema["name"]), schema["schema"] ?? null));
    for (const cls of classes) sections.push(this.schemaLines(String(cls["name"]), cls["schema"] ?? null));
    for (const error of errors) sections.push(this.errorLines(error));
    for (const service of services) sections.push(this.serviceLines(service));
    for (const fn of functions) sections.push(this.functionLines(fn));
    for (const operation of operations) sections.push(this.operationLines(operation));
    for (const constant of constants) sections.push(this.constantLines(constant));
    for (const layer of layers) sections.push(this.layerLines(layer));
    // Hoisted record types are discovered while generating bodies.
    const hoisted = [...this.hoisted.values()].map((record) => this.structLines(record.name, record.fields, `${record.name} is a record type no schema declares.`, record.types));

    const standard = (["strings", "time"] as const).filter((name) => this.imports.has(name)).map((name) => `\t"${name}"`);
    const runtime = ["effect", "forma", ...(this.options.runtimePackages ?? [])].filter((name) => this.imports.has(name as Import) || this.options.runtimePackages?.includes(name)).sort().map((name) => `\t"${this.runtimeModule}/${name}"`);
    const importLines = standard.length + runtime.length === 0 ? [] : ["import (", ...standard, ...(standard.length && runtime.length ? [""] : []), ...runtime, ")", ""];
    const header = [
      "// Code generated by Forma's effect-go prototype (RFC 0019). DO NOT EDIT.",
      "",
      `package ${this.options.packageName}`,
      "",
      ...importLines,
    ];
    const body = [...sections, ...hoisted].map((lines) => lines.join("\n")).join("\n\n");
    const code = binarySpacing(`${[...header, body].join("\n").trimEnd()}\n`);
    return {
      code,
      operationNames: operations.map((operation) => String(operation["name"])),
      naming: {
        declaration: (name) => this.typeNames.get(name) ?? this.layerNames.get(name) ?? this.constantNames.get(name) ?? exportedName(name),
        operation: (name) => {
          const goName = this.functionNames.get(name);
          if (!goName) throw new EffectGoUnsupportedError(`operation ${name}`);
          return goName;
        },
        type: (schema) => this.goType(typeFromJson(schema, this.info.env)),
        zero: (schema) => {
          const type = typeFromJson(schema, this.info.env);
          const resolved = resolve(type, this.info.env);
          const goType = this.goType(type);
          return resolved.kind === "struct" || type.kind === "error" || type.kind === "class" ? `${goType}{}` : `*new(${goType})`;
        },
      },
      declaredNames: new Set([...code.matchAll(/^(?:type|var|func|const) ([A-Za-z_]\w*)/gm), ...code.matchAll(/^\t([A-Z]\w*) +\w+ = /gm)].map((match) => match[1]!)),
    };
  }

  private use(name: Import): void {
    this.imports.add(name);
  }

  // -------------------------------------------------------------------------
  // Declarations
  // -------------------------------------------------------------------------

  private schemaLines(name: string, schema: JsonValue): string[] {
    const goName = this.typeNames.get(name)!;
    const type = typeFromJson(schema, this.info.env);
    if (type.kind === "struct") return this.structLines(goName, type.fields, `${goName} is the ${name} schema.`);
    if (type.kind === "brand") return [`// ${goName} is the ${type.name} brand: a distinct type over its base.`, `type ${goName} ${this.goType(type.base)}`];
    if (isRecord(schema) && schema["kind"] === "Brand") {
      return [`// ${goName} is the ${name} brand: a distinct type over its base.`, `type ${goName} ${this.goType(typeFromJson(schema["schema"], this.info.env))}`];
    }
    if (type.kind === "union" && type.members.every((member) => member.kind === "literal")) {
      const values = type.members.map((member) => (member as MType & { readonly kind: "literal" }).value);
      const base = values.every((value) => typeof value === "string") ? "string" : values.every((value) => typeof value === "number") ? "int64" : undefined;
      if (!base) throw new EffectGoUnsupportedError(`mixed literal union ${name}`);
      const constants = values.map((value) => [`${goName}${typeName(String(value))}`, `${goName} = ${JSON.stringify(value)}`] as const);
      return [`// ${goName} is the ${name} enum.`, `type ${goName} ${base}`, "", "const (", ...alignColumns(constants, "\t"), ")"];
    }
    if (type.kind === "literal") return [`type ${goName} ${typeof type.value === "string" ? "string" : "int64"}`];
    if (type.kind === "union") throw new EffectGoUnsupportedError(`union schema ${name}`);
    return [`// ${goName} is the ${name} schema.`, `type ${goName} = ${this.goType(type)}`];
  }

  /** A struct whose JSON tags carry Forma's field names: the wire encoding. */
  private structLines(goName: string, fields: readonly MField[], comment: string, types?: readonly string[]): string[] {
    const rows = fields.map((field, index) => [
      fieldName(field.name),
      types?.[index] ?? (field.optional ? this.optionType(field.type) : this.goType(field.type)),
      `\`json:"${field.name}${field.optional ? ",omitzero" : ""}"\``,
    ]);
    if (rows.length === 0) return [`// ${comment}`, `type ${goName} struct{}`];
    return [`// ${comment}`, `type ${goName} struct {`, ...alignColumns(rows, "\t"), "}"];
  }

  private optionType(type: MType): string {
    this.use("effect");
    return `effect.Option[${this.goType(type)}]`;
  }

  private errorLines(error: JsonRecord): string[] {
    const name = String(error["name"]);
    const goName = this.typeNames.get(name)!;
    const fields = this.info.errorFields.get(name) ?? [];
    this.use("forma");
    return [
      ...this.structLines(goName, fields, `${goName} is the ${name} error.`),
      "",
      `func (e ${goName}) Error() string {`,
      "\t// fields has no methods, so formatting it does not call Error again.",
      `\ttype fields ${goName}`,
      `\treturn forma.ErrorString(${JSON.stringify(name)}, fields(e))`,
      "}",
      "",
      "// Tag is the error's tag, as in Effect's tagged errors.",
      `func (${goName}) Tag() string {`,
      `\treturn ${JSON.stringify(name)}`,
      "}",
    ];
  }

  private serviceLines(service: JsonRecord): string[] {
    this.use("effect");
    const name = String(service["name"]);
    const goName = this.typeNames.get(name)!;
    const methods = this.info.services.get(name);
    const rows = [...(methods?.values() ?? [])].map((method) => {
      const effect = `effect.Effect[${this.goType(method.effect.success)}]`;
      if (method.value) return [fieldName(method.name), effect] as const;
      const params = method.params.map((param) => `${localName(param.name)} ${this.goType(param.type)}`).join(", ");
      return [fieldName(method.name), `func(${params}) ${effect}`] as const;
    });
    return [
      `// ${goName} is the ${name} service. Implementations are values of this`,
      "// struct; programs read the current one from the fiber's context.",
      `type ${goName} struct {`,
      ...alignColumns(rows, "\t"),
      "}",
      "",
      `// ${goName}Tag identifies the ${name} service in a context.`,
      `var ${goName}Tag = effect.NewTag[${goName}](${JSON.stringify(name)})`,
    ];
  }

  private functionLines(fn: JsonRecord): string[] {
    const name = String(fn["name"]);
    const signature = this.info.functions.get(name);
    if (!signature) throw new EffectGoUnsupportedError(`function ${name} has no signature`);
    this.rejectGeneric([...signature.params.map((param) => param.type), signature.result], name);
    const names = new Names(undefined, this.reservedLocals());
    const params = signature.params.map((param) => `${names.bind(param.name)} ${this.paramType(name, param)}`);
    const body = fn["body"];
    this.serviceVars = new Map();
    const forma = showType({ kind: "function", params: signature.params.map((param) => param.type), result: signature.result });
    const lines = [`// ${this.functionNames.get(name)!} is the pure function ${name} : ${forma}.`, `func ${this.functionNames.get(name)!}(${params.join(", ")}) ${this.goType(signature.result)} {`];
    lines.push(...this.valueReturn(body, names, "\t", signature.result), "}");
    return lines;
  }

  private constantLines(constant: JsonRecord): string[] {
    const name = String(constant["name"]);
    const type = this.info.constants.get(name);
    this.serviceVars = new Map();
    const value = this.value(constant["value"], new Names(undefined, this.reservedLocals()), "", type);
    return [`var ${this.constantNames.get(name)!}${type ? ` ${this.goType(type)}` : ""} = ${value}`];
  }

  private operationLines(operation: JsonRecord): string[] {
    this.use("effect");
    const name = String(operation["name"]);
    const signature = this.info.operations.get(name);
    if (!signature) throw new EffectGoUnsupportedError(`operation ${name} has no signature`);
    this.rejectGeneric([...signature.params.map((param) => param.type), signature.result.success], name);
    const names = new Names(undefined, this.reservedLocals());
    const params = signature.params.map((param) => `${names.bind(param.name)} ${this.paramType(name, param)}`);
    const success = this.goType(signature.result.success);
    const goName = this.functionNames.get(name)!;
    const body = operation["body"];
    const gen = this.genBlock(body, names, operation["value"] === true ? "" : "\t", success, this.servicesUsed(body));
    // Go's type keeps only the success type; the comment keeps the checked errors and requirements.
    const forma = signature.params.length === 0 ? showType(signature.result) : showType({ kind: "function", params: signature.params.map((param) => param.type), result: signature.result });
    const comment = `// ${goName} is the operation ${name} : ${forma}.`;
    if (operation["value"] === true) return [comment, `var ${goName} = ${gen}`];
    return [comment, `func ${goName}(${params.join(", ")}) effect.Effect[${success}] {`, `\treturn ${gen}`, "}"];
  }

  /** `effect.Gen(func(f *effect.Fiber) T { ... })` with the services the body reads bound first. */
  private genBlock(body: JsonValue | undefined, names: Names, indent: string, success: string, services: readonly string[] = []): string {
    this.use("effect");
    const saved = this.serviceVars;
    this.serviceVars = new Map(saved);
    const scope = names.child();
    const inner = `${indent}\t`;
    const lines: string[] = [];
    for (const service of services) {
      const variable = scope.bind(`service:${service}`, localName(service));
      this.serviceVars.set(service, variable);
      lines.push(`${inner}${variable} := ${this.typeNames.get(service)!}Tag.Get(f)`);
    }
    lines.push(...this.statements(body, scope, inner, "return", success));
    this.serviceVars = saved;
    return `effect.Gen(func(f *effect.Fiber) ${success} {\n${lines.join("\n")}\n${indent}})`;
  }

  private layerLines(layer: JsonRecord): string[] {
    this.use("effect");
    const name = String(layer["name"]);
    const goName = this.layerNames.get(name)!;
    const implementation = layer["implementation"];
    if (isRecord(implementation) && implementation["kind"] === "Compose") {
      return [`// ${goName} is the layer ${name}.`, `var ${goName} = ${this.layerExpression(implementation["layer"], name)}`];
    }
    if (!isRecord(implementation) || implementation["kind"] !== "Service") throw new EffectGoUnsupportedError(`layer ${name}`);
    const service = String(implementation["service"]);
    const serviceType = this.typeNames.get(service)!;
    const setup = arrayItems(implementation["setup"]).filter(isRecord);
    const methods = arrayItems(implementation["methods"]).filter(isRecord);
    const names = new Names(undefined, this.reservedLocals());
    const captured = this.servicesUsed([...setup.map((binding) => binding["value"] ?? null), ...methods.map((method) => method["body"] ?? null)]);
    const contextServices = this.info.layers.get(name)?.contextServices ?? [];
    this.serviceVars = new Map();
    const construction: string[] = [];
    for (const dependency of captured) {
      const variable = names.bind(`service:${dependency}`, localName(dependency));
      this.serviceVars.set(dependency, variable);
      construction.push(`\t${variable} := ${this.typeNames.get(dependency)!}Tag.Get(f)`);
    }
    this.contextVar = contextServices.length > 0 ? names.bind("context:layer", "services") : undefined;
    if (this.contextVar) construction.push(`\t${this.contextVar} := effect.CurrentContext(f)`);
    const later: Step[] = [
      ...bindingSteps(setup),
      ...methods.map((method) => ({ value: { kind: "Lambda", params: method["params"] ?? [], body: method["body"] ?? null } })),
    ];
    setup.forEach((binding, index) => construction.push(...this.bindingLines(binding, names, "\t", later.slice(index + 1))));
    const signatures = this.info.services.get(service);
    const indent = construction.length === 0 ? "\t" : "\t\t";
    const entries: string[] = [];
    for (const method of methods) {
      const signature = signatures?.get(String(method["name"]));
      if (!signature) throw new EffectGoUnsupportedError(`layer ${name} defines unknown method ${String(method["name"])}`);
      const success = this.goType(signature.effect.success);
      const scope = names.child();
      const params = stringItems(method["params"]).map((param, index) => `${scope.bind(param)} ${this.goType(signature.params[index]!.type)}`);
      const key = fieldName(String(method["name"]));
      if (signature.value) {
        entries.push(`${indent}${key}: ${this.effectExpression(method["body"], scope, indent, success)},`);
      } else {
        entries.push(
          `${indent}${key}: func(${params.join(", ")}) effect.Effect[${success}] {`,
          `${indent}\treturn ${this.effectExpression(method["body"], scope, `${indent}\t`, success)}`,
          `${indent}},`,
        );
      }
    }
    this.contextVar = undefined;
    const comment = `// ${goName} is the layer ${name}, providing ${service}.`;
    if (construction.length === 0) {
      return [comment, `var ${goName} = effect.LayerSucceed(${JSON.stringify(name)}, ${serviceType}Tag, ${serviceType}{`, ...entries, "})"];
    }
    return [
      comment,
      `var ${goName} = effect.LayerEffect(${JSON.stringify(name)}, ${serviceType}Tag, effect.Gen(func(f *effect.Fiber) ${serviceType} {`,
      ...construction,
      `\treturn ${serviceType}{`,
      ...entries,
      "\t}",
      "}))",
    ];
  }

  private layerExpression(expr: JsonValue | undefined, name: string): string {
    if (!isRecord(expr)) throw new EffectGoUnsupportedError("layer expression");
    switch (expr["kind"]) {
      case "LayerRef": {
        const target = this.layerNames.get(String(expr["name"]));
        if (!target) throw new EffectGoUnsupportedError(`layer reference ${String(expr["name"])}`);
        return target;
      }
      case "LayerMerge":
        return `effect.MergeAll(${JSON.stringify(name)}, ${arrayItems(expr["layers"]).map((item) => this.layerExpression(item, name)).join(", ")})`;
      case "LayerProvide":
      case "LayerProvideMerge": {
        const fn = expr["kind"] === "LayerProvide" ? "effect.ProvideLayer" : "effect.ProvideMergeLayer";
        const deps = arrayItems(expr["dependencies"]).map((item) => this.layerExpression(item, name));
        return `${fn}(${JSON.stringify(name)}, ${this.layerExpression(expr["layer"], name)}, ${deps.join(", ")})`;
      }
      default:
        throw new EffectGoUnsupportedError(`layer expression ${String(expr["kind"])}`);
    }
  }

  /** A parameter's Go type; a record no schema declares is named after the callable and parameter. */
  private paramType(callable: string, param: { readonly name: string; readonly type: MType }): string {
    this.nameHint = `${exportedName(callable)}${exportedName(param.name)}`;
    const type = this.goType(param.type);
    this.nameHint = undefined;
    return type;
  }

  private reservedLocals(): string[] {
    return [...runtimeNames, ...this.taken];
  }

  private rejectGeneric(types: readonly MType[], name: string): void {
    const hasVar = (type: MType): boolean =>
      type.kind === "var" || Object.values(type).some((value) =>
        Array.isArray(value)
          ? value.some((item) => isRecord(item) && ("kind" in item ? hasVar(item as unknown as MType) : "type" in item && hasVar(item["type"] as unknown as MType)))
          : isRecord(value) && "kind" in value && hasVar(value as unknown as MType));
    if (types.some(hasVar)) throw new EffectGoUnsupportedError(`generic signature of ${name}`);
  }

  // -------------------------------------------------------------------------
  // Effect bodies
  // -------------------------------------------------------------------------

  /** Statements of a Gen body whose result type is `success`. */
  private statements(node: JsonValue | undefined, names: Names, indent: string, mode: Mode, success: string): string[] {
    if (!isRecord(node)) throw new EffectGoUnsupportedError("missing effect body");
    const done = mode === "return" && success === "effect.Unit" ? [`${indent}return effect.Unit{}`] : [];
    switch (node["kind"]) {
      case "Succeed":
      case "Pure": {
        if (node["kind"] === "Pure" && this.isEffectValue(node["value"])) {
          return this.awaitStatement(this.value(node["value"], names, indent), indent, mode);
        }
        if (mode === "discard") return [];
        if (isUnitLiteral(node["value"])) return [`${indent}return effect.Unit{}`];
        return this.valueReturn(node["value"], names, indent, this.successType(node));
      }
      case "Do":
      case "Let": {
        const lines: string[] = [];
        const scope = names.child();
        const bindings = arrayItems(node["bindings"]).filter(isRecord);
        const steps = [...bindingSteps(bindings), { value: node["body"] ?? null }, { value: node["forms"] ?? null }];
        bindings.forEach((binding, index) => lines.push(...this.bindingLines(binding, scope, indent, steps.slice(index + 1))));
        if (node["body"] !== undefined) {
          lines.push(...this.statements(node["body"], scope, indent, mode, success));
        } else {
          const forms = arrayItems(node["forms"]);
          forms.forEach((form, index) => lines.push(...this.statements(form, scope, indent, index === forms.length - 1 ? mode : "discard", success)));
          if (forms.length === 0) lines.push(...done);
        }
        return lines;
      }
      case "Bind":
        return this.statements(node["value"], names, indent, mode, success);
      case "If":
        return [
          `${indent}if ${this.value(node["condition"], names, indent)} {`,
          ...this.statements(node["then"], names.child(), `${indent}\t`, mode, success),
          `${indent}} else {`,
          ...this.statements(node["else"], names.child(), `${indent}\t`, mode, success),
          `${indent}}`,
        ];
      case "When":
      case "Unless": {
        const condition = this.value(node["condition"], names, indent);
        return [
          `${indent}if ${node["kind"] === "Unless" ? negate(condition) : condition} {`,
          ...this.statements(node["body"], names.child(), `${indent}\t`, "discard", "effect.Unit"),
          `${indent}}`,
          ...done,
        ];
      }
      case "Cond": {
        const lines: string[] = [];
        let hasElse = false;
        arrayItems(node["clauses"]).filter(isRecord).forEach((clause, index) => {
          if (isElseCondition(clause["condition"])) {
            hasElse = true;
            lines.push(index === 0 ? `${indent}{` : `${indent}} else {`);
          } else {
            lines.push(`${index === 0 ? indent : `${indent}} else `}if ${this.value(clause["condition"], names, indent)} {`);
          }
          lines.push(...this.statements(clause["body"], names.child(), `${indent}\t`, mode, success));
        });
        lines.push(`${indent}}`);
        if (!hasElse) lines.push(...done);
        return lines;
      }
      case "Match":
        return this.matchStatements(node, names, indent, mode, success);
      case "Fail":
        return this.awaitStatement(this.failExpression(node, names, indent, mode === "return" ? success : "effect.Unit"), indent, mode);
      default:
        return this.awaitStatement(this.effectExpression(node, names, indent, mode === "return" ? success : this.successType(node)), indent, mode);
    }
  }

  private awaitStatement(effect: string, indent: string, mode: Mode): string[] {
    return [`${indent}${mode === "return" ? "return " : ""}effect.Await(f, ${effect})`];
  }

  private bindingLines(binding: JsonRecord, names: Names, indent: string, rest: readonly Step[]): string[] {
    const name = typeof binding["name"] === "string" ? binding["name"] : "_";
    const value = binding["value"];
    const used = name !== "_" && referencedIn(rest, name);
    const pure = isRecord(value) && (value["kind"] === "Pure" || value["kind"] === "Succeed") && !this.isEffectValue(value["value"]);
    if (pure) {
      if (!used) return [];
      const inner = isRecord(value) ? value["value"] : undefined;
      this.nameHint = `${exportedName(name)}Record`;
      const type = this.successType(value);
      const code = this.value(inner, names, indent, type);
      this.nameHint = undefined;
      return [`${indent}${names.bind(name)} := ${this.typedLiteral(inner, code, type)}`];
    }
    if (!used && isRecord(value) && ["If", "When", "Unless", "Cond", "Match"].includes(String(value["kind"]))) {
      return this.statements(value, names, indent, "discard", "effect.Unit");
    }
    this.nameHint = `${exportedName(name)}Record`;
    const success = this.successType(value);
    const effect = isRecord(value) && value["kind"] === "Fail" ? this.failExpression(value, names, indent, success) : this.effectExpression(value, names, indent, success);
    this.nameHint = undefined;
    if (!used) return [`${indent}effect.Await(f, ${effect})`];
    return [`${indent}${names.bind(name)} := effect.Await(f, ${effect})`];
  }

  /** `:=` gives untyped numeric constants Go's default type, so state the Forma type. */
  private typedLiteral(node: JsonValue | undefined, code: string, type: string): string {
    if (isRecord(node) && node["kind"] === "Literal" && typeof node["value"] === "number") return `${type}(${code})`;
    return code;
  }

  /** `return value`, with value-level `let` bindings as statements. */
  private valueReturn(node: JsonValue | undefined, names: Names, indent: string, type: MType | string | undefined): string[] {
    if (isRecord(node) && node["kind"] === "List" && this.info.calls.get(node)?.kind === "special") {
      const call = this.info.calls.get(node) as { readonly name: string };
      if (call.name === "let") {
        const [bindingsNode, result] = arrayItems(node["items"]).slice(1);
        const scope = names.child();
        const pairs = isRecord(bindingsNode) ? arrayItems(bindingsNode["items"]) : [];
        const steps = [...letSteps(pairs), { value: result ?? null }];
        const lines: string[] = [];
        letSteps(pairs).forEach((step, index) => {
          if (step.binds === undefined || !referencedIn(steps.slice(index + 1), step.binds)) return;
          const valueType = isRecord(step.value) ? this.info.valueTypes.get(step.value) : undefined;
          const code = this.value(step.value, scope, indent, valueType);
          lines.push(`${indent}${scope.bind(step.binds)} := ${valueType ? this.typedLiteral(step.value, code, this.goType(valueType)) : code}`);
        });
        return [...lines, ...this.valueReturn(result, scope, indent, type)];
      }
    }
    return [`${indent}return ${this.value(node, names, indent, type)}`];
  }

  /** The Go success type of an effect node, from the checker. */
  private successType(node: JsonValue | undefined): string {
    const type = isRecord(node) ? this.info.effectTypes.get(node) : undefined;
    if (!type) throw new EffectGoUnsupportedError(`unchecked effect ${isRecord(node) ? String(node["kind"]) : ""}`);
    return type.success.kind === "never" ? "effect.Unit" : this.goType(type.success);
  }

  private failExpression(node: JsonRecord, names: Names, indent: string, success: string): string {
    this.use("effect");
    return `effect.Fail[${success}](${this.errorValue(node["error"], names, indent)})`;
  }

  /** A Go expression of type `effect.Effect[success]`. */
  private effectExpression(node: JsonValue | undefined, names: Names, indent: string, success: string): string {
    if (!isRecord(node)) throw new EffectGoUnsupportedError("missing effect");
    this.use("effect");
    switch (node["kind"]) {
      case "ServiceCall": {
        const service = String(node["service"]);
        const method = String(node["method"]);
        const callee = `${this.serviceVar(service)}.${fieldName(method)}`;
        if (node["value"] === true) return callee;
        const params = this.info.services.get(service)?.get(method)?.params ?? [];
        return `${callee}(${this.args(node["args"], params.map((param) => param.type), names, indent)})`;
      }
      case "OperationCall": {
        const operation = String(node["operation"]);
        const params = this.info.operations.get(operation)?.params ?? [];
        const goName = this.functionNames.get(operation)!;
        const call = this.info.operations.get(operation) && arrayItems(node["args"]).length === 0 && this.isValueOperation(operation)
          ? goName
          : `${goName}(${this.args(node["args"], params.map((param) => param.type), names, indent)})`;
        return this.withContext(node, call);
      }
      case "Succeed":
      case "Pure":
        if (node["kind"] === "Pure" && this.isEffectValue(node["value"])) return this.value(node["value"], names, indent);
        if (isUnitLiteral(node["value"])) return "effect.Void";
        return `effect.Succeed[${success}](${this.value(node["value"], names, indent, success)})`;
      case "Fail":
        return this.failExpression(node, names, indent, success);
      case "Bind":
        return this.effectExpression(node["value"], names, indent, success);
      case "Catch":
        return `effect.CatchTag(${this.effectExpression(node["body"], names, indent, success)}, ${this.handler(String(node["errorType"]), String(node["binding"]), node["handler"], names, indent, success)})`;
      case "CatchAll": {
        const scope = names.child();
        const binding = String(node["binding"]);
        const param = binding !== "_" && freeIn(node["handler"], binding) ? scope.bind(binding) : "_";
        return `effect.Catch(${this.effectExpression(node["body"], names, indent, success)}, func(${param} error) effect.Effect[${success}] {\n${indent}\treturn ${this.effectExpression(node["handler"], scope, `${indent}\t`, success)}\n${indent}})`;
      }
      case "CatchTags": {
        const handlers = arrayItems(node["handlers"]).filter(isRecord);
        let effect = this.effectExpression(node["body"], names, indent, success);
        if (handlers.some((handler) => handler["errorType"] === "_")) throw new EffectGoUnsupportedError("catch-all arm in catch");
        for (const handler of handlers) {
          effect = `effect.CatchTag(${effect}, ${this.handler(String(handler["errorType"]), String(handler["binding"]), handler["handler"], names, indent, success)})`;
        }
        return effect;
      }
      case "Combinator":
        return this.combinator(node, names, indent, success);
      case "Do":
      case "Let":
      case "If":
      case "When":
      case "Unless":
      case "Cond":
      case "Match":
        return this.genBlock(node, names, indent, success);
      default:
        throw new EffectGoUnsupportedError(`effect ${String(node["kind"])}`);
    }
  }

  private isValueOperation(name: string): boolean {
    return this.declarations.some((declaration) => isRecord(declaration.payload) && declaration.payload["kind"] === "EffectDef" && declaration.payload["name"] === name && declaration.payload["value"] === true);
  }

  private handler(errorType: string, binding: string, handler: JsonValue | undefined, names: Names, indent: string, success: string): string {
    const scope = names.child();
    const param = binding !== "_" && freeIn(handler, binding) ? scope.bind(binding) : "_";
    return `func(${param} ${this.errorTypeName(errorType)}) effect.Effect[${success}] {\n${indent}\treturn ${this.effectExpression(handler, scope, `${indent}\t`, success)}\n${indent}}`;
  }

  private errorTypeName(name: string): string {
    if (name === "TimeoutError") return "effect.TimeoutError";
    const goName = this.typeNames.get(name);
    if (!goName) throw new EffectGoUnsupportedError(`error ${name}`);
    return goName;
  }

  private withContext(node: JsonRecord, call: string): string {
    if (!this.contextVar || !this.info.contextCalls.has(node)) return call;
    return `effect.ProvideContext(${call}, ${this.contextVar})`;
  }

  private combinator(node: JsonRecord, names: Names, indent: string, success: string): string {
    const name = String(node["name"]);
    const args = arrayItems(node["args"]);
    const effectType = this.info.effectTypes.get(node);
    const option = (key: string): JsonValue | undefined =>
      arrayItems(node["options"]).find((entry) => isRecord(entry) && entry["key"] === key) as JsonValue | undefined;
    const optionValue = (key: string): JsonValue | undefined => {
      const entry = option(key);
      return isRecord(entry) ? entry["value"] : undefined;
    };
    const effectArg = (index: number, type = this.successType(args[index])): string => this.effectExpression(args[index], names, indent, type);
    const concurrency = (): string => {
      const setting = optionValue("concurrency");
      if (setting === undefined) return "effect.Sequential";
      if (keywordName(setting) === "unbounded") return "effect.Unbounded";
      const code = this.value(setting, names, indent);
      return isRecord(setting) && setting["kind"] === "Literal" ? code : `int(${code})`;
    };
    switch (name) {
      case "scoped":
        return `effect.Scoped(${effectArg(0, success)})`;
      case "ensuring":
        return `effect.Ensuring(${effectArg(0, success)}, ${effectArg(1, "effect.Unit")})`;
      case "add-finalizer":
        return `effect.AddFinalizer(func(effect.ExitAny) effect.Effect[effect.Unit] {\n${indent}\treturn ${this.effectExpression(args[0], names, `${indent}\t`, "effect.Unit")}\n${indent}})`;
      case "acquire-release": {
        const release = args[1];
        if (!isRecord(release) || release["kind"] !== "Lambda") throw new EffectGoUnsupportedError("acquire-release without (fn [resource] ...)");
        const scope = names.child();
        const [param] = stringItems(release["params"]);
        const resource = param !== undefined && freeIn(release["body"], param) ? scope.bind(param) : "_";
        return `effect.AcquireRelease(${effectArg(0, success)}, func(${resource} ${success}, _ effect.ExitAny) effect.Effect[effect.Unit] {\n${indent}\treturn ${this.effectExpression(release["body"], scope, `${indent}\t`, "effect.Unit")}\n${indent}})`;
      }
      case "all": {
        const collection = args[0];
        if (!isRecord(collection)) throw new EffectGoUnsupportedError("all");
        const items = collection["kind"] === "EffectRecord"
          ? arrayItems(collection["entries"]).filter(isRecord).map((entry) => ({ key: String(entry["key"]), value: entry["value"] }))
          : arrayItems(collection["items"]).map((value) => ({ key: undefined, value }));
        if (items.length < 2 || items.length > 3) throw new EffectGoUnsupportedError(`all over ${items.length} effects`);
        const types = items.map((item) => this.successType(item.value));
        const effects = items.map((item, index) => this.effectExpression(item.value, names, indent, types[index]!));
        const tuple = `effect.All${items.length}(${effects.join(", ")}, ${concurrency()})`;
        if (collection["kind"] !== "EffectRecord") return tuple;
        // A record of effects becomes a tuple converted to the record type.
        const fields = items.map((item, index) => `${fieldName(item.key!)}: t.V${index + 1}`);
        return `effect.Map(${tuple}, func(t effect.Tuple${items.length}[${types.join(", ")}]) ${success} {\n${indent}\treturn ${success}{${fields.join(", ")}}\n${indent}})`;
      }
      case "for-each": {
        const fn = args[1];
        if (!isRecord(fn) || fn["kind"] !== "Lambda") throw new EffectGoUnsupportedError("for-each without (fn [item] ...)");
        const listType = isRecord(args[0]) ? this.info.valueTypes.get(args[0]) : undefined;
        const itemType = listType?.kind === "array" ? this.goType(listType.item) : undefined;
        const item = success.startsWith("[]") ? success.slice(2) : undefined;
        if (!itemType || !item) throw new EffectGoUnsupportedError("for-each types");
        const scope = names.child();
        const [param] = stringItems(fn["params"]);
        const bound = param !== undefined ? scope.bind(param) : "_";
        return `effect.ForEach(${this.value(args[0], names, indent)}, func(${bound} ${itemType}) effect.Effect[${item}] {\n${indent}\treturn ${this.effectExpression(fn["body"], scope, `${indent}\t`, item)}\n${indent}}, ${concurrency()})`;
      }
      case "race":
        return `effect.Race(${effectArg(0, success)}, ${effectArg(1, success)})`;
      case "fork": {
        const inner = effectType?.success.kind === "fiber" ? this.goType(effectType.success.success) : this.successType(args[0]);
        return `effect.Fork(${effectArg(0, inner)})`;
      }
      case "join":
        return `${this.value(args[0], names, indent)}.Join()`;
      case "interrupt":
        return `effect.As(${this.value(args[0], names, indent)}.Interrupt(), effect.Unit{})`;
      case "sleep":
        return `effect.Sleep(${this.duration(args[0], names, indent)})`;
      case "timeout":
        return `effect.Timeout(${effectArg(0, success)}, ${this.duration(args[1], names, indent)})`;
      case "retry":
      case "repeat": {
        const fields: string[] = [];
        const times = optionValue("times");
        if (times !== undefined) fields.push(`Times: ${this.value(times, names, indent)}`);
        const schedule = optionValue("schedule");
        if (schedule !== undefined) fields.push(`Schedule: ${this.value(schedule, names, indent)}`);
        return `effect.${name === "retry" ? "Retry" : "Repeat"}(${effectArg(0, success)}, effect.Policy{${fields.join(", ")}})`;
      }
      case "or-else-succeed":
        return `effect.OrElseSucceed(${effectArg(0, success)}, func() ${success} {\n${indent}\treturn ${this.value(args[1], names, `${indent}\t`, success)}\n${indent}})`;
      case "or-die":
        return `effect.OrDie(${effectArg(0, success)})`;
      case "map-error": {
        // Go has no error unions: the mapping function is error → error.
        const fn = args[1];
        const items = isRecord(fn) ? arrayItems(fn["items"]) : [];
        const params = isRecord(items[1]) ? arrayItems(items[1]["items"]) : [];
        if (!isFnLiteral(fn) || params.length !== 1) throw new EffectGoUnsupportedError("map-error without (fn [error] ...)");
        const scope = names.child();
        const paramName = isRecord(params[0]) ? String(params[0]["name"]) : "_";
        const bound = freeIn(items[2], paramName) ? scope.bind(paramName) : "_";
        return `effect.MapError(${effectArg(0, success)}, func(${bound} error) error {\n${indent}\treturn ${this.value(items[2], scope, `${indent}\t`)}\n${indent}})`;
      }
      case "option": {
        const inner = success.match(/^effect\.Option\[(.*)\]$/)?.[1];
        if (!inner) throw new EffectGoUnsupportedError("option types");
        return `effect.ToOption(${effectArg(0, inner)})`;
      }
      case "provide": {
        const layer = args[1];
        const layerName = isRecord(layer) && layer["kind"] === "Var" ? this.layerNames.get(String(layer["name"])) : undefined;
        if (!layerName) throw new EffectGoUnsupportedError("provide without a layer name");
        const services = this.servicesUsed(args[0]);
        const provided = services.length === 0 ? effectArg(0, success) : this.genBlock(args[0], names, indent, success, services);
        return this.withContext(node, `effect.Provide(${provided}, ${layerName})`);
      }
      case "log":
        return `effect.Log(${args.map((arg) => this.value(arg, names, indent)).join(", ")})`;
      case "ref-make": {
        const type = effectType?.success;
        const item = type?.kind === "ref" ? this.goType(type.item) : undefined;
        if (!item) throw new EffectGoUnsupportedError("ref-make type");
        return `effect.MakeRef[${item}](${this.value(args[0], names, indent, type?.kind === "ref" ? type.item : undefined)})`;
      }
      case "ref-get":
        return `${this.value(args[0], names, indent)}.Get()`;
      case "ref-set": {
        const refType = isRecord(args[0]) ? this.info.valueTypes.get(args[0]) : undefined;
        return `${this.value(args[0], names, indent)}.Set(${this.value(args[1], names, indent, refType?.kind === "ref" ? refType.item : undefined)})`;
      }
      case "ref-update":
        return `${this.value(args[0], names, indent)}.Update(${this.value(args[1], names, indent)})`;
      default:
        throw new EffectGoUnsupportedError(`combinator ${name}`);
    }
  }

  /** Durations are `time.Duration`; plain numbers are milliseconds, as in Effect. */
  private duration(node: JsonValue | undefined, names: Names, indent: string): string {
    const type = isRecord(node) ? this.info.valueTypes.get(node) : undefined;
    const code = this.value(node, names, indent);
    if (type && resolve(type, this.info.env).kind === "prim" && (resolve(type, this.info.env) as { readonly name: string }).name === "Duration") return code;
    this.use("forma");
    return `forma.Millis(${this.asFloat(node, names, indent)})`;
  }

  /** A number as float64: Int values need a conversion, untyped literals do not. */
  private asFloat(node: JsonValue | undefined, names: Names, indent: string): string {
    const code = this.value(node, names, indent);
    const type = isRecord(node) ? this.info.valueTypes.get(node) : undefined;
    const literal = isRecord(node) && node["kind"] === "Literal";
    return !literal && type && this.goType(type) === "int64" ? `float64(${code})` : code;
  }

  private matchStatements(node: JsonRecord, names: Names, indent: string, mode: Mode, success: string): string[] {
    const shape = this.info.matches.get(node);
    if (!shape) throw new EffectGoUnsupportedError("unchecked match");
    const subject = this.value(node["value"], names, indent);
    const arms = arrayItems(node["arms"]).filter(isRecord).map((arm) => ({ pattern: parsePattern(arm["pattern"], shape.kind), body: arm["body"] }));
    const armFor = (tag: string) => arms.find((arm) => arm.pattern?.tag === tag) ?? arms.find((arm) => arm.pattern?.tag === "_");
    const done = mode === "return" && success === "effect.Unit" ? [`${indent}\treturn effect.Unit{}`] : [];
    if (shape.kind === "option") {
      const some = armFor("some");
      const none = armFor("none");
      const scope = names.child();
      const binding = some?.pattern?.binding;
      const bound = binding && binding !== "_" && freeIn(some?.body, binding) ? scope.bind(binding) : undefined;
      const someLines = some ? this.statements(some.body, scope, `${indent}\t`, mode, success) : done;
      const noneLines = none ? this.statements(none.body, names.child(), `${indent}\t`, mode, success) : done;
      return [
        bound ? `${indent}if ${bound}, ok := ${subject}.Get(); ok {` : `${indent}if ${subject}.IsSome() {`,
        ...someLines,
        `${indent}} else {`,
        ...noneLines,
        `${indent}}`,
      ];
    }
    if (shape.kind === "literal") {
      const lines = [`${indent}switch ${subject} {`];
      let hasDefault = false;
      for (const arm of arms) {
        const tag = arm.pattern?.tag;
        if (tag === undefined) continue;
        if (tag === "_") hasDefault = true;
        lines.push(tag === "_" ? `${indent}default:` : `${indent}case ${JSON.stringify(arm.pattern?.value ?? tag)}:`);
        lines.push(...this.statements(arm.body, names.child(), `${indent}\t`, mode, success));
      }
      // The checker proved the match exhaustive; Go needs a default to see that.
      if (!hasDefault && mode === "return") lines.push(`${indent}default:`, `${indent}\tpanic("unreachable: match is exhaustive")`);
      lines.push(`${indent}}`);
      return lines;
    }
    throw new EffectGoUnsupportedError(`match on ${shape.kind}`);
  }

  private errorValue(error: JsonValue | undefined, names: Names, indent: string): string {
    if (typeof error === "string") return `${this.errorTypeName(error)}{}`;
    if (isRecord(error) && error["kind"] === "Error") return this.newError(String(error["errorType"]), error["payload"], names, indent);
    return this.value(error, names, indent);
  }

  private newError(name: string, payload: JsonValue | undefined, names: Names, indent: string): string {
    const goName = this.errorTypeName(name);
    if (payload === undefined || name === "TimeoutError") return `${goName}{}`;
    return `${goName}{${this.recordFields(payload, this.info.errorFields.get(name) ?? [], names, indent)}}`;
  }

  private serviceVar(service: string): string {
    const variable = this.serviceVars.get(service);
    if (!variable) throw new EffectGoUnsupportedError(`service ${service} is not in scope`);
    return variable;
  }

  private servicesUsed(node: JsonValue | undefined): readonly string[] {
    const services = new Set<string>();
    const visit = (item: JsonValue | undefined): void => {
      if (Array.isArray(item)) {
        item.forEach(visit);
        return;
      }
      if (!isRecord(item)) return;
      if (item["kind"] === "ServiceCall" && typeof item["service"] === "string") services.add(item["service"]);
      const call = this.info.calls.get(item);
      if (call?.kind === "service") services.add(call.service);
      if (item["kind"] === "Combinator" && item["name"] === "provide") {
        arrayItems(item["args"]).slice(1).forEach(visit);
        return;
      }
      for (const [key, value] of Object.entries(item)) if (key !== "span" && key !== "effect") visit(value);
    };
    visit(node);
    return [...services].sort();
  }

  private isEffectValue(value: JsonValue | undefined): boolean {
    return isRecord(value) && this.info.valueTypes.get(value)?.kind === "effect";
  }

  // -------------------------------------------------------------------------
  // Values
  // -------------------------------------------------------------------------

  /** Arguments to parameters of known types; brands passed as their base are converted. */
  private args(args: JsonValue | undefined, params: readonly MType[], names: Names, indent: string): string {
    return arrayItems(args).map((arg, index) => this.coerced(arg, params[index], names, indent)).join(", ");
  }

  /**
   * A value used where `target` is expected. Forma lets a brand or an enum
   * stand for its base type; Go needs a conversion.
   */
  private coerced(node: JsonValue | undefined, target: MType | undefined, names: Names, indent: string): string {
    const code = this.value(node, names, indent, target);
    const source = isRecord(node) ? this.info.valueTypes.get(node) : undefined;
    if (!source || !target) return code;
    const base = this.baseOf(source);
    const wanted = resolve(target, this.info.env);
    return base !== undefined && wanted.kind === "prim" && this.goType(wanted) === base ? `${base}(${code})` : code;
  }

  /** The Go base type of a brand or a named literal union, if the type is one. */
  private baseOf(type: MType): string | undefined {
    if (type.kind === "brand") return this.goType(type.base);
    if (type.kind === "named") {
      const resolved = resolve(type, this.info.env);
      if (resolved.kind === "brand") return this.goType(resolved.base);
      if (resolved.kind === "union" && resolved.members.every((member) => member.kind === "literal")) {
        return resolved.members.every((member) => typeof (member as { readonly value: unknown }).value === "string") ? "string" : "int64";
      }
    }
    return undefined;
  }

  private value(node: JsonValue | undefined, names: Names, indent: string, expected?: MType | string): string {
    if (!isRecord(node)) throw new EffectGoUnsupportedError("missing value");
    switch (node["kind"]) {
      case "Literal": {
        const value = node["value"];
        if (value === null) return "effect.Unit{}";
        if (typeof value === "string") return goString(value);
        return String(value);
      }
      case "Var":
        return this.variable(node, names, expected);
      case "Expr": {
        const keyword = keywordName(node);
        if (keyword !== undefined) return goString(keyword);
        const source = node["source"];
        if (isRecord(source) && source["kind"] === "Nil") return "effect.Unit{}";
        throw new EffectGoUnsupportedError(`expression ${JSON.stringify(source)}`);
      }
      case "Record":
        return this.recordLiteral(node, names, indent, expected);
      case "Vector": {
        const type = this.info.valueTypes.get(node);
        const target = typeof expected === "object" ? resolve(expected, this.info.env) : type;
        if (target?.kind === "tuple") {
          const items = arrayItems(node["items"]).map((item, index) => `V${index + 1}: ${this.coerced(item, target.items[index], names, indent)}`);
          return `${this.goType(target)}{${items.join(", ")}}`;
        }
        const item = target?.kind === "array" ? target.item : undefined;
        return `${target ? this.goType(target) : "[]any"}{${arrayItems(node["items"]).map((element) => this.coerced(element, item, names, indent)).join(", ")}}`;
      }
      case "List":
        return this.application(node, names, indent, expected);
      default:
        throw new EffectGoUnsupportedError(`value ${String(node["kind"])}`);
    }
  }

  private variable(node: JsonRecord, names: Names, expected?: MType | string): string {
    const name = String(node["name"]);
    const local = names.lookup(name);
    if (local) return local;
    const call = this.info.calls.get(node);
    if (call?.kind === "builtin") throw new EffectGoUnsupportedError(`builtin ${call.name} used as a value`);
    switch (name) {
      case "nil":
        return "effect.Unit{}";
      case "true":
      case "false":
        return name;
      case "none":
      case "None": {
        const type = typeof expected === "object" ? resolve(expected, this.info.env) : this.info.valueTypes.get(node);
        if (type?.kind !== "option") throw new EffectGoUnsupportedError("None without an option type");
        return `effect.None[${this.goType(type.item)}]()`;
      }
      default:
        break;
    }
    const goName = this.layerNames.get(name) ?? this.functionNames.get(name) ?? this.constantNames.get(name);
    if (goName) return goName;
    throw new EffectGoUnsupportedError(`unbound name ${name}`);
  }

  /** A struct literal for a record: the declared schema it matches, or a hoisted type. */
  private recordLiteral(node: JsonRecord, names: Names, indent: string, expected?: MType | string): string {
    const declaredTarget = this.info.recordTargets.get(node);
    const checked = this.info.valueTypes.get(node);
    const target = declaredTarget ?? (typeof expected === "object" && resolve(expected, this.info.env).kind === "struct" ? expected : checked);
    if (!target) throw new EffectGoUnsupportedError("unchecked record");
    const resolved = resolve(target, this.info.env);
    if (resolved.kind === "map") {
      this.use("forma");
      const entries = arrayItems(node["entries"]).filter(isRecord);
      let code = `forma.EmptyMap[${this.goType(resolved.value)}]()`;
      for (const entry of entries) code += `.Assoc(${goString(recordKey(entry["key"]) ?? "")}, ${this.coerced(entry["value"], resolved.value, names, indent)})`;
      return code;
    }
    if (resolved.kind !== "struct") throw new EffectGoUnsupportedError(`record of type ${resolved.kind}`);
    const typeName = this.goType(target);
    return `${typeName}{${this.recordFields(node, resolved.fields, names, indent)}}`;
  }

  private recordFields(node: JsonValue | undefined, fields: readonly MField[], names: Names, indent: string): string {
    if (!isRecord(node) || node["kind"] !== "Record") throw new EffectGoUnsupportedError("record payload");
    return arrayItems(node["entries"]).filter(isRecord).map((entry) => {
      const key = recordKey(entry["key"]);
      if (key === undefined) throw new EffectGoUnsupportedError("record key");
      const field = fields.find((candidate) => candidate.name === key);
      const value = this.coerced(entry["value"], field?.type, names, indent);
      return `${fieldName(key)}: ${field?.optional ? `effect.Some(${value})` : value}`;
    }).join(", ");
  }

  private application(node: JsonRecord, names: Names, indent: string, expected?: MType | string): string {
    const call = this.info.calls.get(node);
    const items = arrayItems(node["items"]);
    const args = items.slice(1);
    if (!call) throw new EffectGoUnsupportedError(`unchecked application ${JSON.stringify(items[0])}`);
    const type = this.info.valueTypes.get(node);
    switch (call.kind) {
      case "builtin":
        return this.builtin(call.name, args, names, indent, type);
      case "arithmetic":
        return this.arithmetic(call.operator, args, names, indent, type);
      case "equality": {
        // A brand compared with its base type is compared as the base.
        const [left, right] = args.map((arg) => {
          const argType = isRecord(arg) ? this.info.valueTypes.get(arg) : undefined;
          const base = argType ? this.baseOf(argType) : undefined;
          const others = args.filter((other) => other !== arg).map((other) => isRecord(other) ? this.info.valueTypes.get(other) : undefined);
          const mixed = base !== undefined && others.some((other) => other?.kind === "prim");
          return mixed ? `${base}(${this.value(arg, names, indent)})` : this.operand(arg, names, indent);
        });
        return `${left} ${call.operator === "=" ? "==" : "!="} ${right}`;
      }
      case "special":
        return this.special(call.name, node, args, names, indent, expected);
      case "get": {
        const target = this.operand(args[0], names, indent);
        if (call.access === "map") return `${target}.Get(${this.coerced(args[1], { kind: "prim", name: "String" }, names, indent)})`;
        return `${target}.${fieldName(recordKey(args[1]) ?? "")}`;
      }
      case "assoc": {
        const target = this.value(args[0], names, indent);
        if (call.access === "map") {
          const mapType = type ? resolve(type, this.info.env) : undefined;
          return `${target}.Assoc(${this.coerced(args[1], { kind: "prim", name: "String" }, names, indent)}, ${this.coerced(args[2], mapType?.kind === "map" ? mapType.value : undefined, names, indent)})`;
        }
        this.use("forma");
        const goType = type ? this.goType(type) : "any";
        const resolved = type ? resolve(type, this.info.env) : undefined;
        const key = recordKey(args[1]) ?? "";
        const field = resolved?.kind === "struct" ? resolved.fields.find((candidate) => candidate.name === key) : undefined;
        const value = this.coerced(args[2], field?.type, names, indent);
        return `forma.With(${target}, func(r *${goType}) { r.${fieldName(key)} = ${field?.optional ? `effect.Some(${value})` : value} })`;
      }
      case "error":
        return this.newError(call.name, args[0], names, indent);
      case "brand":
        return `${this.typeNames.get(call.name)!}(${this.value(args[0], names, indent)})`;
      case "class":
      case "construct":
        return this.value(args[0], names, indent, type);
      case "function": {
        const params = this.info.functions.get(call.name)?.params ?? [];
        return `${this.functionNames.get(call.name)!}(${this.args(args, params.map((param) => param.type), names, indent)})`;
      }
      case "operation": {
        const params = this.info.operations.get(call.name)?.params ?? [];
        return this.withContext(node, `${this.functionNames.get(call.name)!}(${this.args(args, params.map((param) => param.type), names, indent)})`);
      }
      case "service": {
        const params = this.info.services.get(call.service)?.get(call.method)?.params ?? [];
        return `${this.serviceVar(call.service)}.${fieldName(call.method)}(${this.args(args, params.map((param) => param.type), names, indent)})`;
      }
      case "local":
        return `${names.lookup(call.name) ?? localName(call.name)}(${args.map((arg) => this.value(arg, names, indent)).join(", ")})`;
      default:
        throw new EffectGoUnsupportedError(`${call.kind} application`);
    }
  }

  /** An operand of a binary operator: parenthesized unless it is atomic. */
  private operand(node: JsonValue | undefined, names: Names, indent: string): string {
    const code = this.value(node, names, indent);
    return /^[\w.]+(\(.*\))?$/.test(code) || /^"([^"\\]|\\.)*"$/.test(code) ? code : `(${code})`;
  }

  private arithmetic(operator: string, args: readonly JsonValue[], names: Names, indent: string, type: MType | undefined): string {
    const int = type !== undefined && this.goType(type) === "int64";
    const operands = args.map((arg) => this.value(arg, names, indent));
    if (operator === "max" || operator === "min") return `${operator}(${operands.join(", ")})`;
    if (operands.length === 1 && operator === "-") return int ? `forma.IntSub(0, ${operands[0]})` : `-${this.operand(args[0], names, indent)}`;
    if (int) {
      this.use("forma");
      const fn = { "+": "forma.IntAdd", "-": "forma.IntSub", "*": "forma.IntMul" }[operator];
      if (!fn) throw new EffectGoUnsupportedError(`Int operator ${operator}`);
      return operands.slice(1).reduce((left, right) => `${fn}(${left}, ${right})`, operands[0] ?? "0");
    }
    return args.map((arg) => this.operand(arg, names, indent)).join(` ${operator} `);
  }

  private builtin(name: string, args: readonly JsonValue[], names: Names, indent: string, type: MType | undefined): string {
    const value = (index: number, target?: MType): string => this.coerced(args[index], target, names, indent);
    const str: MType = { kind: "prim", name: "String" };
    switch (name) {
      case "get-or-else":
        return `${this.operand(args[0], names, indent)}.GetOrElse(${value(1)})`;
      case "is-some":
        return `${this.operand(args[0], names, indent)}.IsSome()`;
      case "is-none":
        return `${this.operand(args[0], names, indent)}.IsNone()`;
      case "not":
        return negate(this.value(args[0], names, indent));
      case "trim":
      case "upcase":
      case "downcase":
        this.use("forma");
        return `forma.${{ trim: "Trim", upcase: "Upcase", downcase: "Downcase" }[name]}(${value(0, str)})`;
      case "includes?":
      case "starts-with?":
      case "ends-with?":
        this.use("strings");
        return `strings.${{ "includes?": "Contains", "starts-with?": "HasPrefix", "ends-with?": "HasSuffix" }[name]}(${value(0, str)}, ${value(1, str)})`;
      case "split":
        this.use("strings");
        return `strings.Split(${value(0, str)}, ${value(1, str)})`;
      case "join":
        this.use("strings");
        return `strings.Join(${value(0)}, ${value(1, str)})`;
      case "map":
        this.use("forma");
        return `forma.ListMap(${this.callback(args[0], names, indent)}, ${value(1)})`;
      case "filter":
        this.use("forma");
        return `forma.ListFilter(${this.callback(args[0], names, indent)}, ${value(1)})`;
      case "find":
        this.use("forma");
        return `forma.ListFind(${this.callback(args[0], names, indent)}, ${value(1)})`;
      case "count": {
        const argType = isRecord(args[0]) ? this.info.valueTypes.get(args[0]) : undefined;
        if (argType && this.goType(argType) === "string") {
          this.use("forma");
          return `forma.Length(${value(0)})`;
        }
        return `int64(len(${value(0)}))`;
      }
      case "reduce":
        this.use("forma");
        return `forma.Reduce(${this.callback(args[0], names, indent)}, ${this.value(args[1], names, indent, type)}, ${value(2)})`;
      case "sum":
        this.use("forma");
        return `forma.${type && this.goType(type) === "int64" ? "SumInt" : "SumFloat"}(${value(0)})`;
      case "first":
        this.use("forma");
        return `forma.First(${value(0)})`;
      case "concat": {
        const argType = isRecord(args[0]) ? this.info.valueTypes.get(args[0]) : undefined;
        if (argType && this.goType(argType) === "string") return `${this.operand(args[0], names, indent)} + ${this.operand(args[1], names, indent)}`;
        this.use("forma");
        return `forma.Concat(${value(0)}, ${value(1)})`;
      }
      case "empty?":
        return `len(${value(0)}) == 0`;
      case "conj":
        this.use("forma");
        return `forma.Conj(${value(0)}, ${value(1)})`;
      case "keys":
        return `${this.operand(args[0], names, indent)}.Keys()`;
      case "vals":
        return `${this.operand(args[0], names, indent)}.Vals()`;
      case "dissoc":
        return `${this.operand(args[0], names, indent)}.Dissoc(${value(1, str)})`;
      case "has-key?":
        return `${this.operand(args[0], names, indent)}.Has(${value(1, str)})`;
      case "to-string":
        this.use("forma");
        return `forma.ToString(${value(0)})`;
      case "millis":
      case "seconds":
      case "minutes":
        this.use("forma");
        return `forma.${{ millis: "Millis", seconds: "Seconds", minutes: "Minutes" }[name]}(${this.asFloat(args[0], names, indent)})`;
      case "spaced":
      case "exponential":
        return `effect.${name === "spaced" ? "Spaced" : "Exponential"}(${this.duration(args[0], names, indent)})`;
      case "recurs":
        return `effect.Recurs(int(${value(0)}))`;
      default:
        throw new EffectGoUnsupportedError(`builtin ${name}`);
    }
  }

  /** A function argument: a `(fn ...)` literal or a named function. */
  private callback(node: JsonValue | undefined, names: Names, indent: string): string {
    if (isFnLiteral(node) || (isRecord(node) && node["kind"] === "Var")) return this.value(node, names, indent);
    throw new EffectGoUnsupportedError("callback");
  }

  private special(name: string, node: JsonRecord, args: readonly JsonValue[], names: Names, indent: string, expected?: MType | string): string {
    const type = this.info.valueTypes.get(node);
    switch (name) {
      case "fn": {
        if (type?.kind !== "function") throw new EffectGoUnsupportedError("untyped fn");
        const params = isRecord(args[0]) ? arrayItems(args[0]["items"]) : [];
        const scope = names.child();
        const bound = params.map((param, index) => {
          const paramName = isRecord(param) ? String(param["name"]) : "_";
          const identifier = freeIn(args[1], paramName) ? scope.bind(paramName) : "_";
          return `${identifier} ${this.goType(type.params[index]!)}`;
        });
        const result = this.goType(type.result);
        const body = this.valueReturn(args[1], scope, `${indent}\t`, type.result);
        if (body.length === 1) return `func(${bound.join(", ")}) ${result} { ${body[0]!.trim()} }`;
        return `func(${bound.join(", ")}) ${result} {\n${body.join("\n")}\n${indent}}`;
      }
      case "if":
      case "cond":
      case "match":
      case "let": {
        if (!type) throw new EffectGoUnsupportedError(`untyped ${name}`);
        const result = this.goType(typeof expected === "object" ? expected : type);
        const lines = name === "let"
          ? this.valueReturn(node, names, `${indent}\t`, type)
          : this.conditionalLines(name, node, args, names, `${indent}\t`, typeof expected === "object" ? expected : type);
        return `func() ${result} {\n${lines.join("\n")}\n${indent}}()`;
      }
      case "and":
      case "or":
        return args.map((arg) => this.operand(arg, names, indent)).join(name === "and" ? " && " : " || ");
      case "str": {
        const parts = args.map((arg) => {
          const text = isRecord(arg) && arg["kind"] === "Literal" && typeof arg["value"] === "string" ? arg["value"] : keywordName(arg);
          if (text !== undefined) return goString(text);
          const argType = isRecord(arg) ? this.info.valueTypes.get(arg) : undefined;
          const resolved = argType ? resolve(argType, this.info.env) : undefined;
          if (resolved?.kind === "prim" && resolved.name === "String") return this.operand(arg, names, indent);
          if (argType && this.baseOf(argType) === "string") return `string(${this.value(arg, names, indent)})`;
          this.use("forma");
          return `forma.ToString(${this.value(arg, names, indent)})`;
        });
        return parts.length === 0 ? `""` : parts.join(" + ");
      }
      case ":":
        return this.value(args[0], names, indent, type);
      case "some": {
        const item = type?.kind === "option" ? type.item : undefined;
        return item ? `effect.Some[${this.goType(item)}](${this.coerced(args[0], item, names, indent)})` : `effect.Some(${this.value(args[0], names, indent)})`;
      }
      default:
        throw new EffectGoUnsupportedError(`form ${name}`);
    }
  }

  /** `if`/`cond`/`match` in value position, as statements of a function literal. */
  private conditionalLines(name: string, node: JsonRecord, args: readonly JsonValue[], names: Names, indent: string, type: MType): string[] {
    if (name === "if") {
      return [
        `${indent}if ${this.value(args[0], names, indent)} {`,
        ...this.valueReturn(args[1], names.child(), `${indent}\t`, type),
        `${indent}}`,
        ...this.valueReturn(args[2], names.child(), indent, type),
      ];
    }
    if (name === "cond") {
      const lines: string[] = [];
      for (let index = 0; index + 1 < args.length; index += 2) {
        if (isElseCondition(args[index])) return [...lines, ...this.valueReturn(args[index + 1], names.child(), indent, type)];
        lines.push(`${indent}if ${this.value(args[index], names, indent)} {`, ...this.valueReturn(args[index + 1], names.child(), `${indent}\t`, type), `${indent}}`);
      }
      return [...lines, `${indent}panic("unreachable: cond is exhaustive")`];
    }
    const shape = this.info.matches.get(node);
    if (shape?.kind !== "option" && shape?.kind !== "literal") throw new EffectGoUnsupportedError(`value match on ${shape?.kind}`);
    const subject = this.value(args[0], names, indent);
    const lines: string[] = [];
    for (let index = 1; index + 1 < args.length; index += 2) {
      const pattern = parsePattern(args[index], shape.kind);
      const body = args[index + 1];
      const scope = names.child();
      if (pattern?.tag === "_") return [...lines, ...this.valueReturn(body, scope, indent, type)];
      if (shape.kind === "option") {
        const binding = pattern?.binding;
        const bound = binding && binding !== "_" && freeIn(body, binding) ? scope.bind(binding) : undefined;
        lines.push(pattern?.tag === "some" ? (bound ? `${indent}if ${bound}, ok := ${subject}.Get(); ok {` : `${indent}if ${subject}.IsSome() {`) : `${indent}if ${subject}.IsNone() {`);
      } else {
        lines.push(`${indent}if ${subject} == ${JSON.stringify(pattern?.value ?? pattern?.tag)} {`);
      }
      lines.push(...this.valueReturn(body, scope, `${indent}\t`, type), `${indent}}`);
    }
    return [...lines, `${indent}panic("unreachable: match is exhaustive")`];
  }

  // -------------------------------------------------------------------------
  // Types
  // -------------------------------------------------------------------------

  private goType(type: MType | string): string {
    if (typeof type === "string") return type;
    switch (type.kind) {
      case "prim":
        switch (type.name) {
          case "String":
            return "string";
          case "Int":
            return "int64";
          case "Float":
            return "float64";
          case "Bool":
            return "bool";
          case "Unit":
            this.use("effect");
            return "effect.Unit";
          case "Bytes":
            return "[]byte";
          case "DateTime":
            this.use("time");
            return "time.Time";
          case "Duration":
            this.use("time");
            return "time.Duration";
          case "Schedule":
            this.use("effect");
            return "effect.Schedule";
          default:
            throw new EffectGoUnsupportedError(`type ${type.name}`);
        }
      case "never":
        this.use("effect");
        return "effect.Unit";
      case "literal":
        return typeof type.value === "string" ? "string" : typeof type.value === "boolean" ? "bool" : type.numericKind === "float" || !Number.isInteger(type.value) ? "float64" : "int64";
      case "named":
      case "brand":
      case "class": {
        const goName = this.typeNames.get(type.name);
        if (!goName) throw new EffectGoUnsupportedError(`type ${type.name}`);
        return goName;
      }
      case "error":
        return this.errorTypeName(type.name);
      case "struct":
        return this.structType(type.fields);
      case "array":
        return `[]${this.goType(type.item)}`;
      case "map":
        this.use("forma");
        return `forma.Map[${this.goType(type.value)}]`;
      case "tuple":
        if (type.items.length < 2 || type.items.length > 3) throw new EffectGoUnsupportedError(`tuple of ${type.items.length}`);
        this.use("effect");
        return `effect.Tuple${type.items.length}[${type.items.map((item) => this.goType(item)).join(", ")}]`;
      case "union": {
        const members = type.members;
        if (members.every((member) => member.kind === "literal")) return this.goType(members[0]!);
        throw new EffectGoUnsupportedError("union type");
      }
      case "option":
        this.use("effect");
        return `effect.Option[${this.goType(type.item)}]`;
      case "result":
        this.use("effect");
        return `effect.Result[${this.goType(type.success)}]`;
      case "effect":
        this.use("effect");
        return `effect.Effect[${this.goType(type.success)}]`;
      case "function":
        return `func(${type.params.map((param) => this.goType(param)).join(", ")}) ${this.goType(type.result)}`;
      case "ref":
        this.use("effect");
        return `*effect.Ref[${this.goType(type.item)}]`;
      case "fiber":
        this.use("effect");
        return `*effect.Handle[${this.goType(type.success)}]`;
      case "layer":
        this.use("effect");
        return "*effect.Layer";
      default:
        throw new EffectGoUnsupportedError(`type ${type.kind}`);
    }
  }

  /**
   * Go types are nominal and Forma records are structural. A record type is
   * the declared schema with exactly its fields (optional ones may be
   * absent) when there is one; otherwise a package-level struct is hoisted.
   */
  private structType(fields: readonly MField[]): string {
    const names = new Set(fields.map((field) => field.name));
    const matches = this.structSchemas.filter((schema) =>
      fields.every((field) => schema.fields.some((candidate) => candidate.name === field.name)) &&
      schema.fields.every((field) => field.optional || names.has(field.name)));
    if (matches.length === 1) return this.typeNames.get(matches[0]!.name)!;
    if (matches.length > 1) throw new EffectGoUnsupportedError(`record matches ${matches.map((match) => match.name).join(" and ")}; annotate it`);
    const key = fields.map((field) => `${field.name}${field.optional ? "?" : ""}`).join(",");
    const existing = this.hoisted.get(key);
    if (existing) return existing.name;
    let name = this.nameHint ?? "AnonymousRecord";
    let index = 2;
    const base = name;
    while (this.taken.has(name)) name = `${base}${index++}`;
    this.taken.add(name);
    // Field types are resolved now so nested records are named after this one.
    const types = fields.map((field) => {
      this.nameHint = `${name}${fieldName(field.name)}`;
      return field.optional ? this.optionType(field.type) : this.goType(field.type);
    });
    this.nameHint = undefined;
    this.hoisted.set(key, { name, fields, types });
    return name;
  }
}

/** Aligns columns the way gofmt does for consecutive one-line entries. */
function alignColumns(rows: readonly (readonly string[])[], indent: string): string[] {
  const columns = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columns - 1 }, (_, column) => Math.max(...rows.map((row) => row[column]?.length ?? 0)));
  return rows.map((row) => `${indent}${row.map((cell, column) => (column < row.length - 1 ? cell.padEnd(widths[column]!) : cell)).join(" ")}`);
}

/**
 * gofmt's spacing of `+ - * /`: blanks at expression depth 1, none deeper.
 * Depth grows inside the arguments of a call with more than one argument
 * and in index expressions, shrinks inside parentheses, and resets inside
 * braces. The generator writes every binary operator as ` op `; this pass
 * removes the blanks gofmt would remove. (Mixed-precedence expressions at
 * depth 1 are not generated.)
 */
function binarySpacing(code: string): string {
  const depths = [1];
  let out = "";
  for (let index = 0; index < code.length; index++) {
    const char = code[index]!;
    const depth = depths.at(-1)!;
    if (char === '"') {
      const end = stringEnd(code, index);
      out += code.slice(index, end);
      index = end - 1;
      continue;
    }
    if (char === "/" && code[index + 1] === "/") {
      const end = code.indexOf("\n", index);
      out += code.slice(index, end < 0 ? code.length : end);
      index = (end < 0 ? code.length : end) - 1;
      continue;
    }
    if (char === "(") {
      const isCall = /[\w)\]]$/.test(out);
      depths.push(isCall ? (callArguments(code, index) > 1 ? depth + 1 : depth) : Math.max(1, depth - 1));
    } else if (char === "{") {
      depths.push(1);
    } else if (char === "[") {
      depths.push(depth + 1);
    } else if (char === ")" || char === "}" || char === "]") {
      depths.pop();
    } else if (char === " " && depth > 1 && "+-*/".includes(code[index + 1] ?? "") && code[index + 2] === " ") {
      out += code[index + 1];
      index += 2;
      continue;
    }
    out += char;
  }
  return out;
}

function stringEnd(code: string, start: number): number {
  let index = start + 1;
  while (index < code.length && code[index] !== '"') index += code[index] === "\\" ? 2 : 1;
  return index + 1;
}

/** The number of top-level comma-separated arguments of the call opened at `open`. */
function callArguments(code: string, open: number): number {
  let nesting = 0;
  let count = 1;
  let empty = true;
  for (let index = open + 1; index < code.length; index++) {
    const char = code[index]!;
    if (char === '"') {
      index = stringEnd(code, index) - 1;
      empty = false;
      continue;
    }
    if ("([{".includes(char)) nesting++;
    else if (")]}".includes(char)) {
      if (nesting === 0) return empty ? 0 : count;
      nesting--;
    } else if (char === "," && nesting === 0) count++;
    if (!/\s/.test(char)) empty = false;
  }
  return count;
}

function negate(condition: string): string {
  return /^[\w.]+(\(.*\))?$/.test(condition) ? `!${condition}` : `!(${condition})`;
}

/** A Go interpreted string literal. JSON escapes are valid Go escapes. */
function goString(text: string): string {
  return JSON.stringify(text);
}
