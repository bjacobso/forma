import type { JsonValue, PackageableDeclaration } from "../artifact/artifact.js";
import type { Span } from "../engine/operations.js";
import type { SExpr } from "../reader/types.js";

export interface MechanicsArtifactDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly span?: Span;
}

export type MechanicsArtifactResult =
  | { readonly ok: true; readonly declarations: readonly PackageableDeclaration[] }
  | { readonly ok: false; readonly diagnostics: readonly MechanicsArtifactDiagnostic[] };

type MechanicsJsonResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly diagnostics: readonly MechanicsArtifactDiagnostic[] };

type ServiceMethodEffects = ReadonlyMap<string, JsonValue>;
type OperationEffects = ReadonlyMap<string, JsonValue>;

export function mechanicsPackageableDeclarations(
  exprs: readonly SExpr[],
  sourceId: string,
): MechanicsArtifactResult {
  const declarations: PackageableDeclaration[] = [];
  const signatures = operationSignatures(exprs);
  const serviceMethodEffects = collectServiceMethodEffects(exprs, sourceId);
  const operationEffects = collectOperationEffects(exprs, sourceId, signatures);

  for (let formIndex = 0; formIndex < exprs.length; formIndex++) {
    const expr = exprs[formIndex]!;
    if (!isMechanicsArtifactForm(expr) && !isTypedFunctionForm(expr, signatures)) continue;

    const result = declaration(
      expr,
      sourceId,
      formIndex,
      signatures,
      serviceMethodEffects,
      operationEffects,
    );
    if (!result.ok) return result;
    declarations.push(result.declaration);
  }

  return { ok: true, declarations };
}

export function isMechanicsArtifactForm(expr: SExpr): boolean {
  return (
    isDefineSchemaForm(expr) ||
    isDefineErrorForm(expr) ||
    isDefineClassForm(expr) ||
    isDefineServiceForm(expr) ||
    isDefineOperationForm(expr) ||
    isDefineLayerForm(expr)
  );
}

function isDefineLayerForm(expr: SExpr): boolean {
  return expr._tag === "List" && symName(expr.items[0]) === "define-layer";
}

/**
 * A `(define name value)` whose name has a `(: name Type)` signature is a
 * typed constant, or a pure helper function when the value is `(fn ...)`.
 * Untyped defines stay ordinary Forma code and are not packaged.
 */
function isTypedFunctionForm(expr: SExpr, signatures: ReadonlyMap<string, SExpr>): boolean {
  if (expr._tag !== "List" || symName(expr.items[0]) !== "define" || expr.items.length !== 3) {
    return false;
  }
  const name = symName(expr.items[1]);
  return name !== undefined && signatures.has(name);
}

function isDefineSchemaForm(expr: SExpr): boolean {
  return (
    expr._tag === "List" &&
    symName(expr.items[0]) === "define-schema" &&
    expr.items.length === 3 &&
    isSchemaProjectionExpr(expr.items[2]!)
  );
}

function isDefineClassForm(expr: SExpr): boolean {
  return (
    expr._tag === "List" &&
    symName(expr.items[0]) === "define-class" &&
    expr.items.length === 3 &&
    isFieldsBlock(expr.items[2]!)
  );
}

function isDefineErrorForm(expr: SExpr): boolean {
  return (
    expr._tag === "List" &&
    symName(expr.items[0]) === "define-error" &&
    expr.items.length === 3 &&
    isFieldsBlock(expr.items[2]!)
  );
}

function isDefineServiceForm(expr: SExpr): boolean {
  return (
    expr._tag === "List" &&
    symName(expr.items[0]) === "define-service" &&
    expr.items.length === 3 &&
    isMethodsBlock(expr.items[2]!)
  );
}

function isDefineOperationForm(expr: SExpr): boolean {
  return expr._tag === "List" && symName(expr.items[0]) === "define-operation";
}

function isSchemaProjectionExpr(expr: SExpr): boolean {
  if (expr._tag === "Sym") return !expr.name.startsWith(":");
  if (expr._tag !== "List" || expr.items.length === 0) return false;
  const head = canonicalSchemaHead(symName(expr.items[0]));
  return (
    head === "Struct" ||
    head === "Array" ||
    head === "Optional" ||
    head === "Map" ||
    head === "Ref" ||
    head === "Brand" ||
    head === "Enum" ||
    head === "Literal" ||
    head === "Tuple" ||
    head === "Union" ||
    head === "TaggedUnion" ||
    (head !== undefined &&
      !head.startsWith(":") &&
      expr.items.length > 1 &&
      metadataPairs(expr.items.slice(1)).ok)
  );
}

function isFieldsBlock(expr: SExpr): expr is Extract<SExpr, { readonly _tag: "List" }> {
  return expr._tag === "List" && symName(expr.items[0]) === ":fields";
}

function isMethodsBlock(expr: SExpr): expr is Extract<SExpr, { readonly _tag: "List" }> {
  return expr._tag === "List" && symName(expr.items[0]) === ":methods";
}

function declaration(
  expr: SExpr,
  sourceId: string,
  formIndex: number,
  signatures: ReadonlyMap<string, SExpr>,
  serviceMethodEffects: ServiceMethodEffects,
  operationEffects: OperationEffects,
):
  | { readonly ok: true; readonly declaration: PackageableDeclaration }
  | { readonly ok: false; readonly diagnostics: readonly MechanicsArtifactDiagnostic[] } {
  if (expr._tag !== "List") {
    return {
      ok: false,
      diagnostics: [diagnostic(sourceId, expr, "artifact/form", "Expected declaration form.")],
    };
  }

  switch (symName(expr.items[0])) {
    case "define-schema":
      return schemaDeclaration(expr, sourceId, formIndex);
    case "define-error":
      return errorDeclaration(expr, sourceId, formIndex);
    case "define-class":
      return errorDeclaration(expr, sourceId, formIndex, "ClassDef");
    case "define-service":
      return serviceDeclaration(expr, sourceId, formIndex);
    case "define-operation":
      return operationDeclaration(
        expr,
        sourceId,
        formIndex,
        signatures,
        serviceMethodEffects,
        operationEffects,
      );
    case "define":
      return functionDeclaration(expr, sourceId, formIndex, signatures);
    case "define-layer":
      return layerDeclaration(
        expr,
        sourceId,
        formIndex,
        signatures,
        serviceMethodEffects,
        operationEffects,
      );
    default:
      return {
        ok: false,
        diagnostics: [diagnostic(sourceId, expr, "artifact/form", "Expected mechanics form.")],
      };
  }
}

function operationSignatures(exprs: readonly SExpr[]): ReadonlyMap<string, SExpr> {
  const signatures = new Map<string, SExpr>();
  for (const expr of exprs) {
    if (expr._tag !== "List" || expr.items.length !== 3 || symName(expr.items[0]) !== ":") {
      continue;
    }
    const name = symName(expr.items[1]);
    if (name) signatures.set(name, expr.items[2]!);
  }
  return signatures;
}

function collectServiceMethodEffects(
  exprs: readonly SExpr[],
  sourceId: string,
): ServiceMethodEffects {
  const effects = new Map<string, JsonValue>();
  for (const expr of exprs) {
    if (!isDefineServiceForm(expr)) continue;
    if (expr._tag !== "List") continue;
    const serviceName = symName(expr.items[1]);
    const methodsBlock = expr.items[2];
    if (!serviceName || methodsBlock?._tag !== "List") continue;

    for (const method of methodsBlock.items.slice(1)) {
      const methodJson = methodToJson(sourceId, serviceName, method);
      if (!methodJson.ok || !isRecord(methodJson.value)) continue;
      const methodName = methodJson.value["name"];
      const effect = methodJson.value["effect"];
      if (typeof methodName === "string" && effect !== undefined) {
        effects.set(`${serviceName}.${methodName}`, effect);
      }
    }
  }
  return effects;
}

function collectOperationEffects(
  exprs: readonly SExpr[],
  sourceId: string,
  signatures: ReadonlyMap<string, SExpr>,
): OperationEffects {
  const effects = new Map<string, JsonValue>();
  for (const expr of exprs) {
    if (!isDefineOperationForm(expr) || expr._tag !== "List") continue;
    const name = symName(expr.items[1]);
    const paramsExpr = expr.items[2];
    if (!name || paramsExpr?._tag !== "Vector") continue;
    const signature = signatures.get(name);
    if (!signature) continue;
    const signatureJson = operationSignatureToJson(sourceId, signature, paramsExpr);
    if (signatureJson.ok) {
      effects.set(name, signatureJson.value.effect);
    }
  }
  return effects;
}

