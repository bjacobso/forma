/**
 * Types for checking mechanics programs before they are generated as Effect
 * TypeScript.
 *
 * The checker works over the portable mechanics IR, so its types mirror what
 * the IR can express: schema data, tagged errors, services, and the Effect,
 * Option, Result, Ref, Fiber, and Layer shapes used by operation bodies.
 * Assignability follows TypeScript where TypeScript is sound (width subtyping
 * for structs, covariant success values, error and requirement set inclusion)
 * and is stricter where Forma knows more: `Int` can be assigned to `Float`
 * rather than the same type, and brands are nominal.
 *
 * @module
 */
import type { JsonValue } from "../artifact/artifact.js";

export type PrimitiveName =
  | "String"
  | "Int"
  | "Float"
  | "Bool"
  | "Unit"
  | "Json"
  | "Bytes"
  | "DateTime"
  | "Duration"
  | "Schedule";

export interface MField {
  readonly name: string;
  readonly type: MType;
  readonly optional: boolean;
}

/** Errors and requirements carry the span where they first entered a type. */
export type Provenance = ReadonlyMap<string, JsonValue | undefined>;

export type MType =
  | { readonly kind: "prim"; readonly name: PrimitiveName }
  | { readonly kind: "never" }
  | { readonly kind: "unknown" }
  | { readonly kind: "literal"; readonly numericKind?: "int" | "float"; readonly value: string | number | boolean }
  | { readonly kind: "named"; readonly name: string }
  | { readonly kind: "brand"; readonly name: string; readonly base: MType }
  | { readonly kind: "struct"; readonly fields: readonly MField[] }
  | { readonly kind: "array"; readonly item: MType }
  | { readonly kind: "map"; readonly value: MType; readonly key?: MType }
  | { readonly kind: "tuple"; readonly items: readonly MType[] }
  | { readonly kind: "union"; readonly members: readonly MType[] }
  | { readonly kind: "option"; readonly item: MType }
  | { readonly kind: "result"; readonly success: MType; readonly failure: MType }
  | { readonly kind: "error"; readonly name: string }
  | { readonly kind: "class"; readonly name: string }
  | {
      readonly kind: "effect";
      readonly success: MType;
      readonly errors: Provenance;
      readonly requirements: Provenance;
    }
  | { readonly kind: "function"; readonly params: readonly MType[]; readonly result: MType }
  | { readonly kind: "ref"; readonly item: MType }
  | { readonly kind: "fiber"; readonly success: MType; readonly errors: Provenance }
  | {
      readonly kind: "stream";
      readonly item: MType;
      readonly errors: Provenance;
      readonly requirements: Provenance;
    }
  | { readonly kind: "layer"; readonly layer: LayerType }
  | { readonly kind: "var"; readonly id: number };

export interface LayerType {
  readonly provides: readonly string[];
  readonly errors: Provenance;
  /** Service-level requirements (TypeScript `RIn`), not method capabilities. */
  readonly requirements: Provenance;
}

export const prim = (name: PrimitiveName): MType => ({ kind: "prim", name });
export const tString = prim("String");
export const tInt = prim("Int");
export const tFloat = prim("Float");
/** Internal compatibility name for the numeric operand type. */
export const tNumber = tFloat;
export const tBool = prim("Bool");
export const tUnit = prim("Unit");
export const tNever: MType = { kind: "never" };
export const tUnknown: MType = { kind: "unknown" };
export const emptySet: Provenance = new Map();

export const effectOf = (
  success: MType,
  errors: Provenance = emptySet,
  requirements: Provenance = emptySet,
): MType & { readonly kind: "effect" } => ({ kind: "effect", success, errors, requirements });

export function unionSets(...sets: readonly Provenance[]): Provenance {
  const merged = new Map<string, JsonValue | undefined>();
  for (const set of sets) {
    for (const [name, span] of set) {
      if (!merged.has(name)) merged.set(name, span);
    }
  }
  return merged;
}

export function setOf(names: readonly string[], span?: JsonValue): Provenance {
  return new Map(names.map((name) => [name, span]));
}

/** Schema, error, and service declarations visible to type operations. */
export interface TypeEnvironment {
  readonly schemas: ReadonlyMap<string, MType>;
  readonly errors: ReadonlySet<string>;
  /** `__class` names: nominal types whose fields live in `classFields`. */
  readonly classes: ReadonlyMap<string, readonly MField[]>;
  /** Generalized variables in function signatures, allocated per checker instance. */
  readonly variables?: Map<string, number>;
}

