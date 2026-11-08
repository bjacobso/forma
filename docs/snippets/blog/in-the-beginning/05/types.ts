import { Schema } from "effect";

// #region type
// A type is data too. `rest`, when present, is the type of any
// number of extra arguments, so `+` can stay variadic.
export const TNum = Schema.TaggedStruct("TNum", {});
export const TData = Schema.TaggedStruct("TData", {});
export const TVar = Schema.TaggedStruct("TVar", {
  id: Schema.Number,
});

export interface TFun {
  readonly _tag: "TFun";
  readonly params: ReadonlyArray<Type>;
  readonly rest: Type | null;
  readonly result: Type;
}
export type Type =
  | typeof TNum.Type
  | typeof TData.Type
  | typeof TVar.Type
  | TFun;

const LazyType = Schema.suspend((): Schema.Codec<Type> => Type);
export const TFun = Schema.TaggedStruct("TFun", {
  params: Schema.Array(LazyType),
  rest: Schema.NullOr(LazyType),
  result: LazyType,
});
export const Type = Schema.Union([TNum, TData, TVar, TFun]);
// #endregion type

// #region build
export const num: Type = { _tag: "TNum" };
export const data: Type = { _tag: "TData" };
export const fun = (
  params: ReadonlyArray<Type>,
  result: Type,
  rest: Type | null = null,
): TFun => ({ _tag: "TFun", params, rest, result });
// #endregion build

// #region show
// Print a type, naming its variables 'a, 'b, ... in order of
// appearance. Pass the same map to name several types consistently.
export const showType = (
  t: Type,
  names = new Map<number, string>(),
): string => {
  switch (t._tag) {
    case "TNum":
      return "Num";
    case "TData":
      return "Data";
    case "TVar": {
      const letter = String.fromCharCode(97 + names.size);
      if (!names.has(t.id)) names.set(t.id, `'${letter}`);
      return names.get(t.id)!;
    }
    case "TFun": {
      const params = t.params.map((p) => showType(p, names));
      if (t.rest) params.push(`${showType(t.rest, names)}...`);
      const result = showType(t.result, names);
      return `(${params.join(", ")}) -> ${result}`;
    }
  }
};
// #endregion show
