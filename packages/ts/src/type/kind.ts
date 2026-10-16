/**
 * Kind system for higher-kinded types.
 *
 * Kinds classify types the same way types classify values:
 *   KStar    = *           (the kind of concrete types like Number, String, Boolean)
 *   KRow     = Row         (the kind of row types)
 *   KEffect  = Effect      (the kind of effect rows)
 *   KArrow   = k1 -> k2    (the kind of type constructors like List : * -> *)
 *
 * Kinds are inferred, not written by users. The kind system prevents nonsense
 * like TApp(Number, [String]) by ensuring type constructors are applied correctly.
 */

// ---------------------------------------------------------------------------
// Kind ADT
// ---------------------------------------------------------------------------

/** The kind of concrete types: Number, String, Boolean, etc. */
export interface KStar {
  readonly _tag: "KStar";
}

/** The kind of row types (for record polymorphism) */
export interface KRow {
  readonly _tag: "KRow";
}

/** The kind of effect rows */
export interface KEffect {
  readonly _tag: "KEffect";
}

/** The kind of type constructors: k1 -> k2 */
export interface KArrow {
  readonly _tag: "KArrow";
  readonly arg: Kind;
  readonly res: Kind;
}

export type Kind = KStar | KRow | KEffect | KArrow;

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export const KStar: KStar = { _tag: "KStar" };
export const KRow: KRow = { _tag: "KRow" };
export const KEffect: KEffect = { _tag: "KEffect" };
export const KArrow = (arg: Kind, res: Kind): KArrow => ({ _tag: "KArrow", arg, res });

// ---------------------------------------------------------------------------
// Well-known kinds
// ---------------------------------------------------------------------------

/** * -> * (e.g., List, Option) */
export const kUnary = KArrow(KStar, KStar);

/** * -> * -> * (e.g., Map, Either) */
export const kBinary = KArrow(KStar, KArrow(KStar, KStar));

// ---------------------------------------------------------------------------
// Kind registry for built-in type constructors
// ---------------------------------------------------------------------------

const builtinKinds = new Map<string, Kind>([
  ["Number", KStar],
  ["Int", KStar],
  ["Float", KStar],
  ["String", KStar],
  ["Boolean", KStar],
  ["Unit", KStar],
  ["List", kUnary],
  ["Map", kBinary],
  ["Unknown", KStar],
  ["Never", KStar],
]);

/**
 * Get the kind of a built-in type constructor.
 * Returns undefined for unknown constructors.
 */
export function getBuiltinKind(name: string): Kind | undefined {
  return builtinKinds.get(name);
}

// ---------------------------------------------------------------------------
// Kind inference from type parameter count
// ---------------------------------------------------------------------------

/**
 * Build a kind from a type parameter count.
 * 0 params → *, 1 param → * -> *, 2 params → * -> * -> *, etc.
 */
export function kindFromArity(arity: number): Kind {
  let k: Kind = KStar;
  for (let i = 0; i < arity; i++) {
    k = KArrow(KStar, k);
  }
  return k;
}

// ---------------------------------------------------------------------------
// Kind equality
// ---------------------------------------------------------------------------

export function kindsEqual(a: Kind, b: Kind): boolean {
  if (a._tag !== b._tag) return false;
  if (a._tag === "KArrow" && b._tag === "KArrow") {
    return kindsEqual(a.arg, b.arg) && kindsEqual(a.res, b.res);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pretty printing
// ---------------------------------------------------------------------------

export function showKind(k: Kind): string {
  switch (k._tag) {
    case "KStar":
      return "*";
    case "KRow":
      return "Row";
    case "KEffect":
      return "Effect";
    case "KArrow": {
      const arg = k.arg._tag === "KArrow" ? `(${showKind(k.arg)})` : showKind(k.arg);
      return `${arg} -> ${showKind(k.res)}`;
    }
  }
}
