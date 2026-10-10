import { KFloat, isKFloat, isNumeric, kEquals } from "../evaluator/types.js";
import type { JsonValue, PackageableDeclaration } from "../artifact/artifact.js";

function numericLiteral(value: unknown, kind: unknown): unknown {
  return typeof value === "number" && (kind === "float" || !Number.isInteger(value)) ? new KFloat(value) : value;
}

function literalMatches(pattern: unknown, value: unknown): boolean {
  return isKFloat(pattern) === isKFloat(value) && valuesEqual(pattern, value);
}

export type MechanicsRuntimeValue = unknown;

export type MechanicsServiceMethod = (
  ...args: readonly MechanicsRuntimeValue[]
) => MechanicsRuntimeValue | Promise<MechanicsRuntimeValue>;

export type MechanicsServiceImplementation = Readonly<Record<string, MechanicsServiceMethod>>;

export interface MechanicsRuntimeOptions {
  readonly declarations: readonly PackageableDeclaration[];
  readonly services: Readonly<Record<string, MechanicsServiceImplementation>>;
}

export interface MechanicsRuntime {
  readonly operations: ReadonlySet<string>;
  readonly invoke: (
    operationName: string,
    args?: readonly MechanicsRuntimeValue[],
  ) => Promise<MechanicsRuntimeValue>;
}

export class MechanicsRuntimeError extends Error {
  readonly code: string;
  readonly errorType: string | undefined;
  readonly errorValue: MechanicsRuntimeValue | undefined;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    details?: unknown,
    errorType?: string,
    errorValue?: MechanicsRuntimeValue,
  ) {
    super(message);
    this.name = "MechanicsRuntimeError";
    this.code = code;
    this.details = details;
    this.errorType = errorType;
    this.errorValue = errorValue;
  }
}

type JsonRecord = { readonly [key: string]: JsonValue };
type ServiceMap = ReadonlyMap<string, ReadonlyMap<string, MechanicsServiceMethod>>;

export function makeMechanicsRuntime(options: MechanicsRuntimeOptions): MechanicsRuntime {
  const operations = new Map<string, JsonRecord>();
  const services = normalizeServices(options.services);

  for (const declaration of options.declarations) {
    if (!isRecord(declaration.payload)) continue;
    if (declaration.payload["kind"] !== "EffectDef") continue;
    const name = declaration.payload["name"];
    if (typeof name === "string") {
      operations.set(name, declaration.payload);
    }
  }

  const invoke = async (
    operationName: string,
    args: readonly MechanicsRuntimeValue[] = [],
  ): Promise<MechanicsRuntimeValue> => {
    const operation = operations.get(operationName);
    if (!operation) {
      throw new MechanicsRuntimeError(
        "mechanics/unknown-operation",
        `Unknown mechanics operation: ${operationName}`,
        { operationName },
      );
    }

    assertRequirementsAvailable(operation, services);
    const env = new Map<string, MechanicsRuntimeValue>();
    const params = arrayField(operation, "params");
    for (let index = 0; index < params.length; index++) {
      const param = params[index];
      if (isRecord(param) && typeof param["name"] === "string") {
        env.set(param["name"], args[index]);
      }
    }

    return evaluateEffect(recordField(operation, "body"), env, services, invoke);
  };

  return {
    operations: new Set(operations.keys()),
    invoke,
  };
}

type OperationInvoke = (
  operationName: string,
  args?: readonly MechanicsRuntimeValue[],
) => Promise<MechanicsRuntimeValue>;

