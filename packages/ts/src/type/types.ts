/**
 * Type and Row representations for Hindley-Milner inference with row polymorphism.
 *
 * Type   = mono-types (TVar, TCon, TFun, TApp, TRow)
 * Row    = row types for records (REmpty, RVar, RExtend)
 * ERow   = effect rows for algebraic effects (EEmpty, EVar, EExtend)
 * Scheme = universally quantified type (forall tvars rvars evars. type + constraints)
 */
import type { Kind } from "./kind.js";

// ---------------------------------------------------------------------------
// Types (tau)
// ---------------------------------------------------------------------------

/** Unification variable, optionally annotated with a Kind */
export interface TVar {
  readonly _tag: "TVar";
  readonly id: string;
  readonly kind?: Kind | undefined;
}

/** Nullary type constructor: Num, Str, Bool, Nil */
export interface TCon {
  readonly _tag: "TCon";
  readonly name: string;
}

/** Function type: arg -> res, optionally accepting extra rest args of one type */
export interface TFun {
  readonly _tag: "TFun";
  readonly arg: Type;
  readonly res: Type;
  readonly rest?: Type | undefined;
  readonly effect?: ERow | undefined;
}

/** Pure variadic function: zero or more rest args of one type -> result */
export interface TVariadic {
  readonly _tag: "TVariadic";
  readonly rest: Type;
  readonly res: Type;
  readonly effect?: ERow | undefined;
}

/** Applied type constructor: List Num, Map Str Num, etc. */
export interface TApp {
  readonly _tag: "TApp";
  readonly con: Type;
  readonly args: readonly Type[];
}

/** Record type, backed by a Row */
export interface TRow {
  readonly _tag: "TRow";
  readonly row: Row;
}

export type Type = TVar | TCon | TFun | TVariadic | TApp | TRow;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Empty row (closed record) */
export interface REmpty {
  readonly _tag: "REmpty";
}

/** Row unification variable (open record) */
export interface RVar {
  readonly _tag: "RVar";
  readonly id: string;
}

/** Extend a row with a labeled field */
export interface RExtend {
  readonly _tag: "RExtend";
  readonly label: string;
  readonly type: Type;
  readonly tail: Row;
}

export type Row = REmpty | RVar | RExtend;

// ---------------------------------------------------------------------------
// Effect Rows
// ---------------------------------------------------------------------------

/** Empty effect row (pure: no effects) */
export interface EEmpty {
  readonly _tag: "EEmpty";
}

/** Effect row variable (open effect set) */
export interface EVar {
  readonly _tag: "EVar";
  readonly id: string;
}

/** Extend an effect row with a labeled effect */
export interface EExtend {
  readonly _tag: "EExtend";
  readonly label: string;
  readonly tail: ERow;
}

export type ERow = EEmpty | EVar | EExtend;

// ---------------------------------------------------------------------------
// Constraints (for type classes)
// ---------------------------------------------------------------------------

/** A type class constraint: e.g., Eq a, Functor f */
export interface Constraint {
  readonly className: string;
  readonly args: readonly Type[];
}

// ---------------------------------------------------------------------------
// Schemes (sigma)
// ---------------------------------------------------------------------------