function schemaDeclaration(
  expr: SExpr,
  sourceId: string,
  formIndex: number,
):
  | { readonly ok: true; readonly declaration: PackageableDeclaration }
  | { readonly ok: false; readonly diagnostics: readonly MechanicsArtifactDiagnostic[] } {
  if (expr._tag !== "List" || expr.items.length !== 3) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/schema",
          "define-schema expects a schema name and schema expression.",
        ),
      ],
    };
  }

  const name = symName(expr.items[1]);
  if (!name) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr.items[1]!,
          "artifact/schema",
          "define-schema expects a schema name.",
        ),
      ],
    };
  }

  const schema = schemaExprToJson(sourceId, expr.items[2]!);
  if (!schema.ok) return schema;

  return {
    ok: true,
    declaration: {
      summary: { kind: "SchemaDef", name, resultType: "SchemaDef" },
      payload: {
        kind: "SchemaDef",
        name,
        schema: schema.value,
      },
      payloadContract: "mechanics/schema-def/v0",
      validators: ["payload-contract"],
      sourceId,
      formIndex,
      span: spanOf(sourceId, expr),
    },
  };
}

/** `define-error` and `define-class` share the `(Name (:fields ...))` shape. */
function errorDeclaration(
  expr: SExpr,
  sourceId: string,
  formIndex: number,
  kind: "ErrorDef" | "ClassDef" = "ErrorDef",
):
  | { readonly ok: true; readonly declaration: PackageableDeclaration }
  | { readonly ok: false; readonly diagnostics: readonly MechanicsArtifactDiagnostic[] } {
  if (expr._tag !== "List" || expr.items.length !== 3) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/error",
          "define-error expects an error name and (:fields ...) block.",
        ),
      ],
    };
  }

  const name = symName(expr.items[1]);
  if (!name) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr.items[1]!,
          "artifact/error",
          "define-error expects an error name.",
        ),
      ],
    };
  }

  const fieldsBlock = expr.items[2]!;
  if (!isFieldsBlock(fieldsBlock)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          fieldsBlock,
          "artifact/error",
          "define-error expects a (:fields ...) block.",
        ),
      ],
    };
  }

  const fields: JsonValue[] = [];
  for (const field of fieldsBlock.items.slice(1)) {
    const result = fieldToJson(sourceId, field);
    if (!result.ok) return result;
    fields.push(result.value);
  }

  return {
    ok: true,
    declaration: {
      summary: { kind, name, resultType: kind },
      payload: {
        kind,
        name,
        schema: { kind: "Struct", fields },
      },
      payloadContract: kind === "ErrorDef" ? "mechanics/error-def/v0" : "mechanics/class-def/v0",
      validators: ["payload-contract"],
      sourceId,
      formIndex,
      span: spanOf(sourceId, expr),
    },
  };
}

function serviceDeclaration(
  expr: SExpr,
  sourceId: string,
  formIndex: number,
):
  | { readonly ok: true; readonly declaration: PackageableDeclaration }
  | { readonly ok: false; readonly diagnostics: readonly MechanicsArtifactDiagnostic[] } {
  if (expr._tag !== "List" || expr.items.length !== 3) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/service",
          "define-service expects a service name and (:methods ...) block.",
        ),
      ],
    };
  }

  const name = symName(expr.items[1]);
  if (!name) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr.items[1]!,
          "artifact/service",
          "define-service expects a service name.",
        ),
      ],
    };
  }

  const methodsBlock = expr.items[2]!;
  if (!isMethodsBlock(methodsBlock)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          methodsBlock,
          "artifact/service",
          "define-service expects a (:methods ...) block.",
        ),
      ],
    };
  }

  const methods: JsonValue[] = [];
  for (const method of methodsBlock.items.slice(1)) {
    const result = methodToJson(sourceId, name, method);
    if (!result.ok) return result;
    methods.push(result.value);
  }

  return {
    ok: true,
    declaration: {
      summary: { kind: "ServiceDef", name, resultType: "ServiceDef" },
      payload: {
        kind: "ServiceDef",
        name,
        methods,
      },
      payloadContract: "mechanics/service-def/v0",
      validators: ["payload-contract"],
      sourceId,
      formIndex,
      span: spanOf(sourceId, expr),
    },
  };
}

function operationDeclaration(
  expr: SExpr,
  sourceId: string,
  formIndex: number,
  signatures: ReadonlyMap<string, SExpr>,
  serviceMethodEffects: ServiceMethodEffects,
  operationEffects: OperationEffects,
):
  | { readonly ok: true; readonly declaration: PackageableDeclaration }
  | { readonly ok: false; readonly diagnostics: readonly MechanicsArtifactDiagnostic[] } {
  if (expr._tag !== "List" || expr.items.length < 4) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/effect",
          "define-operation expects a name, parameter vector, and body.",
        ),
      ],
    };
  }

  const name = symName(expr.items[1]);
  if (!name) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr.items[1]!,
          "artifact/effect",
          "define-operation expects an operation name.",
        ),
      ],
    };
  }

  const paramsExpr = expr.items[2]!;
  if (paramsExpr._tag !== "Vector") {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          paramsExpr,
          "artifact/effect",
          "define-operation expects a parameter vector.",
        ),
      ],
    };
  }

  const signature = signatures.get(name);
  if (!signature) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/effect",
          "define-operation requires a preceding type signature.",
        ),
      ],
    };
  }

  const signatureJson = operationSignatureToJson(sourceId, signature, paramsExpr);
  if (!signatureJson.ok) return signatureJson;

  const bodyForms = expr.items.slice(3);
  const context = bodyContext(sourceId, serviceMethodEffects, operationEffects, signatureJson.value.effect);
  const body = effectBodyFormsToJson(context, bodyForms);
  if (context.diagnostics.length > 0) return { ok: false, diagnostics: context.diagnostics };
  const capabilities =
    isRecord(signatureJson.value.effect) && Array.isArray(signatureJson.value.effect["requirements"])
      ? signatureJson.value.effect["requirements"]
      : [];

  return {
    ok: true,
    declaration: {
      summary: { kind: "EffectDef", name, resultType: "EffectDef" },
      payload: {
        kind: "EffectDef",
        name,
        params: signatureJson.value.params,
        effect: signatureJson.value.effect,
        authority: { capabilities },
        body,
      },
      payloadContract: "mechanics/effect-def/v0",
      validators: ["payload-contract"],
      sourceId,
      formIndex,
      span: spanOf(sourceId, expr),
    },
  };
}

type DeclarationResult =
  | { readonly ok: true; readonly declaration: PackageableDeclaration }
  | { readonly ok: false; readonly diagnostics: readonly MechanicsArtifactDiagnostic[] };

function failed(
  sourceId: string,
  expr: SExpr,
  code: string,
  message: string,
): { readonly ok: false; readonly diagnostics: readonly MechanicsArtifactDiagnostic[] } {
  return { ok: false, diagnostics: [diagnostic(sourceId, expr, code, message)] };
}

/**
 * `(: name (-> A B R))` + `(define name (fn [a b] body))`: a pure helper
 * function. The body is a value expression; effects belong in
 * `define-operation`.
 */
function functionDeclaration(
  expr: SExpr,
  sourceId: string,
  formIndex: number,
  signatures: ReadonlyMap<string, SExpr>,
): DeclarationResult {
  if (expr._tag !== "List" || expr.items.length !== 3) {
    return failed(sourceId, expr, "artifact/function", "define expects a name and a (fn ...) value.");
  }
  const name = symName(expr.items[1])!;
  const fnExpr = expr.items[2]!;
  const signature = signatures.get(name)!;
  if (fnExpr._tag !== "List" || symName(fnExpr.items[0]) !== "fn") {
    const type = typeExprToJson(sourceId, signature);
    if (!type.ok) return type;
    return {
      ok: true,
      declaration: {
        summary: { kind: "ValueDef", name, resultType: "ValueDef" },
        payload: { kind: "ValueDef", name, type: type.value, value: valueExprToCoreJson(sourceId, fnExpr) },
        payloadContract: "mechanics/value-def/v0",
        validators: ["payload-contract"],
        sourceId,
        formIndex,
        span: spanOf(sourceId, expr),
      },
    };
  }
  if (fnExpr.items[1]?._tag !== "Vector" || fnExpr.items.length < 3) {
    return failed(sourceId, fnExpr, "artifact/function", "typed define expects (fn [params...] body).");
  }
  const paramsExpr = fnExpr.items[1];
  if (signature._tag !== "List" || symName(signature.items[0]) !== "->" || signature.items.length < 2) {
    return failed(sourceId, signature, "artifact/function", "function signature must be (-> Input... Output).");
  }
  const inputTypes = signature.items.slice(1, -1);
  if (inputTypes.length !== paramsExpr.items.length) {
    return failed(
      sourceId,
      paramsExpr,
      "artifact/function",
      `function signature declares ${inputTypes.length} parameter(s) but (fn ...) binds ${paramsExpr.items.length}.`,
    );
  }
  const params: JsonValue[] = [];
  for (let index = 0; index < paramsExpr.items.length; index++) {
    const paramName = scalarName(paramsExpr.items[index]);
    if (!paramName) {
      return failed(sourceId, paramsExpr.items[index]!, "artifact/function", "function parameters must be symbolic names.");
    }
    const type = typeExprToJson(sourceId, inputTypes[index]!);
    if (!type.ok) return type;
    params.push({ name: paramName, type: type.value });
  }
  const returns = typeExprToJson(sourceId, signature.items.at(-1)!);
  if (!returns.ok) return returns;
  if (isRecord(returns.value) && returns.value["kind"] === "Effect") {
    return failed(
      sourceId,
      expr,
      "artifact/function",
      `${name} returns an Effect; write it with define-operation so its body is an effect program.`,
    );
  }
  const bodyForms = fnExpr.items.slice(2);
  if (bodyForms.length !== 1) {
    return failed(sourceId, fnExpr, "artifact/function", "function bodies must be a single value expression.");
  }
  return {
    ok: true,
    declaration: {
      summary: { kind: "FunctionDef", name, resultType: "FunctionDef" },
      payload: {
        kind: "FunctionDef",
        name,
        params,
        returns: returns.value,
        body: valueExprToCoreJson(sourceId, bodyForms[0]!),
      },
      payloadContract: "mechanics/function-def/v0",
      validators: ["payload-contract"],
      sourceId,
      formIndex,
      span: spanOf(sourceId, expr),
    },
  };
}