/** Converts an IR type or schema node into a checker type. */
export function typeFromJson(json: JsonValue | undefined, env: TypeEnvironment): MType {
  if (!isRecord(json)) return tUnknown;
  switch (json["kind"]) {
    case "Primitive":
      return primitiveType(json["name"]);
    case "Ref": {
      const name = typeof json["name"] === "string" ? json["name"] : "";
      if (env.errors.has(name)) return { kind: "error", name };
      if (env.classes.has(name)) return { kind: "class", name };
      if (env.schemas.has(name)) return { kind: "named", name };
      if (/^[a-z]/.test(name) && !name.includes("__forma_") && env.variables) {
        if (!env.variables.has(name)) env.variables.set(name, -(env.variables.size + 1));
        return {kind:"var",id:env.variables.get(name)!};
      }
      if (name === "Duration") return prim("Duration");
      return { kind: "named", name };
    }
    case "Brand":
      return {
        kind: "brand",
        name: typeof json["name"] === "string" ? json["name"] : "Brand",
        base: typeFromJson(json["schema"], env),
      };
    case "Struct":
      return {
        kind: "struct",
        fields: arrayItems(json["fields"]).flatMap((field) => {
          if (!isRecord(field) || typeof field["name"] !== "string") return [];
          const schema = field["schema"];
          const optional = isRecord(schema) && schema["kind"] === "Optional";
          return [
            {
              name: field["name"],
              optional,
              type: typeFromJson(optional && isRecord(schema) ? schema["item"] : schema, env),
            },
          ];
        }),
      };
    case "Array":
      return { kind: "array", item: typeFromJson(json["item"], env) };
    case "Optional":
      return union([typeFromJson(json["item"], env), tUnit]);
    case "Option":
      return { kind: "option", item: typeFromJson(json["item"], env) };
    case "Map":
      return { kind: "map", value: typeFromJson(json["value"], env), ...(json["key"] ? {key: typeFromJson(json["key"], env)} : {}) };
    case "Literal": {
      const values = arrayItems(json["values"]).filter(
        (value): value is string | number | boolean =>
          typeof value === "string" || typeof value === "number" || typeof value === "boolean",
      );
      return union(values.map((value) => ({ kind: "literal", value })));
    }
    case "Tuple":
      return { kind: "tuple", items: arrayItems(json["items"]).map((item) => typeFromJson(item, env)) };
    case "Union":
      return union(arrayItems(json["variants"]).map((variant) => typeFromJson(variant, env)));
    case "TaggedUnion": {
      const discriminator =
        typeof json["discriminator"] === "string" ? json["discriminator"] : "tag";
      return union(
        arrayItems(json["variants"]).flatMap((variant) => {
          if (!isRecord(variant) || typeof variant["tag"] !== "string") return [];
          const base = resolve(typeFromJson(variant["schema"], env), env);
          const fields = base.kind === "struct" ? base.fields : [];
          return [
            {
              kind: "struct" as const,
              fields: [
                { name: discriminator, optional: false, type: { kind: "literal" as const, value: variant["tag"] } },
                ...fields.filter((field) => field.name !== discriminator),
              ],
            },
          ];
        }),
      );
    }
    case "Annotated":
      return typeFromJson(json["schema"], env);
    case "Effect":
      return effectOf(
        typeFromJson(json["success"], env),
        setOf(stringItems(json["errors"])),
        setOf(stringItems(json["requirements"])),
      );
    case "Result":
      return {
        kind: "result",
        success: typeFromJson(json["success"], env),
        failure: typeFromJson(json["failure"], env),
      };
    case "RefCell":
      return { kind: "ref", item: typeFromJson(json["item"], env) };
    case "Stream":
      return {
        kind: "stream",
        item: typeFromJson(json["item"], env),
        errors: setOf(stringItems(json["errors"])),
        requirements: setOf(stringItems(json["requirements"])),
      };
    case "Fiber":
      return {
        kind: "fiber",
        success: typeFromJson(json["success"], env),
        errors: setOf(stringItems(json["errors"])),
      };
    case "Function":
      return {
        kind: "function",
        params: arrayItems(json["params"]).map((param) => typeFromJson(param, env)),
        result: typeFromJson(json["result"], env),
      };
    default:
      return tUnknown;
  }
}