/** Polymorphic type scheme: forall tvars rvars evars. type where constraints */
export interface Scheme {
  readonly tvars: readonly string[];
  readonly rvars: readonly string[];
  readonly evars: readonly string[];
  readonly type: Type;
  readonly constraints: readonly Constraint[];
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export const TVar = (id: string, kind?: Kind): TVar => ({ _tag: "TVar", id, kind });
export const TCon = (name: string): TCon => ({ _tag: "TCon", name });
export const TFun = (arg: Type, res: Type, effect?: ERow, rest?: Type): TFun => ({
  _tag: "TFun",
  arg,
  res,
  ...(rest ? { rest } : {}),
  effect,
});
export const TVariadic = (rest: Type, res: Type, effect?: ERow): TVariadic => ({
  _tag: "TVariadic",
  rest,
  res,
  effect,
});
export const TApp = (con: Type, args: readonly Type[]): TApp => ({ _tag: "TApp", con, args });
export const TRow = (row: Row): TRow => ({ _tag: "TRow", row });

export const REmpty: REmpty = { _tag: "REmpty" };
export const RVar = (id: string): RVar => ({ _tag: "RVar", id });
export const RExtend = (label: string, type: Type, tail: Row): RExtend => ({
  _tag: "RExtend",
  label,
  type,
  tail,
});

export const EEmpty: EEmpty = { _tag: "EEmpty" };
export const EVar = (id: string): EVar => ({ _tag: "EVar", id });
export const EExtend = (label: string, tail: ERow): EExtend => ({
  _tag: "EExtend",
  label,
  tail,
});

export const Constraint = (className: string, args: readonly Type[]): Constraint => ({
  className,
  args,
});

export const Scheme = (
  tvars: readonly string[],
  rvars: readonly string[],
  type: Type,
  evars: readonly string[] = [],
  constraints: readonly Constraint[] = [],
): Scheme => ({
  tvars,
  rvars,
  evars,
  type,
  constraints,
});

/** Wrap a monotype as a scheme with no quantifiers */
export const mono = (type: Type): Scheme => Scheme([], [], type, [], []);

// ---------------------------------------------------------------------------
// Well-known types
// ---------------------------------------------------------------------------

export const tInt = TCon("Int");
export const tFloat = TCon("Float");
/** Legacy Number/Num aliases denote Float; prefer explicit Int/Float. */
export const tNum = tFloat;
export const tStr = TCon("String");
export const tBool = TCon("Bool");
export const tNil = TCon("Unit");
export const tList = TCon("List");

// Meta descriptor value
export const tMeta = TCon("Meta");

// Special types for gradual typing
export const tUnknown: Type = TCon("Unknown");
export const tNever: Type = TCon("Never");

// ---------------------------------------------------------------------------
// Free variables
// ---------------------------------------------------------------------------

export function ftvType(t: Type, out: Set<string> = new Set()): Set<string> {
  switch (t._tag) {
    case "TVar":
      out.add(t.id);
      return out;
    case "TCon":
      return out;
    case "TFun":
      ftvType(t.arg, out);
      ftvType(t.res, out);
      if (t.rest) ftvType(t.rest, out);
      return out;
    case "TVariadic":
      ftvType(t.rest, out);
      ftvType(t.res, out);
      return out;
    case "TApp":
      ftvType(t.con, out);
      for (const a of t.args) ftvType(a, out);
      return out;
    case "TRow":
      ftvRow(t.row, out, new Set());
      return out;
  }
}

/** Collect free effect row variables */
export function fevERow(e: ERow, out: Set<string> = new Set()): Set<string> {
  switch (e._tag) {
    case "EEmpty":
      return out;
    case "EVar":
      out.add(e.id);
      return out;
    case "EExtend":
      return fevERow(e.tail, out);
  }
}

/** Collect free effect vars from a type (traverses TFun effects) */
export function fevType(t: Type, out: Set<string> = new Set()): Set<string> {
  switch (t._tag) {
    case "TVar":
    case "TCon":
      return out;
    case "TFun":
      fevType(t.arg, out);
      fevType(t.res, out);
      if (t.rest) fevType(t.rest, out);
      if (t.effect) fevERow(t.effect, out);
      return out;
    case "TVariadic":
      fevType(t.rest, out);
      fevType(t.res, out);
      if (t.effect) fevERow(t.effect, out);
      return out;
    case "TApp":
      fevType(t.con, out);
      for (const a of t.args) fevType(a, out);
      return out;
    case "TRow":
      return out;
  }
}

/** Free row variables also occur inside function parameters and type applications. */
export function frvType(t: Type, out: Set<string> = new Set()): Set<string> {
  const row = (r: Row): void => {
    if (r._tag === "RVar") out.add(r.id);
    else if (r._tag === "RExtend") { frvType(r.type, out); row(r.tail); }
  };
  switch (t._tag) {
    case "TFun": frvType(t.arg, out); frvType(t.res, out); if (t.rest) frvType(t.rest, out); break;
    case "TVariadic": frvType(t.rest, out); frvType(t.res, out); break;
    case "TApp": frvType(t.con, out); t.args.forEach(a => frvType(a, out)); break;
    case "TRow": row(t.row); break;
  }
  return out;
}

export function ftvRow(r: Row, tvOut: Set<string>, rvOut: Set<string>): void {
  switch (r._tag) {
    case "REmpty":
      return;
    case "RVar":
      rvOut.add(r.id);
      return;
    case "RExtend":
      ftvType(r.type, tvOut);
      ftvRow(r.tail, tvOut, rvOut);
      return;
  }
}

export function frvRow(r: Row, out: Set<string> = new Set()): Set<string> {
  ftvRow(r, new Set(), out);
  return out;
}

export function freeVarsScheme(s: Scheme): {
  tvars: Set<string>;
  rvars: Set<string>;
  evars: Set<string>;
} {
  const tvars = ftvType(s.type);
  const rvars = frvType(s.type);
  const evars = fevType(s.type);
  for (const v of s.tvars) tvars.delete(v);
  for (const v of s.rvars) rvars.delete(v);
  for (const v of s.evars) evars.delete(v);
  return { tvars, rvars, evars };
}

// ---------------------------------------------------------------------------
// Pretty printing
// ---------------------------------------------------------------------------

/**
 * Map an internal TCon name to its public display name.
 *
 * Since the internal TCon names are now canonical (Number/String/Boolean/Unit),
 * this is an identity function. It is kept as a named helper for documentation
 * purposes — to make it explicit that every user-visible type name surface
 * passes through here — and to ease future changes if display-name conventions
 * ever diverge from internal names again.
 *
 * Legacy internal spellings (Num/Str/Bool/Nil) are preserved here only as
 * fallback translations in case any residual external data still carries them.
 */
function showPublicTypeName(name: string): string {
  switch (name) {
    // Legacy fallback translations — kept so any residual serialized type
    // representations from pre-migration data still display correctly.
    case "Number":
    case "Num":
      return "Float";
    case "Str":
      return "String";
    case "Boolean":
      return "Bool";
    case "Nil":
      return "Unit";
    default:
      return name;
  }
}

export function showType(t: Type): string {
  switch (t._tag) {
    case "TVar":
      return t.id;
    case "TCon":
      return showPublicTypeName(t.name);
    case "TFun": {
      const p = t.arg._tag === "TFun" ? `(${showType(t.arg)})` : showType(t.arg);
      const arrow = t.rest
        ? ` -rest ${showType(t.rest)}${t.effect && t.effect._tag !== "EEmpty" ? ` -{${showERow(t.effect)}}` : ""}-> `
        : t.effect && t.effect._tag !== "EEmpty"
          ? ` -{${showERow(t.effect)}}-> `
          : " -> ";
      return `${p}${arrow}${showType(t.res)}`;
    }
    case "TVariadic": {
      if (t.effect && t.effect._tag !== "EEmpty") {
        return `...${showType(t.rest)} -{${showERow(t.effect)}}-> ${showType(t.res)}`;
      }
      return `...${showType(t.rest)} -> ${showType(t.res)}`;
    }
    case "TApp":
      return `${showType(t.con)}<${t.args.map(showType).join(", ")}>`;
    case "TRow":
      return `{${showRow(t.row)}}`;
  }
}

export function showRow(row: Row): string {
  const {fields, tail} = flattenRow(row);
  const labels = [...fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([label, type]) => {
    const key = label.startsWith(":") ? label : JSON.stringify(label.startsWith("\0str:") ? label.slice(5) : label);
    return `${key} ${showType(type)}`;
  });
  if (tail._tag === "RVar") labels.push(`& ${tail.id}`);
  return labels.join(" ");
}

export function showERow(e: ERow): string {
  switch (e._tag) {
    case "EEmpty":
      return "";
    case "EVar":
      return e.id;
    case "EExtend": {
      const rest =
        e.tail._tag === "EEmpty"
          ? ""
          : e.tail._tag === "EVar"
            ? ` | ${e.tail.id}`
            : `, ${showERow(e.tail)}`;
      return `${e.label}${rest}`;
    }
  }
}

export function showConstraint(c: Constraint): string {
  return `${c.className} ${c.args.map(showType).join(" ")}`;
}

export function showScheme(s: Scheme): string {
  const allVars = [...s.tvars, ...s.rvars, ...s.evars];
  const base =
    allVars.length === 0 ? showType(s.type) : `forall ${allVars.join(" ")}. ${showType(s.type)}`;
  if (s.constraints.length === 0) return base;
  const cs = s.constraints.map(showConstraint).join(", ");
  return `(${cs}) => ${base}`;
}

/** Build a multi-arg function type: (a, b, c) -> ret  becomes  a -> b -> c -> ret */
export function fnType(params: readonly Type[], ret: Type): Type {
  let result = ret;
  for (let i = params.length - 1; i >= 0; i--) {
    result = TFun(params[i]!, result);
  }
  return result;
}

export function variadicFnType(
  params: readonly Type[],
  rest: Type,
  ret: Type,
  effect?: ERow,
): Type {
  let result: Type =
    params.length === 0
      ? TVariadic(rest, ret, effect)
      : TFun(params[params.length - 1]!, ret, effect, rest);
  for (let i = params.length - 2; i >= 0; i--) {
    result = TFun(params[i]!, result);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

export interface FlatRow {
  readonly fields: Map<string, Type>;
  readonly tail: Row;
}

export function flattenRow(r: Row): FlatRow {
  const fields = new Map<string, Type>();
  let cur: Row = r;
  while (cur._tag === "RExtend") {
    fields.set(cur.label, cur.type);
    cur = cur.tail;
  }
  return { fields, tail: cur };
}

export function buildRow(fields: Map<string, Type>, tail: Row): Row {
  const labels = Array.from(fields.keys()).sort();
  let r: Row = tail;
  for (let i = labels.length - 1; i >= 0; i--) {
    const label = labels[i]!;
    r = RExtend(label, fields.get(label)!, r);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Effect Row helpers
// ---------------------------------------------------------------------------

export interface FlatERow {
  readonly labels: Set<string>;
  readonly tail: ERow;
}

export function flattenERow(e: ERow): FlatERow {
  const labels = new Set<string>();
  let cur: ERow = e;
  while (cur._tag === "EExtend") {
    labels.add(cur.label);
    cur = cur.tail;
  }
  return { labels, tail: cur };
}

export function buildERow(labels: Set<string>, tail: ERow): ERow {
  const sorted = Array.from(labels).sort();
  let e: ERow = tail;
  for (let i = sorted.length - 1; i >= 0; i--) {
    e = EExtend(sorted[i]!, e);
  }
  return e;
}