/**
 * `(define-layer Name (:provides Service) (:setup [x eff ...]) (:methods (m [p] body) ...))`
 * implements a service; `(define-layer Name LayerExpr)` composes layers with
 * `layer-merge`, `layer-provide`, and `layer-provide-merge`. An optional
 * `(: Name (Layer [Provides...] [Errors...] [Requirements...]))` signature is
 * checked against the inferred layer type.
 */
function layerDeclaration(
  expr: SExpr,
  sourceId: string,
  formIndex: number,
  signatures: ReadonlyMap<string, SExpr>,
  serviceMethodEffects: ServiceMethodEffects,
  operationEffects: OperationEffects,
): DeclarationResult {
  if (expr._tag !== "List" || expr.items.length < 3) {
    return failed(sourceId, expr, "artifact/layer", "define-layer expects a name and a layer body.");
  }
  const name = symName(expr.items[1]);
  if (!name) return failed(sourceId, expr.items[1]!, "artifact/layer", "define-layer expects a layer name.");

  let signature: JsonValue | undefined;
  const signatureExpr = signatures.get(name);
  if (signatureExpr) {
    const parsed = layerTypeToJson(sourceId, signatureExpr);
    if (!parsed.ok) return parsed;
    signature = parsed.value;
  }

  const sections = expr.items.slice(2);
  const isServiceLayer = sections.every(
    (section) => section._tag === "List" && symName(section.items[0])?.startsWith(":") === true,
  );
  let implementation: JsonValue;
  if (isServiceLayer) {
    const result = serviceLayerToJson(sourceId, name, sections, serviceMethodEffects, operationEffects);
    if (!result.ok) return result;
    implementation = result.value;
  } else {
    if (sections.length !== 1) {
      return failed(sourceId, expr, "artifact/layer", "a composed layer is a single layer expression.");
    }
    const result = layerExprToJson(sourceId, sections[0]!);
    if (!result.ok) return result;
    implementation = { kind: "Compose", layer: result.value };
  }

  return {
    ok: true,
    declaration: {
      summary: { kind: "LayerDef", name, resultType: "LayerDef" },
      payload: {
        kind: "LayerDef",
        name,
        ...(signature === undefined ? {} : { signature }),
        implementation,
      },
      payloadContract: "mechanics/layer-def/v0",
      validators: ["payload-contract"],
      sourceId,
      formIndex,
      span: spanOf(sourceId, expr),
    },
  };
}

function serviceLayerToJson(
  sourceId: string,
  layerName: string,
  sections: readonly SExpr[],
  serviceMethodEffects: ServiceMethodEffects,
  operationEffects: OperationEffects,
): MechanicsJsonResult {
  let service: string | undefined;
  let setup: JsonValue[] = [];
  const methods: JsonValue[] = [];
  const context = bodyContext(sourceId, serviceMethodEffects, operationEffects, {
    kind: "Effect",
    success: { kind: "Primitive", name: "Unit" },
    errors: [],
    requirements: [],
  });
  for (const section of sections) {
    if (section._tag !== "List") continue;
    const keyword = symName(section.items[0]);
    switch (keyword) {
      case ":provides": {
        service = symName(section.items[1]);
        if (!service || section.items.length !== 2) {
          return failed(sourceId, section, "artifact/layer", "(:provides Service) names exactly one service.");
        }
        break;
      }
      case ":setup": {
        const bindings = section.items[1];
        if (bindings?._tag !== "Vector" || section.items.length !== 2) {
          return failed(sourceId, section, "artifact/layer", "(:setup [name effect ...]) expects one binding vector.");
        }
        setup = bindingPairsToJson(context, bindings);
        break;
      }
      case ":methods": {
        for (const method of section.items.slice(1)) {
          if (method._tag !== "List" || method.items.length < 3 || method.items[1]?._tag !== "Vector") {
            return failed(sourceId, method, "artifact/layer", "layer methods must be (name [params...] body).");
          }
          const methodName = symName(method.items[0]);
          if (!methodName) {
            return failed(sourceId, method.items[0]!, "artifact/layer", "layer methods require a method name.");
          }
          const params: string[] = [];
          for (const param of method.items[1].items) {
            const paramName = scalarName(param);
            if (!paramName) {
              return failed(sourceId, param, "artifact/layer", "layer method parameters must be symbolic names.");
            }
            params.push(paramName);
          }
          methods.push({
            name: methodName,
            params,
            body: effectBodyFormsToJson(context, method.items.slice(2)),
            span: spanJson(sourceId, method),
          });
        }
        break;
      }
      default:
        return failed(
          sourceId,
          section,
          "artifact/layer",
          `Unknown layer section ${keyword ?? "?"}; expected :provides, :setup, or :methods.`,
        );
    }
  }
  if (context.diagnostics.length > 0) return { ok: false, diagnostics: context.diagnostics };
  if (!service) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "artifact/layer",
          message: `Layer ${layerName} implements a service and needs a (:provides Service) section.`,
          ...(sections[0] ? { span: spanOf(sourceId, sections[0]) } : {}),
        },
      ],
    };
  }
  return { ok: true, value: { kind: "Service", service, setup, methods } };
}

function layerExprToJson(sourceId: string, expr: SExpr): MechanicsJsonResult {
  const name = symName(expr);
  if (name) return { ok: true, value: { kind: "LayerRef", name, span: spanJson(sourceId, expr) } };
  if (expr._tag !== "List" || expr.items.length < 2) {
    return failed(sourceId, expr, "artifact/layer", "Expected a layer name or (layer-merge|layer-provide|layer-provide-merge ...).");
  }
  const head = symName(expr.items[0]);
  const operands: JsonValue[] = [];
  for (const item of expr.items.slice(1)) {
    const operand = layerExprToJson(sourceId, item);
    if (!operand.ok) return operand;
    operands.push(operand.value);
  }
  switch (head) {
    case "layer-merge":
      return { ok: true, value: { kind: "LayerMerge", layers: operands, span: spanJson(sourceId, expr) } };
    case "layer-provide":
    case "layer-provide-merge":
      if (operands.length < 2) {
        return failed(sourceId, expr, "artifact/layer", `${head} expects a layer and at least one dependency layer.`);
      }
      return {
        ok: true,
        value: {
          kind: head === "layer-provide" ? "LayerProvide" : "LayerProvideMerge",
          layer: operands[0]!,
          dependencies: operands.slice(1),
          span: spanJson(sourceId, expr),
        },
      };
    default:
      return failed(sourceId, expr, "artifact/layer", `Unknown layer combinator ${head ?? "?"}.`);
  }
}

function layerTypeToJson(sourceId: string, expr: SExpr): MechanicsJsonResult {
  if (
    expr._tag !== "List" ||
    symName(expr.items[0]) !== "Layer" ||
    expr.items.length !== 4 ||
    expr.items.slice(1).some((item) => item._tag !== "Vector")
  ) {
    return failed(sourceId, expr, "artifact/layer-type", "Layer type expects (Layer [Provides...] [Errors...] [Requirements...]).");
  }
  const provides = symbolicSetToJson(sourceId, expr.items[1]!, "provides");
  if (!provides.ok) return provides;
  const errors = symbolicSetToJson(sourceId, expr.items[2]!, "errors");
  if (!errors.ok) return errors;
  const requirements = symbolicSetToJson(sourceId, expr.items[3]!, "requirements");
  if (!requirements.ok) return requirements;
  return {
    ok: true,
    value: {
      kind: "Layer",
      provides: provides.value,
      errors: errors.value,
      requirements: requirements.value,
      span: spanJson(sourceId, expr),
    },
  };
}

interface BodyContext {
  readonly sourceId: string;
  readonly serviceMethodEffects: ServiceMethodEffects;
  readonly operationEffects: OperationEffects;
  readonly effect: JsonValue;
  readonly diagnostics: MechanicsArtifactDiagnostic[];
}

