import type { Diagnostic } from "../diagnostic/diagnostic.js";
import type { PackageableDeclaration, JsonValue } from "./artifact.js";
import type { ValidatorInput } from "./validator-registry.js";

/** Existing recursive mechanics contracts, registered outside packaging. */
export function validateMechanicsPayload(input: ValidatorInput): readonly Diagnostic[] {
  return [...validatePayloadContract(input.declaration, input.index), ...validateMechanicsPayloadShape(input.declaration, input.index)];
}
type PayloadFieldKind = "array" | "object" | "string";

interface PayloadFieldConstraint {
  readonly field: string;
  readonly kind?: PayloadFieldKind | undefined;
  readonly literal?: string | undefined;
}

interface PayloadContract {
  readonly requiredFields: readonly string[];
  readonly fieldConstraints: readonly PayloadFieldConstraint[];
}

const payloadContracts: ReadonlyMap<string, PayloadContract> = new Map([
  [
    "mechanics/schema-def/v0",
    {
      requiredFields: ["kind", "name", "schema"],
      fieldConstraints: [
        { field: "kind", kind: "string", literal: "SchemaDef" },
        { field: "name", kind: "string" },
        { field: "schema", kind: "object" },
      ],
    },
  ],
  [
    "mechanics/error-def/v0",
    {
      requiredFields: ["kind", "name", "schema"],
      fieldConstraints: [
        { field: "kind", kind: "string", literal: "ErrorDef" },
        { field: "name", kind: "string" },
        { field: "schema", kind: "object" },
      ],
    },
  ],
  [
    "mechanics/service-def/v0",
    {
      requiredFields: ["kind", "name", "methods"],
      fieldConstraints: [
        { field: "kind", kind: "string", literal: "ServiceDef" },
        { field: "name", kind: "string" },
        { field: "methods", kind: "array" },
      ],
    },
  ],
  [
    "mechanics/class-def/v0",
    {
      requiredFields: ["kind", "name", "schema"],
      fieldConstraints: [
        { field: "kind", kind: "string", literal: "ClassDef" },
        { field: "name", kind: "string" },
        { field: "schema", kind: "object" },
      ],
    },
  ],
  [
    "mechanics/function-def/v0",
    {
      requiredFields: ["kind", "name", "params", "returns", "body"],
      fieldConstraints: [
        { field: "kind", kind: "string", literal: "FunctionDef" },
        { field: "name", kind: "string" },
        { field: "params", kind: "array" },
        { field: "returns", kind: "object" },
        { field: "body", kind: "object" },
      ],
    },
  ],
  [
    "mechanics/value-def/v0",
    {
      requiredFields: ["kind", "name", "type", "value"],
      fieldConstraints: [
        { field: "kind", kind: "string", literal: "ValueDef" },
        { field: "name", kind: "string" },
        { field: "type", kind: "object" },
        { field: "value", kind: "object" },
      ],
    },
  ],
  [
    "mechanics/layer-def/v0",
    {
      requiredFields: ["kind", "name", "implementation"],
      fieldConstraints: [
        { field: "kind", kind: "string", literal: "LayerDef" },
        { field: "name", kind: "string" },
        { field: "implementation", kind: "object" },
      ],
    },
  ],
  [
    "mechanics/effect-def/v0",
    {
      requiredFields: ["kind", "name", "params", "effect", "body"],
      fieldConstraints: [
        { field: "kind", kind: "string", literal: "EffectDef" },
        { field: "name", kind: "string" },
        { field: "params", kind: "array" },
        { field: "effect", kind: "object" },
        { field: "body", kind: "object" },
      ],
    },
  ],
]);

