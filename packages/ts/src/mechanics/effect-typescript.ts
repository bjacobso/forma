/**
 * Generates an Effect 4 TypeScript module from mechanics declarations.
 *
 * Schemas become `Schema` constants with a same-named type, errors become
 * `Schema.TaggedError` classes, services become `Context.Service` classes,
 * pure functions become arrow functions, operations become functions
 * returning `Effect.gen` programs, and layers become `Layer` constants.
 *
 * Generation is type-directed: it uses the mechanics checker's results (and
 * runs the checker when none are supplied) and throws on a body it cannot
 * translate rather than emitting a placeholder program.
 *
 * @module
 */
import type { JsonValue, PackageableDeclaration } from "../artifact/artifact.js";
import { arrowBody, Precedence, type EmitContext, type ImportName } from "./builtins.js";
import {
  builtinErrors,
  checkMechanicsDeclarations,
  keywordName,
  parsePattern,
  recordKey,
  type CheckInfo,
  type EffectType,
  type LayerInfo,
} from "./check.js";
import { inlineBrands, orderSchemaDeclarations, schemaExpressionTs, type SchemaNaming } from "./effect-schema.js";
import { camelIdentifier, isIdentifierName, propertyAccess, propertyName, typeName } from "./naming.js";
import {
  arrayItems,
  containsLiterals,
  isRecord,
  requirementService,
  stringItems,
  typeFromJson,
  type MType,
  type Provenance,
} from "./types.js";

export interface MechanicsEffectTypeScriptModule {
  readonly code: string;
  readonly operationNames: readonly string[];
}

export interface MechanicsEffectTypeScriptOptions {
  /** Check results to reuse; the generator runs the checker when omitted. */
  readonly check?: CheckInfo;
}

type JsonRecord = Readonly<Record<string, JsonValue>>;

type Module =
  | "Record"
  | "Schedule"
  | "Stream"
  | "Cause"
  | "Config"
  | "Context"
  | "Duration"
  | "Effect"
  | "Fiber"
  | "Layer"
  | "Option"
  | "Ref"
  | "Result"
  | "Schema"
  | "Scope";

const modules: readonly Module[] = ["Cause", "Config", "Context", "Duration", "Effect", "Fiber", "Layer", "Option", "Ref", "Record", "Result", "Schedule", "Schema", "Scope", "Stream"];

/** Globals generated code relies on or that readers expect to mean the global. */
const globals = ["Array", "Boolean", "Date", "Error", "JSON", "Map", "Math", "Number", "Object", "Promise", "Set", "String", "Symbol", "console", "globalThis"];

const schemaNaming: SchemaNaming = { schemaConst: typeName };

/** Lines longer than this are broken across lines. */
const maxWidth = 100;

export function generateMechanicsEffectTypeScriptModule(
  declarations: readonly PackageableDeclaration[],
  options: MechanicsEffectTypeScriptOptions = {},
): MechanicsEffectTypeScriptModule {
  const info = options.check ?? checkMechanicsDeclarations(declarations).info;
  return new Generator(declarations, info).module();
}

const Prec = Precedence;
type Prec = number;

interface Expr {
  readonly code: string;
  readonly prec: Prec;
}

const atom = (code: string): Expr => ({ code, prec: Prec.Postfix });

/** A renderer that lays out an expression starting at a given indent. */
type Render = (indent: string) => string;

/**
 * Lexical names: Forma names map to TypeScript identifiers, and a binding is
 * renamed when its identifier is already visible (so `const x = f(x)` never
 * hits the temporal dead zone). Sibling blocks may reuse names.
 */
class Names {
  private readonly bindings: Map<string, string>;
  private readonly taken: Set<string>;

  constructor(parent?: Names, reserved: Iterable<string> = [], sharedTaken?: Set<string>) {
    this.bindings = new Map(parent?.bindings);
    this.taken = sharedTaken ?? new Set([...(parent?.taken ?? []), ...reserved]);
  }

  /** A new JavaScript block (branch, callback, or generator body). */
  child(): Names {
    return new Names(this);
  }

  /**
   * New Forma bindings that are emitted into the current JavaScript block:
   * they shadow like a child scope but share its identifiers, so sibling
   * `do!` forms in one block never declare the same `const`.
   */
  sameBlock(): Names {
    return new Names(this, [], this.taken);
  }

  bind(name: string, preferred = camelIdentifier(name)): string {
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

  /** Makes a Forma name refer to an existing TypeScript expression. */
  alias(name: string, identifier: string): void {
    this.bindings.set(name, identifier);
  }

  isTaken(identifier: string): boolean {
    return this.taken.has(identifier);
  }
}

type Mode = "return" | "discard";

class Generator {
  private readonly imports = new Set<Module>();
  private readonly reserved = new Set<string>([...modules, ...globals]);
  private serviceVars = new Map<string, string>();
  private contextVar: string | undefined;
  /**
   * Whether the value being rendered has a contextual type in TypeScript
   * (a typed parameter, a function's declared return, or a field of such a
   * value). Without one TypeScript widens literals, so records of schemas
   * with literal types get `satisfies`.
   */
  private contextual = false;

  constructor(
    private readonly declarations: readonly PackageableDeclaration[],
    private readonly info: CheckInfo,
  ) {}

  module(): MechanicsEffectTypeScriptModule {
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
    for (const payload of [...functions, ...constants, ...operations]) this.reserved.add(camelIdentifier(String(payload["name"])));
    for (const payload of [...schemas, ...errors, ...classes, ...services, ...layers]) this.reserved.add(typeName(String(payload["name"])));

    const sections: string[][] = [];
    const declared = new Set([...schemas, ...errors, ...classes].map((payload) => String(payload["name"])));
    const brands = inlineBrands(payloads).filter((brand) => !declared.has(brand.name));
    for (const brand of brands) this.reserved.add(typeName(brand.name));
    const data = orderSchemaDeclarations([
      ...brands.map((brand) => ({ name: brand.name, schema: brand.schema, kind: "SchemaDef" })),
      ...schemas.map((payload) => ({ name: String(payload["name"]), schema: payload["schema"] ?? null, kind: "SchemaDef" })),
      ...classes.map((payload) => ({ name: String(payload["name"]), schema: payload["schema"] ?? null, kind: "ClassDef" })),
      ...errors.map((payload) => ({ name: String(payload["name"]), schema: payload["schema"] ?? null, kind: "ErrorDef" })),
    ]);
    for (const declaration of data) {
      sections.push(
        declaration.kind === "SchemaDef"
          ? this.schemaLines(declaration.name, declaration.schema)
          : this.classLines(declaration.name, declaration.schema, declaration.kind === "ErrorDef"),
      );
    }
    for (const service of services) sections.push(this.serviceLines(service));
    for (const constant of orderConstants(constants)) sections.push(this.constantLines(constant));
    for (const fn of functions) sections.push(this.functionLines(fn));
    for (const operation of operations) sections.push(this.operationLines(operation));
    for (const layer of orderLayers(layers)) sections.push(this.layerLines(layer));

    const imports = [...this.imports].sort();
    const header = imports.length > 0 ? [`import { ${imports.join(", ")} } from "effect";`, ""] : [];
    const body = sections.map((lines) => lines.join("\n")).join("\n\n");
    return {
      code: `${[...header, body].join("\n").trimEnd()}\n`,
      operationNames: operations.map((operation) => String(operation["name"])),
    };
  }

  private use(module: Module): void {
    this.imports.add(module);
  }

  // -------------------------------------------------------------------------
  // Declarations
  // -------------------------------------------------------------------------

  private schemaLines(name: string, schema: JsonValue): string[] {
    this.use("Schema");
    const constName = typeName(name);
    const struct = isRecord(schema) && schema["kind"] === "Struct" ? arrayItems(schema["fields"]).filter(isRecord) : [];
    let expression = struct.length > 0 ? `Schema.Struct({\n${this.fieldLines(struct, "  ").join("\n")}\n})` : schemaExpressionTs(schema, schemaNaming, true);
    if (`export const ${constName} = ${expression};`.length > maxWidth && expression.startsWith("Schema.Union([")) {
      expression = breakUnion(expression);
    }
    return [`export const ${constName} = ${expression};`, `export type ${constName} = typeof ${constName}.Type;`];
  }

  private fieldLines(fields: readonly JsonRecord[], indent: string): string[] {
    return fields.flatMap((field) =>
      typeof field["name"] === "string"
        ? [`${indent}${propertyName(field["name"])}: ${schemaExpressionTs(field["schema"], schemaNaming)},`]
        : [],
    );
  }

  /** `Schema.TaggedError` classes for errors and `Schema.Class` classes for data. */
  private classLines(name: string, schema: JsonValue, error: boolean): string[] {
    this.use("Schema");
    const className = typeName(name);
    const fields = isRecord(schema) ? arrayItems(schema["fields"]).filter(isRecord) : [];
    const head = error
      ? `export class ${className} extends Schema.TaggedError<${className}>()(${JSON.stringify(name)}, {`
      : `export class ${className} extends Schema.Class<${className}>(${JSON.stringify(name)})({`;
    if (fields.length === 0) return [`${head}}) {}`];
    return [head, ...this.fieldLines(fields, "  "), "}) {}"];
  }

