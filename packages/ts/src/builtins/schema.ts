import { isNumeric } from "../evaluator/types.js";
import { Effect } from "effect";
import type { BuiltinFn, KValue } from "../evaluator/types.js";
import { isKList, isKMap } from "../evaluator/types.js";
import { ArityError, KernelTypeError } from "../diagnostic/errors.js";
import type { KernelError } from "../diagnostic/errors.js";

type ValidationIssue = {
  readonly path: readonly KValue[];
  readonly message: string;
};

const SCHEMA_TYPE_KEY = ":schema/type";
const SCHEMA_VALUE_KEY = ":schema/value";
const SCHEMA_ITEM_KEY = ":schema/item";
const SCHEMA_STRICT_KEY = ":schema/strict";
const SCHEMA_DECODE_KEY = ":schema/decode";
const SCHEMA_ENCODE_KEY = ":schema/encode";

const makeSchema = (tag: string, entries: ReadonlyArray<readonly [string, KValue]> = []) =>
  new Map<string, KValue>([[SCHEMA_TYPE_KEY, tag], ...entries]) as ReadonlyMap<string, KValue>;

const getSchemaTag = (schema: KValue): string | null => {
  if (!isKMap(schema)) return null;
  const tag = schema.get(SCHEMA_TYPE_KEY);
  return typeof tag === "string" ? tag : null;
};

const formatPath = (path: readonly KValue[]): string =>
  path.length === 0 ? "<root>" : path.map(String).join(".");

const typeError = (message: string, expected = "valid", got = "invalid") =>
  new KernelTypeError({ message, expected, got });