function bodyContext(
  sourceId: string,
  serviceMethodEffects: ServiceMethodEffects,
  operationEffects: OperationEffects,
  effect: JsonValue,
): BodyContext {
  return { sourceId, serviceMethodEffects, operationEffects, effect, diagnostics: [] };
}

function report(context: BodyContext, expr: SExpr, code: string, message: string): JsonValue {
  context.diagnostics.push(diagnostic(context.sourceId, expr, code, message));
  return { kind: "Pure", value: { kind: "Literal", value: null }, effect: context.effect, span: spanJson(context.sourceId, expr) };
}

/**
 * Argument shapes for the Effect combinators a body can call. `effect`
 * arguments are effect programs, `lambda` arguments are `(fn [x] effect...)`,
 * `effects` is a vector or map of effect programs, `type` is a type
 * expression, and `value` is an ordinary value expression.
 */
type CombinatorArg = "effect" | "value" | "lambda" | "effects" | "type";

interface CombinatorSpec {
  readonly args: readonly CombinatorArg[];
  readonly rest?: CombinatorArg;
  readonly options?: readonly string[];
}

const combinators: ReadonlyMap<string, CombinatorSpec> = new Map<string, CombinatorSpec>([
  ["scoped", { args: ["effect"] }],
  ["acquire-release", { args: ["effect", "lambda"] }],
  ["ensuring", { args: ["effect", "effect"] }],
  ["add-finalizer", { args: ["effect"] }],
  ["all", { args: ["effects"], options: ["concurrency"] }],
  ["for-each", { args: ["value", "lambda"], options: ["concurrency"] }],
  ["race", { args: ["effect", "effect"] }],
  ["fork", { args: ["effect"] }],
  ["join", { args: ["value"] }],
  ["interrupt", { args: ["value"] }],
  ["sleep", { args: ["value"] }],
  ["timeout", { args: ["effect", "value"] }],
  ["retry", { args: ["effect"], options: ["times"] }],
  ["map-error", { args: ["effect", "value"] }],
  ["or-else-succeed", { args: ["effect", "value"] }],
  ["or-die", { args: ["effect"] }],
  ["option", { args: ["effect"] }],
  ["result", { args: ["effect"] }],
  ["provide", { args: ["effect", "value"] }],
  ["log", { args: [], rest: "value" }],
  ["ref-make", { args: ["value"] }],
  ["ref-get", { args: ["value"] }],
  ["ref-set", { args: ["value", "value"] }],
  ["ref-update", { args: ["value", "value"] }],
  ["config", { args: ["type", "value"], options: ["default"] }],
  ["decode", { args: ["type", "value"] }],
]);

function effectBodyFormsToJson(context: BodyContext, bodyForms: readonly SExpr[]): JsonValue {
  if (bodyForms.length === 1) return effectCoreExprToJson(context, bodyForms[0]!);
  if (bodyForms.length === 0) {
    return { kind: "Pure", value: { kind: "Var", name: "nil" }, effect: context.effect };
  }
  return {
    kind: "Do",
    forms: bodyForms.map((form) => effectCoreExprToJson(context, form)),
    effect: context.effect,
    span: spanJson(context.sourceId, bodyForms[0]!),
  };
}

function effectCoreExprToJson(context: BodyContext, expr: SExpr): JsonValue {
  const { sourceId, effect } = context;
  if (expr._tag === "List" && expr.items.length > 0) {
    const head = symName(expr.items[0]);
    if (head?.includes(".") && !head.startsWith(".")) {
      const [service, method] = head.split(".", 2);
      if (service && method) {
        return {
          kind: "ServiceCall",
          service,
          method,
          args: expr.items.slice(1).map((arg) => valueExprToCoreJson(sourceId, arg)),
          effect: context.serviceMethodEffects.get(head) ?? effect,
          span: spanJson(sourceId, expr),
        };
      }
    }
    if (head && context.operationEffects.has(head)) {
      return {
        kind: "OperationCall",
        operation: head,
        args: expr.items.slice(1).map((arg) => valueExprToCoreJson(sourceId, arg)),
        effect: context.operationEffects.get(head) ?? effect,
        span: spanJson(sourceId, expr),
      };
    }

    const combinator = head ? combinators.get(head) : undefined;
    if (head && combinator) return combinatorToJson(context, expr, head, combinator);

    switch (head) {
      case "succeed":
        if (expr.items.length !== 2) {
          return report(context, expr, "artifact/effect-body", "succeed expects exactly one value.");
        }
        return {
          kind: "Succeed",
          value: valueExprToCoreJson(sourceId, expr.items[1]!),
          effect,
          span: spanJson(sourceId, expr),
        };
      case "fail":
        if (expr.items.length !== 2) {
          return report(context, expr, "artifact/effect-body", "fail expects exactly one error value.");
        }
        return {
          kind: "Fail",
          error: errorValueToCoreJson(sourceId, expr.items[1]!),
          effect,
          span: spanJson(sourceId, expr),
        };
      case "catch":
        return effectCatchToJson(context, expr);
      case "<-":
        if (expr.items.length !== 2) {
          return report(context, expr, "artifact/effect-body", "<- expects exactly one effect.");
        }
        return {
          kind: "Bind",
          value: effectCoreExprToJson(context, expr.items[1]!),
          effect,
          span: spanJson(sourceId, expr),
        };
      case "do":
        return {
          kind: "Do",
          forms: expr.items.slice(1).map((form) => effectCoreExprToJson(context, form)),
          effect,
          span: spanJson(sourceId, expr),
        };
      case "if":
        if (expr.items.length !== 4) {
          return report(
            context,
            expr,
            "artifact/effect-body",
            "if expects a condition, a then branch, and an else branch; use when or unless for one branch.",
          );
        }
        return {
          kind: "If",
          condition: valueExprToCoreJson(sourceId, expr.items[1]!),
          then: effectCoreExprToJson(context, expr.items[2]!),
          else: effectCoreExprToJson(context, expr.items[3]!),
          effect,
          span: spanJson(sourceId, expr),
        };
      case "when":
      case "unless":
        if (expr.items.length < 3) {
          return report(context, expr, "artifact/effect-body", `${head} expects a condition and a body.`);
        }
        return {
          kind: head === "when" ? "When" : "Unless",
          condition: valueExprToCoreJson(sourceId, expr.items[1]!),
          body: effectBodyFormsToJson(context, expr.items.slice(2)),
          effect,
          span: spanJson(sourceId, expr),
        };
      case "cond":
        return effectCondToJson(context, expr);
      case "do!":
      case "let":
        return effectBindingsToJson(context, expr, head === "do!" ? "Do" : "Let");
      case "match":
        return effectMatchToJson(context, expr);
      default:
        break;
    }
  }

  return {
    kind: "Pure",
    value: valueExprToCoreJson(sourceId, expr),
    effect,
    span: spanJson(sourceId, expr),
  };
}

function combinatorToJson(
  context: BodyContext,
  expr: Extract<SExpr, { readonly _tag: "List" }>,
  name: string,
  spec: CombinatorSpec,
): JsonValue {
  const items = expr.items.slice(1);
  const optionStart = spec.options
    ? items.findIndex((item, index) => index >= spec.args.length && symName(item)?.startsWith(":") === true)
    : -1;
  const positional = optionStart === -1 ? items : items.slice(0, optionStart);
  const optionItems = optionStart === -1 ? [] : items.slice(optionStart);
  const arity = spec.args.length;
  if (spec.rest ? positional.length < arity : positional.length !== arity) {
    return report(
      context,
      expr,
      "artifact/effect-body",
      `${name} expects ${spec.rest ? "at least " : ""}${arity} argument(s), received ${positional.length}.`,
    );
  }
  const args: JsonValue[] = [];
  for (let index = 0; index < positional.length; index++) {
    const kind = spec.args[index] ?? spec.rest ?? "value";
    args.push(combinatorArgToJson(context, positional[index]!, kind, name));
  }
  const options: JsonValue[] = [];
  if (optionItems.length % 2 !== 0) {
    return report(context, expr, "artifact/effect-body", `${name} options must be :keyword value pairs.`);
  }
  for (let index = 0; index < optionItems.length; index += 2) {
    const key = symName(optionItems[index])?.replace(/^:/, "");
    if (!key || !spec.options?.includes(key)) {
      return report(
        context,
        optionItems[index]!,
        "artifact/effect-body",
        `${name} does not accept option ${symName(optionItems[index]) ?? "?"}; expected ${(spec.options ?? []).map((option) => `:${option}`).join(", ") || "no options"}.`,
      );
    }
    options.push({ key, value: valueExprToCoreJson(context.sourceId, optionItems[index + 1]!) });
  }
  return {
    kind: "Combinator",
    name,
    args,
    ...(options.length > 0 ? { options } : {}),
    effect: context.effect,
    span: spanJson(context.sourceId, expr),
  };
}