  private serviceLines(service: JsonRecord): string[] {
    this.use("Context");
    const name = String(service["name"]);
    const className = typeName(name);
    const methods = this.info.services.get(name);
    const lines = [`export class ${className} extends Context.Service<`, `  ${className},`, "  {"];
    for (const method of methods?.values() ?? []) {
      const params = method.params.map((param) => `${camelIdentifier(param.name)}: ${this.typeTs(param.type)}`).join(", ");
      lines.push(`    readonly ${propertyName(camelIdentifier(method.name))}: (${params}) => ${this.effectTypeTs(method.effect)};`);
    }
    lines.push("  }", `>()(${JSON.stringify(name)}) {}`);
    return lines;
  }

  private constantLines(constant: JsonRecord): string[] {
    const name = String(constant["name"]);
    const type = this.info.constants.get(name);
    const head = `export const ${camelIdentifier(name)}${type ? `: ${this.typeTs(type)}` : ""} =`;
    this.serviceVars = new Map();
    const inline = `${head} ${this.value(constant["value"], new Names(undefined, this.reserved), "").code};`;
    if (!inline.includes("\n") && inline.length <= maxWidth) return [inline];
    return [`${head} ${this.value(constant["value"], new Names(undefined, this.reserved), "").code};`];
  }

  private functionLines(fn: JsonRecord): string[] {
    const name = String(fn["name"]);
    const signature = this.info.functions.get(name);
    const names = new Names(undefined, this.reserved);
    this.serviceVars = new Map();
    const body = fn["body"];
    const params = (signature?.params ?? []).map(
      (param) => `${names.bind(param.name, unusedPrefix(param.name, body))}: ${this.typeTs(param.type)}`,
    );
    const returns = signature ? this.typeTs(signature.result) : "unknown";
    const head = signatureHead(camelIdentifier(name), params, returns);
    const block = this.letBlock(body, names, "  ");
    if (block) return [`${head} {`, ...block, "};"].map((line, index) => (index === 0 ? line.replace(/ =>$/, " =>") : line));
    const rendered = this.contextualValue(body, names, "  ").code;
    const value = rendered.startsWith("{") ? `(${rendered})` : rendered;
    const inline = `${head} ${value};`;
    if (!inline.includes("\n") && inline.length <= maxWidth) return [inline];
    if (value.startsWith("({\n")) {
      // Hug a multi-line object literal: `=> ({` ... `});`
      const objectLines = this.contextualValue(body, names, "").code.split("\n");
      return [`${head} (${objectLines[0]}`, ...objectLines.slice(1, -1), `${objectLines.at(-1)!});`];
    }
    return [head, `  ${value};`];
  }

  /** A function body that starts with `let` becomes statements and a return. */
  private letBlock(body: JsonValue | undefined, names: Names, indent: string): string[] | undefined {
    if (!isRecord(body) || body["kind"] !== "List") return undefined;
    const call = this.info.calls.get(body);
    if (call?.kind !== "special" || call.name !== "let") return undefined;
    const [bindingsNode, result] = arrayItems(body["items"]).slice(1);
    const scope = names.child();
    const lines = this.letBindings(bindingsNode, result, scope, indent, indent);
    lines.push(...(this.letBlock(result, scope, indent) ?? [`${indent}return ${this.contextualValue(result, scope, indent).code};`]));
    return lines;
  }

  /** `const` lines for a value-level `let`; bindings nothing reads are dropped (values are pure). */
  private letBindings(bindingsNode: JsonValue | undefined, result: JsonValue | undefined, scope: Names, lineIndent: string, indent: string): string[] {
    const pairs = isRecord(bindingsNode) ? arrayItems(bindingsNode["items"]) : [];
    const steps = [...letSteps(pairs), { value: result ?? null }];
    const lines: string[] = [];
    letSteps(pairs).forEach((step, index) => {
      if (step.binds === undefined || !referencedIn(steps.slice(index + 1), step.binds)) return;
      const value = this.value(step.value, scope, indent).code;
      lines.push(`${lineIndent}const ${scope.bind(step.binds)} = ${value};`);
    });
    return lines;
  }

  private operationLines(operation: JsonRecord): string[] {
    this.use("Effect");
    const name = String(operation["name"]);
    const signature = this.info.operations.get(name);
    const body = operation["body"];
    const names = new Names(undefined, this.reserved);
    const services = this.servicesUsed(body);
    // Parameters keep their names; a colliding service variable becomes `fooService`.
    const params = (signature?.params ?? []).map(
      (param) => `${names.bind(param.name, unusedPrefix(param.name, body))}: ${this.typeTs(param.type)}`,
    );
    this.serviceVars = new Map();
    for (const service of services) this.serviceVars.set(service, bindService(names, service));
    const returns = signature ? this.effectTypeTs(signature.result) : "Effect.Effect<unknown>";
    const lines = [signatureHead(camelIdentifier(name), params, returns), "  Effect.gen(function* () {"];
    for (const service of services) lines.push(`    const ${this.serviceVars.get(service)!} = yield* ${typeName(service)};`);
    lines.push(...this.statements(body, names, "    ", "return"));
    lines.push("  });");
    return lines;
  }

  private layerLines(layer: JsonRecord): string[] {
    this.use("Layer");
    const name = String(layer["name"]);
    const info = this.info.layers.get(name);
    const implementation = layer["implementation"];
    const head = `export const ${typeName(name)}${info ? `: ${this.layerTypeTs(info)}` : ""} =`;
    if (isRecord(implementation) && implementation["kind"] === "Compose") {
      const expression = this.layerExpression(implementation["layer"], "");
      return `${head} ${expression};`.length <= maxWidth ? [`${head} ${expression};`] : [head, `  ${this.layerExpression(implementation["layer"], "  ")};`];
    }
    if (!isRecord(implementation) || implementation["kind"] !== "Service") {
      throw new Error(`Effect TypeScript: layer ${name} has no implementation`);
    }
    return this.serviceLayerLines(head, implementation, info);
  }

  private layerExpression(expr: JsonValue | undefined, indent: string): string {
    if (!isRecord(expr)) throw new Error("Effect TypeScript: invalid layer expression");
    switch (expr["kind"]) {
      case "LayerRef":
        return typeName(String(expr["name"]));
      case "LayerMerge": {
        const layers = arrayItems(expr["layers"]);
        if (layers.length === 1) return this.layerExpression(layers[0], indent);
        return layout("Layer.mergeAll", layers.map((item) => (inner: string) => this.layerExpression(item, inner)), indent);
      }
      case "LayerProvide":
      case "LayerProvideMerge": {
        const dependencies = arrayItems(expr["dependencies"]);
        const dependency: Render =
          dependencies.length === 1
            ? (inner) => this.layerExpression(dependencies[0], inner)
            : (inner) => layout("Layer.mergeAll", dependencies.map((item) => (deeper: string) => this.layerExpression(item, deeper)), inner);
        const fn = expr["kind"] === "LayerProvide" ? "Layer.provide" : "Layer.provideMerge";
        return layout(fn, [(inner) => this.layerExpression(expr["layer"], inner), dependency], indent);
      }
      default:
        throw new Error(`Effect TypeScript: unsupported layer expression ${String(expr["kind"])}`);
    }
  }