async function evaluateEffect(
  node: JsonRecord,
  env: Map<string, MechanicsRuntimeValue>,
  services: ServiceMap,
  invoke: OperationInvoke,
): Promise<MechanicsRuntimeValue> {
  switch (node["kind"]) {
    case "OperationCall": {
      const operationName = stringField(node, "operation");
      const args = await Promise.all(
        arrayField(node, "args").map((arg) => evaluateValue(arg, env, services, invoke)),
      );
      return invoke(operationName, args);
    }
    case "ServiceCall": {
      const serviceName = stringField(node, "service");
      const methodName = stringField(node, "method");
      const service = services.get(serviceName);
      const method = service?.get(methodName);
      if (!method) {
        throw new MechanicsRuntimeError(
          "mechanics/missing-service-method",
          `Missing mechanics service method: ${serviceName}.${methodName}`,
          { service: serviceName, method: methodName },
        );
      }
      const args = await Promise.all(
        arrayField(node, "args").map((arg) => evaluateValue(arg, env, services, invoke)),
      );
      return method(...args);
    }
    case "Succeed":
      return evaluateValue(node["value"], env, services, invoke);
    case "Fail": {
      const error = await evaluateValue(node["error"], env, services, invoke);
      const errorType = errorValueType(error);
      throw new MechanicsRuntimeError(
        failCode(error),
        "Mechanics operation failed.",
        { error },
        errorType,
        error,
      );
    }
    case "Catch": {
      try {
        return await evaluateEffect(recordField(node, "body"), env, services, invoke);
      } catch (error) {
        if (
          !(error instanceof MechanicsRuntimeError) ||
          error.errorType !== stringField(node, "errorType")
        ) {
          throw error;
        }
        const scoped = new Map(env);
        scoped.set(stringField(node, "binding"), error.errorValue);
        return evaluateEffect(recordField(node, "handler"), scoped, services, invoke);
      }
    }
    case "Bind": {
      const value = await evaluateEffect(recordField(node, "value"), env, services, invoke);
      if (!isRecord(node["body"])) return value;
      const scoped = new Map(env);
      if (typeof node["name"] === "string") {
        scoped.set(node["name"], value);
      }
      return evaluateEffect(node["body"], scoped, services, invoke);
    }
    case "Do":
      return evaluateDo(node, env, services, invoke);
    case "Let":
      return evaluateLet(node, env, services, invoke);
    case "If":
      return isTruthy(await evaluateValue(node["condition"], env, services, invoke))
        ? evaluateEffect(recordField(node, "then"), env, services, invoke)
        : evaluateEffect(recordField(node, "else"), env, services, invoke);
    case "When":
      return isTruthy(await evaluateValue(node["condition"], env, services, invoke))
        ? evaluateEffect(recordField(node, "body"), env, services, invoke)
        : null;
    case "Unless":
      return !isTruthy(await evaluateValue(node["condition"], env, services, invoke))
        ? evaluateEffect(recordField(node, "body"), env, services, invoke)
        : null;
    case "Cond":
      for (const clause of arrayField(node, "clauses")) {
        if (!isRecord(clause)) continue;
        if (isTruthy(await evaluateValue(clause["condition"], env, services, invoke))) {
          return evaluateEffect(recordField(clause, "body"), env, services, invoke);
        }
      }
      return null;
    case "Match":
      return evaluateMatch(node, env, services, invoke);
    case "Pure":
      return evaluateValue(node["value"], env, services, invoke);
    default:
      throw new MechanicsRuntimeError(
        "mechanics/unsupported-node",
        `Unsupported mechanics effect node: ${String(node["kind"])}`,
        { node },
      );
  }
}

async function evaluateDo(
  node: JsonRecord,
  env: Map<string, MechanicsRuntimeValue>,
  services: ServiceMap,
  invoke: OperationInvoke,
): Promise<MechanicsRuntimeValue> {
  const scoped = new Map(env);
  for (const binding of arrayField(node, "bindings")) {
    if (!isRecord(binding) || typeof binding["name"] !== "string") continue;
    scoped.set(
      binding["name"],
      await evaluateEffect(recordField(binding, "value"), scoped, services, invoke),
    );
  }

  if (isRecord(node["body"])) {
    return evaluateEffect(node["body"], scoped, services, invoke);
  }

  let result: MechanicsRuntimeValue = null;
  for (const form of arrayField(node, "forms")) {
    result = await evaluateEffect(asRecord(form), scoped, services, invoke);
  }
  return result;
}

async function evaluateLet(
  node: JsonRecord,
  env: Map<string, MechanicsRuntimeValue>,
  services: ServiceMap,
  invoke: OperationInvoke,
): Promise<MechanicsRuntimeValue> {
  const scoped = new Map(env);
  for (const binding of arrayField(node, "bindings")) {
    if (!isRecord(binding) || typeof binding["name"] !== "string") continue;
    scoped.set(
      binding["name"],
      await evaluateEffect(recordField(binding, "value"), scoped, services, invoke),
    );
  }
  return evaluateEffect(recordField(node, "body"), scoped, services, invoke);
}

