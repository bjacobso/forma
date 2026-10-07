/**
 * Type substitution for type variables, row variables, and effect variables.
 *
 * Substitutions are stored as three separate maps — one for type vars,
 * one for row vars, one for effect vars — so occurs checks can be precise.
 */
import type { Type, Row, Scheme, ERow } from "./types.js";
import {
  TFun,
  TVariadic,
  TApp,
  TRow,
  RExtend,
  EExtend,
  ftvType,
  frvType,
  ftvRow,
  fevERow,
  fevType,
} from "./types.js";

// ---------------------------------------------------------------------------
// Substitution
// ---------------------------------------------------------------------------

export interface Subst {
  readonly tvars: ReadonlyMap<string, Type>;
  readonly rvars: ReadonlyMap<string, Row>;
  readonly evars: ReadonlyMap<string, ERow>;
}

export const emptySubst: Subst = {
  tvars: new Map(),
  rvars: new Map(),
  evars: new Map(),
};

// ---------------------------------------------------------------------------
// Apply substitution
// ---------------------------------------------------------------------------

export function applyType(s: Subst, t: Type): Type {
  switch (t._tag) {
    case "TVar": {
      const hit = s.tvars.get(t.id);
      return hit ? applyType(s, hit) : t;
    }
    case "TCon":
      return t;
    case "TFun": {
      const effect = t.effect ? applyERow(s, t.effect) : undefined;
      const rest = t.rest ? applyType(s, t.rest) : undefined;
      return TFun(applyType(s, t.arg), applyType(s, t.res), effect, rest);
    }
    case "TVariadic": {
      const effect = t.effect ? applyERow(s, t.effect) : undefined;
      return TVariadic(applyType(s, t.rest), applyType(s, t.res), effect);
    }
    case "TApp":
      return TApp(
        applyType(s, t.con),
        t.args.map((a) => applyType(s, a)),
      );
    case "TRow":
      return TRow(applyRow(s, t.row));
  }
}

export function applyERow(s: Subst, e: ERow): ERow {
  switch (e._tag) {
    case "EEmpty":
      return e;
    case "EVar": {
      const hit = s.evars.get(e.id);
      return hit ? applyERow(s, hit) : e;
    }
    case "EExtend":
      return EExtend(e.label, applyERow(s, e.tail));
  }
}

export function applyRow(s: Subst, r: Row): Row {
  switch (r._tag) {
    case "REmpty":
      return r;
    case "RVar": {
      const hit = s.rvars.get(r.id);
      return hit ? applyRow(s, hit) : r;
    }
    case "RExtend":
      return RExtend(r.label, applyType(s, r.type), applyRow(s, r.tail));
  }
}

function restrict<K, V>(map: ReadonlyMap<K, V>, bound: readonly K[]): ReadonlyMap<K, V> {
  // Most schemes bind fresh variables absent from the current substitution.
  // Applying a substitution only reads these maps, so sharing is safe.
  if (!bound.some(key => map.has(key))) return map;
  const result = new Map(map);
  for (const key of bound) result.delete(key);
  return result;
}

export function applyScheme(s: Subst, scheme: Scheme): Scheme {
  const restricted: Subst = {
    tvars: restrict(s.tvars, scheme.tvars),
    rvars: restrict(s.rvars, scheme.rvars),
    evars: restrict(s.evars, scheme.evars),
  };
  return {
    tvars: scheme.tvars,
    rvars: scheme.rvars,
    evars: scheme.evars,
    type: applyType(restricted, scheme.type),
    constraints: scheme.constraints,
  };
}

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

export type TypeEnv = ReadonlyMap<string, Scheme>;

export function applyEnv(s: Subst, env: TypeEnv): Map<string, Scheme> {
  const result = new Map<string, Scheme>();
  for (const [k, v] of env) {
    result.set(k, applyScheme(s, v));
  }
  return result;
}

export function freeVarsEnv(env: TypeEnv): {
  tvars: Set<string>;
  rvars: Set<string>;
  evars: Set<string>;
} {
  const tvars = new Set<string>();
  const rvars = new Set<string>();
  const evars = new Set<string>();
  for (const scheme of env.values()) {
    // Free vars = all vars in type minus bound vars
    const schemeFtv = ftvType(scheme.type);
    const schemeRv = frvType(scheme.type);
    const schemeEv = fevType(scheme.type);
    for (const v of scheme.tvars) schemeFtv.delete(v);
    for (const v of scheme.rvars) schemeRv.delete(v);
    for (const v of scheme.evars) schemeEv.delete(v);
    for (const v of schemeFtv) tvars.add(v);
    for (const v of schemeRv) rvars.add(v);
    for (const v of schemeEv) evars.add(v);
  }
  return { tvars, rvars, evars };
}

// ---------------------------------------------------------------------------
// Occurs checks
// ---------------------------------------------------------------------------

export function occursInType(tvar: string, t: Type): boolean {
  return ftvType(t).has(tvar);
}

export function occursInRow(rvar: string, r: Row): boolean {
  const rv = new Set<string>();
  ftvRow(r, new Set(), rv);
  return rv.has(rvar);
}

export function occursInERow(evar: string, e: ERow): boolean {
  return fevERow(e).has(evar);
}