  private serviceLayerLines(head: string, implementation: JsonRecord, info: LayerInfo | undefined): string[] {
    const service = String(implementation["service"]);
    const serviceClass = typeName(service);
    const setup = arrayItems(implementation["setup"]).filter(isRecord);
    const methods = arrayItems(implementation["methods"]).filter(isRecord);
    const names = new Names(undefined, this.reserved);
    const captured = this.servicesUsed([...setup.map((binding) => binding["value"] ?? null), ...methods.map((method) => method["body"] ?? null)]);
    this.serviceVars = new Map();
    for (const dependency of captured) this.serviceVars.set(dependency, bindService(names, dependency));
    const contextServices = info?.contextServices ?? [];
    this.contextVar = contextServices.length > 0 ? names.bind("context:layer", "context") : undefined;

    const construction: string[] = [];
    for (const dependency of captured) construction.push(`    const ${this.serviceVars.get(dependency)!} = yield* ${typeName(dependency)};`);
    if (this.contextVar) {
      this.use("Effect");
      construction.push(`    const ${this.contextVar} = yield* Effect.context<${contextServices.map(typeName).join(" | ")}>();`);
    }
    const later: Step[] = [
      ...bindingSteps(setup),
      ...methods.map((method) => ({ value: { kind: "Lambda", params: method["params"] ?? [], body: method["body"] ?? null } })),
    ];
    setup.forEach((binding, index) => {
      construction.push(...this.bindingLines(binding, names, "    ", later.slice(index + 1)));
    });

    const entryIndent = construction.length === 0 ? "    " : "      ";
    const entries: string[] = [];
    for (const method of methods) {
      const scope = names.child();
      const params = stringItems(method["params"]).map((param) => scope.bind(param, unusedPrefix(param, method["body"])));
      const key = propertyName(camelIdentifier(String(method["name"])));
      const prefix = `${entryIndent}${key}: (${params.join(", ")}) =>`;
      const inline = this.effectExpression(method["body"], scope.child(), entryIndent);
      if (!inline.includes("\n") && `${prefix} ${inline},`.length <= maxWidth) {
        entries.push(`${prefix} ${inline},`);
      } else {
        const deeper = `${entryIndent}  `;
        entries.push(prefix, `${deeper}${this.effectExpression(method["body"], scope.child(), deeper)},`);
      }
    }
    this.contextVar = undefined;

    const shapeIndent = entryIndent.slice(2);
    const shape = [`${serviceClass}.of({`, ...entries, `${shapeIndent}})`];
    if (construction.length === 0) {
      return [`${head} Layer.succeed(`, `  ${serviceClass},`, `  ${shape[0]}`, ...shape.slice(1, -1), `${shape.at(-1)!},`, ");"];
    }
    this.use("Effect");
    return [
      `${head} Layer.effect(`,
      `  ${serviceClass},`,
      "  Effect.gen(function* () {",
      ...construction,
      `    return ${shape[0]}`,
      ...shape.slice(1, -1),
      `${shape.at(-1)!};`,
      "  }),",
      ");",
    ];
  }

  // -------------------------------------------------------------------------
  // Effect bodies
  // -------------------------------------------------------------------------