const failValidation = (
  issues: readonly ValidationIssue[],
): Effect.Effect<never, KernelTypeError> => {
  const message = issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`).join(", ");
  return Effect.fail(typeError(`Validation failed: ${message}`));
};

const validateValue = (
  schema: KValue,
  value: KValue,
  path: readonly KValue[],
): readonly ValidationIssue[] => {
  if (!isKMap(schema)) {
    return [{ path, message: "schema must be a map" }];
  }

  const tag = getSchemaTag(schema);
  if (tag === null) {
    return [{ path, message: "schema must be a map with :schema/type" }];
  }

  if (tag === "optional") {
    if (value === null) return [];
    const inner = schema.get(SCHEMA_VALUE_KEY);
    if (inner === undefined) return [{ path, message: "optional schema requires :schema/value" }];
    return validateValue(inner, value, path);
  }

  if (tag === "transform") {
    const inner = schema.get(SCHEMA_VALUE_KEY);
    if (inner === undefined) return [{ path, message: "transform schema requires :schema/value" }];
    return validateValue(inner, value, path);
  }

  if (tag === "any") return [];
  if (tag === "string")
    return typeof value === "string" ? [] : [{ path, message: "expected string" }];
  if (tag === "number")
    return isNumeric(value) ? [] : [{ path, message: "expected number" }];
  if (tag === "boolean")
    return typeof value === "boolean" ? [] : [{ path, message: "expected boolean" }];
  if (tag === "nil") return value === null ? [] : [{ path, message: "expected nil" }];

  if (tag === "literal") {
    const literalValue = schema.get(SCHEMA_VALUE_KEY);
    return Object.is(literalValue, value)
      ? []
      : [{ path, message: `expected literal ${String(literalValue)}` }];
  }

  if (tag === "list") {
    if (!isKList(value)) return [{ path, message: "expected list" }];
    const itemSchema = schema.get(SCHEMA_ITEM_KEY);
    if (itemSchema === undefined) return [{ path, message: "list schema requires :schema/item" }];
    return value.flatMap((item, index) => validateValue(itemSchema, item, [...path, index]));
  }

  if (tag === "map") {
    if (!isKMap(value)) return [{ path, message: "expected map" }];
    const shape = schema.get(SCHEMA_VALUE_KEY);
    if (shape === undefined || !isKMap(shape)) {
      return [{ path, message: "map schema requires :schema/value map" }];
    }

    const strict = schema.get(SCHEMA_STRICT_KEY) === true;
    const issues: ValidationIssue[] = [];

    for (const [field, fieldSchema] of shape) {
      const fieldPath = [...path, field];
      const fieldValue = value.get(field);
      const fieldTag = getSchemaTag(fieldSchema);
      if (fieldValue === undefined) {
        if (fieldTag !== "optional") {
          issues.push({ path: fieldPath, message: "missing required key" });
        }
        continue;
      }
      issues.push(...validateValue(fieldSchema, fieldValue, fieldPath));
    }

    if (strict) {
      for (const [key] of value) {
        if (!shape.has(key)) {
          issues.push({ path: [...path, key], message: "unexpected key" });
        }
      }
    }

    return issues;
  }

  return [{ path, message: `unknown schema type: ${tag}` }];
};

const validateWithSchema = (
  schema: KValue,
  value: KValue,
  apply: (fn: KValue, args: readonly KValue[]) => Effect.Effect<KValue, KernelError>,
  path: readonly KValue[] = [],
): Effect.Effect<readonly ValidationIssue[], KernelError> =>
  Effect.gen(function* () {
    if (!isKMap(schema)) {
      return [{ path, message: "schema must be a map" }];
    }

    const tag = getSchemaTag(schema);
    if (tag === null) {
      return [{ path, message: "schema must be a map with :schema/type" }];
    }

    if (tag === "optional") {
      if (value === null) return [];
      const inner = schema.get(SCHEMA_VALUE_KEY);
      if (inner === undefined) return [{ path, message: "optional schema requires :schema/value" }];
      return yield* validateWithSchema(inner, value, apply, path);
    }

    if (tag === "transform") {
      const inner = schema.get(SCHEMA_VALUE_KEY);
      if (inner === undefined)
        return [{ path, message: "transform schema requires :schema/value" }];

      const directIssues = yield* validateWithSchema(inner, value, apply, path);
      if (directIssues.length === 0) return [];

      const encodeFn = schema.get(SCHEMA_ENCODE_KEY);
      if (encodeFn === undefined) {
        return [{ path, message: "transform schema requires :schema/encode" }];
      }

      const encodedAttempt = yield* Effect.result(apply(encodeFn, [value]));
      if (encodedAttempt._tag === "Failure") {
        return directIssues;
      }

      const encodedIssues = yield* validateWithSchema(inner, encodedAttempt.success, apply, path);
      return encodedIssues.length === 0 ? [] : directIssues;
    }

    if (tag === "map") {
      if (!isKMap(value)) return [{ path, message: "expected map" }];
      const shape = schema.get(SCHEMA_VALUE_KEY);
      if (shape === undefined || !isKMap(shape)) {
        return [{ path, message: "map schema requires :schema/value map" }];
      }

      const strict = schema.get(SCHEMA_STRICT_KEY) === true;
      const issues: ValidationIssue[] = [];

      for (const [field, fieldSchema] of shape) {
        const fieldPath = [...path, field];
        const fieldValue = value.get(field);
        const fieldTag = getSchemaTag(fieldSchema);
        if (fieldValue === undefined) {
          if (fieldTag !== "optional") {
            issues.push({ path: fieldPath, message: "missing required key" });
          }
          continue;
        }
        issues.push(...(yield* validateWithSchema(fieldSchema, fieldValue, apply, fieldPath)));
      }

      if (strict) {
        for (const [key] of value) {
          if (!shape.has(key)) {
            issues.push({ path: [...path, key], message: "unexpected key" });
          }
        }
      }

      return issues;
    }

    if (tag === "list") {
      if (!isKList(value)) return [{ path, message: "expected list" }];
      const itemSchema = schema.get(SCHEMA_ITEM_KEY);
      if (itemSchema === undefined) return [{ path, message: "list schema requires :schema/item" }];

      const issues: ValidationIssue[] = [];
      for (let i = 0; i < value.length; i++) {
        issues.push(...(yield* validateWithSchema(itemSchema, value[i]!, apply, [...path, i])));
      }
      return issues;
    }

    return validateValue(schema, value, path);
  });

const decodeWithSchema = (
  schema: KValue,
  value: KValue,
  apply: (fn: KValue, args: readonly KValue[]) => Effect.Effect<KValue, KernelError>,
  path: readonly KValue[] = [],
): Effect.Effect<KValue, KernelError> =>
  Effect.gen(function* () {
    const issues = validateValue(schema, value, path);
    if (issues.length > 0) return yield* failValidation(issues);

    const tag = getSchemaTag(schema);
    if (tag === null || !isKMap(schema)) {
      return yield* Effect.fail(typeError("invalid schema", "schema", "unknown"));
    }

    if (tag === "transform") {
      const inner = schema.get(SCHEMA_VALUE_KEY)!;
      const decodeFn = schema.get(SCHEMA_DECODE_KEY);
      if (decodeFn === undefined) {
        return yield* Effect.fail(
          typeError(
            "transform schema requires :schema/decode",
            "transform schema",
            "missing decoder",
          ),
        );
      }
      const decodedInner = yield* decodeWithSchema(inner, value, apply, path);
      return yield* apply(decodeFn, [decodedInner]);
    }

    if (tag === "map") {
      const shape = schema.get(SCHEMA_VALUE_KEY)!;
      if (!isKMap(shape) || !isKMap(value)) return value;
      const result = new Map<string, KValue>();
      for (const [field, fieldSchema] of shape) {
        const fieldValue = value.get(field);
        if (fieldValue === undefined) continue;
        const decodedField = yield* decodeWithSchema(fieldSchema, fieldValue, apply, [
          ...path,
          field,
        ]);
        result.set(field, decodedField);
      }
      if (schema.get(SCHEMA_STRICT_KEY) !== true) {
        for (const [key, raw] of value) {
          if (!result.has(key)) result.set(key, raw);
        }
      }
      return result as ReadonlyMap<string, KValue>;
    }

    if (tag === "list") {
      if (!isKList(value)) return value;
      const itemSchema = schema.get(SCHEMA_ITEM_KEY)!;
      const decoded = [] as KValue[];
      for (let i = 0; i < value.length; i++) {
        decoded.push(yield* decodeWithSchema(itemSchema, value[i]!, apply, [...path, i]));
      }
      return decoded;
    }

    if (tag === "optional") {
      if (value === null) return null;
      const inner = schema.get(SCHEMA_VALUE_KEY)!;
      return yield* decodeWithSchema(inner, value, apply, path);
    }

    return value;
  });

const encodeWithSchema = (
  schema: KValue,
  value: KValue,
  apply: (fn: KValue, args: readonly KValue[]) => Effect.Effect<KValue, KernelError>,
  path: readonly KValue[] = [],
): Effect.Effect<KValue, KernelError> =>
  Effect.gen(function* () {
    const tag = getSchemaTag(schema);
    if (tag === null || !isKMap(schema)) {
      return yield* Effect.fail(typeError("invalid schema", "schema", "unknown"));
    }

    if (tag === "transform") {
      const inner = schema.get(SCHEMA_VALUE_KEY)!;
      const encodeFn = schema.get(SCHEMA_ENCODE_KEY);
      if (encodeFn === undefined) {
        return yield* Effect.fail(
          typeError(
            "transform schema requires :schema/encode",
            "transform schema",
            "missing encoder",
          ),
        );
      }
      const preEncoded = yield* apply(encodeFn, [value]);
      const encodedInner = yield* encodeWithSchema(inner, preEncoded, apply, path);
      const issues = validateValue(inner, encodedInner, path);
      if (issues.length > 0) return yield* failValidation(issues);
      return encodedInner;
    }

    if (tag === "map") {
      if (!isKMap(value)) {
        return yield* Effect.fail(
          typeError(`Validation failed: ${formatPath(path)}: expected map`, "map", "non-map"),
        );
      }
      const shape = schema.get(SCHEMA_VALUE_KEY)!;
      if (!isKMap(shape)) return value;
      const strict = schema.get(SCHEMA_STRICT_KEY) === true;
      const out = new Map<string, KValue>();

      for (const [field, fieldSchema] of shape) {
        const fieldTag = getSchemaTag(fieldSchema);
        const fieldValue = value.get(field);
        if (fieldValue === undefined) {
          if (fieldTag !== "optional") {
            return yield* Effect.fail(
              typeError(
                `Validation failed: ${formatPath([...path, field])}: missing required key`,
                "present key",
                "missing",
              ),
            );
          }
          continue;
        }
        out.set(field, yield* encodeWithSchema(fieldSchema, fieldValue, apply, [...path, field]));
      }

      if (strict) {
        for (const [key] of value) {
          if (!shape.has(key)) {
            return yield* Effect.fail(
              typeError(
                `Validation failed: ${formatPath([...path, key])}: unexpected key`,
                "known key",
                "unknown key",
              ),
            );
          }
        }
      } else {
        for (const [key, val] of value) {
          if (!out.has(key)) out.set(key, val);
        }
      }

      return out as ReadonlyMap<string, KValue>;
    }

    if (tag === "list") {
      if (!isKList(value)) {
        return yield* Effect.fail(
          typeError(`Validation failed: ${formatPath(path)}: expected list`, "list", "non-list"),
        );
      }
      const itemSchema = schema.get(SCHEMA_ITEM_KEY)!;
      const out: KValue[] = [];
      for (let i = 0; i < value.length; i++) {
        out.push(yield* encodeWithSchema(itemSchema, value[i]!, apply, [...path, i]));
      }
      return out;
    }

    if (tag === "optional") {
      if (value === null) return null;
      const inner = schema.get(SCHEMA_VALUE_KEY)!;
      return yield* encodeWithSchema(inner, value, apply, path);
    }

    const issues = validateValue(schema, value, path);
    if (issues.length > 0) return yield* failValidation(issues);
    return value;
  });

const okResult = (value: KValue) =>
  new Map<string, KValue>([
    [":ok", true],
    [":value", value],
    [":errors", [] as readonly KValue[]],
  ]) as ReadonlyMap<string, KValue>;

const errResult = (issues: readonly ValidationIssue[]) =>
  new Map<string, KValue>([
    [":ok", false],
    [":value", null],
    [
      ":errors",
      issues.map(
        (issue) =>
          new Map<string, KValue>([
            [":path", issue.path],
            [":message", issue.message],
          ]) as ReadonlyMap<string, KValue>,
      ),
    ],
  ]) as ReadonlyMap<string, KValue>;

export const schemaAny: BuiltinFn = (args) => {
  if (args.length !== 0)
    return Effect.fail(new ArityError({ name: "schema/any", expected: 0, got: args.length }));
  return Effect.succeed(makeSchema("any"));
};

export const schemaString: BuiltinFn = (args) => {
  if (args.length !== 0)
    return Effect.fail(new ArityError({ name: "schema/string", expected: 0, got: args.length }));
  return Effect.succeed(makeSchema("string"));
};

export const schemaNumber: BuiltinFn = (args) => {
  if (args.length !== 0)
    return Effect.fail(new ArityError({ name: "schema/number", expected: 0, got: args.length }));
  return Effect.succeed(makeSchema("number"));
};

export const schemaBoolean: BuiltinFn = (args) => {
  if (args.length !== 0)
    return Effect.fail(new ArityError({ name: "schema/boolean", expected: 0, got: args.length }));
  return Effect.succeed(makeSchema("boolean"));
};

export const schemaNil: BuiltinFn = (args) => {
  if (args.length !== 0)
    return Effect.fail(new ArityError({ name: "schema/nil", expected: 0, got: args.length }));
  return Effect.succeed(makeSchema("nil"));
};

export const schemaLiteral: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "schema/literal", expected: 1, got: args.length }));
  return Effect.succeed(makeSchema("literal", [[SCHEMA_VALUE_KEY, args[0]!]]));
};

export const schemaOptional: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "schema/optional", expected: 1, got: args.length }));
  return Effect.succeed(makeSchema("optional", [[SCHEMA_VALUE_KEY, args[0]!]]));
};

export const schemaList: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "schema/list", expected: 1, got: args.length }));
  return Effect.succeed(makeSchema("list", [[SCHEMA_ITEM_KEY, args[0]!]]));
};

export const schemaMap: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "schema/map", expected: 1, got: args.length }));
  const shape = args[0]!;
  if (!isKMap(shape)) {
    return Effect.fail(
      new KernelTypeError({
        message: "schema/map: arg must be a map of field schemas",
        expected: "map",
        got: typeof shape,
      }),
    );
  }
  return Effect.succeed(makeSchema("map", [[SCHEMA_VALUE_KEY, shape]]));
};

export const schemaStrict: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "schema/strict", expected: 1, got: args.length }));
  const schema = args[0]!;
  if (!isKMap(schema) || getSchemaTag(schema) !== "map") {
    return Effect.fail(
      typeError("schema/strict: arg must be a schema/map value", "map schema", "other"),
    );
  }
  return Effect.succeed(
    new Map<string, KValue>([...schema, [SCHEMA_STRICT_KEY, true]]) as ReadonlyMap<string, KValue>,
  );
};

export const schemaTransform: BuiltinFn = (args) => {
  if (args.length !== 3)
    return Effect.fail(new ArityError({ name: "schema/transform", expected: 3, got: args.length }));
  return Effect.succeed(
    makeSchema("transform", [
      [SCHEMA_VALUE_KEY, args[0]!],
      [SCHEMA_DECODE_KEY, args[1]!],
      [SCHEMA_ENCODE_KEY, args[2]!],
    ]),
  );
};

export const validate: BuiltinFn = (args, apply) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "validate", expected: 2, got: args.length }));
  return Effect.gen(function* () {
    const issues = yield* validateWithSchema(args[0]!, args[1]!, apply);
    return issues.length === 0 ? okResult(args[1]!) : errResult(issues);
  });
};

export const assertValid: BuiltinFn = (args, apply) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "assert-valid", expected: 2, got: args.length }));
  return Effect.gen(function* () {
    const issues = yield* validateWithSchema(args[0]!, args[1]!, apply);
    if (issues.length === 0) return args[1]!;
    return yield* failValidation(issues);
  });
};

export const decode: BuiltinFn = (args, apply) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "decode", expected: 2, got: args.length }));
  return decodeWithSchema(args[0]!, args[1]!, apply);
};

export const encode: BuiltinFn = (args, apply) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "encode", expected: 2, got: args.length }));
  return encodeWithSchema(args[0]!, args[1]!, apply);
};

export const schemaBuiltins: Record<string, BuiltinFn> = {
  "schema/any": schemaAny,
  "schema/string": schemaString,
  "schema/number": schemaNumber,
  "schema/boolean": schemaBoolean,
  "schema/nil": schemaNil,
  "schema/literal": schemaLiteral,
  "schema/optional": schemaOptional,
  "schema/list": schemaList,
  "schema/map": schemaMap,
  "schema/strict": schemaStrict,
  "schema/transform": schemaTransform,
  validate,
  "assert-valid": assertValid,
  decode,
  encode,
};