function primitiveType(name: JsonValue | undefined): MType {
  switch (name) {
    case "String":
    case "Int":
    case "Bool":
    case "Unit":
    case "Json":
    case "Bytes":
    case "DateTime":
      return prim(name);
    case "Float":
    case "Number":
    case "Num": return tFloat;
    default:
      return tUnknown;
  }
}

/** Expands schema names to their definitions; brands stay nominal. */
export function resolve(type: MType, env: TypeEnvironment, seen = new Set<string>()): MType {
  if (type.kind !== "named") return type;
  if (seen.has(type.name)) return tUnknown;
  const definition = env.schemas.get(type.name);
  if (!definition) return tUnknown;
  seen.add(type.name);
  return resolve(definition, env, seen);
}

export function union(members: readonly MType[]): MType {
  const flat: MType[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    for (const item of member.kind === "union" ? member.members : [member]) {
      if (item.kind === "never") continue;
      if (item.kind === "unknown") return tUnknown;
      const key = typeKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      flat.push(item);
    }
  }
  if (flat.length === 0) return tNever;
  if (flat.length === 1) return flat[0]!;
  return { kind: "union", members: flat };
}

/**
 * Least upper bound used to join branch results. Literal types are kept, so
 * branches producing `"pro"` and `"enterprise"` still fit an enum.
 */
export function join(left: MType, right: MType, env: TypeEnvironment): MType {
  if (isAssignable(left, right, env)) return right;
  if (isAssignable(right, left, env)) return left;
  return union([left, right]);
}

/** Widens a literal produced by inference to its primitive (`"a"` → String). */
export function widenLiteral(type: MType): MType {
  if (type.kind !== "literal") return type;
  if (typeof type.value === "string") return tString;
  if (typeof type.value === "boolean") return tBool;
  return type.numericKind === "float" || !Number.isInteger(type.value) ? tFloat : tInt;
}

/**
 * Widens literal types everywhere inside a type, the way TypeScript widens
 * values it infers without a contextual type (`{ role: "admin" }` has
 * `role: string`).
 */
export function widenDeep(type: MType): MType {
  switch (type.kind) {
    case "literal":
      return widenLiteral(type);
    case "struct":
      return { kind: "struct", fields: type.fields.map((field) => ({ ...field, type: widenDeep(field.type) })) };
    case "array":
      return { kind: "array", item: widenDeep(type.item) };
    case "option":
      return { kind: "option", item: widenDeep(type.item) };
    case "map":
      return { ...type, value: widenDeep(type.value) };
    case "tuple":
      return { kind: "tuple", items: type.items.map(widenDeep) };
    case "union":
      return union(type.members.map(widenDeep));
    default:
      return type;
  }
}

/** Whether a type mentions literal types, so values of it need a contextual type in TypeScript. */
export function containsLiterals(type: MType, env: TypeEnvironment, seen = new Set<string>()): boolean {
  switch (type.kind) {
    case "literal":
      return true;
    case "named":
      if (seen.has(type.name)) return false;
      seen.add(type.name);
      return containsLiterals(resolve(type, env), env, seen);
    case "struct":
      return type.fields.some((field) => containsLiterals(field.type, env, seen));
    case "array":
    case "option":
      return containsLiterals(type.item, env, seen);
    case "map":
      return containsLiterals(type.value, env, seen);
    case "tuple":
      return type.items.some((item) => containsLiterals(item, env, seen));
    case "union":
      return type.members.some((member) => containsLiterals(member, env, seen));
    default:
      return false;
  }
}

export type Substitution = Map<number, MType>;