function combinatorArgToJson(
  context: BodyContext,
  expr: SExpr,
  kind: CombinatorArg,
  name: string,
): JsonValue {
  const { sourceId } = context;
  switch (kind) {
    case "effect":
      return effectCoreExprToJson(context, expr);
    case "value":
      return valueExprToCoreJson(sourceId, expr);
    case "type": {
      const type = typeExprToJson(sourceId, expr);
      if (!type.ok) {
        context.diagnostics.push(...type.diagnostics);
        return { kind: "TypeArg", type: { kind: "Primitive", name: "Unit" } };
      }
      return { kind: "TypeArg", type: type.value, span: spanJson(sourceId, expr) };
    }
    case "lambda": {
      if (expr._tag !== "List" || symName(expr.items[0]) !== "fn" || expr.items[1]?._tag !== "Vector") {
        return report(context, expr, "artifact/effect-body", `${name} expects (fn [params...] effect) here.`);
      }
      const params: string[] = [];
      for (const param of expr.items[1].items) {
        const paramName = scalarName(param);
        if (!paramName) return report(context, param, "artifact/effect-body", "fn parameters must be symbolic names.");
        params.push(paramName);
      }
      return {
        kind: "Lambda",
        params,
        body: effectBodyFormsToJson(context, expr.items.slice(2)),
        span: spanJson(sourceId, expr),
      };
    }
    case "effects":
      if (expr._tag === "Vector") {
        return {
          kind: "EffectVector",
          items: expr.items.map((item) => effectCoreExprToJson(context, item)),
          span: spanJson(sourceId, expr),
        };
      }
      if (expr._tag === "Map") {
        const entries: JsonValue[] = [];
        for (const [key, value] of expr.pairs) {
          const keyName = scalarName(key);
          if (!keyName) return report(context, key, "artifact/effect-body", `${name} map keys must be keywords.`);
          entries.push({ key: keyName, value: effectCoreExprToJson(context, value) });
        }
        return { kind: "EffectRecord", entries, span: spanJson(sourceId, expr) };
      }
      return report(context, expr, "artifact/effect-body", `${name} expects a vector or map of effects.`);
  }
}

function effectCondToJson(context: BodyContext, expr: Extract<SExpr, { readonly _tag: "List" }>): JsonValue {
  const clauses: JsonValue[] = [];
  const items = expr.items.slice(1);
  if (items.length === 0 || items.length % 2 !== 0) {
    return report(context, expr, "artifact/effect-body", "cond expects condition/body pairs.");
  }
  for (let index = 0; index + 1 < items.length; index += 2) {
    clauses.push({
      condition: valueExprToCoreJson(context.sourceId, items[index]!),
      body: effectCoreExprToJson(context, items[index + 1]!),
      span: spanJson(context.sourceId, items[index]!),
    });
  }
  return {
    kind: "Cond",
    clauses,
    effect: context.effect,
    span: spanJson(context.sourceId, expr),
  };
}

function effectBindingsToJson(
  context: BodyContext,
  expr: Extract<SExpr, { readonly _tag: "List" }>,
  kind: "Do" | "Let",
): JsonValue {
  const bindingsExpr = expr.items[1];
  const form = kind === "Do" ? "do!" : "let";
  if (bindingsExpr?._tag !== "Vector" || bindingsExpr.items.length % 2 !== 0) {
    return report(context, expr, "artifact/effect-body", `${form} expects a [name value ...] binding vector.`);
  }
  if (expr.items.length < 3) {
    return report(context, expr, "artifact/effect-body", `${form} expects a body after its bindings.`);
  }
  return {
    kind,
    bindings: bindingPairsToJson(context, bindingsExpr),
    body: effectBodyFormsToJson(context, expr.items.slice(2)),
    effect: context.effect,
    span: spanJson(context.sourceId, expr),
  };
}

function bindingPairsToJson(
  context: BodyContext,
  bindingsExpr: Extract<SExpr, { readonly _tag: "Vector" }>,
): JsonValue[] {
  const items = bindingsExpr.items;
  const bindings: JsonValue[] = [];
  if (items.length % 2 !== 0) {
    report(context, bindingsExpr, "artifact/effect-body", "bindings must be [name value ...] pairs.");
    return bindings;
  }
  for (let index = 0; index + 1 < items.length; index += 2) {
    const name = items[index]?._tag === "Sym" ? scalarName(items[index]) : undefined;
    if (!name) {
      report(context, items[index]!, "artifact/effect-body", "binding names must be symbols.");
      continue;
    }
    const value = unwrapArrowBind(items[index + 1]!);
    bindings.push({
      name,
      value: effectCoreExprToJson(context, value),
      span: spanJson(context.sourceId, value),
    });
  }
  return bindings;
}

function unwrapArrowBind(expr: SExpr): SExpr {
  if (expr._tag === "List" && symName(expr.items[0]) === "<-" && expr.items[1]) {
    return expr.items[1];
  }
  return expr;
}

function effectMatchToJson(context: BodyContext, expr: Extract<SExpr, { readonly _tag: "List" }>): JsonValue {
  const arms: JsonValue[] = [];
  const items = expr.items.slice(2);
  if (expr.items.length < 4 || items.length % 2 !== 0) {
    return report(context, expr, "artifact/effect-body", "match expects a value and pattern/body pairs.");
  }
  for (let index = 0; index + 1 < items.length; index += 2) {
    arms.push({
      pattern: valueExprToCoreJson(context.sourceId, items[index]!),
      body: effectCoreExprToJson(context, items[index + 1]!),
      span: spanJson(context.sourceId, items[index]!),
    });
  }
  return {
    kind: "Match",
    value: valueExprToCoreJson(context.sourceId, expr.items[1]!),
    arms,
    effect: context.effect,
    span: spanJson(context.sourceId, expr),
  };
}

/**
 * `(catch body (E e) handler)` recovers from one tagged error;
 * `(catch body (E1 a) h1 (E2 b) h2 ...)` recovers from several with one
 * `catchTags`; `(catch body (_ e) handler)` recovers from every typed error.
 */
function effectCatchToJson(context: BodyContext, expr: Extract<SExpr, { readonly _tag: "List" }>): JsonValue {
  const clauses = expr.items.slice(2);
  if (expr.items.length < 4 || clauses.length % 2 !== 0) {
    return report(
      context,
      expr,
      "artifact/effect-body",
      "catch expects an effect followed by (ErrorType binding) handler pairs.",
    );
  }
  const handlers: JsonValue[] = [];
  for (let index = 0; index < clauses.length; index += 2) {
    const pattern = clauses[index]!;
    const errorType = pattern._tag === "List" && pattern.items.length === 2 ? symName(pattern.items[0]) : undefined;
    const binding = pattern._tag === "List" && pattern.items.length === 2 ? symName(pattern.items[1]) : undefined;
    if (!errorType || !binding) {
      return report(context, pattern, "artifact/effect-body", "catch patterns must be (ErrorType binding) or (_ binding).");
    }
    handlers.push({
      errorType,
      binding,
      handler: effectCoreExprToJson(context, clauses[index + 1]!),
      span: spanJson(context.sourceId, pattern),
    });
  }
  const body = effectCoreExprToJson(context, expr.items[1]!);
  const first = handlers[0] as Record<string, JsonValue>;
  if (handlers.length === 1 && first["errorType"] === "_") {
    return {
      kind: "CatchAll",
      body,
      binding: first["binding"]!,
      handler: first["handler"]!,
      effect: context.effect,
      span: spanJson(context.sourceId, expr),
    };
  }
  if (handlers.some((handler) => (handler as Record<string, JsonValue>)["errorType"] === "_")) {
    return report(context, expr, "artifact/effect-body", "a (_ binding) catch-all must be the only catch clause.");
  }
  if (handlers.length === 1) {
    return {
      kind: "Catch",
      body,
      errorType: first["errorType"]!,
      binding: first["binding"]!,
      handler: first["handler"]!,
      effect: context.effect,
      span: spanJson(context.sourceId, expr),
    };
  }
  return {
    kind: "CatchTags",
    body,
    handlers,
    effect: context.effect,
    span: spanJson(context.sourceId, expr),
  };
}

function errorValueToCoreJson(sourceId: string, expr: SExpr): JsonValue {
  if (expr._tag === "List" && expr.items.length === 2) {
    const errorType = scalarName(expr.items[0]);
    if (errorType) {
      return {
        kind: "Error",
        errorType,
        payload: valueExprToCoreJson(sourceId, expr.items[1]!),
        span: spanJson(sourceId, expr),
      };
    }
  }
  return valueExprToCoreJson(sourceId, expr);
}

