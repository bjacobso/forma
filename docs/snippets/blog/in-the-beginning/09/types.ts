import { Schema } from "effect";
import { TData, TNum, TVar } from "../05/types.ts";

// #region type
// Part 5's types, with two additions. A function type now says what
// calling it does, as a row of effect labels. And Unit is the type
// of an expression that only matters for what it does.
export const TUnit = Schema.TaggedStruct("TUnit", {});

export interface TFun {
  readonly _tag: "TFun";
  readonly params: ReadonlyArray<Type>;
  readonly rest: Type | null;
  readonly result: Type;
  readonly effects: Type;
}
// A row: some labels, then maybe a variable standing for more.
export interface TRow {
  readonly _tag: "TRow";
  readonly labels: ReadonlyArray<string>;
  readonly tail: Type | null;
}
export type Type =
  | typeof TNum.Type
  | typeof TData.Type
  | typeof TUnit.Type
  | typeof TVar.Type
  | TFun
  | TRow;

const LazyType = Schema.suspend((): Schema.Codec<Type> => Type);
export const TFun = Schema.TaggedStruct("TFun", {
  params: Schema.Array(LazyType),
  rest: Schema.NullOr(LazyType),
  result: LazyType,
  effects: LazyType,
});
export const TRow = Schema.TaggedStruct("TRow", {
  labels: Schema.Array(Schema.String),
  tail: Schema.NullOr(LazyType),
});
export const Type = Schema.Union([
  TNum,
  TData,
  TUnit,
  TVar,
  TFun,
  TRow,
]);
// #endregion type

export const num: Type = { _tag: "TNum" };
export const data: Type = { _tag: "TData" };
export const unit: Type = { _tag: "TUnit" };
export const row = (
  labels: ReadonlyArray<string>,
  tail: Type | null,
): TRow => ({ _tag: "TRow", labels, tail });
export const fun = (
  params: ReadonlyArray<Type>,
  result: Type,
  effects: Type,
  rest: Type | null = null,
): TFun => ({ _tag: "TFun", params, rest, result, effects });

// The types directly inside a type.
export const children = (t: Type): Type[] =>
  t._tag === "TFun"
    ? [...t.params, t.result, t.effects, ...(t.rest ? [t.rest] : [])]
    : t._tag === "TRow" && t.tail ? [t.tail]
    : [];

// How many times each variable appears in a type.
const counts = (t: Type, seen = new Map<number, number>()) => {
  if (t._tag === "TVar") seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
  for (const inner of children(t)) counts(inner, seen);
  return seen;
};

// #region show
// Print a type. A function's effects follow a !. A variable that
// stands for "any other effects" is left out if it appears only
// once, because then it says nothing.
export const showType = (
  t: Type,
  names = new Map<number, string>(),
  seen = counts(t),
): string => {
  const show = (t: Type) => showType(t, names, seen);
  switch (t._tag) {
    case "TNum":
      return "Num";
    case "TData":
      return "Data";
    case "TUnit":
      return "Unit";
    case "TVar": {
      const letter = String.fromCharCode(97 + names.size);
      if (!names.has(t.id)) names.set(t.id, `'${letter}`);
      return names.get(t.id)!;
    }
    case "TRow": {
      const labels = [...t.labels].sort().join(", ");
      const { tail: v } = t;
      const shared = v?._tag === "TVar" && seen.get(v.id)! > 1;
      const tail = shared ? show(v) : "";
      if (!labels) return tail;
      return tail ? `{${labels} | ${tail}}` : `{${labels}}`;
    }
    case "TFun": {
      const params = t.params.map(show);
      if (t.rest) params.push(`${show(t.rest)}...`);
      const arrow = `(${params.join(", ")}) -> ${show(t.result)}`;
      return arrow + does(t.effects, show);
    }
  }
};

// " ! effects", or nothing for a function that does nothing.
const does = (effects: Type, show: (t: Type) => string) => {
  const shown = show(
    effects._tag === "TVar" ? row([], effects) : effects,
  );
  return shown ? ` ! ${shown}` : "";
};

// A whole program: what it returns, and what running it does.
export const showComputation = (type: Type, effects: Type) => {
  const names = new Map<number, string>();
  const seen = counts(fun([], type, effects));
  const show = (t: Type) => showType(t, names, seen);
  return show(type) + does(effects, show);
};
// #endregion show
