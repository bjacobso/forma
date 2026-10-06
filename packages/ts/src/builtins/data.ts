import { Effect } from "effect";
import type { BuiltinFn, KValue } from "../evaluator/types.js";
import { KDictionary, isKDictionary, asList, isKMap, isKList, mapKey, mapKeyValue, kEquals } from "../evaluator/types.js";
import { ArityError, KernelTypeError } from "../diagnostic/errors.js";

export const get: BuiltinFn = (args) => {
  if (args.length < 2 || args.length > 3)
    return Effect.fail(new ArityError({ name: "get", expected: "2-3", got: args.length }));
  const coll = args[0]!;
  const key = args[1]!;
  const defaultVal = args.length === 3 ? args[2]! : null;

  if (isKMap(coll)) {
    if (mapKey(key) === undefined)
      return Effect.fail(
        new KernelTypeError({
          message: "get: map key must be a string",
          expected: "string",
          got: typeof key,
        }),
      );
    const v = coll.get(mapKey(key)!);
    return Effect.succeed(isKDictionary(coll) ? v === undefined ? new Map([[":_tag", "None"]]) : new Map<string, KValue>([[":_tag", "Some"], [":value", v]]) : v !== undefined ? v : defaultVal);
  }
  if (isKList(coll)) {
    if (typeof key !== "number")
      return Effect.fail(
        new KernelTypeError({
          message: "get: list index must be a number",
          expected: "number",
          got: typeof key,
        }),
      );
    const v = coll[key];
    return Effect.succeed(v !== undefined ? v : defaultVal);
  }
  return Effect.succeed(defaultVal);
};

export const getIn: BuiltinFn = (args) => {
  if (args.length < 2 || args.length > 3)
    return Effect.fail(new ArityError({ name: "get-in", expected: "2-3", got: args.length }));
  let current: KValue = args[0]!;
  const path = asList(args[1]!, "get-in");
  const defaultVal = args.length === 3 ? args[2]! : null;

  for (const key of path) {
    if (current === null) return Effect.succeed(defaultVal);
    if (isKMap(current)) {
      if (mapKey(key) === undefined) return Effect.succeed(defaultVal);
      const mapVal = current.get(mapKey(key)!);
      current = mapVal !== undefined ? mapVal : null;
    } else if (isKList(current)) {
      if (typeof key !== "number") return Effect.succeed(defaultVal);
      const listVal: KValue | undefined = current[key];
      current = listVal !== undefined ? listVal : null;
    } else {
      return Effect.succeed(defaultVal);
    }
  }
  return Effect.succeed(current ?? defaultVal);
};

const keyCandidates = (key: KValue): readonly string[] | null => {
  key = mapKeyValue(mapKey(key) ?? "");
  if (typeof key === "object" && key !== null && "name" in key) key = key.name;
  if (typeof key === "string") {
    return key.startsWith(":") ? [key, key.slice(1)] : [key, `:${key}`];
  }
  if (typeof key === "number") {
    return [String(key), `:${key}`];
  }
  return null;
};

const getMapValue = (map: ReadonlyMap<string, KValue>, key: KValue): KValue | undefined => {
  const candidates = keyCandidates(key);
  if (!candidates) return undefined;

  for (const candidate of candidates) {
    if (map.has(candidate)) return map.get(candidate);
  }

  return undefined;
};

/**
 * Safe path access for runtime expression payloads.
 *
 * Unlike `get-in`, this accepts variadic path segments and tolerates either
 * plain object keys (`name`) or keyword-style keys (`:name`).
 */
export const path: BuiltinFn = (args) => {
  if (args.length < 1) {
    return Effect.fail(new ArityError({ name: "path", expected: "1+", got: args.length }));
  }

  let current: KValue = args[0]!;
  for (const segment of args.slice(1)) {
    if (current === null) return Effect.succeed(null);

    if (segment === "length" && (typeof current === "string" || isKList(current))) {
      current = current.length;
      continue;
    }

    if (isKMap(current)) {
      current = getMapValue(current, segment) ?? null;
      continue;
    }

    if (isKList(current)) {
      if (typeof segment !== "number") return Effect.succeed(null);
      current = current[segment] ?? null;
      continue;
    }

    return Effect.succeed(null);
  }

  return Effect.succeed(current);
};

export const assoc: BuiltinFn = (args) => {
  if (args.length < 3 || args.length % 2 === 0)
    return Effect.fail(new ArityError({ name: "assoc", expected: "3+", got: args.length }));
  const coll = args[0]!;
  if (!isKMap(coll))
    return Effect.fail(
      new KernelTypeError({
        message: "assoc: first arg must be a map",
        expected: "map",
        got: typeof coll,
      }),
    );
  const result = isKDictionary(coll) ? new KDictionary(coll) : new Map(coll);
  for (let i = 1; i < args.length; i += 2) {
    const k = args[i]!;
    if (mapKey(k) === undefined)
      return Effect.fail(
        new KernelTypeError({
          message: "assoc: key must be a string",
          expected: "string",
          got: typeof k,
        }),
      );
    result.set(mapKey(k)!, args[i + 1]!);
  }
  return Effect.succeed(result as ReadonlyMap<string, KValue>);
};

