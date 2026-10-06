/**
 * Type definition forms: __sum-type, __typeclass, instance, and mechanics services.
 */
import type { SExpr } from "../reader/index.js";
import { asSym, trySym, headSym, asList, asVector } from "../reader/types.js";
import type {
  CoreExpr,
  Span,
  ClassTypeParam,
  ClassConstraint,
  ClassMethod,
  TypeExpr,
} from "./core-expr.js";
import {
  CTypeDef,
  CDefClass,
  CDefService,
  CInstance,
  TEApp,
  TERow,
  TESym,
  TEFun,
} from "./core-expr.js";
import { InferenceError } from "./errors.js";
import { spanOf } from "./lower-core.js";
import type { LowerFn } from "./lower-core.js";
import { parseTypeExpr } from "./type-parser.js";

export function lowerTypeDef(span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length < 3) {
    throw new InferenceError({ message: "(type ...) requires at least 2 arguments" });
  }

  const nameExpr = items[1]!;

  // ADT: (__sum-type (Name params...) (Con1 fields...) (Con2 fields...) ...)
  if (nameExpr._tag === "List") {
    const typeName = headSym(nameExpr);
    if (!typeName) {
      throw new InferenceError({ message: "A type name must be a symbol" });
    }
    const typeParams = nameExpr.items.slice(1).map((p) => asSym(p, "type parameter"));
    if (asSym(items[0]!, "type declaration") === "__type-alias") {
      if (items.length !== 3) throw new InferenceError({message: "A type alias requires one body"});
      if (new Set(typeParams).size !== typeParams.length || typeParams.some(p => !/^[a-z]/.test(p)))
        throw new InferenceError({message: "Type parameters must be distinct lowercase symbols"});
      return CTypeDef(span, typeName, parseTypeExpr(items[2]!), typeParams);
    }

    const constructors = items.slice(2).filter(con=>headSym(con) !== ":tag").map((con) => {
      const conName = headSym(con);
      if (!conName) {
        throw new InferenceError({ message: "type constructor must be (Name fields...)" });
      }
      return {
        name: conName,
        fields: asList(con, "__sum-type constructor").slice(1).map(parseTypeExpr),
      };
    });

    if (constructors.length === 0) {
      throw new InferenceError({ message: "type requires at least one constructor" });
    }

    return CTypeDef(span, typeName, undefined, typeParams, constructors);
  }

  // Alias: (__sum-type Name TypeExpr)
  const aliasName = asSym(nameExpr, "type name");
  if (items.length !== 3) {
    throw new InferenceError({
      message: "(type Name Type) requires exactly 2 arguments for aliases",
    });
  }
  let typeExpr = parseTypeExpr(items[2]!);
  if (typeExpr._tag === "TEApp" && typeExpr.con._tag === "TESym" && typeExpr.con.name === "Brand") {
    if (typeExpr.args.length !== 1) throw new InferenceError({message: "Brand expects one base type and derives its name from the declaration"});
    typeExpr = TEApp(typeExpr.span, typeExpr.con, [TESym(span, aliasName), typeExpr.args[0]!]);
  }
  return CTypeDef(span, aliasName, typeExpr);
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export function lowerDefineService(span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length !== 3) {
    throw new InferenceError({
      message: "__service expects a service name and (:methods ...) block.",
    });
  }

  const serviceName = asSym(items[1]!, "service name");
  const methods = parseServiceMethods(serviceName, items[2]!);
  return CDefService(span, serviceName, methods);
}

function parseServiceMethods(
  serviceName: string,
  expr: SExpr,
): readonly { readonly name: string; readonly typeExpr: TypeExpr }[] {
  const items = asList(expr, "service methods");
  if (trySym(items[0]!) !== ":methods") {
    throw new InferenceError({
      message: "__service expects a (:methods ...) block.",
    });
  }

  return items.slice(1).map((method) => parseServiceMethod(serviceName, method));
}