export function applySubstitution(type: MType, subst: Substitution): MType {
  switch (type.kind) {
    case "var": {
      const bound = subst.get(type.id);
      return bound ? applySubstitution(bound, subst) : type;
    }
    case "array":
      return { kind: "array", item: applySubstitution(type.item, subst) };
    case "map":
      return { ...type, value: applySubstitution(type.value, subst), ...(type.key ? {key: applySubstitution(type.key, subst)} : {}) };
    case "option":
      return { kind: "option", item: applySubstitution(type.item, subst) };
    case "ref":
      return { kind: "ref", item: applySubstitution(type.item, subst) };
    case "tuple":
      return { kind: "tuple", items: type.items.map((item) => applySubstitution(item, subst)) };
    case "union":
      return union(type.members.map((member) => applySubstitution(member, subst)));
    case "result":
      return {
        kind: "result",
        success: applySubstitution(type.success, subst),
        failure: applySubstitution(type.failure, subst),
      };
    case "function":
      return {
        kind: "function",
        params: type.params.map((param) => applySubstitution(param, subst)),
        result: applySubstitution(type.result, subst),
      };
    case "effect":
      return { ...type, success: applySubstitution(type.success, subst) };
    case "fiber":
      return { ...type, success: applySubstitution(type.success, subst) };
    case "stream":
      return { ...type, item: applySubstitution(type.item, subst) };
    case "struct":
      return {
        kind: "struct",
        fields: type.fields.map((field) => ({ ...field, type: applySubstitution(field.type, subst) })),
      };
    default:
      return type;
  }
}

/**
 * `source` can be used where `target` is expected. Unbound inference
 * variables in either side are bound in `subst` on first use.
 */
export function isAssignable(
  source: MType,
  target: MType,
  env: TypeEnvironment,
  subst?: Substitution,
): boolean {
  const s = subst ? applySubstitution(source, subst) : source;
  const t = subst ? applySubstitution(target, subst) : target;
  if (s.kind === "var" && t.kind === "var" && s.id === t.id) return true;
  if (s.kind === "var" && subst) {
    if (t.kind === "var" && t.id === s.id) return true;
    subst.set(s.id, widenDeep(t));
    return true;
  }
  if (t.kind === "var" && subst) {
    subst.set(t.id, widenDeep(s));
    return true;
  }
  // `Unknown` only arises after a reported error, so it is compatible with
  // everything to keep one mistake from cascading into many diagnostics.
  if (t.kind === "unknown" || s.kind === "never" || s.kind === "unknown") return true;
  if (s.kind === "named" && t.kind === "named" && s.name === t.name) return true;
  if (s.kind === "named") return isAssignable(resolve(s, env), t, env, subst);
  if (t.kind === "named") return isAssignable(s, resolve(t, env), env, subst);
  if (s.kind === "union") return s.members.every((member) => isAssignable(member, t, env, subst));
  if (t.kind === "union") {
    // Prefer an exact member so inference variables bind predictably.
    return t.members.some((member) => isAssignable(s, member, env, subst));
  }

  // A branded value is still a value of its base type (`UserId` is a `String`).
  if (s.kind === "brand" && t.kind !== "brand") return isAssignable(s.base, t, env, subst);

  switch (t.kind) {
    case "prim":
      if (s.kind === "prim") return s.name === t.name || (s.name === "Int" && t.name === "Float");
      if (s.kind === "literal") {
        if (typeof s.value === "string") return t.name === "String";
        if (typeof s.value === "boolean") return t.name === "Bool";
        return t.name === "Float" || (t.name === "Int" && s.numericKind !== "float" && Number.isSafeInteger(s.value));
      }
      if (s.kind === "brand") return false;
      return false;
    case "literal":
      return s.kind === "literal" && s.value === t.value;
    case "brand":
      return s.kind === "brand" && s.name === t.name;
    case "struct": {
      if (s.kind !== "struct") return false;
      return t.fields.every((field) => {
        const found = s.fields.find((candidate) => candidate.name === field.name);
        if (!found) return field.optional;
        if (found.optional && !field.optional) return false;
        return isAssignable(found.type, field.type, env, subst);
      });
    }
    case "array":
      if (s.kind === "array") return isAssignable(s.item, t.item, env, subst);
      if (s.kind === "tuple") return s.items.every((item) => isAssignable(item, t.item, env, subst));
      return false;
    case "map":
      return s.kind === "map" && isAssignable(s.value, t.value, env, subst) && (!t.key || isAssignable(s.key ?? tString, t.key, env, subst));
    case "tuple":
      return (
        s.kind === "tuple" &&
        s.items.length === t.items.length &&
        s.items.every((item, index) => isAssignable(item, t.items[index]!, env, subst))
      );
    case "option":
      return s.kind === "option" && isAssignable(s.item, t.item, env, subst);
    case "result":
      return (
        s.kind === "result" &&
        isAssignable(s.success, t.success, env, subst) &&
        isAssignable(s.failure, t.failure, env, subst)
      );
    case "error":
      return s.kind === "error" && s.name === t.name;
    case "class":
      return s.kind === "class" && s.name === t.name;
    case "effect":
      return (
        s.kind === "effect" &&
        isAssignable(s.success, t.success, env, subst) &&
        [...s.errors.keys()].every((error) => t.errors.has(error)) &&
        [...s.requirements.keys()].every((requirement) => coversRequirement(t.requirements, requirement))
      );
    case "stream":
      return (
        s.kind === "stream" &&
        isAssignable(s.item, t.item, env, subst) &&
        [...s.errors.keys()].every((error) => t.errors.has(error)) &&
        [...s.requirements.keys()].every((requirement) => coversRequirement(t.requirements, requirement))
      );
    case "fiber":
      return (
        s.kind === "fiber" &&
        isAssignable(s.success, t.success, env, subst) &&
        [...s.errors.keys()].every((error) => t.errors.has(error))
      );
    case "ref":
      return (
        s.kind === "ref" &&
        isAssignable(s.item, t.item, env, subst) &&
        isAssignable(t.item, s.item, env, subst)
      );
    case "function":
      return (
        s.kind === "function" &&
        s.params.length === t.params.length &&
        s.params.every((param, index) => isAssignable(t.params[index]!, param, env, subst)) &&
        isAssignable(s.result, t.result, env, subst)
      );
    case "layer":
      return false;
    default:
      return false;
  }
}