export const dissoc: BuiltinFn = (args) => {
  if (args.length < 2)
    return Effect.fail(new ArityError({ name: "dissoc", expected: "2+", got: args.length }));
  const coll = args[0]!;
  if (!isKMap(coll))
    return Effect.fail(
      new KernelTypeError({
        message: "dissoc: first arg must be a map",
        expected: "map",
        got: typeof coll,
      }),
    );
  const result = isKDictionary(coll) ? new KDictionary(coll) : new Map(coll);
  for (let i = 1; i < args.length; i++) {
    const k = args[i]!;
    if (mapKey(k) !== undefined) result.delete(mapKey(k)!);
  }
  return Effect.succeed(result as ReadonlyMap<string, KValue>);
};

export const keys: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "keys", expected: 1, got: args.length }));
  const coll = args[0]!;
  if (!isKMap(coll))
    return Effect.fail(
      new KernelTypeError({
        message: "keys: arg must be a map",
        expected: "map",
        got: typeof coll,
      }),
    );
  return Effect.succeed([...coll.keys()].map(mapKeyValue));
};

export const vals: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "vals", expected: 1, got: args.length }));
  const coll = args[0]!;
  if (!isKMap(coll))
    return Effect.fail(
      new KernelTypeError({
        message: "vals: arg must be a map",
        expected: "map",
        got: typeof coll,
      }),
    );
  return Effect.succeed([...coll.values()] as readonly KValue[]);
};

export const merge: BuiltinFn = (args) => {
  const result = args.some(isKDictionary) ? new KDictionary() : new Map<string, KValue>();
  for (const a of args) {
    if (!isKMap(a))
      return Effect.fail(
        new KernelTypeError({
          message: "merge: all args must be maps",
          expected: "map",
          got: typeof a,
        }),
      );
    for (const [k, v] of a) {
      result.set(k, v);
    }
  }
  return Effect.succeed(result as ReadonlyMap<string, KValue>);
};

export const selectKeys: BuiltinFn = (args) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "select-keys", expected: 2, got: args.length }));
  const coll = args[0]!;
  if (!isKMap(coll))
    return Effect.fail(
      new KernelTypeError({
        message: "select-keys: first arg must be a map",
        expected: "map",
        got: typeof coll,
      }),
    );
  const keyList = asList(args[1]!, "select-keys");
  const result = isKDictionary(coll) ? new KDictionary() : new Map<string, KValue>();
  for (const k of keyList) {
    if (mapKey(k) !== undefined && coll.has(mapKey(k)!)) {
      result.set(mapKey(k)!, coll.get(mapKey(k)!)!);
    }
  }
  return Effect.succeed(result as ReadonlyMap<string, KValue>);
};

export const id: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "id", expected: 1, got: args.length }));
  const value = args[0]!;
  if (typeof value === "string") return Effect.succeed(value);
  return Effect.succeed(null);
};

export const contains: BuiltinFn = args => {
  if (args.length !== 2) return Effect.fail(new ArityError({name: "contains?", expected: 2, got: args.length}));
  const collection = args[0]!, key = args[1]!;
  if (isKMap(collection)) return Effect.succeed(mapKey(key) !== undefined && collection.has(mapKey(key)!));
  if (Array.isArray(collection)) return Effect.succeed(collection.some(value => kEquals(value, key)));
  if (typeof collection === "string" && typeof key === "string") return Effect.succeed(collection.includes(key));
  return Effect.fail(new KernelTypeError({message: "contains? requires a collection", expected: "collection", got: typeof collection}));
};

const dictionary: BuiltinFn = args => {
  if (args.length !== 1) return Effect.fail(new ArityError({name:"__dictionary",expected:1,got:args.length}));
  if (!isKMap(args[0]!)) return Effect.fail(new KernelTypeError({message:"Map construction requires a record or map",expected:"Map",got:typeof args[0]}));
  return Effect.succeed(new KDictionary(args[0]));
};
/** A computed key selects the dictionary view, including missing values. */
const computedGet: BuiltinFn = (args, apply) => isKMap(args[0]!)
  ? get([new KDictionary(args[0]), ...args.slice(1)], apply)
  : get(args, apply);
export const dataBuiltins: Record<string, BuiltinFn> = {
  __dictionary: dictionary,
  "__map-get": computedGet,
  "meta/get": get,
  "contains?": contains,
  get,
  "get-in": getIn,
  path,
  assoc,
  dissoc,
  keys,
  vals,
  merge,
  "select-keys": selectKeys,
  id,
};