  /** Statements for an effect node inside an `Effect.gen` body. */
  private statements(node: JsonValue | undefined, names: Names, indent: string, mode: Mode): string[] {
    if (!isRecord(node)) throw new Error("Effect TypeScript: expected an effect body node");
    switch (node["kind"]) {
      case "Succeed":
        return this.valueStatement(node["value"], names, indent, mode);
      case "Pure":
        if (this.isEffectValue(node["value"])) {
          return this.yieldStatement(this.value(node["value"], names, indent).code, indent, mode);
        }
        return this.valueStatement(node["value"], names, indent, mode);
      case "Do":
      case "Let": {
        const lines: string[] = [];
        const scope = names.sameBlock();
        const bindings = arrayItems(node["bindings"]).filter(isRecord);
        const steps = [...bindingSteps(bindings), { value: node["body"] ?? null }, { value: node["forms"] ?? null }];
        bindings.forEach((binding, index) => {
          lines.push(...this.bindingLines(binding, scope, indent, steps.slice(index + 1)));
        });
        if (node["body"] !== undefined) {
          lines.push(...this.statements(node["body"], scope, indent, mode));
        } else {
          const forms = arrayItems(node["forms"]);
          forms.forEach((form, index) => {
            lines.push(...this.statements(form, scope, indent, index === forms.length - 1 ? mode : "discard"));
          });
          if (forms.length === 0 && mode === "return") lines.push(`${indent}return;`);
        }
        return lines;
      }
      case "Bind":
        return this.statements(node["value"], names, indent, mode);
      case "If":
        return [
          `${indent}if (${this.value(node["condition"], names, indent).code}) {`,
          ...this.statements(node["then"], names.child(), `${indent}  `, mode),
          `${indent}} else {`,
          ...this.statements(node["else"], names.child(), `${indent}  `, mode),
          `${indent}}`,
        ];
      case "When":
      case "Unless": {
        const condition = this.value(node["condition"], names, indent);
        const test = node["kind"] === "Unless" ? `!${wrap(condition, Prec.Unary)}` : condition.code;
        return [
          `${indent}if (${test}) {`,
          ...this.statements(node["body"], names.child(), `${indent}  `, "discard"),
          `${indent}}`,
          ...(mode === "return" ? [`${indent}return;`] : []),
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
            const keyword = index === 0 ? `${indent}if` : `${indent}} else if`;
            lines.push(`${keyword} (${this.value(clause["condition"], names, indent).code}) {`);
          }
          lines.push(...this.statements(clause["body"], names.child(), `${indent}  `, mode));
        });
        lines.push(`${indent}}`);
        if (!hasElse && mode === "return") lines.push(`${indent}return;`);
        return lines;
      }
      case "Match":
        return this.matchStatements(node, names, indent, mode);
      case "Fail":
        this.use("Effect");
        return this.yieldStatement(`Effect.fail(${this.errorValue(node["error"], names, indent)})`, indent, mode);
      default:
        return this.yieldStatement(this.effectExpression(node, names, indent), indent, mode);
    }
  }

  private valueStatement(value: JsonValue | undefined, names: Names, indent: string, mode: Mode): string[] {
    if (mode === "discard") return [];
    if (isUnitLiteral(value)) return [`${indent}return;`];
    const block = this.letBlock(value, names, indent);
    if (block) return block;
    return [`${indent}return ${this.value(value, names, indent).code};`];
  }

  private yieldStatement(effect: string, indent: string, mode: Mode): string[] {
    return [`${indent}${mode === "return" ? "return " : ""}yield* ${effect};`];
  }

  private bindingLines(binding: JsonRecord, names: Names, indent: string, rest: readonly Step[]): string[] {
    const name = typeof binding["name"] === "string" ? binding["name"] : "_";
    const value = binding["value"];
    const used = name !== "_" && referencedIn(rest, name);
    const pure = isRecord(value) && (value["kind"] === "Pure" || value["kind"] === "Succeed") && !this.isEffectValue(value["value"]);
    if (pure) {
      if (!used) return [];
      const code = this.value(isRecord(value) ? value["value"] : undefined, names, indent).code;
      return [`${indent}const ${names.bind(name)} = ${code};`];
    }
    if (!used && isRecord(value) && ["If", "When", "Unless", "Cond", "Match"].includes(String(value["kind"]))) {
      return this.statements(value, names, indent, "discard");
    }
    const effect = this.effectExpression(value, names, indent);
    if (!used) return [`${indent}yield* ${effect};`];
    return [`${indent}const ${names.bind(name)} = yield* ${effect};`];
  }

  /** An expression evaluating to an Effect for the given node. */
  private effectExpression(node: JsonValue | undefined, names: Names, indent: string): string {
    if (!isRecord(node)) throw new Error("Effect TypeScript: expected an effect body node");
    switch (node["kind"]) {
      case "ServiceCall": {
        const callee = `${this.serviceVar(String(node["service"]))}.${camelIdentifier(String(node["method"]))}`;
        return layout(callee, this.argRenders(node["args"], names), indent);
      }
      case "OperationCall": {
        const call = layout(camelIdentifier(String(node["operation"])), this.argRenders(node["args"], names), indent);
        return this.withContext(node, call);
      }
      case "Succeed":
      case "Pure":
        if (node["kind"] === "Pure" && this.isEffectValue(node["value"])) return this.value(node["value"], names, indent).code;
        this.use("Effect");
        if (isUnitLiteral(node["value"])) return "Effect.void";
        return `Effect.succeed(${this.value(node["value"], names, indent).code})`;
      case "Fail":
        this.use("Effect");
        return `Effect.fail(${this.errorValue(node["error"], names, indent)})`;
      case "Bind":
        return this.effectExpression(node["value"], names, indent);
      case "Catch":
        this.use("Effect");
        return layout(
          "Effect.catchTag",
          [
            (inner) => this.effectExpression(node["body"], names, inner),
            () => JSON.stringify(String(node["errorType"])),
            (inner) => this.handler(String(node["binding"]), node["handler"], names, inner),
          ],
          indent,
        );
      case "CatchTags": {
        this.use("Effect");
        const handlers = arrayItems(node["handlers"]).filter(isRecord);
        return layout(
          "Effect.catchTags",
          [
            (inner) => this.effectExpression(node["body"], names, inner),
            (inner) => {
              const deeper = `${inner}  `;
              const entries = handlers.map(
                (handler) =>
                  `${deeper}${propertyName(String(handler["errorType"]))}: ${this.handler(String(handler["binding"]), handler["handler"], names, deeper)},`,
              );
              return `{\n${entries.join("\n")}\n${inner}}`;
            },
          ],
          indent,
        );
      }
      case "CatchAll":
        this.use("Effect");
        return layout(
          "Effect.catch",
          [
            (inner) => this.effectExpression(node["body"], names, inner),
            (inner) => this.handler(String(node["binding"]), node["handler"], names, inner),
          ],
          indent,
        );
      case "Combinator":
        return this.combinator(node, names, indent);
      case "Do":
      case "Let":
      case "If":
      case "When":
      case "Unless":
      case "Cond":
      case "Match":
        return this.gen(node, names, indent);
      default:
        throw new Error(`Effect TypeScript: unsupported effect body kind ${String(node["kind"])}`);
    }
  }

  /**
   * An effect that resolves its own services, used where they come from a
   * layer provided around it rather than from the enclosing function.
   */
  private serviceScope(node: JsonValue | undefined, names: Names, indent: string): string {
    const services = this.servicesUsed(node);
    if (services.length === 0) return this.effectExpression(node, names, indent);
    const saved = this.serviceVars;
    this.serviceVars = new Map(saved);
    const scope = names.child();
    const inner = `${indent}  `;
    const lines = services.map((service) => {
      const variable = bindService(scope, service);
      this.serviceVars.set(service, variable);
      return `${inner}const ${variable} = yield* ${typeName(service)};`;
    });
    lines.push(...this.statements(node, scope, inner, "return"));
    this.serviceVars = saved;
    this.use("Effect");
    return `Effect.gen(function* () {\n${lines.join("\n")}\n${indent}})`;
  }

  private gen(node: JsonValue | undefined, names: Names, indent: string): string {
    this.use("Effect");
    const lines = this.statements(node, names.child(), `${indent}  `, "return");
    return `Effect.gen(function* () {\n${lines.join("\n")}\n${indent}})`;
  }

  private handler(binding: string, handler: JsonValue | undefined, names: Names, indent: string): string {
    const scope = names.child();
    const param = binding !== "_" && freeIn(handler, binding) ? scope.bind(binding) : "";
    return `(${param}) => ${this.effectExpression(handler, scope, indent)}`;
  }

  private lambda(node: JsonValue | undefined, names: Names, indent: string): string {
    if (!isRecord(node) || node["kind"] !== "Lambda") throw new Error("Effect TypeScript: expected (fn [...] effect)");
    const scope = names.child();
    const params = stringItems(node["params"]).map((param) => scope.bind(param, unusedPrefix(param, node["body"])));
    return `(${params.join(", ")}) => ${this.effectExpression(node["body"], scope, indent)}`;
  }

  private withContext(node: JsonRecord, call: string): string {
    if (!this.contextVar || !this.info.contextCalls.has(node)) return call;
    this.use("Effect");
    return `Effect.provideContext(${call}, ${this.contextVar})`;
  }

  /** Arguments to typed parameters, which give their values a contextual type. */
  private argRenders(args: JsonValue | undefined, names: Names): Render[] {
    return arrayItems(args).map((arg) => (inner: string) => this.contextualValue(arg, names, inner).code);
  }

  private contextualValue(node: JsonValue | undefined, names: Names, indent: string): Expr {
    this.contextual = true;
    return this.value(node, names, indent);
  }

  private combinator(node: JsonRecord, names: Names, indent: string): string {
    this.use("Effect");
    const name = String(node["name"]);
    const args = arrayItems(node["args"]);
    const effect = (index: number): Render => (inner) => this.effectExpression(args[index], names, inner);
    const value = (index: number): Render => (inner) => this.value(args[index], names, inner).code;
    const lambda = (index: number): Render => (inner) => this.lambda(args[index], names, inner);
    const option = (key: string): JsonValue | undefined => {
      for (const entry of arrayItems(node["options"])) {
        if (isRecord(entry) && entry["key"] === key) return entry["value"];
      }
      return undefined;
    };
    const concurrency = (): Render[] => {
      const setting = option("concurrency");
      if (setting === undefined) return [];
      const keyword = keywordName(setting);
      return [(inner) => `{ concurrency: ${keyword !== undefined ? JSON.stringify(keyword) : this.value(setting, names, inner).code} }`];
    };
    const call = (callee: string, renders: readonly Render[]): string => layout(callee, renders, indent);
    switch (name) {
      case "scoped":
        return call("Effect.scoped", [effect(0)]);
      case "acquire-release":
        return call("Effect.acquireRelease", [effect(0), lambda(1)]);
      case "ensuring":
        return call("Effect.ensuring", [effect(0), effect(1)]);
      case "add-finalizer":
        return call("Effect.addFinalizer", [(inner) => `() => ${this.effectExpression(args[0], names, inner)}`]);
      case "all": {
        const collection = args[0];
        if (!isRecord(collection)) throw new Error("Effect TypeScript: all expects effects");
        if (collection["kind"] === "EffectRecord") {
          const entries = arrayItems(collection["entries"]).filter(isRecord);
          const record: Render = (inner) => {
            const deeper = `${inner}  `;
            const lines = entries.map(
              (entry) => `${deeper}${propertyName(String(entry["key"]))}: ${this.effectExpression(entry["value"], names, deeper)},`,
            );
            return `{\n${lines.join("\n")}\n${inner}}`;
          };
          return call("Effect.all", [record, ...concurrency()]);
        }
        const items = arrayItems(collection["items"]);
        const vector: Render = (inner) => {
          const rendered = items.map((item) => this.effectExpression(item, names, inner));
          const inline = `[${rendered.join(", ")}]`;
          if (!inline.includes("\n") && inner.length + inline.length <= maxWidth) return inline;
          const deeper = `${inner}  `;
          return `[\n${items.map((item) => `${deeper}${this.effectExpression(item, names, deeper)},`).join("\n")}\n${inner}]`;
        };
        return call("Effect.all", [vector, ...concurrency()]);
      }
      case "for-each":
        return call("Effect.forEach", [value(0), lambda(1), ...concurrency()]);
      case "race":
        return call("Effect.race", [effect(0), effect(1)]);
      case "fork":
        return call("Effect.forkChild", [effect(0)]);
      case "join":
        this.use("Fiber");
        return call("Fiber.join", [value(0)]);
      case "interrupt":
        this.use("Fiber");
        return call("Fiber.interrupt", [value(0)]);
      case "sleep":
        return call("Effect.sleep", [value(0)]);
      case "timeout":
        return call("Effect.timeout", [effect(0), value(1)]);
      case "retry":
      case "repeat": {
        const policy = (["times", "schedule"] as const).flatMap((key) => {
          const setting = option(key);
          return setting === undefined ? [] : [(inner: string) => `${key}: ${this.value(setting, names, inner).code}`];
        });
        return call(name === "retry" ? "Effect.retry" : "Effect.repeat", [effect(0), (inner) => objectLiteral(policy, inner)]);
      }
      case "map-error":
        return call("Effect.mapError", [effect(0), value(1)]);
      case "or-else-succeed": {
        // The fallback's return type is stated so TypeScript does not widen literals.
        const success = this.info.effectTypes.get(node)?.success;
        const returns = success ? `: ${this.typeTs(success)}` : "";
        return call("Effect.orElseSucceed", [effect(0), (inner) => `()${returns} => ${arrowBody(this.contextualValue(args[1], names, inner).code)}`]);
      }
      case "or-die":
        return call("Effect.orDie", [effect(0)]);
      case "option":
        return call("Effect.option", [effect(0)]);
      case "result":
        return call("Effect.result", [effect(0)]);
      case "provide":
        return call("Effect.provide", [(inner) => this.serviceScope(args[0], names, inner), value(1)]);
      case "log":
        return call("Effect.log", args.map((_, index) => value(index)));
      case "ref-make": {
        this.use("Ref");
        const type = this.info.effectTypes.get(node)?.success;
        const item = type?.kind === "ref" ? `<${this.typeTs(type.item)}>` : "";
        return call(`Ref.make${item}`, [value(0)]);
      }
      case "ref-get":
        this.use("Ref");
        return call("Ref.get", [value(0)]);
      case "ref-set":
        this.use("Ref");
        return call("Ref.set", [value(0), value(1)]);
      case "ref-update":
        this.use("Ref");
        return call("Ref.update", [value(0), value(1)]);
      case "config": {
        this.use("Config");
        const type = this.typeArg(args[0]);
        const reader = `Config.${type.kind === "prim" ? configReader(type.name) : "string"}(${this.value(args[1], names, indent).code})`;
        const fallback = option("default");
        return fallback === undefined ? reader : call("Config.withDefault", [() => reader, (inner) => this.value(fallback, names, inner).code]);
      }
      case "decode": {
        this.use("Schema");
        const type = this.typeArg(args[0]);
        const schema = type.kind === "named" ? typeName(type.name) : "Schema.Unknown";
        return call(`Schema.decodeUnknownEffect(${schema})`, [value(1)]);
      }
      default:
        throw new Error(`Effect TypeScript: unsupported combinator ${name}`);
    }
  }

  private typeArg(node: JsonValue | undefined): MType {
    return isRecord(node) ? typeFromJson(node["type"], this.info.env) : { kind: "unknown" };
  }

  private matchStatements(node: JsonRecord, names: Names, indent: string, mode: Mode): string[] {
    const shape = this.info.matches.get(node);
    if (!shape) throw new Error("Effect TypeScript: match was not checked");
    const lines: string[] = [];
    let subject = this.value(node["value"], names, indent).code;
    if (!isIdentifierName(subject)) {
      const temp = names.bind("match:subject", "matched");
      lines.push(`${indent}const ${temp} = ${subject};`);
      subject = temp;
    }
    const arms = arrayItems(node["arms"]).filter(isRecord).map((arm) => ({ pattern: parsePattern(arm["pattern"]), body: arm["body"] }));
    const armFor = (tag: string) => arms.find((arm) => arm.pattern?.tag === tag) ?? arms.find((arm) => arm.pattern?.tag === "_");
    const armLines = (arm: (typeof arms)[number] | undefined, payload: string | undefined, inner: string): string[] => {
      if (!arm) return mode === "return" ? [`${inner}return;`] : [];
      const scope = names.child();
      const out: string[] = [];
      const binding = arm.pattern?.binding;
      if (binding && binding !== "_" && payload !== undefined && freeIn(arm.body, binding)) {
        out.push(`${inner}const ${scope.bind(binding)} = ${payload};`);
      }
      out.push(...this.statements(arm.body, scope, inner, mode));
      return out;
    };

    if (shape.kind === "option" || shape.kind === "result") {
      const isOption = shape.kind === "option";
      this.use(isOption ? "Option" : "Result");
      const test = isOption ? "Option.isSome" : "Result.isSuccess";
      lines.push(`${indent}if (${test}(${subject})) {`);
      lines.push(...armLines(armFor(isOption ? "some" : "success"), `${subject}.${isOption ? "value" : "success"}`, `${indent}  `));
      lines.push(`${indent}} else {`);
      lines.push(...armLines(armFor(isOption ? "none" : "failure"), isOption ? undefined : `${subject}.failure`, `${indent}  `));
      lines.push(`${indent}}`);
      return lines;
    }

    const discriminant = shape.kind === "tagged" ? propertyAccess(subject, shape.discriminator) : subject;
    lines.push(`${indent}switch (${discriminant}) {`);
    for (const arm of arms) {
      const tag = arm.pattern?.tag;
      if (tag === undefined) continue;
      lines.push(tag === "_" ? `${indent}  default: {` : `${indent}  case ${JSON.stringify(tag)}: {`);
      lines.push(...armLines(arm, subject, `${indent}    `));
      if (mode === "discard") lines.push(`${indent}    break;`);
      lines.push(`${indent}  }`);
    }
    lines.push(`${indent}}`);
    return lines;
  }

  private errorValue(error: JsonValue | undefined, names: Names, indent: string): string {
    if (typeof error === "string") return `new ${typeName(error)}({})`;
    if (isRecord(error) && error["kind"] === "Error") return this.newError(String(error["errorType"]), error["payload"], names, indent);
    return this.value(error, names, indent).code;
  }

  private newError(name: string, payload: JsonValue | undefined, names: Names, indent: string): string {
    if (payload === undefined) return `new ${typeName(name)}({})`;
    return `new ${typeName(name)}(${this.contextualValue(payload, names, indent).code})`;
  }

  private serviceVar(service: string): string {
    const variable = this.serviceVars.get(service);
    if (!variable) throw new Error(`Effect TypeScript: service ${service} is not in scope`);
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
        // The provided effect gets its services from the layer, inside its own scope.
        arrayItems(item["args"]).slice(1).forEach(visit);
        return;
      }
      for (const [key, value] of Object.entries(item)) {
        if (key !== "span" && key !== "effect") visit(value);
      }
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

  private value(node: JsonValue | undefined, names: Names, indent: string): Expr {
    const contextual = this.contextual;
    this.contextual = false;
    try {
      return this.valueInner(node, names, indent, contextual);
    } finally {
      this.contextual = false;
    }
  }

  private valueInner(node: JsonValue | undefined, names: Names, indent: string, contextual: boolean): Expr {
    if (!isRecord(node)) throw new Error("Effect TypeScript: missing value node");
    switch (node["kind"]) {
      case "Literal": {
        const value = node["value"];
        if (value === null) return atom("undefined");
        if (typeof value === "number" && value < 0) return { code: JSON.stringify(value), prec: Prec.Unary };
        return atom(JSON.stringify(value));
      }
      case "Var":
        return atom(this.variable(String(node["name"]), names));
      case "Expr": {
        const keyword = keywordName(node);
        if (keyword !== undefined) return atom(JSON.stringify(keyword));
        const source = node["source"];
        if (isRecord(source) && source["kind"] === "Nil") return atom("undefined");
        throw new Error(`Effect TypeScript: unsupported expression value ${JSON.stringify(source)}`);
      }
      case "Record":
        return this.typedLiteral(node, this.info.recordTargets.get(node), contextual, this.recordLiteral(node, names, indent));
      case "Vector": {
        const items = arrayItems(node["items"]);
        const item = (element: JsonValue, inner: string): string => {
          this.contextual = contextual;
          return this.value(element, names, inner).code;
        };
        const inline = `[${items.map((element) => item(element, indent)).join(", ")}]`;
        if (!inline.includes("\n") && indent.length + inline.length <= maxWidth) return atom(inline);
        const deeper = `${indent}  `;
        return atom(`[\n${items.map((element) => `${deeper}${item(element, deeper)},`).join("\n")}\n${indent}]`);
      }
      case "List":
        return this.application(node, names, indent, contextual);
      default:
        throw new Error(`Effect TypeScript: unsupported value kind ${String(node["kind"])}`);
    }
  }

  private variable(name: string, names: Names): string {
    const local = names.lookup(name);
    if (local) return local;
    switch (name) {
      case "nil":
        return "undefined";
      case "true":
      case "false":
        return name;
      case "none":
        this.use("Option");
        return "Option.none()";
      default:
        break;
    }
    if (this.info.layers.has(name)) return typeName(name);
    if (this.info.functions.has(name) || this.info.operations.has(name) || this.info.constants.has(name)) {
      return camelIdentifier(name);
    }
    throw new Error(`Effect TypeScript: unbound name ${name}`);
  }

  private recordLiteral(node: JsonRecord, names: Names, indent: string): string {
    const entries = arrayItems(node["entries"]).filter(isRecord);
    return objectLiteral(
      entries.map((entry) => (inner: string) => {
        const key = recordKey(entry["key"]);
        if (key === undefined) throw new Error("Effect TypeScript: unsupported record key");
        // Fields of an object literal are contextually typed by the literal's own type.
        return objectEntry(key, this.contextualValue(entry["value"], names, inner).code);
      }),
      indent,
    );
  }

  /** `{...} satisfies T` when TypeScript would otherwise widen the literal's enum and tag fields. */
  private typedLiteral(node: JsonRecord, target: MType | undefined, contextual: boolean, code: string): Expr {
    if (contextual || target?.kind !== "named" || !containsLiterals(target, this.info.env) || !this.hasLiteralValue(node)) {
      return atom(code);
    }
    return { code: `${code} satisfies ${typeName(target.name)}`, prec: Prec.Relational };
  }

  /** Whether a record (or the new value of an assoc) holds a value whose type is a literal. */
  private hasLiteralValue(node: JsonValue | undefined): boolean {
    if (!isRecord(node)) return false;
    if (node["kind"] === "Record") return arrayItems(node["entries"]).some((entry) => isRecord(entry) && this.hasLiteralValue(entry["value"]));
    if (node["kind"] === "Vector") return arrayItems(node["items"]).some((item) => this.hasLiteralValue(item));
    const call = this.info.calls.get(node);
    if (call?.kind === "assoc") return this.hasLiteralValue(arrayItems(node["items"])[3]);
    if (call?.kind === "special" && ["if", "cond", "match", "construct", ":"].includes(call.name)) {
      return arrayItems(node["items"]).slice(1).some((item) => this.hasLiteralValue(item));
    }
    if (call?.kind === "construct") return this.hasLiteralValue(arrayItems(node["items"])[1]);
    const type = this.info.valueTypes.get(node);
    return type !== undefined && (type.kind === "literal" || (type.kind === "union" && type.members.some((member) => member.kind === "literal")));
  }

  private application(node: JsonRecord, names: Names, indent: string, contextual: boolean): Expr {
    const call = this.info.calls.get(node);
    const items = arrayItems(node["items"]);
    const args = items.slice(1);
    if (!call) throw new Error(`Effect TypeScript: unchecked application ${JSON.stringify(items[0])}`);
    const operand = (index: number, prec: Prec): string => wrap(this.value(args[index], names, indent), prec);
    switch (call.kind) {
      case "builtin": {
        const scope = names.child();
        const emit: EmitContext = {
          use: (module: ImportName) => this.use(module),
          resultType: () => {
            const type = this.info.valueTypes.get(node);
            if (!type) throw new Error(`Effect TypeScript: ${call.name} has no checked type`);
            return this.typeTs(type);
          },
          fresh: (preferred) => scope.bind(`builtin:${preferred}`, preferred),
        };
        const contextualArgs = call.overload.contextualArgs ?? [];
        const code = call.overload.emit(
          args.map((item, index) => (contextualArgs.includes(index) ? this.contextualValue(item, names, indent) : this.value(item, names, indent))),
          emit,
        );
        return { code, prec: call.overload.prec ?? Prec.Postfix };
      }
      case "arithmetic": {
        if (call.operator === "max" || call.operator === "min") {
          return atom(`Math.${call.operator}(${args.map((_, index) => this.value(args[index], names, indent).code).join(", ")})`);
        }
        if (args.length === 1 && call.operator === "-") {
          // `- -x` must not become the decrement operator `--x`.
          const negated = operand(0, Prec.Unary);
          return { code: negated.startsWith("-") ? `-(${negated})` : `-${negated}`, prec: Prec.Unary };
        }
        const prec = call.operator === "*" ? Prec.Multiplicative : Prec.Additive;
        const parts = args.map((_, index) => operand(index, index === 0 ? prec : prec + 1));
        return { code: parts.join(` ${call.operator} `), prec };
      }
      case "equality":
        return {
          code: `${operand(0, Prec.Relational)} ${call.operator === "=" ? "===" : "!=="} ${operand(1, Prec.Relational)}`,
          prec: Prec.Equality,
        };
      case "special":
        return this.special(call.name, node, args, names, indent, contextual);
      case "get": {
        const target = operand(0, Prec.Postfix);
        if (call.access === "map") {
          // Record.get only sees own keys, so `constructor` is not found on the prototype.
          this.use("Record");
          return atom(`Record.get(${this.value(args[0], names, indent).code}, ${this.value(args[1], names, indent).code})`);
        }
        const key = recordKey(args[1]) ?? "";
        if (call.access === "optional-field") {
          this.use("Option");
          return atom(`Option.fromUndefinedOr(${propertyAccess(target, key)})`);
        }
        return atom(propertyAccess(target, key));
      }
      case "assoc": {
        const spread: Render = (inner) => `...${this.value(args[0], names, inner).code}`;
        const replacement: Render =
          call.access === "map"
            ? (inner) => `[${this.value(args[1], names, inner).code}]: ${this.contextualValue(args[2], names, inner).code}`
            : (inner) => objectEntry(recordKey(args[1]) ?? "", this.contextualValue(args[2], names, inner).code);
        const updated = objectLiteral([spread, replacement], call.access === "class" ? `${indent}  ` : indent);
        const type = this.info.valueTypes.get(node);
        if (call.access === "class") return atom(`new ${type?.kind === "class" ? typeName(type.name) : "Object"}(${updated})`);
        return this.typedLiteral(node, type, contextual, updated);
      }
      case "error":
        return atom(this.newError(call.name, args[0], names, indent));
      case "class":
        return atom(`new ${typeName(call.name)}(${this.contextualValue(args[0], names, indent).code})`);
      case "stream":
        return atom(this.streamCall(call.name, args, names, indent));
      case "brand":
        return atom(`${typeName(call.name)}.make(${this.value(args[0], names, indent).code})`);
      case "construct":
        this.contextual = contextual;
        return this.value(args[0], names, indent);
      case "function":
        return atom(layout(camelIdentifier(call.name), this.argRenders(args, names), indent));
      case "operation":
        return atom(this.withContext(node, layout(camelIdentifier(call.name), this.argRenders(args, names), indent)));
      case "service":
        return atom(layout(`${this.serviceVar(call.service)}.${camelIdentifier(call.method)}`, this.argRenders(args, names), indent));
      case "local":
        return atom(layout(names.lookup(call.name) ?? camelIdentifier(call.name), this.argRenders(args, names), indent));
    }
  }

  private special(name: string, node: JsonRecord, args: readonly JsonValue[], names: Names, indent: string, contextual: boolean): Expr {
    // Branches of a conditional share the conditional's contextual type.
    const branch = (index: number, scope: Names = names): Expr => {
      this.contextual = contextual;
      return this.value(args[index], scope, indent);
    };
    switch (name) {
      case "fn": {
        const params = isRecord(args[0]) ? arrayItems(args[0]["items"]) : [];
        const scope = names.child();
        const identifiers = params.map((param) => {
          const paramName = isRecord(param) ? String(param["name"]) : "_";
          return scope.bind(paramName, unusedPrefix(paramName, args[1]));
        });
        const body = this.value(args[1], scope, indent);
        return { code: `(${identifiers.join(", ")}) => ${arrowBody(body.code)}`, prec: Prec.Arrow };
      }
      case "if":
        return {
          code: `${wrap(this.value(args[0], names, indent), Prec.Or)} ? ${wrap(branch(1), Prec.Conditional)} : ${wrap(branch(2), Prec.Conditional)}`,
          prec: Prec.Conditional,
        };
      case "cond": {
        let code: string | undefined;
        for (let index = args.length - 2; index >= 0; index -= 2) {
          const value = wrap(branch(index + 1), Prec.Conditional);
          const condition = args[index];
          if (isElseCondition(condition)) {
            code = value;
          } else {
            code = `${wrap(this.value(condition, names, indent), Prec.Or)} ? ${value} : ${code ?? "undefined"}`;
          }
        }
        return { code: code ?? "undefined", prec: Prec.Conditional };
      }
      case "let": {
        const scope = names.child();
        const lines = this.letBindings(args[0], args[1], scope, "", indent);
        if (lines.length === 0) {
          this.contextual = contextual;
          return this.value(args[1], scope, indent);
        }
        return atom(`(() => { ${lines.join(" ")} return ${this.value(args[1], scope, indent).code}; })()`);
      }
      case "and":
      case "or": {
        const prec = name === "and" ? Prec.And : Prec.Or;
        return { code: args.map((item) => wrap(this.value(item, names, indent), prec + 1)).join(name === "and" ? " && " : " || "), prec };
      }
      case "str": {
        const parts = args.map((item) => {
          const text = isRecord(item) && item["kind"] === "Literal" && typeof item["value"] === "string" ? item["value"] : keywordName(item);
          if (text !== undefined) return templateText(text);
          return `\${${this.value(item, names, indent).code}}`;
        });
        return atom(`\`${parts.join("")}\``);
      }
      case ":":
        this.contextual = contextual;
        return this.value(args[0], names, indent);
      case "some":
        this.use("Option");
        return atom(`Option.some(${this.value(args[0], names, indent).code})`);
      case "match":
        return this.valueMatch(node, args, names, indent, contextual);
      default:
        throw new Error(`Effect TypeScript: unsupported form ${name} (${JSON.stringify(node["span"])})`);
    }
  }

  private streamCall(name: string, args: readonly JsonValue[], names: Names, indent: string): string {
    this.use("Stream");
    const arg = (index: number): Render => (inner) => this.value(args[index], names, inner).code;
    switch (name) {
      case "stream-of":
        return layout("Stream.fromIterable", [arg(0)], indent);
      case "stream-range":
        return layout("Stream.range", [arg(0), arg(1)], indent);
      case "stream-map":
        return layout("Stream.map", [arg(0), arg(1)], indent);
      case "stream-filter":
        return layout("Stream.filter", [arg(0), arg(1)], indent);
      case "stream-take":
        return layout("Stream.take", [arg(0), arg(1)], indent);
      case "stream-map-effect":
        return layout(
          "Stream.mapEffect",
          [arg(0), arg(1), ...(args[2] === undefined ? [] : [(inner: string) => `{ concurrency: ${this.value(args[2], names, inner).code} }`])],
          indent,
        );
      case "stream-run-collect":
        return layout("Stream.runCollect", [arg(0)], indent);
      case "stream-run-fold":
        return layout("Stream.runFold", [arg(0), (inner) => `() => ${arrowBody(this.value(args[1], names, inner).code)}`, arg(2)], indent);
      case "stream-run-for-each":
        return layout("Stream.runForEach", [arg(0), arg(1)], indent);
      default:
        throw new Error(`Effect TypeScript: unsupported stream function ${name}`);
    }
  }

  /**
   * `match` in value position: `Option.match` / `Result.match` for those
   * types, and a conditional chain on the tag (which TypeScript narrows) for
   * enums and tagged unions.
   */
  private valueMatch(node: JsonRecord, args: readonly JsonValue[], names: Names, indent: string, contextual: boolean): Expr {
    const shape = this.info.matches.get(node);
    if (!shape) throw new Error("Effect TypeScript: match was not checked");
    const arms: { readonly pattern: ReturnType<typeof parsePattern>; readonly body: JsonValue | undefined }[] = [];
    for (let index = 1; index + 1 < args.length; index += 2) {
      arms.push({ pattern: parsePattern(args[index]), body: args[index + 1] });
    }
    const subject = this.value(args[0], names, indent);
    const armFor = (tag: string) => arms.find((arm) => arm.pattern?.tag === tag) ?? arms.find((arm) => arm.pattern?.tag === "_");
    const handler = (tag: string): string => {
      const arm = armFor(tag);
      if (!arm) throw new Error(`Effect TypeScript: match has no arm for ${tag}`);
      const scope = names.child();
      const binding = arm.pattern?.binding;
      const param = binding && binding !== "_" && freeIn(arm.body, binding) ? scope.bind(binding) : "";
      this.contextual = contextual;
      return `(${param}) => ${arrowBody(this.value(arm.body, scope, `${indent}  `).code)}`;
    };
    if (shape.kind === "option" || shape.kind === "result") {
      const isOption = shape.kind === "option";
      this.use(isOption ? "Option" : "Result");
      const entries = isOption
        ? [`onNone: ${handler("none")}`, `onSome: ${handler("some")}`]
        : [`onFailure: ${handler("failure")}`, `onSuccess: ${handler("success")}`];
      const inline = `${isOption ? "Option" : "Result"}.match(${subject.code}, { ${entries.join(", ")} })`;
      if (!inline.includes("\n") && indent.length + inline.length <= maxWidth) return atom(inline);
      return atom(`${isOption ? "Option" : "Result"}.match(${subject.code}, {\n${entries.map((entry) => `${indent}  ${entry},`).join("\n")}\n${indent}})`);
    }

    // Enums and tagged unions: test the tag in arm order; the last arm needs no test.
    const render = (subjectCode: string, scope: Names): string => {
      const discriminant = shape.kind === "tagged" ? propertyAccess(subjectCode, shape.discriminator) : subjectCode;
      const branches: { readonly test: string | undefined; readonly value: string }[] = [];
      for (const arm of arms) {
        const tag = arm.pattern?.tag;
        const armScope = scope.child();
        const binding = arm.pattern?.binding;
        if (binding && binding !== "_") armScope.alias(binding, subjectCode);
        this.contextual = contextual;
        const value = wrap(this.value(arm.body, armScope, indent), Prec.Conditional);
        branches.push({ test: tag === "_" ? undefined : `${discriminant} === ${JSON.stringify(tag)}`, value });
        if (tag === "_") break;
      }
      // The last case needs no test: the checker proved the match exhaustive.
      const last = branches.at(-1);
      if (last) branches[branches.length - 1] = { test: undefined, value: last.value };
      return conditionalChain(branches, indent);
    };
    if (isIdentifierName(subject.code)) return { code: render(subject.code, names), prec: Prec.Conditional };
    const scope = names.child();
    const parameter = scope.bind("match:subject", "matched");
    return atom(`((${parameter}) => ${render(parameter, scope)})(${subject.code})`);
  }

  // -------------------------------------------------------------------------
  // Types
  // -------------------------------------------------------------------------

  private effectTypeTs(effect: EffectType): string {
    this.use("Effect");
    return generic("Effect.Effect", this.typeTs(effect.success), this.errorUnion(effect.errors), this.requirementUnion(effect.requirements));
  }

  private layerTypeTs(info: LayerInfo): string {
    this.use("Layer");
    const provides = info.type.provides.map(typeName).join(" | ") || "never";
    return generic("Layer.Layer", provides, this.errorUnion(info.type.errors), this.requirementUnion(info.type.requirements));
  }

  private errorUnion(errors: Provenance): string {
    const names = [...errors.keys()].map((error) => this.errorTypeName(error));
    return names.length === 0 ? "never" : names.join(" | ");
  }

  private errorTypeName(error: string): string {
    const builtin = builtinErrors.get(error);
    if (builtin) {
      this.use(builtin.split(".")[0] as Module);
      return builtin;
    }
    return typeName(error);
  }

  private requirementUnion(requirements: Provenance): string {
    const services = new Set<string>();
    for (const requirement of requirements.keys()) {
      if (requirement === "Scope") {
        this.use("Scope");
        services.add("Scope.Scope");
      } else {
        services.add(typeName(requirementService(requirement)));
      }
    }
    return services.size === 0 ? "never" : [...services].sort().join(" | ");
  }

  private typeTs(type: MType): string {
    switch (type.kind) {
      case "prim":
        switch (type.name) {
          case "String":
            return "string";
          case "Int":
          case "Number":
            return "number";
          case "Bool":
            return "boolean";
          case "Unit":
            return "void";
          case "Json":
            this.use("Schema");
            return "Schema.Json";
          case "Bytes":
            return "Uint8Array";
          case "DateTime":
            return "Date";
          case "Duration":
            this.use("Duration");
            return "Duration.Duration";
          case "Schedule":
            throw new Error("Effect TypeScript: schedules can only be passed to retry and repeat");
        }
        return "never";
      case "never":
        return "never";
      case "unknown":
        throw new Error("Effect TypeScript: cannot generate a type the checker could not resolve");
      case "literal":
        return JSON.stringify(type.value);
      case "named":
      case "brand":
      case "class":
        return typeName(type.name);
      case "error":
        return this.errorTypeName(type.name);
      case "struct":
        return type.fields.length === 0
          ? "{}"
          : `{ ${type.fields.map((field) => `readonly ${propertyName(field.name)}${field.optional ? "?" : ""}: ${this.typeTs(field.type)}`).join("; ")} }`;
      case "array":
        return `ReadonlyArray<${this.typeTs(type.item)}>`;
      case "map":
        return `{ readonly [key: string]: ${this.typeTs(type.value)} }`;
      case "tuple":
        return `readonly [${type.items.map((item) => this.typeTs(item)).join(", ")}]`;
      case "union":
        return type.members
          .map((member) => (member.kind === "function" ? `(${this.typeTs(member)})` : this.typeTs(member)))
          .join(" | ");
      case "option":
        this.use("Option");
        return `Option.Option<${this.typeTs(type.item)}>`;
      case "result":
        this.use("Result");
        return `Result.Result<${this.typeTs(type.success)}, ${this.typeTs(type.failure)}>`;
      case "effect":
        return this.effectTypeTs(type);
      case "function":
        return `(${type.params.map((param, index) => `arg${index}: ${this.typeTs(param)}`).join(", ")}) => ${this.typeTs(type.result)}`;
      case "ref":
        this.use("Ref");
        return `Ref.Ref<${this.typeTs(type.item)}>`;
      case "fiber":
        this.use("Fiber");
        return generic("Fiber.Fiber", this.typeTs(type.success), this.errorUnion(type.errors));
      case "stream":
        this.use("Stream");
        return generic("Stream.Stream", this.typeTs(type.item), this.errorUnion(type.errors), this.requirementUnion(type.requirements));
      case "layer":
        return this.layerTypeTs({ type: type.layer, contextServices: [] });
      case "var":
        return "never";
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `Name<A, E, R>`, dropping trailing `never` parameters. */
function generic(name: string, ...params: readonly string[]): string {
  const kept = [...params];
  while (kept.length > 1 && kept.at(-1) === "never") kept.pop();
  return `${name}<${kept.join(", ")}>`;
}

function signatureHead(name: string, params: readonly string[], returns: string): string {
  const inline = `export const ${name} = (${params.join(", ")}): ${returns} =>`;
  if (inline.length <= maxWidth || params.length === 0) return inline;
  return [`export const ${name} = (`, ...params.map((param) => `  ${param},`), `): ${returns} =>`].join("\n");
}

/**
 * Lays out a call: on one line when it fits, hugging a trailing multi-line
 * argument when only the last one breaks, otherwise one argument per line.
 */
function layout(callee: string, args: readonly Render[], indent: string): string {
  const inline = args.map((arg) => arg(indent));
  const oneLine = `${callee}(${inline.join(", ")})`;
  if (!oneLine.includes("\n") && indent.length + oneLine.length <= maxWidth) return oneLine;
  const leading = inline.slice(0, -1);
  const last = inline.at(-1);
  if (
    last !== undefined &&
    leading.every((arg) => !arg.includes("\n")) &&
    last.includes("\n") &&
    indent.length + `${callee}(${[...leading, last.split("\n")[0]].join(", ")}`.length <= maxWidth
  ) {
    return `${callee}(${[...leading, last].join(", ")})`;
  }
  const inner = `${indent}  `;
  return `${callee}(\n${args.map((arg) => `${inner}${arg(inner)},`).join("\n")}\n${indent})`;
}

/** Puts each member of a top-level `Schema.Union([...])` on its own line. */
function breakUnion(expression: string): string {
  const inner = expression.slice("Schema.Union([".length, -"])".length);
  const members: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index];
    if (char === "(" || char === "[" || char === "{") depth++;
    if (char === ")" || char === "]" || char === "}") depth--;
    if (char === '"') {
      index = inner.indexOf('"', index + 1);
      continue;
    }
    if (char === "," && depth === 0) {
      members.push(inner.slice(start, index).trim());
      start = index + 1;
    }
  }
  members.push(inner.slice(start).trim());
  return `Schema.Union([\n${members.map((member) => `  ${member},`).join("\n")}\n])`;
}