function valueExprToCoreJson(sourceId: string, expr: SExpr): JsonValue {
  switch (expr._tag) {
    case "Sym":
      if (expr.name.startsWith(":")) {
        return { kind: "Expr", source: sexprToJson(expr), span: spanJson(sourceId, expr) };
      }
      return { kind: "Var", name: expr.name, span: spanJson(sourceId, expr) };
    case "Str":
      return { kind: "Literal", value: expr.value, span: spanJson(sourceId, expr) };
    case "Num":
      return { kind: "Literal", value: expr.value, span: spanJson(sourceId, expr) };
    case "Bool":
      return { kind: "Literal", value: expr.value, span: spanJson(sourceId, expr) };
    case "List":
      return {
        kind: "List",
        items: expr.items.map((item) => valueExprToCoreJson(sourceId, item)),
        span: spanJson(sourceId, expr),
      };
    case "Vector":
      return {
        kind: "Vector",
        items: expr.items.map((item) => valueExprToCoreJson(sourceId, item)),
        span: spanJson(sourceId, expr),
      };
    case "Map":
      return {
        kind: "Record",
        entries: expr.pairs.map(([key, value]) => ({
          key: valueExprToCoreJson(sourceId, key),
          value: valueExprToCoreJson(sourceId, value),
        })),
        span: spanJson(sourceId, expr),
      };
    default:
      return { kind: "Expr", source: sexprToJson(expr), span: spanJson(sourceId, expr) };
  }
}

function operationSignatureToJson(
  sourceId: string,
  signature: SExpr,
  paramsExpr: Extract<SExpr, { readonly _tag: "Vector" }>,
):
  | {
      readonly ok: true;
      readonly value: {
        readonly params: readonly JsonValue[];
        readonly effect: JsonValue;
      };
    }
  | { readonly ok: false; readonly diagnostics: readonly MechanicsArtifactDiagnostic[] } {
  if (
    signature._tag !== "List" ||
    symName(signature.items[0]) !== "->" ||
    signature.items.length < 2
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          signature,
          "artifact/effect",
          "operation signature must be (-> Input... (Effect ...)).",
        ),
      ],
    };
  }

  const inputTypes = signature.items.slice(1, -1);
  if (inputTypes.length !== paramsExpr.items.length) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          paramsExpr,
          "artifact/effect",
          "operation signature arity must match define-operation parameters.",
        ),
      ],
    };
  }

  const params: JsonValue[] = [];
  for (let index = 0; index < paramsExpr.items.length; index++) {
    const name = scalarName(paramsExpr.items[index]);
    if (!name) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            sourceId,
            paramsExpr.items[index]!,
            "artifact/effect",
            "operation parameters must be symbolic names.",
          ),
        ],
      };
    }
    const type = typeExprToJson(sourceId, inputTypes[index]!);
    if (!type.ok) return type;
    params.push({ name, type: type.value });
  }

  const effect = effectTypeToJson(sourceId, signature.items.at(-1)!);
  if (!effect.ok) return effect;

  return {
    ok: true,
    value: { params, effect: effect.value },
  };
}

function methodToJson(sourceId: string, serviceName: string, expr: SExpr): MechanicsJsonResult {
  if (expr._tag !== "List" || expr.items.length !== 3) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/service-method",
          "service methods must be (name [param Type ...] ReturnEffect).",
        ),
      ],
    };
  }

  const name = symName(expr.items[0]);
  if (!name) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr.items[0]!,
          "artifact/service-method",
          "service methods require a method name.",
        ),
      ],
    };
  }

  const params = methodParamsToJson(sourceId, expr.items[1]!);
  if (!params.ok) return params;

  const effect = effectTypeToJson(sourceId, expr.items[2]!, `${serviceName}.${name}`);
  if (!effect.ok) return effect;

  return {
    ok: true,
    value: {
      name,
      params: params.value,
      effect: effect.value,
    },
  };
}

function methodParamsToJson(sourceId: string, expr: SExpr): MechanicsJsonResult {
  if (expr._tag !== "Vector" || expr.items.length % 2 !== 0) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/service-method",
          "service method params must be [name Type ...] pairs.",
        ),
      ],
    };
  }

  const params: JsonValue[] = [];
  for (let index = 0; index < expr.items.length; index += 2) {
    const name = scalarName(expr.items[index]);
    if (!name) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            sourceId,
            expr.items[index]!,
            "artifact/service-method",
            "service method params require symbolic names.",
          ),
        ],
      };
    }
    const type = typeExprToJson(sourceId, expr.items[index + 1]!);
    if (!type.ok) return type;
    params.push({ name, type: type.value });
  }

  return { ok: true, value: params };
}

function typeExprToJson(sourceId: string, expr: SExpr): MechanicsJsonResult {
  if (expr._tag === "List" && expr.items.length > 0) {
    const head = symName(expr.items[0]);
    switch (head) {
      case "Effect":
        return effectTypeToJson(sourceId, expr);
      case "Option":
      case "Optional":
      case "Ref": {
        if (expr.items.length !== 2) {
          return {
            ok: false,
            diagnostics: [
              diagnostic(sourceId, expr, "artifact/type", `${head} type expects one argument.`),
            ],
          };
        }
        const item = typeExprToJson(sourceId, expr.items[1]!);
        if (!item.ok) return item;
        // In signatures `(Ref T)` is an Effect `Ref`; inside define-schema it
        // stays a schema reference.
        return { ok: true, value: { kind: head === "Ref" ? "RefCell" : head, item: item.value } };
      }
      case "Fiber": {
        if (expr.items.length !== 3) {
          return failed(sourceId, expr, "artifact/type", "Fiber type expects (Fiber Success [Errors...]).");
        }
        const success = typeExprToJson(sourceId, expr.items[1]!);
        if (!success.ok) return success;
        const errors = symbolicSetToJson(sourceId, expr.items[2]!, "errors");
        if (!errors.ok) return errors;
        return { ok: true, value: { kind: "Fiber", success: success.value, errors: errors.value } };
      }
      case "Stream": {
        if (expr.items.length !== 4) {
          return failed(sourceId, expr, "artifact/type", "Stream type expects (Stream Item [Errors...] [Requirements...]).");
        }
        const item = typeExprToJson(sourceId, expr.items[1]!);
        if (!item.ok) return item;
        const errors = symbolicSetToJson(sourceId, expr.items[2]!, "errors");
        if (!errors.ok) return errors;
        const requirements = symbolicSetToJson(sourceId, expr.items[3]!, "requirements");
        if (!requirements.ok) return requirements;
        return {
          ok: true,
          value: { kind: "Stream", item: item.value, errors: errors.value, requirements: requirements.value, span: spanJson(sourceId, expr) },
        };
      }
      case "Result": {
        if (expr.items.length !== 3) {
          return failed(sourceId, expr, "artifact/type", "Result type expects (Result Success Failure).");
        }
        const success = typeExprToJson(sourceId, expr.items[1]!);
        if (!success.ok) return success;
        const failure = typeExprToJson(sourceId, expr.items[2]!);
        if (!failure.ok) return failure;
        return { ok: true, value: { kind: "Result", success: success.value, failure: failure.value } };
      }
      case "->": {
        if (expr.items.length < 2) {
          return failed(sourceId, expr, "artifact/type", "Function type expects (-> Input... Output).");
        }
        const params: JsonValue[] = [];
        for (const item of expr.items.slice(1, -1)) {
          const param = typeExprToJson(sourceId, item);
          if (!param.ok) return param;
          params.push(param.value);
        }
        const result = typeExprToJson(sourceId, expr.items.at(-1)!);
        if (!result.ok) return result;
        return { ok: true, value: { kind: "Function", params, result: result.value } };
      }
      case "Array":
      case "List": {
        if (expr.items.length !== 2) {
          return {
            ok: false,
            diagnostics: [
              diagnostic(sourceId, expr, "artifact/type", `${head} type expects one argument.`),
            ],
          };
        }
        const item = typeExprToJson(sourceId, expr.items[1]!);
        if (!item.ok) return item;
        return { ok: true, value: { kind: "Array", item: item.value } };
      }
      case "Map": {
        if (expr.items.length !== 2) {
          return {
            ok: false,
            diagnostics: [
              diagnostic(sourceId, expr, "artifact/type", "Map type expects one argument."),
            ],
          };
        }
        const value = typeExprToJson(sourceId, expr.items[1]!);
        if (!value.ok) return value;
        return { ok: true, value: { kind: "Map", value: value.value } };
      }
      case "Tuple": {
        const split = splitTrailingSchemaMetadata(expr.items.slice(1));
        if (!split.ok) {
          return {
            ok: false,
            diagnostics: [
              diagnostic(
                sourceId,
                expr,
                "artifact/type",
                "Tuple type metadata must be keyword/value pairs.",
              ),
            ],
          };
        }
        if (split.schemas.length === 0) {
          return {
            ok: false,
            diagnostics: [
              diagnostic(sourceId, expr, "artifact/type", "Tuple type expects at least one item."),
            ],
          };
        }
        const items: JsonValue[] = [];
        for (const itemExpr of split.schemas) {
          const item = typeExprToJson(sourceId, itemExpr);
          if (!item.ok) return item;
          items.push(item.value);
        }
        return { ok: true, value: { kind: "Tuple", items } };
      }
      default:
        break;
    }
  }

  return schemaExprToJson(sourceId, expr);
}

