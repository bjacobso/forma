import { Effect } from "effect";
import type { BuiltinFn, KValue } from "../evaluator/types.js";
import { asList, asKFn, asNumber, isKList, isKMap, mapKey, TypeCheckError } from "../evaluator/types.js";
import { KernelTypeError, ArityError } from "../diagnostic/errors.js";

export const list: BuiltinFn = (args) => {
  return Effect.succeed(args);
};

export const map: BuiltinFn = (args, apply) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "map", expected: 2, got: args.length }));
  const fn = asKFn(args[0]!, "map");
  const coll = asList(args[1]!, "map");
  return Effect.gen(function* () {
    const result: KValue[] = [];
    for (const item of coll) {
      result.push(yield* apply(fn, [item]));
    }
    return result as readonly KValue[];
  });
};

export const filter: BuiltinFn = (args, apply) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "filter", expected: 2, got: args.length }));
  const fn = asKFn(args[0]!, "filter");
  const coll = asList(args[1]!, "filter");
  return Effect.gen(function* () {
    const result: KValue[] = [];
    for (const item of coll) {
      const keep = yield* apply(fn, [item]);
      if (keep !== null && keep !== false) {
        result.push(item);
      }
    }
    return result as readonly KValue[];
  });
};

export const reduce: BuiltinFn = (args, apply) => {
  if (args.length !== 3)
    return Effect.fail(new ArityError({ name: "reduce", expected: 3, got: args.length }));
  const fn = asKFn(args[0]!, "reduce");
  const init = args[1]!;
  const coll = asList(args[2]!, "reduce");
  return Effect.gen(function* () {
    let acc: KValue = init;
    for (const item of coll) {
      acc = yield* apply(fn, [acc, item]);
    }
    return acc;
  });
};

export const first: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "first", expected: 1, got: args.length }));
  const coll = asList(args[0]!, "first");
  return Effect.succeed(coll.length > 0 ? coll[0]! : null);
};

export const rest: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "rest", expected: 1, got: args.length }));
  const coll = asList(args[0]!, "rest");
  return Effect.succeed(coll.slice(1));
};

export const count: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "count", expected: 1, got: args.length }));
  const v = args[0]!;
  if (isKList(v)) return Effect.succeed(v.length);
  if (isKMap(v)) return Effect.succeed(v.size);
  if (typeof v === "string") return Effect.succeed(v.length);
  return Effect.succeed(0);
};

export const nth: BuiltinFn = (args) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "nth", expected: 2, got: args.length }));
  const coll = asList(args[0]!, "nth");
  const idx = asNumber(args[1]!, "nth");
  if (idx < 0 || idx >= coll.length) return Effect.succeed(null);
  return Effect.succeed(coll[idx]!);
};

export const conj: BuiltinFn = (args) => {
  if (args.length < 2)
    return Effect.fail(new ArityError({ name: "conj", expected: "2+", got: args.length }));
  const coll = asList(args[0]!, "conj");
  return Effect.succeed([...coll, ...args.slice(1)]);
};

export const concat: BuiltinFn = (args) => {
  const result: KValue[] = [];
  for (const a of args) {
    const lst = asList(a, "concat");
    result.push(...lst);
  }
  return Effect.succeed(result as readonly KValue[]);
};

export const sortBy: BuiltinFn = (args, apply) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "sort-by", expected: 2, got: args.length }));
  const fn = asKFn(args[0]!, "sort-by");
  const coll = asList(args[1]!, "sort-by");
  return Effect.gen(function* () {
    const keyed: { item: KValue; key: KValue }[] = [];
    for (const item of coll) {
      const key = yield* apply(fn, [item]);
      keyed.push({ item, key });
    }
    keyed.sort((a, b) => {
      if (typeof a.key === "number" && typeof b.key === "number") return a.key - b.key;
      if (typeof a.key === "string" && typeof b.key === "string") return a.key.localeCompare(b.key);
      return 0;
    });
    return keyed.map((k) => k.item) as readonly KValue[];
  });
};