/**
 * A requirement set covers a capability `Service.method` when it lists that
 * capability or the whole `Service`.
 */
export function coversRequirement(declared: Provenance, requirement: string): boolean {
  if (declared.has(requirement)) return true;
  const service = requirement.split(".")[0]!;
  return service !== requirement && declared.has(service);
}

export function requirementService(requirement: string): string {
  return requirement.split(".")[0]!;
}

/** Stable identity used for deduplication. */
export function typeKey(type: MType): string {
  return showType(type);
}

/** Renders a type in Forma's own syntax for diagnostics. */
export function showType(type: MType): string {
  switch (type.kind) {
    case "prim":
      return type.name;
    case "never":
      return "Never";
    case "unknown":
      return "Unknown";
    case "literal":
      return JSON.stringify(type.value);
    case "named":
    case "error":
    case "class":
      return type.name;
    case "brand":
      return type.name;
    case "struct":
      return `{${type.fields.map((field) => `:${field.name}${field.optional ? "?" : ""} ${showType(field.type)}`).join(" ")}}`;
    case "array":
      return `(Array ${showType(type.item)})`;
    case "map":
      return `(Map ${showType(type.value)})`;
    case "tuple":
      return `(Tuple ${type.items.map(showType).join(" ")})`;
    case "union":
      return type.members.every((member) => member.kind === "literal")
        ? `(Enum ${type.members.map(showType).join(" ")})`
        : `(Union ${type.members.map(showType).join(" ")})`;
    case "option":
      return `(Option ${showType(type.item)})`;
    case "result":
      return `(Result ${showType(type.success)} ${showType(type.failure)})`;
    case "effect":
      return `(Effect ${showType(type.success)} [${[...type.errors.keys()].join(" ")}] [${[...type.requirements.keys()].join(" ")}])`;
    case "function":
      return `(-> ${[...type.params, type.result].map(showType).join(" ")})`;
    case "ref":
      return `(Ref ${showType(type.item)})`;
    case "fiber":
      return `(Fiber ${showType(type.success)} [${[...type.errors.keys()].join(" ")}])`;
    case "stream":
      return `(Stream ${showType(type.item)} [${[...type.errors.keys()].join(" ")}] [${[...type.requirements.keys()].join(" ")}])`;
    case "layer":
      return `(Layer [${type.layer.provides.join(" ")}] [${[...type.layer.errors.keys()].join(" ")}] [${[...type.layer.requirements.keys()].join(" ")}])`;
    case "var":
      return `?${type.id}`;
  }
}

export function isRecord(value: unknown): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function arrayItems(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function stringItems(value: JsonValue | undefined): readonly string[] {
  return arrayItems(value).filter((item): item is string => typeof item === "string");
}