function effectTypeToJson(
  sourceId: string,
  expr: SExpr,
  operationRequirement?: string,
): MechanicsJsonResult {
  if (
    expr._tag !== "List" ||
    expr.items.length !== 4 ||
    symName(expr.items[0]) !== "Effect" ||
    expr.items[2]!._tag !== "Vector" ||
    expr.items[3]!._tag !== "Vector"
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/effect-type",
          "Effect type expects (Effect Success [Errors...] [Requirements...]).",
        ),
      ],
    };
  }

  const success = typeExprToJson(sourceId, expr.items[1]!);
  if (!success.ok) return success;

  const errors = symbolicSetToJson(sourceId, expr.items[2]!, "errors");
  if (!errors.ok) return errors;

  const requirements = symbolicSetToJson(sourceId, expr.items[3]!, "requirements");
  if (!requirements.ok) return requirements;

  const requirementNames = [...(requirements.value as string[])];
  if (operationRequirement && !requirementNames.includes(operationRequirement)) {
    requirementNames.push(operationRequirement);
  }

  return {
    ok: true,
    value: {
      kind: "Effect",
      success: success.value,
      errors: errors.value,
      requirements: requirementNames,
      span: spanJson(sourceId, expr),
    },
  };
}

function symbolicSetToJson(sourceId: string, expr: SExpr, label: string): MechanicsJsonResult {
  if (expr._tag !== "Vector") {
    return {
      ok: false,
      diagnostics: [
        diagnostic(sourceId, expr, "artifact/effect-type", `Effect ${label} must be a vector.`),
      ],
    };
  }

  const names: string[] = [];
  for (const item of expr.items) {
    const name = scalarName(item);
    if (!name) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            sourceId,
            item,
            "artifact/effect-type",
            `Effect ${label} entries must be symbolic names.`,
          ),
        ],
      };
    }
    if (!names.includes(name)) names.push(name);
  }

  return { ok: true, value: names };
}

function schemaExprToJson(sourceId: string, expr: SExpr): MechanicsJsonResult {
  const scalar = scalarName(expr);
  if (scalar) {
    return { ok: true, value: primitiveOrRef(scalar, spanJson(sourceId, expr)) };
  }

  if (expr._tag !== "List" || expr.items.length === 0) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/schema",
          "Expected a schema symbol or schema expression.",
        ),
      ],
    };
  }

  const head = canonicalSchemaHead(symName(expr.items[0]));
  switch (head) {
    case "Struct": {
      const fields: JsonValue[] = [];
      for (const field of expr.items.slice(1)) {
        const result = fieldToJson(sourceId, field);
        if (!result.ok) return result;
        fields.push(result.value);
      }
      return { ok: true, value: { kind: "Struct", fields, span: spanJson(sourceId, expr) } };
    }
    case "Array":
    case "Optional": {
      const metadata = metadataPairs(expr.items.slice(2));
      if (!metadata.ok) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              sourceId,
              expr,
              "artifact/schema",
              `${head} schema metadata must be keyword/value pairs.`,
            ),
          ],
        };
      }
      if (expr.items.length < 2) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(sourceId, expr, "artifact/schema", `${head} schema expects an item schema.`),
          ],
        };
      }
      const item = schemaExprToJson(sourceId, expr.items[1]!);
      if (!item.ok) return item;
      return {
        ok: true,
        value: applyMetadata(
          { kind: head, item: item.value, span: spanJson(sourceId, expr) },
          metadata.pairs,
          spanJson(sourceId, expr),
        ),
      };
    }
    case "Map": {
      const metadata = metadataPairs(expr.items.slice(2));
      if (!metadata.ok) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              sourceId,
              expr,
              "artifact/schema",
              "Map schema metadata must be keyword/value pairs.",
            ),
          ],
        };
      }
      if (expr.items.length < 2) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(sourceId, expr, "artifact/schema", "Map schema expects a value schema."),
          ],
        };
      }
      const value = schemaExprToJson(sourceId, expr.items[1]!);
      if (!value.ok) return value;
      return {
        ok: true,
        value: applyMetadata(
          { kind: "Map", value: value.value, span: spanJson(sourceId, expr) },
          metadata.pairs,
          spanJson(sourceId, expr),
        ),
      };
    }
    case "Ref": {
      const target = scalarName(expr.items[1]);
      const metadata = metadataPairs(expr.items.slice(2));
      if (!target) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              sourceId,
              expr.items[1] ?? expr,
              "artifact/schema",
              "Ref schema expects a symbolic target.",
            ),
          ],
        };
      }
      if (!metadata.ok) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              sourceId,
              expr,
              "artifact/schema",
              "Ref schema metadata must be keyword/value pairs.",
            ),
          ],
        };
      }
      return {
        ok: true,
        value: applyMetadata(
          { kind: "Ref", name: target, span: spanJson(sourceId, expr) },
          metadata.pairs,
          spanJson(sourceId, expr),
        ),
      };
    }
    case "Brand": {
      if (expr.items.length !== 3) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              sourceId,
              expr,
              "artifact/schema",
              "Brand schema expects a brand name and base schema.",
            ),
          ],
        };
      }
      const name = scalarName(expr.items[1]);
      if (!name) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              sourceId,
              expr.items[1]!,
              "artifact/schema",
              "Brand schema expects a symbolic brand name.",
            ),
          ],
        };
      }
      const schema = schemaExprToJson(sourceId, expr.items[2]!);
      if (!schema.ok) return schema;
      return {
        ok: true,
        value: { kind: "Brand", name, schema: schema.value, span: spanJson(sourceId, expr) },
      };
    }
    case "Enum": {
      const values: JsonValue[] = [];
      for (const value of expr.items.slice(1)) {
        const scalar = scalarName(value);
        if (scalar === undefined) {
          return {
            ok: false,
            diagnostics: [
              diagnostic(
                sourceId,
                value,
                "artifact/schema",
                "Enum schema values must be symbols, keywords, or strings.",
              ),
            ],
          };
        }
        values.push(scalar);
      }
      if (values.length === 0) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              sourceId,
              expr,
              "artifact/schema",
              "Enum schema expects at least one value.",
            ),
          ],
        };
      }
      return { ok: true, value: { kind: "Literal", values, span: spanJson(sourceId, expr) } };
    }
    case "Literal": {
      const values: JsonValue[] = [];
      for (const value of expr.items.slice(1)) {
        const scalar = scalarJson(value);
        if (scalar === undefined) {
          return {
            ok: false,
            diagnostics: [
              diagnostic(
                sourceId,
                value,
                "artifact/schema",
                "Literal schema values must be scalar values.",
              ),
            ],
          };
        }
        values.push(scalar);
      }
      return { ok: true, value: { kind: "Literal", values, span: spanJson(sourceId, expr) } };
    }
    case "Tuple": {
      const split = splitTrailingSchemaMetadata(expr.items.slice(1));
      if (!split.ok) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              sourceId,
              expr,
              "artifact/schema",
              "Tuple schema metadata must be keyword/value pairs.",
            ),
          ],
        };
      }
      if (split.schemas.length === 0) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              sourceId,
              expr,
              "artifact/schema",
              "Tuple schema expects at least one item schema.",
            ),
          ],
        };
      }
      const items: JsonValue[] = [];
      for (const itemExpr of split.schemas) {
        const item = schemaExprToJson(sourceId, itemExpr);
        if (!item.ok) return item;
        items.push(item.value);
      }
      return {
        ok: true,
        value: applyMetadata(
          { kind: "Tuple", items, span: spanJson(sourceId, expr) },
          split.pairs,
          spanJson(sourceId, expr),
        ),
      };
    }
    case "Union": {
      const split = splitTrailingSchemaMetadata(expr.items.slice(1));
      if (!split.ok) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              sourceId,
              expr,
              "artifact/schema",
              "Union schema metadata must be keyword/value pairs.",
            ),
          ],
        };
      }
      if (split.schemas.length === 0) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              sourceId,
              expr,
              "artifact/schema",
              "Union schema expects at least one variant schema.",
            ),
          ],
        };
      }
      const variants: JsonValue[] = [];
      for (const variant of split.schemas) {
        const schema = schemaExprToJson(sourceId, variant);
        if (!schema.ok) return schema;
        variants.push(schema.value);
      }
      return {
        ok: true,
        value: applyMetadata(
          { kind: "Union", variants, span: spanJson(sourceId, expr) },
          split.pairs,
          spanJson(sourceId, expr),
        ),
      };
    }
    case "TaggedUnion":
      return taggedUnionSchemaToJson(sourceId, expr);
    default: {
      if (!head) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(sourceId, expr, "artifact/schema", "Expected a schema expression."),
          ],
        };
      }
      const metadata = metadataPairs(expr.items.slice(1));
      if (!metadata.ok) {
        return {
          ok: false,
          diagnostics: [
            diagnostic(
              sourceId,
              expr,
              "artifact/schema",
              "Schema metadata must be keyword/value pairs.",
            ),
          ],
        };
      }
      return {
        ok: true,
        value: applyMetadata(
          primitiveOrRef(head, spanJson(sourceId, expr)),
          metadata.pairs,
          spanJson(sourceId, expr),
        ),
      };
    }
  }
}