function parseServiceMethod(
  serviceName: string,
  expr: SExpr,
): { readonly name: string; readonly typeExpr: TypeExpr } {
  const items = asList(expr, "service method");
  if (items.length !== 3) {
    throw new InferenceError({
      message: "service methods must be (name [param Type ...] ReturnEffect).",
    });
  }

  const methodName = asSym(items[0]!, "service method name");
  const paramTypes = parseServiceMethodParamTypes(items[1]!);
  const returnType = appendServiceRequirement(
    `${serviceName}.${methodName}`,
    parseTypeExpr(items[2]!),
  );
  return {
    name: methodName,
    typeExpr: TEFun(spanOf(expr), paramTypes, returnType),
  };
}

function parseServiceMethodParamTypes(expr: SExpr): readonly TypeExpr[] {
  const items = asVector(expr, "service method params");
  if (items.length % 2 !== 0) {
    throw new InferenceError({
      message: "service method params must be [name Type ...] pairs.",
    });
  }

  const params: TypeExpr[] = [];
  for (let index = 0; index < items.length; index += 2) {
    asSym(items[index]!, "service method param name");
    params.push(parseTypeExpr(items[index + 1]!));
  }
  return params;
}

function appendServiceRequirement(operationRequirement: string, typeExpr: TypeExpr): TypeExpr {
  if (
    typeExpr._tag !== "TEApp" ||
    typeExpr.con._tag !== "TESym" ||
    typeExpr.con.name !== "Effect" ||
    typeExpr.args.length !== 3
  ) {
    throw new InferenceError({
      message: "service methods must return an Effect type.",
    });
  }

  const [success, errors, requirements] = typeExpr.args;
  if (
    !success ||
    !errors ||
    !requirements ||
    requirements._tag !== "TEApp" ||
    requirements.con._tag !== "TESym" ||
    requirements.con.name !== "RequirementSet"
  ) {
    throw new InferenceError({
      message: "service method Effect requirements must be a requirement set.",
    });
  }

  const operationRequirementExists = requirements.args.some(
    (requirement) => requirement._tag === "TESym" && requirement.name === operationRequirement,
  );
  return TEApp(typeExpr.span, typeExpr.con, [
    success,
    errors,
    TEApp(requirements.span, requirements.con, [
      ...requirements.args,
      ...(operationRequirementExists
        ? []
        : [TESym(requirements.span, operationRequirement)]),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Schema projection
// ---------------------------------------------------------------------------

/**
 * Lower a schema declaration into a type alias for the checker.
 *
 * This is the first mechanics bridge for schemas: canonical schema elaboration
 * still owns runtime payloads, but the HM checker can now use schema names in
 * annotations and field access.
 */
export function lowerDefineSchema(span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length !== 3) {
    throw new InferenceError({
      message: "(__schema Name SchemaExpr) requires exactly a name and schema expression",
    });
  }

  const schemaName = asSym(items[1]!, "__schema name");
  const typeExpr = schemaExprToTypeExpr(items[2]!);
  return CTypeDef(span, schemaName, typeExpr, undefined, undefined, "schema");
}

export function lowerDefineError(span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length !== 3) {
    throw new InferenceError({
      message: "(error Name {...}) requires a name and field record",
    });
  }

  const errorName = asSym(items[1]!, "error name");
  const fields = parseErrorFields(items[2]!);
  return CTypeDef(span, errorName, TERow(spanOf(items[2]!), fields), undefined, undefined, "error");
}

export function isDefineSchemaProjection(items: readonly SExpr[]): boolean {
  return items.length === 3 && trySym(items[1]!) !== undefined && isSchemaProjectionExpr(items[2]!);
}

function isSchemaProjectionExpr(expr: SExpr): boolean {
  if (expr._tag === "Sym") return !expr.name.startsWith(":");
  if (expr._tag !== "List" || expr.items.length === 0) return false;
  const head = canonicalSchemaHead(trySym(expr.items[0]!)) ?? "";
  return (
    [
      "Struct",
      "Array",
      "Optional",
      "Map",
      "Ref",
      "Brand",
      "Enum",
      "Literal",
      "Tuple",
      "Union",
      "TaggedUnion",
    ].includes(head) ||
    (expr.items.length > 1 && hasOnlyMetadataPairs(expr.items, 1))
  );
}

function schemaExprToTypeExpr(expr: SExpr): TypeExpr {
  const primitive = primitiveSchemaTypeExpr(expr);
  if (primitive) return primitive;

  if (expr._tag === "List" && expr.items.length > 0) {
    const head = canonicalSchemaHead(trySym(expr.items[0]!));
    switch (head) {
      case "Struct":
        return TERow(
          spanOf(expr),
          expr.items.slice(1).map((field) => schemaFieldToRowField(field)),
        );
      case "Array": {
        if (expr.items.length < 2 || !hasOnlyMetadataPairs(expr.items, 2)) {
          throw new InferenceError({ message: "Array schema expects exactly one item schema" });
        }
        return TEApp(spanOf(expr), TESym(spanOf(expr.items[0]!), "List"), [
          schemaExprToTypeExpr(expr.items[1]!),
        ]);
      }
      case "Optional": {
        if (expr.items.length < 2 || !hasOnlyMetadataPairs(expr.items, 2)) {
          throw new InferenceError({ message: "Optional schema expects exactly one item schema" });
        }
        return TEApp(spanOf(expr), TESym(spanOf(expr.items[0]!), "Option"), [
          schemaExprToTypeExpr(expr.items[1]!),
        ]);
      }
      case "Map": {
        if (expr.items.length < 2 || !hasOnlyMetadataPairs(expr.items, 2)) {
          throw new InferenceError({ message: "Map schema has the wrong arity." });
        }
        schemaExprToTypeExpr(expr.items[1]!);
        return TESym(spanOf(expr.items[0]!), "Map");
      }
      case "Ref": {
        if (expr.items.length < 2 || !hasOnlyMetadataPairs(expr.items, 2)) {
          throw new InferenceError({ message: "Ref schema expects exactly one target" });
        }
        return TESym(spanOf(expr.items[1]!), asSym(expr.items[1]!, "Ref schema target"));
      }
      case "Brand": {
        if (expr.items.length !== 3) {
          throw new InferenceError({
            message: "Brand schema expects a brand name and base schema",
          });
        }
        return TEApp(spanOf(expr), TESym(spanOf(expr.items[0]!), "Brand"), [
          TESym(spanOf(expr.items[1]!), asSym(expr.items[1]!, "Brand schema name")),
          schemaExprToTypeExpr(expr.items[2]!),
        ]);
      }
      case "Enum":
        return enumSchemaTypeExpr(expr);
      case "Literal":
        return literalSchemaTypeExpr(expr);
      case "Tuple": {
        const split = splitTrailingSchemaMetadata(
          expr.items.slice(1),
          "Tuple schema metadata must be keyword/value pairs.",
        );
        if (split.schemas.length === 0) {
          throw new InferenceError({
            message: "Tuple schema expects at least one item schema.",
          });
        }
        return TEApp(spanOf(expr), TESym(spanOf(expr.items[0]!), "Tuple"), [
          ...split.schemas.map(schemaExprToTypeExpr),
        ]);
      }
      case "Union": {
        const split = splitTrailingSchemaMetadata(
          expr.items.slice(1),
          "Union schema metadata must be keyword/value pairs.",
        );
        if (split.schemas.length === 0) {
          throw new InferenceError({
            message: "Union schema expects at least one variant schema.",
          });
        }
        return TEApp(spanOf(expr), TESym(spanOf(expr.items[0]!), "Union"), [
          ...split.schemas.map(schemaExprToTypeExpr),
        ]);
      }
      case "TaggedUnion": {
        const variants = taggedUnionVariants(expr);
        return TEApp(spanOf(expr), TESym(spanOf(expr.items[0]!), "TaggedUnion"), [
          ...variants.map((variant) => schemaExprToTypeExpr(variant.schema)),
        ]);
      }
      default:
        if (expr.items.length > 1 && hasOnlyMetadataPairs(expr.items, 1)) {
          const brand = metadataSymbol(expr.items, ":brand");
          const base = schemaExprToTypeExpr(expr.items[0]!);
          return brand
            ? TEApp(spanOf(expr), TESym(spanOf(expr.items[0]!), "Brand"), [brand, base])
            : base;
        }
        break;
    }
  }

  return parseTypeExpr(expr);
}

function taggedUnionVariants(
  expr: SExpr & { readonly _tag: "List" },
): readonly { readonly tag: string; readonly schema: SExpr }[] {
  const discriminator = expr.items[1];
  if (!discriminator || !schemaScalarName(discriminator)) {
    throw new InferenceError({
      message: "TaggedUnion schema expects a discriminator and variant schemas.",
    });
  }

  const split = splitTrailingSchemaMetadata(
    expr.items.slice(2),
    "TaggedUnion schema metadata must be keyword/value pairs.",
  );
  const variants = split.schemas.map((variant) => {
    const items = asVector(variant, "TaggedUnion variant");
    if (items.length !== 2) {
      throw new InferenceError({
        message: "TaggedUnion variants must be [tag SchemaExpr].",
      });
    }
    return {
      tag: schemaScalarName(items[0]!) ?? "",
      schema: items[1]!,
    };
  });

  if (variants.length === 0) {
    throw new InferenceError({
      message: "TaggedUnion schema expects at least one variant schema.",
    });
  }
  if (variants.some((variant) => variant.tag.length === 0)) {
    throw new InferenceError({
      message: "TaggedUnion variant tags must be symbols, keywords, or strings.",
    });
  }
  return variants;
}

function schemaScalarName(expr: SExpr): string | undefined {
  if (expr._tag === "Sym") return expr.name.replace(/^:/, "");
  if (expr._tag === "Str") return expr.value.replace(/^:/, "");
  return undefined;
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

function primitiveSchemaTypeExpr(expr: SExpr): TypeExpr | undefined {
  const name = schemaScalarName(expr);
  if (!name || (expr._tag !== "Sym" && expr._tag !== "Str")) return undefined;
  const primitive = primitiveSchemaTypeName(name);
  return primitive ? TESym(spanOf(expr), primitive) : undefined;
}

function primitiveSchemaTypeName(name: string): string | undefined {
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
      return "Boolean";
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

function splitTrailingSchemaMetadata(
  items: readonly SExpr[],
  message: string,
): { readonly schemas: readonly SExpr[] } {
  const metadataStart = items.findIndex((item) => trySym(item)?.startsWith(":") === true);
  if (metadataStart === -1) return { schemas: items };
  if (!hasOnlyMetadataPairs(items, metadataStart)) {
    throw new InferenceError({ message });
  }
  return { schemas: items.slice(0, metadataStart) };
}

function enumSchemaTypeExpr(expr: SExpr & { readonly _tag: "List" }): TypeExpr {
  const values = expr.items.slice(1);
  if (values.length === 0) {
    throw new InferenceError({
      message: "Enum schema expects at least one value.",
    });
  }

  for (const value of values) {
    if (schemaScalarName(value) === undefined) {
      throw new InferenceError({
        message: "Enum schema values must be symbols, keywords, or strings.",
      });
    }
  }

  return TESym(spanOf(expr.items[0]!), "String");
}

function literalSchemaTypeExpr(expr: SExpr & { readonly _tag: "List" }): TypeExpr {
  const values = expr.items.slice(1);
  if (values.length === 0) {
    throw new InferenceError({
      message: "Literal schema expects at least one literal value",
    });
  }

  const types = values.map((value) => literalValueTypeName(value));
  const first = types[0]!;
  if (types.some((type) => type !== first)) {
    throw new InferenceError({
      message: "Literal schema values must have one primitive type.",
    });
  }

  return TESym(spanOf(expr.items[0]!), first);
}

function literalValueTypeName(expr: SExpr): string {
  switch (expr._tag) {
    case "Str":
      return "String";
    case "Num":
      return "Number";
    case "Bool":
      return "Boolean";
    case "Sym":
      if (expr.name === "nil") return "Unit";
      if (expr.name.startsWith(":")) return "String";
      break;
    default:
      break;
  }
  throw new InferenceError({
    message: "Literal schema values must be strings, numbers, booleans, nil, or keywords",
  });
}

function hasOnlyMetadataPairs(items: readonly SExpr[], start: number): boolean {
  const metadata = items.slice(start);
  if (metadata.length === 0) return true;
  if (metadata.length % 2 !== 0) return false;
  for (let i = 0; i < metadata.length; i += 2) {
    const key = trySym(metadata[i]!);
    if (!key?.startsWith(":")) return false;
  }
  return true;
}

function metadataSymbol(items: readonly SExpr[], key: string): TypeExpr | undefined {
  for (let i = 1; i < items.length - 1; i += 2) {
    if (trySym(items[i]!) === key) {
      return TESym(spanOf(items[i + 1]!), asSym(items[i + 1]!, `${key} metadata value`));
    }
  }
  return undefined;
}

function schemaFieldToRowField(expr: SExpr): { readonly label: string; readonly type: TypeExpr } {
  const items =
    expr._tag === "Vector"
      ? expr.items
      : expr._tag === "List" && trySym(expr.items[0]!) === "field"
        ? expr.items.slice(1)
        : expr._tag === "List"
          ? expr.items
          : undefined;

  if (!items || items.length !== 2) {
    throw new InferenceError({
      message: "Struct schema fields must be [name SchemaExpr] or (field name SchemaExpr)",
    });
  }

  const rawLabel = trySym(items[0]!) ?? (items[0]!._tag === "Str" ? items[0]!.value : undefined);
  if (!rawLabel) {
    throw new InferenceError({ message: "Struct schema field names must be symbols or strings" });
  }

  return {
    label: rawLabel.startsWith(":") ? rawLabel : `:${rawLabel}`,
    type: schemaExprToTypeExpr(items[1]!),
  };
}

function parseErrorFields(
  expr: SExpr,
): readonly { readonly label: string; readonly type: TypeExpr }[] {
  const items = asList(expr, "error fields");
  if (trySym(items[0]!) !== ":fields") {
    throw new InferenceError({
      message: "error expects a field record.",
    });
  }
  return items.slice(1).map((field) => schemaFieldToRowField(field));
}

/**
 * Lower (__typeclass (ClassName params...) [supers...]? (method-name type) ...)
 *
 * Examples:
 *   (__typeclass (Eq a) (eq (-> a a Bool)))
 *   (__typeclass (Functor (f : * -> *)) (fmap (-> (-> a b) (f a) (f b))))
 *   (__typeclass (Ord a) [(Eq a)] (compare (-> a a Num)))
 */
export function lowerDefineTypeclass(span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length < 3) {
    throw new InferenceError({
      message: "(__typeclass ...) requires class header and methods",
    });
  }

  const headerExpr = items[1]!;
  const className = headSym(headerExpr);
  if (!className) {
    throw new InferenceError({ message: "__typeclass header must be (ClassName params...)" });
  }
  const headerItems = asList(headerExpr, "__typeclass header");

  // Parse type parameters (possibly with kind annotations)
  const typeParams: ClassTypeParam[] = [];
  for (let i = 1; i < headerItems.length; i++) {
    const p = headerItems[i]!;
    const symName = trySym(p);
    if (symName) {
      typeParams.push({ name: symName });
    } else if (p._tag === "List" && p.items.length === 3) {
      // (f : * -> *) — kind-annotated parameter
      const name = trySym(p.items[0]!);
      const colon = trySym(p.items[1]!);
      if (name && colon === ":") {
        typeParams.push({ name, kindAnnotation: parseTypeExpr(p.items[2]!) });
      } else {
        throw new InferenceError({
          message: "__typeclass param must be symbol or (name : kind)",
        });
      }
    } else {
      throw new InferenceError({
        message: "__typeclass param must be symbol or (name : kind)",
      });
    }
  }

  // Check for super class constraints (optional vector)
  let startIdx = 2;
  const supers: ClassConstraint[] = [];
  if (items[2]?._tag === "Vector") {
    const supersItems = asVector(items[2]!, "__typeclass supers");
    for (const s of supersItems) {
      const superName = headSym(s);
      if (superName) {
        supers.push({
          className: superName,
          args: asList(s, "super class constraint").slice(1).map(parseTypeExpr),
        });
      } else {
        throw new InferenceError({ message: "Super class constraint must be (ClassName args...)" });
      }
    }
    startIdx = 3;
  }

  // Parse methods
  const methods: ClassMethod[] = [];
  for (let i = startIdx; i < items.length; i++) {
    const m = items[i]!;
    if (m._tag !== "List" || m.items.length !== 2) {
      throw new InferenceError({ message: "__typeclass method must be (name type)" });
    }
    methods.push({ name: asSym(m.items[0]!, "method name"), typeExpr: parseTypeExpr(m.items[1]!) });
  }

  return CDefClass(span, className, typeParams, supers, methods);
}

/**
 * Lower (instance [(constraints...)]? (ClassName types...) (define method expr) ...)
 *
 * Examples:
 *   (instance (Eq Num) (define eq (fn [a b] (= a b))))
 *   (instance [(Eq a)] (Eq (List a)) (define eq (fn [xs ys] ...)))
 *   (instance (Functor List) (define fmap (fn [f xs] (map f xs))))
 */
export function lowerInstance(lower: LowerFn, span: Span, items: readonly SExpr[]): CoreExpr {
  if (items.length < 3) {
    throw new InferenceError({ message: "(instance ...) requires class+type and method defs" });
  }

  // Check for optional constraints vector
  let idx = 1;
  const constraints: ClassConstraint[] = [];
  if (items[idx]?._tag === "Vector") {
    const constraintItems = asVector(items[idx]!, "instance constraints");
    for (const c of constraintItems) {
      const cName = headSym(c);
      if (cName) {
        constraints.push({
          className: cName,
          args: asList(c, "instance constraint").slice(1).map(parseTypeExpr),
        });
      }
    }
    idx++;
  }

  const headerExpr = items[idx]!;
  const instanceClassName = headSym(headerExpr);
  if (!instanceClassName) {
    throw new InferenceError({ message: "instance header must be (ClassName types...)" });
  }
  const className = instanceClassName;
  const typeArgs = asList(headerExpr, "instance header").slice(1).map(parseTypeExpr);
  idx++;

  // Parse method implementations
  const methods: import("./core-expr.js").InstanceMethod[] = [];
  for (let i = idx; i < items.length; i++) {
    const m = items[i]!;
    if (m._tag !== "List" || m.items.length !== 3) {
      throw new InferenceError({ message: "instance method must be (define name expr)" });
    }
    if (trySym(m.items[0]!) !== "define") {
      throw new InferenceError({ message: "instance method must start with define" });
    }
    methods.push({ name: asSym(m.items[1]!, "instance method name"), expr: lower(m.items[2]!) });
  }

  return CInstance(span, className, typeArgs, constraints, methods);
}