/**
 * Text inside a template literal. Every `$` is escaped so adjacent pieces can
 * never form `${`, and carriage returns are escaped because template
 * literals normalize them to newlines.
 */
function templateText(text: string): string {
  return text.replace(/[\\`$\r]/g, (match) => (match === "\r" ? "\\r" : `\\${match}`));
}

/** `{ a, b: c }` on one line when it fits, otherwise one entry per line. */
function objectLiteral(entries: readonly Render[], indent: string): string {
  if (entries.length === 0) return "{}";
  const inline = `{ ${entries.map((entry) => entry(indent)).join(", ")} }`;
  if (!inline.includes("\n") && indent.length + inline.length <= maxWidth - 20) return inline;
  const deeper = `${indent}  `;
  return `{\n${entries.map((entry) => `${deeper}${entry(deeper)},`).join("\n")}\n${indent}}`;
}

/** `key: value`, or the shorthand `key` when the value is the same identifier. */
function objectEntry(key: string, value: string): string {
  return value === key && isIdentifierName(key) ? key : `${propertyName(key)}: ${value}`;
}

/** `a ? x : b ? y : z`, broken one branch per line when it is too long. */
function conditionalChain(branches: readonly { readonly test: string | undefined; readonly value: string }[], indent: string): string {
  const inline = branches.map((branch) => (branch.test === undefined ? branch.value : `${branch.test} ? ${branch.value} : `)).join("");
  if (!inline.includes("\n") && indent.length + inline.length <= maxWidth) return inline;
  let code = "";
  let depth = `${indent}  `;
  branches.forEach((branch, index) => {
    if (branch.test === undefined) {
      code += index === 0 ? branch.value : branch.value;
      return;
    }
    code += `${branch.test}\n${depth}? ${branch.value}\n${depth}: `;
    depth = `${depth}  `;
  });
  return code;
}

function wrap(expr: Expr, prec: Prec): string {
  return expr.prec < prec ? `(${expr.code})` : expr.code;
}

/** `UserRepo` → `userRepo`; `Console` → `consoleService` rather than shadowing the global. */
function bindService(names: Names, service: string): string {
  const name = typeName(service);
  const preferred = camelIdentifier(`${name.charAt(0).toLowerCase()}${name.slice(1)}`);
  return names.bind(`service:${service}`, names.isTaken(preferred) ? `${preferred}Service` : preferred);
}

function configReader(name: string): string {
  switch (name) {
    case "Int":
      return "int";
    case "Number":
      return "number";
    case "Bool":
      return "boolean";
    default:
      return "string";
  }
}

function isElseCondition(node: JsonValue | undefined): boolean {
  return keywordName(node) === "else" || (isRecord(node) && node["kind"] === "Literal" && node["value"] === true);
}

function isUnitLiteral(value: JsonValue | undefined): boolean {
  if (!isRecord(value)) return false;
  if (value["kind"] === "Var" && value["name"] === "nil") return true;
  if (value["kind"] === "Literal" && value["value"] === null) return true;
  const source = value["source"];
  return value["kind"] === "Expr" && isRecord(source) && source["kind"] === "Nil";
}

const usageCache = new WeakMap<object, Map<string, boolean>>();

/** A step in a binding sequence: a value, then (optionally) a name it binds. */
interface Step {
  readonly value: JsonValue | undefined;
  readonly binds?: string;
}

/** Whether `name` is referenced by a sequence of bindings before something rebinds it. */
function referencedIn(steps: readonly Step[], name: string): boolean {
  for (const step of steps) {
    if (freeIn(step.value, name)) return true;
    if (step.binds === name) return false;
  }
  return false;
}

function bindingSteps(bindings: readonly JsonValue[]): Step[] {
  return bindings.flatMap((binding) =>
    isRecord(binding) ? [{ value: binding["value"], ...(typeof binding["name"] === "string" ? { binds: binding["name"] } : {}) }] : [],
  );
}

/** `[name value ...]` pairs of a value-level `let`. */
function letSteps(pairs: readonly JsonValue[]): Step[] {
  const steps: Step[] = [];
  for (let index = 0; index + 1 < pairs.length; index += 2) {
    const binding = pairs[index];
    steps.push({ value: pairs[index + 1], ...(isRecord(binding) && binding["kind"] === "Var" ? { binds: String(binding["name"]) } : {}) });
  }
  return steps;
}

/**
 * Whether a Forma name occurs free in a subtree: references under a binder
 * that shadows it (do!/let bindings, fn and layer parameters, catch and
 * match bindings) do not count.
 */
function freeIn(node: JsonValue | undefined, name: string): boolean {
  if (Array.isArray(node)) return node.some((item) => freeIn(item, name));
  if (!isRecord(node)) return false;
  let cached = usageCache.get(node);
  const hit = cached?.get(name);
  if (hit !== undefined) return hit;
  const result = computeFreeIn(node, name);
  if (!cached) usageCache.set(node, (cached = new Map()));
  cached.set(name, result);
  return result;
}

function computeFreeIn(node: JsonRecord, name: string): boolean {
  const patternBinds = (pattern: JsonValue | undefined): boolean => parsePattern(pattern)?.binding === name;
  switch (node["kind"]) {
    case "Var":
      return node["name"] === name;
    case "Do":
    case "Let":
      return referencedIn([...bindingSteps(arrayItems(node["bindings"])), { value: node["body"] ?? null }, { value: node["forms"] ?? null }], name);
    case "Lambda":
      return !stringItems(node["params"]).includes(name) && freeIn(node["body"], name);
    case "Catch":
    case "CatchAll":
      return freeIn(node["body"], name) || (node["binding"] !== name && freeIn(node["handler"], name));
    case "CatchTags":
      return (
        freeIn(node["body"], name) ||
        arrayItems(node["handlers"]).some((handler) => isRecord(handler) && handler["binding"] !== name && freeIn(handler["handler"], name))
      );
    case "Match":
      return (
        freeIn(node["value"], name) ||
        arrayItems(node["arms"]).some((arm) => isRecord(arm) && !patternBinds(arm["pattern"]) && freeIn(arm["body"], name))
      );
    case "List": {
      const items = arrayItems(node["items"]);
      const head = items[0];
      const headName = isRecord(head) && head["kind"] === "Var" ? head["name"] : undefined;
      if (headName === "fn") {
        const params = isRecord(items[1]) ? arrayItems(items[1]["items"]) : [];
        return !params.some((param) => isRecord(param) && param["name"] === name) && freeIn(items[2], name);
      }
      if (headName === "let") {
        const pairs = isRecord(items[1]) ? arrayItems(items[1]["items"]) : [];
        return referencedIn([...letSteps(pairs), { value: items[2] ?? null }], name);
      }
      if (headName === "match") {
        if (freeIn(items[1], name)) return true;
        for (let index = 2; index + 1 < items.length; index += 2) {
          if (!patternBinds(items[index]) && freeIn(items[index + 1], name)) return true;
        }
        return false;
      }
      return items.some((item) => freeIn(item, name));
    }
    default:
      return Object.entries(node).some(([key, value]) => key !== "span" && key !== "effect" && freeIn(value, name));
  }
}

/** Unused parameters get a leading underscore so `noUnusedParameters` accepts them. */
function unusedPrefix(name: string, body: JsonValue | undefined): string {
  return freeIn(body, name) ? camelIdentifier(name) : `_${camelIdentifier(name)}`;
}

/** Constants may refer to each other, so each is emitted after the ones it uses. */
function orderConstants(constants: readonly JsonRecord[]): readonly JsonRecord[] {
  const byName = new Map(constants.map((constant) => [String(constant["name"]), constant]));
  const ordered: JsonRecord[] = [];
  const seen = new Set<string>();
  const visit = (constant: JsonRecord): void => {
    const name = String(constant["name"]);
    if (seen.has(name)) return;
    seen.add(name);
    for (const reference of byName.keys()) {
      if (!freeIn(constant["value"], reference)) continue;
      const target = byName.get(reference);
      if (target) visit(target);
    }
    ordered.push(constant);
  };
  constants.forEach(visit);
  return ordered;
}

function orderLayers(layers: readonly JsonRecord[]): readonly JsonRecord[] {
  const byName = new Map(layers.map((layer) => [String(layer["name"]), layer]));
  const ordered: JsonRecord[] = [];
  const seen = new Set<string>();
  const references = (node: JsonValue | undefined): readonly string[] => {
    if (Array.isArray(node)) return node.flatMap(references);
    if (!isRecord(node)) return [];
    const names = node["kind"] === "LayerRef" && typeof node["name"] === "string" ? [node["name"]] : [];
    return [...names, ...Object.entries(node).flatMap(([key, value]) => (key === "span" ? [] : references(value)))];
  };
  const visit = (layer: JsonRecord): void => {
    const name = String(layer["name"]);
    if (seen.has(name)) return;
    seen.add(name);
    const implementation = layer["implementation"];
    if (isRecord(implementation) && implementation["kind"] === "Compose") {
      for (const reference of references(implementation["layer"])) {
        const target = byName.get(reference);
        if (target) visit(target);
      }
    }
    ordered.push(layer);
  };
  layers.forEach(visit);
  return ordered;
}