function taggedUnionSchemaToJson(
  sourceId: string,
  expr: SExpr & { readonly _tag: "List" },
): MechanicsJsonResult {
  const discriminator = scalarName(expr.items[1]);
  if (!discriminator) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr.items[1] ?? expr,
          "artifact/schema",
          "TaggedUnion schema expects a discriminator.",
        ),
      ],
    };
  }
  if (expr.items.length < 3) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/schema",
          "TaggedUnion schema expects at least one variant schema.",
        ),
      ],
    };
  }

  const split = splitTrailingSchemaMetadata(expr.items.slice(2));
  if (!split.ok) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/schema",
          "TaggedUnion schema metadata must be keyword/value pairs.",
        ),
      ],
    };
  }
  if (split.schemas.length === 0) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/schema",
          "TaggedUnion schema expects at least one variant schema.",
        ),
      ],
    };
  }

  const variants: JsonValue[] = [];
  for (const variant of split.schemas) {
    const variantJson = taggedUnionVariantToJson(sourceId, variant);
    if (!variantJson.ok) return variantJson;
    variants.push(variantJson.value);
  }

  return {
    ok: true,
    value: applyMetadata(
      { kind: "TaggedUnion", discriminator, variants, span: spanJson(sourceId, expr) },
      split.pairs,
      spanJson(sourceId, expr),
    ),
  };
}

function taggedUnionVariantToJson(sourceId: string, expr: SExpr): MechanicsJsonResult {
  if (expr._tag !== "Vector" || expr.items.length !== 2) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/schema",
          "TaggedUnion variants must be [tag SchemaExpr].",
        ),
      ],
    };
  }

  const tag = scalarName(expr.items[0]);
  if (!tag) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr.items[0]!,
          "artifact/schema",
          "TaggedUnion variant tags must be symbols, keywords, or strings.",
        ),
      ],
    };
  }

  const schema = schemaExprToJson(sourceId, expr.items[1]!);
  if (!schema.ok) return schema;
  return { ok: true, value: { tag, schema: schema.value, span: spanJson(sourceId, expr) } };
}

function fieldToJson(sourceId: string, expr: SExpr): MechanicsJsonResult {
  const items =
    expr._tag === "Vector"
      ? expr.items
      : expr._tag === "List" && symName(expr.items[0]) === "field"
        ? expr.items.slice(1)
        : expr._tag === "List"
          ? expr.items
          : undefined;

  if (!items || items.length !== 2) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          expr,
          "artifact/schema-field",
          "Struct schema fields must be [name SchemaExpr] or (field name SchemaExpr).",
        ),
      ],
    };
  }

  const name = scalarName(items[0]!);
  if (!name) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          sourceId,
          items[0]!,
          "artifact/schema-field",
          "Struct schema field names must be symbols, keywords, or strings.",
        ),
      ],
    };
  }

  const schema = schemaExprToJson(sourceId, items[1]!);
  if (!schema.ok) return schema;
  return { ok: true, value: { name, schema: schema.value, span: spanJson(sourceId, expr) } };
}

function primitiveOrRef(name: string, span: JsonValue): JsonValue {
  const primitive = primitiveName(name);
  return primitive ? { kind: "Primitive", name: primitive, span } : { kind: "Ref", name, span };
}

function canonicalSchemaHead(head: string | undefined): string | undefined {
  switch (head) {
    case "object":
    case "Object":
      return "Struct";
    case "array":
      return "Array";
    case "optional":
      return "Optional";
    case "map":
      return "Map";
    case "ref":
      return "Ref";
    case "brand":
      return "Brand";
    case "enum":
      return "Enum";
    case "literal":
      return "Literal";
    case "tuple":
      return "Tuple";
    case "union":
      return "Union";
    case "tagged-union":
    case "taggedUnion":
      return "TaggedUnion";
    default:
      return head;
  }
}

function applyMetadata(
  schema: JsonValue,
  pairs: readonly (readonly [string, SExpr])[],
  span: JsonValue,
): JsonValue {
  let wrapped = schema;
  const metadata: Record<string, JsonValue> = {};

  for (const [key, value] of pairs) {
    if (key === "brand") {
      const name = scalarName(value);
      if (name) {
        wrapped = { kind: "Brand", name, schema: wrapped, span };
      }
      continue;
    }

    const scalar = scalarJson(value);
    if (scalar !== undefined) {
      metadata[key] = scalar;
    }
  }

  return Object.keys(metadata).length > 0
    ? { kind: "Annotated", schema: wrapped, metadata, span }
    : wrapped;
}

function metadataPairs(
  values: readonly SExpr[],
):
  | { readonly ok: true; readonly pairs: readonly (readonly [string, SExpr])[] }
  | { readonly ok: false } {
  if (values.length % 2 !== 0) return { ok: false };

  const pairs: Array<readonly [string, SExpr]> = [];
  for (let index = 0; index < values.length; index += 2) {
    const key = scalarName(values[index]!);
    if (!key) return { ok: false };
    pairs.push([key, values[index + 1]!] as const);
  }
  return { ok: true, pairs };
}

function splitTrailingSchemaMetadata(values: readonly SExpr[]):
  | {
      readonly ok: true;
      readonly schemas: readonly SExpr[];
      readonly pairs: readonly (readonly [string, SExpr])[];
    }
  | { readonly ok: false } {
  const metadataStart = values.findIndex((value) => symName(value)?.startsWith(":") === true);
  if (metadataStart === -1) return { ok: true, schemas: values, pairs: [] };

  const metadata = values.slice(metadataStart);
  if (metadata.length % 2 !== 0) return { ok: false };

  const pairs: Array<readonly [string, SExpr]> = [];
  for (let index = 0; index < metadata.length; index += 2) {
    const key = symName(metadata[index]!);
    if (!key?.startsWith(":")) return { ok: false };
    pairs.push([key.replace(/^:/, ""), metadata[index + 1]!] as const);
  }

  return { ok: true, schemas: values.slice(0, metadataStart), pairs };
}

function primitiveName(name: string): string | undefined {
  switch (name.toLowerCase()) {
    case "string":
      return "String";
    case "int":
    case "integer":
      return "Int";
    case "float":
      return "Float";
    case "number":
      return "Number";
    case "bool":
    case "boolean":
      return "Bool";
    case "bytes":
      return "Bytes";
    case "datetime":
      return "DateTime";
    case "json":
      return "Json";
    case "unit":
      return "Unit";
    default:
      return undefined;
  }
}

function scalarJson(expr: SExpr): JsonValue | undefined {
  switch (expr._tag) {
    case "Sym":
      return expr.name;
    case "Str":
      return expr.value;
    case "Num":
      return expr.value;
    case "Bool":
      return expr.value;
    default:
      return undefined;
  }
}

function scalarName(expr: SExpr | undefined): string | undefined {
  if (!expr) return undefined;
  if (expr._tag === "Sym") return expr.name.replace(/^:/, "");
  if (expr._tag === "Str") return expr.value.replace(/^:/, "");
  return undefined;
}

function symName(expr: SExpr | undefined): string | undefined {
  return expr?._tag === "Sym" ? expr.name : undefined;
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sexprToJson(expr: SExpr): JsonValue {
  switch (expr._tag) {
    case "Sym":
      return { kind: "Symbol", name: expr.name };
    case "Str":
      return { kind: "String", value: expr.value };
    case "Num":
      return { kind: "Number", value: expr.value };
    case "Bool":
      return { kind: "Bool", value: expr.value };
    case "List":
      return { kind: "List", items: expr.items.map(sexprToJson) };
    case "Vector":
      return { kind: "Vector", items: expr.items.map(sexprToJson) };
    case "Map":
      return {
        kind: "Map",
        entries: expr.pairs.map(([key, value]) => ({
          key: sexprToJson(key),
          value: sexprToJson(value),
        })),
      };
    case "Set":
      return { kind: "Set", items: expr.items.map(sexprToJson) };
    case "Error":
      return { kind: "Error" };
  }
}

function spanOf(sourceId: string, expr: SExpr): Span {
  return {
    sourceId,
    startOffset: expr.loc.start,
    endOffset: expr.loc.end,
    startLine: expr.loc.line,
    startColumn: expr.loc.col,
  };
}

function spanJson(sourceId: string, expr: SExpr): JsonValue {
  return {
    sourceId,
    startOffset: expr.loc.start,
    endOffset: expr.loc.end,
  };
}

function diagnostic(
  sourceId: string,
  expr: SExpr,
  code: string,
  message: string,
): MechanicsArtifactDiagnostic {
  return { code, message, span: spanOf(sourceId, expr) };
}