function validatePayloadContract(
  declaration: PackageableDeclaration,
  index: number,
): readonly Diagnostic[] {
  const contractName = declaration.payloadContract;
  if (!contractName) return [];

  const contract = payloadContracts.get(contractName);
  if (!contract) return [];

  const payload = jsonRecord(declaration.payload);
  if (!payload) {
    return [declarationDiagnostic("artifact/payload-not-object", index, declaration)];
  }

  const diagnostics: Diagnostic[] = [];
  for (const field of contract.requiredFields) {
    if (!(field in payload)) {
      diagnostics.push(
        declarationDiagnostic("artifact/payload-contract-missing-field", index, declaration, {
          contract: contractName,
          field,
        }),
      );
    }
  }

  for (const constraint of contract.fieldConstraints) {
    const value = payload[constraint.field];
    if (value === undefined) continue;

    if (constraint.kind && jsonKind(value) !== constraint.kind) {
      diagnostics.push(
        declarationDiagnostic("artifact/payload-contract-field-kind", index, declaration, {
          contract: contractName,
          field: constraint.field,
          expected: constraint.kind,
          got: jsonKind(value),
        }),
      );
    }

    if (constraint.literal !== undefined && value !== constraint.literal) {
      diagnostics.push(
        declarationDiagnostic("artifact/payload-contract-field-literal", index, declaration, {
          contract: contractName,
          field: constraint.field,
          expected: constraint.literal,
          got: value,
        }),
      );
    }
  }

  diagnostics.push(...validateMechanicsContractPayload(contractName, payload, declaration, index));

  return diagnostics;
}