export const groupBy: BuiltinFn = (args, apply) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "group-by", expected: 2, got: args.length }));
  const fn = asKFn(args[0]!, "group-by");
  const coll = asList(args[1]!, "group-by");
  return Effect.gen(function* () {
    const groups = new Map<string, KValue[]>();
    for (const item of coll) {
      const key = yield* apply(fn, [item]);
      const keyStr = mapKey(key);
      if (keyStr === undefined) throw new TypeCheckError("group-by","keyword or string key",typeof key);
      const arr = groups.get(keyStr);
      if (arr) {
        arr.push(item);
      } else {
        groups.set(keyStr, [item]);
      }
    }
    // Convert to ReadonlyMap<string, readonly KValue[]>
    const result = new Map<string, KValue>();
    for (const [k, v] of groups) {
      result.set(k, v as readonly KValue[]);
    }
    return result as ReadonlyMap<string, KValue>;
  });
};

export const flatMap: BuiltinFn = (args, apply) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "flat-map", expected: 2, got: args.length }));
  const fn = asKFn(args[0]!, "flat-map");
  const coll = asList(args[1]!, "flat-map");
  return Effect.gen(function* () {
    const result: KValue[] = [];
    for (const item of coll) {
      const mapped = yield* apply(fn, [item]);
      const items = asList(mapped, "flat-map result");
      result.push(...items);
    }
    return result as readonly KValue[];
  });
};

export const some: BuiltinFn = (args, apply) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "some", expected: 2, got: args.length }));
  const fn = asKFn(args[0]!, "some");
  const coll = asList(args[1]!, "some");
  return Effect.gen(function* () {
    for (const item of coll) {
      const result = yield* apply(fn, [item]);
      if (result !== null && result !== false) return result;
    }
    return null;
  });
};

export const everyQ: BuiltinFn = (args, apply) => {
  if (args.length !== 2)
    return Effect.fail(new ArityError({ name: "every?", expected: 2, got: args.length }));
  const fn = asKFn(args[0]!, "every?");
  const coll = asList(args[1]!, "every?");
  return Effect.gen(function* () {
    for (const item of coll) {
      const result = yield* apply(fn, [item]);
      if (result === null || result === false) return false;
    }
    return true;
  });
};

export const emptyQ: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "empty?", expected: 1, got: args.length }));
  const v = args[0]!;
  if (isKList(v)) return Effect.succeed(v.length === 0);
  if (isKMap(v)) return Effect.succeed(v.size === 0);
  if (typeof v === "string") return Effect.succeed(v.length === 0);
  if (v === null) return Effect.succeed(true);
  return Effect.succeed(false);
};

export const distinct: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "distinct", expected: 1, got: args.length }));
  const coll = asList(args[0]!, "distinct");
  const seen: KValue[] = [];
  const result: KValue[] = [];
  for (const item of coll) {
    const isDup = seen.some((s) => {
      if (s === item) return true;
      if (typeof s === typeof item && s === item) return true;
      return false;
    });
    if (!isDup) {
      seen.push(item);
      result.push(item);
    }
  }
  return Effect.succeed(result as readonly KValue[]);
};

export const into: BuiltinFn = (args) => {
  if (args.length !== 1)
    return Effect.fail(new ArityError({ name: "into", expected: 1, got: args.length }));
  const pairs = asList(args[0]!, "into");
  const result = new Map<string, KValue>();
  for (const pair of pairs) {
    const p = asList(pair, "into pair");
    if (p.length !== 2) return Effect.fail(new KernelTypeError({message:"into expects key/value pairs",expected:"pair",got:String(p.length)}));
    const key = mapKey(p[0]!);
    if (key === undefined) return Effect.fail(new KernelTypeError({message:"into keys must be strings, keywords or symbols",expected:"map key",got:typeof p[0]}));
    result.set(key, p[1]!);
  }
  return Effect.succeed(result as ReadonlyMap<string, KValue>);
};

export const collectionBuiltins: Record<string, BuiltinFn> = {
  list,
  map,
  filter,
  reduce,
  first,
  rest,
  count,
  nth,
  conj,
  concat,
  "sort-by": sortBy,
  "group-by": groupBy,
  "flat-map": flatMap,
  some,
  "every?": everyQ,
  "empty?": emptyQ,
  distinct,
  into,
};