async function evaluateMatch(
  node: JsonRecord,
  env: Map<string, MechanicsRuntimeValue>,
  services: ServiceMap,
  invoke: OperationInvoke,
): Promise<MechanicsRuntimeValue> {
  const value = await evaluateValue(node["value"], env, services, invoke);
  for (const arm of arrayField(node, "arms")) {
    if (!isRecord(arm)) continue;
    const scoped = new Map(env);
    if (await patternMatches(arm["pattern"], value, scoped, services, invoke)) {
      return evaluateEffect(recordField(arm, "body"), scoped, services, invoke);
    }
  }
  return null;
}

async function evaluateValue(
  value: JsonValue | undefined,
  env: Map<string, MechanicsRuntimeValue>,
  services: ServiceMap,
  invoke: OperationInvoke,
): Promise<MechanicsRuntimeValue> {
  if (!isRecord(value)) return value;

  switch (value["kind"]) {
    case "Literal":
      return numericLiteral(value["value"], value["numericKind"]);
    case "Var": {
      const name = stringField(value, "name");
      if (name === "nil") return null;
      if (env.has(name)) return env.get(name);
      throw new MechanicsRuntimeError(
        "mechanics/unbound-var",
        `Unbound mechanics variable: ${name}`,
        { name },
      );
    }
    case "Vector":
      return Promise.all(
        arrayField(value, "items").map((item) => evaluateValue(item, env, services, invoke)),
      );
    case "List": {
      const items = arrayField(value, "items");
      return Promise.all(
        items.map((item, index) =>
          index === 0
            ? evaluateListHead(item, env, services, invoke)
            : evaluateValue(item, env, services, invoke),
        ),
      );
    }
    case "Record": {
      const record: Record<string, MechanicsRuntimeValue> = {};
      for (const entry of arrayField(value, "entries")) {
        if (!isRecord(entry)) continue;
        const key = await evaluateValue(entry["key"], env, services, invoke);
        record[recordKeyString(key, entry["key"])] = await evaluateValue(
          entry["value"],
          env,
          services,
          invoke,
        );
      }
      return record;
    }
    case "Error": {
      const errorType = stringField(value, "errorType");
      const payload = await evaluateValue(value["payload"], env, services, invoke);
      return isRecord(payload)
        ? { _tag: errorType, ...payload }
        : { _tag: errorType, value: payload };
    }
    case "Expr":
      return evaluateExprLiteral(value["source"]);
    default:
      throw new MechanicsRuntimeError(
        "mechanics/unsupported-value-node",
        `Unsupported mechanics value node: ${String(value["kind"])}`,
        { node: value },
      );
  }
}

async function evaluateListHead(
  value: JsonValue | undefined,
  env: Map<string, MechanicsRuntimeValue>,
  services: ServiceMap,
  invoke: OperationInvoke,
): Promise<MechanicsRuntimeValue> {
  if (isRecord(value) && value["kind"] === "Var" && typeof value["name"] === "string") {
    const name = value["name"];
    if (name !== "nil" && !env.has(name)) return name;
  }
  return evaluateValue(value, env, services, invoke);
}

async function patternMatches(
  pattern: JsonValue | undefined,
  value: MechanicsRuntimeValue,
  env: Map<string, MechanicsRuntimeValue>,
  services: ServiceMap,
  invoke: OperationInvoke,
): Promise<boolean> {
  if (!isRecord(pattern)) return valuesEqual(pattern, value);

  switch (pattern["kind"]) {
    case "Var": {
      const name = stringField(pattern, "name");
      if (name === "_") return true;
      if (name === "nil") return valuesEqual(null, value);
      if (name === "true") return valuesEqual(true, value);
      if (name === "false") return valuesEqual(false, value);
      if (env.has(name)) return valuesEqual(env.get(name), value);
      env.set(name, value);
      return true;
    }
    case "Literal":
      return literalMatches(numericLiteral(pattern["value"], pattern["numericKind"]), value);
    case "Expr":
      return literalMatches(evaluateExprLiteral(pattern["source"]), value);
    case "List":
    case "Vector": {
      if (!Array.isArray(value)) return false;
      const items = arrayField(pattern, "items");
      return (
        value.length === items.length &&
        (await asyncEvery(items, (item, index) =>
          patternMatches(item, value[index], env, services, invoke),
        ))
      );
    }
    case "Record": {
      if (!isRecord(value)) return false;
      return asyncEvery(arrayField(pattern, "entries"), async (entry) => {
        if (!isRecord(entry)) return false;
        const key = recordKeyString(
          await evaluateValue(entry["key"], env, services, invoke),
          entry["key"],
        );
        return Object.hasOwn(value, key)
          ? patternMatches(entry["value"], value[key], env, services, invoke)
          : false;
      });
    }
    default:
      return valuesEqual(await evaluateValue(pattern, env, services, invoke), value);
  }
}