function validateMechanicsContractPayload(
  contractName: string,
  payload: Record<string, JsonValue>,
  declaration: PackageableDeclaration,
  index: number,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  switch (contractName) {
    case "mechanics/schema-def/v0":
      validateSchemaNode(
        payload["schema"],
        "$.payload.schema",
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "mechanics/error-def/v0":
    case "mechanics/class-def/v0":
      validateSchemaNode(
        payload["schema"],
        "$.payload.schema",
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "mechanics/function-def/v0":
      validateParamArray(payload["params"], "$.payload.params", contractName, declaration, index, diagnostics);
      validateTypeNode(payload["returns"], "$.payload.returns", contractName, declaration, index, diagnostics);
      validateValueNode(payload["body"], "$.payload.body", contractName, declaration, index, diagnostics);
      break;
    case "mechanics/value-def/v0":
      validateTypeNode(payload["type"], "$.payload.type", contractName, declaration, index, diagnostics);
      validateValueNode(payload["value"], "$.payload.value", contractName, declaration, index, diagnostics);
      break;
    case "mechanics/layer-def/v0":
      validateLayerPayload(payload, contractName, declaration, index, diagnostics);
      break;
    case "mechanics/service-def/v0":
      validateMethodArray(
        payload["methods"],
        "$.payload.methods",
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "mechanics/effect-def/v0":
      validateParamArray(
        payload["params"],
        "$.payload.params",
        contractName,
        declaration,
        index,
        diagnostics,
      );
      validateEffectTypeNode(
        payload["effect"],
        "$.payload.effect",
        contractName,
        declaration,
        index,
        diagnostics,
      );
      validateBodyNode(
        payload["body"],
        "$.payload.body",
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    default:
      break;
  }
  return diagnostics;
}

function validateSchemaNode(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const node = expectRecord(value, path, contractName, declaration, index, diagnostics);
  if (!node) return;

  const kind = expectString(
    node["kind"],
    `${path}.kind`,
    contractName,
    declaration,
    index,
    diagnostics,
  );
  if (!kind) return;

  switch (kind) {
    case "Primitive":
    case "Ref":
      expectString(node["name"], `${path}.name`, contractName, declaration, index, diagnostics);
      break;
    case "Struct":
      validateFieldArray(
        node["fields"],
        `${path}.fields`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "Array":
    case "Optional":
      validateSchemaNode(
        node["item"],
        `${path}.item`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "Map":
      validateSchemaNode(
        node["value"],
        `${path}.value`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "Brand":
      expectString(node["name"], `${path}.name`, contractName, declaration, index, diagnostics);
      validateSchemaNode(
        node["schema"],
        `${path}.schema`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "Literal":
      expectArray(node["values"], `${path}.values`, contractName, declaration, index, diagnostics);
      break;
    case "Tuple":
      validateSchemaArray(
        node["items"],
        `${path}.items`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "Union":
      validateSchemaArray(
        node["variants"],
        `${path}.variants`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "TaggedUnion":
      expectString(
        node["discriminator"],
        `${path}.discriminator`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      validateTaggedUnionVariantArray(
        node["variants"],
        `${path}.variants`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "Option":
    case "RefCell":
      validateTypeNode(node["item"], `${path}.item`, contractName, declaration, index, diagnostics);
      break;
    case "Result":
      validateTypeNode(node["success"], `${path}.success`, contractName, declaration, index, diagnostics);
      validateTypeNode(node["failure"], `${path}.failure`, contractName, declaration, index, diagnostics);
      break;
    case "Fiber":
      validateTypeNode(node["success"], `${path}.success`, contractName, declaration, index, diagnostics);
      validateStringArray(node["errors"], `${path}.errors`, contractName, declaration, index, diagnostics);
      break;
    case "Stream":
      validateTypeNode(node["item"], `${path}.item`, contractName, declaration, index, diagnostics);
      validateStringArray(node["errors"], `${path}.errors`, contractName, declaration, index, diagnostics);
      validateStringArray(node["requirements"], `${path}.requirements`, contractName, declaration, index, diagnostics);
      break;
    case "Function": {
      const params = expectArray(node["params"], `${path}.params`, contractName, declaration, index, diagnostics);
      params?.forEach((param, paramIndex) =>
        validateTypeNode(param, `${path}.params[${paramIndex}]`, contractName, declaration, index, diagnostics),
      );
      validateTypeNode(node["result"], `${path}.result`, contractName, declaration, index, diagnostics);
      break;
    }
    case "Annotated":
      validateSchemaNode(
        node["schema"],
        `${path}.schema`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      expectRecord(
        node["metadata"],
        `${path}.metadata`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    default:
      diagnostics.push(
        contractDiagnostic(contractName, path, "known schema kind", kind, index, declaration),
      );
      break;
  }
}

function validateTypeNode(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const node = jsonRecord(value);
  if (node?.["kind"] === "Effect") {
    validateEffectTypeNode(value, path, contractName, declaration, index, diagnostics);
    return;
  }
  validateSchemaNode(value, path, contractName, declaration, index, diagnostics);
}

function validateEffectTypeNode(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const node = expectRecord(value, path, contractName, declaration, index, diagnostics);
  if (!node) return;

  const kind = expectString(
    node["kind"],
    `${path}.kind`,
    contractName,
    declaration,
    index,
    diagnostics,
  );
  if (kind && kind !== "Effect") {
    diagnostics.push(
      contractDiagnostic(contractName, `${path}.kind`, "Effect", kind, index, declaration),
    );
  }
  validateTypeNode(
    node["success"],
    `${path}.success`,
    contractName,
    declaration,
    index,
    diagnostics,
  );
  validateStringArray(
    node["errors"],
    `${path}.errors`,
    contractName,
    declaration,
    index,
    diagnostics,
  );
  validateStringArray(
    node["requirements"],
    `${path}.requirements`,
    contractName,
    declaration,
    index,
    diagnostics,
  );
}

function validateBodyNode(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const node = expectRecord(value, path, contractName, declaration, index, diagnostics);
  if (!node) return;

  const kind = expectString(
    node["kind"],
    `${path}.kind`,
    contractName,
    declaration,
    index,
    diagnostics,
  );
  if (!kind) return;

  if (node["effect"] !== undefined) {
    validateEffectTypeNode(
      node["effect"],
      `${path}.effect`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
  }

  switch (kind) {
    case "Pure":
      validateValueNode(
        node["value"],
        `${path}.value`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "Succeed":
      validateValueNode(
        node["value"],
        `${path}.value`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "Fail":
      if (typeof node["error"] !== "string") {
        validateValueNode(
          node["error"],
          `${path}.error`,
          contractName,
          declaration,
          index,
          diagnostics,
        );
      }
      break;
    case "Catch":
      validateBodyNode(node["body"], `${path}.body`, contractName, declaration, index, diagnostics);
      expectString(
        node["errorType"],
        `${path}.errorType`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      expectString(
        node["binding"],
        `${path}.binding`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      validateBodyNode(
        node["handler"],
        `${path}.handler`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "ServiceCall":
      expectString(
        node["service"],
        `${path}.service`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      expectString(node["method"], `${path}.method`, contractName, declaration, index, diagnostics);
      validateValueArray(
        node["args"],
        `${path}.args`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "OperationCall":
      expectString(
        node["operation"],
        `${path}.operation`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      validateValueArray(
        node["args"],
        `${path}.args`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "Bind":
      validateBodyNode(
        node["value"],
        `${path}.value`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      if (node["body"] !== undefined) {
        validateBodyNode(
          node["body"],
          `${path}.body`,
          contractName,
          declaration,
          index,
          diagnostics,
        );
      }
      break;
    case "Do":
      if (node["bindings"] !== undefined) {
        validateBindingArray(
          node["bindings"],
          `${path}.bindings`,
          contractName,
          declaration,
          index,
          diagnostics,
        );
      }
      if (node["body"] !== undefined) {
        validateBodyNode(
          node["body"],
          `${path}.body`,
          contractName,
          declaration,
          index,
          diagnostics,
        );
      }
      if (node["forms"] !== undefined) {
        validateBodyArray(
          node["forms"],
          `${path}.forms`,
          contractName,
          declaration,
          index,
          diagnostics,
        );
      }
      break;
    case "Let":
      validateBindingArray(
        node["bindings"],
        `${path}.bindings`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      validateBodyNode(node["body"], `${path}.body`, contractName, declaration, index, diagnostics);
      break;
    case "If":
      validateValueNode(
        node["condition"],
        `${path}.condition`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      validateBodyNode(node["then"], `${path}.then`, contractName, declaration, index, diagnostics);
      validateBodyNode(node["else"], `${path}.else`, contractName, declaration, index, diagnostics);
      break;
    case "When":
    case "Unless":
      validateValueNode(
        node["condition"],
        `${path}.condition`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      validateBodyNode(node["body"], `${path}.body`, contractName, declaration, index, diagnostics);
      break;
    case "Cond":
      validateCondClauseArray(
        node["clauses"],
        `${path}.clauses`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "Match":
      validateValueNode(
        node["value"],
        `${path}.value`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      validateMatchArmArray(
        node["arms"],
        `${path}.arms`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "CatchTags": {
      validateBodyNode(node["body"], `${path}.body`, contractName, declaration, index, diagnostics);
      const handlers = expectArray(node["handlers"], `${path}.handlers`, contractName, declaration, index, diagnostics);
      handlers?.forEach((handler, handlerIndex) => {
        const handlerPath = `${path}.handlers[${handlerIndex}]`;
        const record = expectRecord(handler, handlerPath, contractName, declaration, index, diagnostics);
        if (!record) return;
        expectString(record["errorType"], `${handlerPath}.errorType`, contractName, declaration, index, diagnostics);
        expectString(record["binding"], `${handlerPath}.binding`, contractName, declaration, index, diagnostics);
        validateBodyNode(record["handler"], `${handlerPath}.handler`, contractName, declaration, index, diagnostics);
      });
      break;
    }
    case "CatchAll":
      validateBodyNode(node["body"], `${path}.body`, contractName, declaration, index, diagnostics);
      expectString(node["binding"], `${path}.binding`, contractName, declaration, index, diagnostics);
      validateBodyNode(node["handler"], `${path}.handler`, contractName, declaration, index, diagnostics);
      break;
    case "Combinator": {
      expectString(node["name"], `${path}.name`, contractName, declaration, index, diagnostics);
      const args = expectArray(node["args"], `${path}.args`, contractName, declaration, index, diagnostics);
      args?.forEach((arg, argIndex) =>
        validateCombinatorArg(arg, `${path}.args[${argIndex}]`, contractName, declaration, index, diagnostics),
      );
      if (node["options"] !== undefined) {
        const options = expectArray(node["options"], `${path}.options`, contractName, declaration, index, diagnostics);
        options?.forEach((option, optionIndex) => {
          const optionPath = `${path}.options[${optionIndex}]`;
          const record = expectRecord(option, optionPath, contractName, declaration, index, diagnostics);
          if (!record) return;
          expectString(record["key"], `${optionPath}.key`, contractName, declaration, index, diagnostics);
          validateValueNode(record["value"], `${optionPath}.value`, contractName, declaration, index, diagnostics);
        });
      }
      break;
    }
    default:
      diagnostics.push(
        contractDiagnostic(contractName, path, "known body kind", kind, index, declaration),
      );
      break;
  }
}

const valueNodeKinds = new Set(["Var", "Literal", "List", "Vector", "Record", "Error", "Expr"]);

/** A combinator argument is an effect body, a value, or an effect lambda/collection/type. */
function validateCombinatorArg(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const node = expectRecord(value, path, contractName, declaration, index, diagnostics);
  if (!node) return;
  const kind = node["kind"];
  if (typeof kind === "string" && valueNodeKinds.has(kind)) {
    validateValueNode(value, path, contractName, declaration, index, diagnostics);
    return;
  }
  switch (kind) {
    case "Lambda":
      validateStringArray(node["params"], `${path}.params`, contractName, declaration, index, diagnostics);
      validateBodyNode(node["body"], `${path}.body`, contractName, declaration, index, diagnostics);
      return;
    case "EffectVector":
      validateBodyArray(node["items"], `${path}.items`, contractName, declaration, index, diagnostics);
      return;
    case "EffectRecord": {
      const entries = expectArray(node["entries"], `${path}.entries`, contractName, declaration, index, diagnostics);
      entries?.forEach((entry, entryIndex) => {
        const entryPath = `${path}.entries[${entryIndex}]`;
        const record = expectRecord(entry, entryPath, contractName, declaration, index, diagnostics);
        if (!record) return;
        expectString(record["key"], `${entryPath}.key`, contractName, declaration, index, diagnostics);
        validateBodyNode(record["value"], `${entryPath}.value`, contractName, declaration, index, diagnostics);
      });
      return;
    }
    case "TypeArg":
      validateTypeNode(node["type"], `${path}.type`, contractName, declaration, index, diagnostics);
      return;
    default:
      validateBodyNode(value, path, contractName, declaration, index, diagnostics);
  }
}

function validateLayerPayload(
  payload: Record<string, JsonValue>,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const signature = payload["signature"];
  if (signature !== undefined) {
    const record = expectRecord(signature, "$.payload.signature", contractName, declaration, index, diagnostics);
    if (record) {
      for (const field of ["provides", "errors", "requirements"]) {
        validateStringArray(record[field], `$.payload.signature.${field}`, contractName, declaration, index, diagnostics);
      }
    }
  }
  const implementation = expectRecord(payload["implementation"], "$.payload.implementation", contractName, declaration, index, diagnostics);
  if (!implementation) return;
  const path = "$.payload.implementation";
  if (implementation["kind"] === "Compose") {
    validateLayerExpression(implementation["layer"], `${path}.layer`, contractName, declaration, index, diagnostics);
    return;
  }
  if (implementation["kind"] !== "Service") {
    diagnostics.push(contractDiagnostic(contractName, `${path}.kind`, "Service or Compose", String(implementation["kind"]), index, declaration));
    return;
  }
  expectString(implementation["service"], `${path}.service`, contractName, declaration, index, diagnostics);
  validateBindingArray(implementation["setup"], `${path}.setup`, contractName, declaration, index, diagnostics);
  const methods = expectArray(implementation["methods"], `${path}.methods`, contractName, declaration, index, diagnostics);
  methods?.forEach((method, methodIndex) => {
    const methodPath = `${path}.methods[${methodIndex}]`;
    const record = expectRecord(method, methodPath, contractName, declaration, index, diagnostics);
    if (!record) return;
    expectString(record["name"], `${methodPath}.name`, contractName, declaration, index, diagnostics);
    validateStringArray(record["params"], `${methodPath}.params`, contractName, declaration, index, diagnostics);
    validateBodyNode(record["body"], `${methodPath}.body`, contractName, declaration, index, diagnostics);
  });
}

function validateLayerExpression(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const node = expectRecord(value, path, contractName, declaration, index, diagnostics);
  if (!node) return;
  switch (node["kind"]) {
    case "LayerRef":
      expectString(node["name"], `${path}.name`, contractName, declaration, index, diagnostics);
      return;
    case "LayerMerge": {
      const layers = expectArray(node["layers"], `${path}.layers`, contractName, declaration, index, diagnostics);
      layers?.forEach((layer, layerIndex) =>
        validateLayerExpression(layer, `${path}.layers[${layerIndex}]`, contractName, declaration, index, diagnostics),
      );
      return;
    }
    case "LayerProvide":
    case "LayerProvideMerge": {
      validateLayerExpression(node["layer"], `${path}.layer`, contractName, declaration, index, diagnostics);
      const dependencies = expectArray(node["dependencies"], `${path}.dependencies`, contractName, declaration, index, diagnostics);
      dependencies?.forEach((layer, layerIndex) =>
        validateLayerExpression(layer, `${path}.dependencies[${layerIndex}]`, contractName, declaration, index, diagnostics),
      );
      return;
    }
    default:
      diagnostics.push(contractDiagnostic(contractName, path, "known layer expression kind", String(node["kind"]), index, declaration));
  }
}

function validateFieldArray(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const fields = expectArray(value, path, contractName, declaration, index, diagnostics);
  if (!fields) return;
  fields.forEach((field, fieldIndex) => {
    const fieldPath = `${path}[${fieldIndex}]`;
    const record = expectRecord(field, fieldPath, contractName, declaration, index, diagnostics);
    if (!record) return;
    expectString(
      record["name"],
      `${fieldPath}.name`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
    validateSchemaNode(
      record["schema"],
      `${fieldPath}.schema`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
  });
}

function validateSchemaArray(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const schemas = expectArray(value, path, contractName, declaration, index, diagnostics);
  if (!schemas) return;
  schemas.forEach((schema, schemaIndex) =>
    validateSchemaNode(
      schema,
      `${path}[${schemaIndex}]`,
      contractName,
      declaration,
      index,
      diagnostics,
    ),
  );
}

function validateTaggedUnionVariantArray(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const variants = expectArray(value, path, contractName, declaration, index, diagnostics);
  if (!variants) return;
  variants.forEach((variant, variantIndex) => {
    const variantPath = `${path}[${variantIndex}]`;
    const record = expectRecord(
      variant,
      variantPath,
      contractName,
      declaration,
      index,
      diagnostics,
    );
    if (!record) return;
    expectString(
      record["tag"],
      `${variantPath}.tag`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
    validateSchemaNode(
      record["schema"],
      `${variantPath}.schema`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
  });
}

function validateMethodArray(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const methods = expectArray(value, path, contractName, declaration, index, diagnostics);
  if (!methods) return;
  methods.forEach((method, methodIndex) => {
    const methodPath = `${path}[${methodIndex}]`;
    const record = expectRecord(method, methodPath, contractName, declaration, index, diagnostics);
    if (!record) return;
    expectString(
      record["name"],
      `${methodPath}.name`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
    validateParamArray(
      record["params"],
      `${methodPath}.params`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
    validateEffectTypeNode(
      record["effect"],
      `${methodPath}.effect`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
  });
}

function validateParamArray(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const params = expectArray(value, path, contractName, declaration, index, diagnostics);
  if (!params) return;
  params.forEach((param, paramIndex) => {
    const paramPath = `${path}[${paramIndex}]`;
    const record = expectRecord(param, paramPath, contractName, declaration, index, diagnostics);
    if (!record) return;
    expectString(
      record["name"],
      `${paramPath}.name`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
    validateTypeNode(
      record["type"],
      `${paramPath}.type`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
  });
}

function validateBindingArray(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const bindings = expectArray(value, path, contractName, declaration, index, diagnostics);
  if (!bindings) return;
  bindings.forEach((binding, bindingIndex) => {
    const bindingPath = `${path}[${bindingIndex}]`;
    const record = expectRecord(
      binding,
      bindingPath,
      contractName,
      declaration,
      index,
      diagnostics,
    );
    if (!record) return;
    expectString(
      record["name"],
      `${bindingPath}.name`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
    validateBodyNode(
      record["value"],
      `${bindingPath}.value`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
  });
}

function validateBodyArray(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const bodies = expectArray(value, path, contractName, declaration, index, diagnostics);
  if (!bodies) return;
  bodies.forEach((body, bodyIndex) =>
    validateBodyNode(body, `${path}[${bodyIndex}]`, contractName, declaration, index, diagnostics),
  );
}

function validateMatchArmArray(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const arms = expectArray(value, path, contractName, declaration, index, diagnostics);
  if (!arms) return;
  arms.forEach((arm, armIndex) => {
    const armPath = `${path}[${armIndex}]`;
    const record = expectRecord(arm, armPath, contractName, declaration, index, diagnostics);
    if (!record) return;
    validateValueNode(
      record["pattern"],
      `${armPath}.pattern`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
    validateBodyNode(
      record["body"],
      `${armPath}.body`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
  });
}

function validateCondClauseArray(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const clauses = expectArray(value, path, contractName, declaration, index, diagnostics);
  if (!clauses) return;
  clauses.forEach((clause, clauseIndex) => {
    const clausePath = `${path}[${clauseIndex}]`;
    const record = expectRecord(clause, clausePath, contractName, declaration, index, diagnostics);
    if (!record) return;
    validateValueNode(
      record["condition"],
      `${clausePath}.condition`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
    validateBodyNode(
      record["body"],
      `${clausePath}.body`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
  });
}

function validateValueArray(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const values = expectArray(value, path, contractName, declaration, index, diagnostics);
  if (!values) return;
  values.forEach((item, itemIndex) =>
    validateValueNode(item, `${path}[${itemIndex}]`, contractName, declaration, index, diagnostics),
  );
}

function validateValueNode(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const node = expectRecord(value, path, contractName, declaration, index, diagnostics);
  if (!node) return;
  const kind = expectString(
    node["kind"],
    `${path}.kind`,
    contractName,
    declaration,
    index,
    diagnostics,
  );
  if (!kind) return;

  switch (kind) {
    case "Var":
      expectString(node["name"], `${path}.name`, contractName, declaration, index, diagnostics);
      break;
    case "Literal":
      break;
    case "List":
    case "Vector":
      validateValueArray(
        node["items"],
        `${path}.items`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "Record":
      validateRecordEntryArray(
        node["entries"],
        `${path}.entries`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "Error":
      expectString(
        node["errorType"],
        `${path}.errorType`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      validateValueNode(
        node["payload"],
        `${path}.payload`,
        contractName,
        declaration,
        index,
        diagnostics,
      );
      break;
    case "Expr":
      expectRecord(node["source"], `${path}.source`, contractName, declaration, index, diagnostics);
      break;
    default:
      diagnostics.push(
        contractDiagnostic(contractName, path, "known value kind", kind, index, declaration),
      );
      break;
  }
}

function validateRecordEntryArray(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const entries = expectArray(value, path, contractName, declaration, index, diagnostics);
  if (!entries) return;
  entries.forEach((entry, entryIndex) => {
    const entryPath = `${path}[${entryIndex}]`;
    const record = expectRecord(entry, entryPath, contractName, declaration, index, diagnostics);
    if (!record) return;
    validateValueNode(
      record["key"],
      `${entryPath}.key`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
    validateValueNode(
      record["value"],
      `${entryPath}.value`,
      contractName,
      declaration,
      index,
      diagnostics,
    );
  });
}

function validateStringArray(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): void {
  const values = expectArray(value, path, contractName, declaration, index, diagnostics);
  if (!values) return;
  values.forEach((item, itemIndex) =>
    expectString(item, `${path}[${itemIndex}]`, contractName, declaration, index, diagnostics),
  );
}

function expectRecord(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): Record<string, JsonValue> | undefined {
  const record = jsonRecord(value);
  if (!record) {
    diagnostics.push(
      contractDiagnostic(contractName, path, "object", jsonKind(value), index, declaration),
    );
  }
  return record;
}

function expectArray(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): readonly JsonValue[] | undefined {
  if (!Array.isArray(value)) {
    diagnostics.push(
      contractDiagnostic(contractName, path, "array", jsonKind(value), index, declaration),
    );
    return undefined;
  }
  return value;
}

function expectString(
  value: JsonValue | undefined,
  path: string,
  contractName: string,
  declaration: PackageableDeclaration,
  index: number,
  diagnostics: Diagnostic[],
): string | undefined {
  if (typeof value !== "string") {
    diagnostics.push(
      contractDiagnostic(contractName, path, "string", jsonKind(value), index, declaration),
    );
    return undefined;
  }
  return value;
}

function contractDiagnostic(
  contractName: string,
  path: string,
  expected: string,
  got: unknown,
  index: number,
  declaration: PackageableDeclaration,
): Diagnostic {
  return declarationDiagnostic("artifact/payload-contract-nested-field", index, declaration, {
    contract: contractName,
    path,
    expected,
    got,
  });
}

function validateMechanicsPayloadShape(
  declaration: PackageableDeclaration,
  index: number,
): readonly Diagnostic[] {
  if (declaration.payloadContract?.startsWith("mechanics/")) return [];

  const payload = jsonRecord(declaration.payload);
  if (!payload) return [];

  switch (payload["kind"]) {
    case "SchemaDef":
      return jsonRecord(payload["schema"])
        ? []
        : [
            declarationDiagnostic("artifact/schema-payload-invalid", index, declaration, {
              field: "schema",
            }),
          ];
    case "ErrorDef":
      return jsonRecord(payload["schema"])
        ? []
        : [
            declarationDiagnostic("artifact/error-payload-invalid", index, declaration, {
              field: "schema",
            }),
          ];
    case "ServiceDef":
      return Array.isArray(payload["methods"])
        ? []
        : [
            declarationDiagnostic("artifact/service-payload-invalid", index, declaration, {
              field: "methods",
            }),
          ];
    case "EffectDef":
      return validateEffectPayloadShape(payload, declaration, index);
    default:
      return [];
  }
}

function validateEffectPayloadShape(
  payload: Record<string, JsonValue>,
  declaration: PackageableDeclaration,
  index: number,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!Array.isArray(payload["params"])) {
    diagnostics.push(
      declarationDiagnostic("artifact/effect-payload-invalid", index, declaration, {
        field: "params",
      }),
    );
  }
  if (!jsonRecord(payload["effect"])) {
    diagnostics.push(
      declarationDiagnostic("artifact/effect-payload-invalid", index, declaration, {
        field: "effect",
      }),
    );
  }
  if (!jsonRecord(payload["body"])) {
    diagnostics.push(
      declarationDiagnostic("artifact/effect-payload-invalid", index, declaration, {
        field: "body",
      }),
    );
  }
  return diagnostics;
}

function declarationDiagnostic(
  code: string,
  index: number,
  declaration: PackageableDeclaration,
  details?: Record<string, unknown>,
): Diagnostic {
  return {
    code,
    severity: "error",
    phase: "emit",
    message: `Declaration ${index} cannot be packaged: ${code.replace("artifact/", "")}`,
    ...(declaration.span ? { span: declaration.span } : {}),
    ...(details ? { details } : {}),
  };
}

function jsonRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, JsonValue>;
}

function jsonKind(
  value: JsonValue | undefined,
): PayloadFieldKind | "boolean" | "null" | "number" | "undefined" {
  if (Array.isArray(value)) return "array";
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
}