function valuesEqual(left: MechanicsRuntimeValue, right: MechanicsRuntimeValue): boolean {
  if (isNumeric(left) && isNumeric(right)) return kEquals(left,right);
  if (Object.is(left, right)) return true;

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((item, index) => valuesEqual(item, right[index]))
    );
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && valuesEqual(left[key], right[key]))
    );
  }

  return false;
}

function assertRequirementsAvailable(operation: JsonRecord, services: ServiceMap): void {
  const effect = operation["effect"];
  if (!isRecord(effect)) return;

  for (const requirement of arrayField(effect, "requirements")) {
    if (typeof requirement !== "string") continue;
    const [serviceName, methodName, ...extra] = requirement.split(".");
    const operationAvailable =
      extra.length === 0 &&
      serviceName !== undefined &&
      methodName !== undefined &&
      services.get(serviceName)?.has(methodName);
    const serviceAvailable = services.has(requirement);
    if (!operationAvailable && !serviceAvailable) {
      throw new MechanicsRuntimeError(
        "mechanics/missing-capability",
        `Missing mechanics capability: ${requirement}`,
        { capability: requirement },
      );
    }
  }
}

function normalizeServices(services: MechanicsRuntimeOptions["services"]): ServiceMap {
  return new Map(
    Object.entries(services).map(([serviceName, service]) => [
      serviceName,
      new Map(Object.entries(service)),
    ]),
  );
}

async function asyncEvery<T>(
  values: readonly T[],
  predicate: (value: T, index: number) => Promise<boolean>,
): Promise<boolean> {
  for (let index = 0; index < values.length; index++) {
    if (!(await predicate(values[index]!, index))) return false;
  }
  return true;
}

function failCode(error: MechanicsRuntimeValue): string {
  const errorType = errorValueType(error);
  if (errorType) return `mechanics/fail/${errorType}`;
  if (typeof error === "string" && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(error)) {
    return `mechanics/fail/${error}`;
  }
  return "mechanics/fail";
}

function errorValueType(error: MechanicsRuntimeValue): string | undefined {
  return isRecord(error) && typeof error["_tag"] === "string" ? error["_tag"] : undefined;
}

function recordKeyString(key: MechanicsRuntimeValue, source: JsonValue | undefined): string {
  if (typeof key === "string") return key.replace(/^:/, "");
  if (typeof key === "number" || typeof key === "boolean") return String(key);
  throw new MechanicsRuntimeError("mechanics/invalid-record-key", "Invalid mechanics record key.", {
    key,
    source,
  });
}

function evaluateExprLiteral(source: JsonValue | undefined): MechanicsRuntimeValue {
  if (!isRecord(source)) return source;
  switch (source["kind"]) {
    case "Symbol":
      return typeof source["name"] === "string" ? source["name"] : source;
    case "Number": return numericLiteral(source["value"], source["numericKind"]);
    case "String":
    case "Bool":
      return source["value"];
    default:
      return source;
  }
}

function isTruthy(value: MechanicsRuntimeValue): boolean {
  return value !== null && value !== false && value !== undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: JsonValue | undefined): JsonRecord {
  if (isRecord(value)) return value;
  throw new MechanicsRuntimeError("mechanics/invalid-payload", "Expected mechanics object node.", {
    value,
  });
}

function recordField(record: JsonRecord, field: string): JsonRecord {
  return asRecord(record[field]);
}

function arrayField(record: JsonRecord, field: string): readonly JsonValue[] {
  const value = record[field];
  return Array.isArray(value) ? value : [];
}

function stringField(record: JsonRecord, field: string): string {
  const value = record[field];
  if (typeof value === "string") return value;
  throw new MechanicsRuntimeError(
    "mechanics/invalid-payload",
    `Expected string field '${field}'.`,
    { record },
  );
}
