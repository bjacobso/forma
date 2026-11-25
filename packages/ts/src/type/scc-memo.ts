/**
 * Per-SCC HM inference memoization (stage 1).
 *
 * Caches successful, closed Hindley-Milner definition SCCs within an
 * AnalysisWorkspace, keyed by canonical AST/signature content, prelude/policy
 * scope, and canonical referenced schemes. On replay, component-local
 * type/row/effect variables are alpha-renamed to fresh variables at the current
 * counter base and declaration/annotation/node spans are reprojected onto the
 * current CoreExpr nodes.
 */
import type { CoreExpr, Lit, Pattern, Span, TypeExpr } from "./core-expr.js";
import { exprChildren } from "./core-expr.js";
import type { SExpr } from "../reader/types.js";
import type { Kind } from "./kind.js";
import type { Constraint, ERow, Row, Scheme, Type } from "./types.js";
import {
  EExtend,
  EVar,
  RExtend,
  RVar,
  TApp,
  TFun,
  TRow,
  TVar,
  TVariadic,
  freeVarsScheme,
} from "./types.js";
import type { TypeEnv } from "./substitution.js";
import type { InferenceSnapshot } from "./inference-snapshot.js";
import { hasHoles } from "./holes.js";

export const SCC_MEMO_VERSION = "scc-memo-v1";
export const DEFAULT_MAX_SCC_ENTRIES = 4096;

export interface SccMemoCounters {
  hits: number;
  misses: number;
  stores: number;
  fallbacks: number;
}

export interface SccMemoStats {
  readonly hits: number;
  readonly misses: number;
  readonly stores: number;
  readonly fallbacks: number;
  readonly entries: number;
  readonly lastRun: Readonly<SccMemoCounters>;
}

export interface CachedSccEntry {
  readonly tvarsAllocated: number;
  readonly rvarsAllocated: number;
  readonly evarsAllocated: number;
  readonly hasVars: boolean;
  /** Exported schemes in component order, with relative var indices and no spans. */
  readonly schemes: readonly Scheme[];
  /** Resolved definition result types in component order, with relative var indices. */
  readonly defTypes: readonly Type[];
  /** Resolved node types in deterministic pre-order (collectComponentNodes). */
  readonly nodeTypes: readonly (Type | undefined)[];
}

export class SccDocumentCache {
  readonly #maxEntries: number;
  readonly #entries = new Map<string, CachedSccEntry>();
  #scopeKey = "";
  readonly #totals: SccMemoCounters = { hits: 0, misses: 0, stores: 0, fallbacks: 0 };
  #lastRun: SccMemoCounters = { hits: 0, misses: 0, stores: 0, fallbacks: 0 };

  constructor(maxEntries = DEFAULT_MAX_SCC_ENTRIES) {
    this.#maxEntries = maxEntries;
  }

  beginRun(scopeKey: string): void {
    if (this.#scopeKey !== scopeKey) {
      this.#entries.clear();
      this.#scopeKey = scopeKey;
    }
    this.#lastRun = { hits: 0, misses: 0, stores: 0, fallbacks: 0 };
  }

  get scopeKey(): string {
    return this.#scopeKey;
  }

  get(key: string): CachedSccEntry | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    // Refresh LRU order.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry;
  }

  set(key: string, entry: CachedSccEntry): void {
    if (this.#entries.has(key)) {
      this.#entries.delete(key);
    } else if (this.#entries.size >= this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    this.#entries.set(key, entry);
  }

  clear(): void {
    this.#entries.clear();
  }

  recordHit(): void {
    this.#totals.hits++;
    this.#lastRun.hits++;
  }

  recordMiss(): void {
    this.#totals.misses++;
    this.#lastRun.misses++;
  }

  recordStore(): void {
    this.#totals.stores++;
    this.#lastRun.stores++;
  }

  recordFallback(): void {
    this.#totals.fallbacks++;
    this.#lastRun.fallbacks++;
  }

  stats(): SccMemoStats {
    return {
      hits: this.#totals.hits,
      misses: this.#totals.misses,
      stores: this.#totals.stores,
      fallbacks: this.#totals.fallbacks,
      entries: this.#entries.size,
      lastRun: { ...this.#lastRun },
    };
  }
}

export interface SccMemoSession {
  readonly cache: SccDocumentCache;
  readonly scopeKey: string;
}

let activeSession: SccMemoSession | undefined;

export function getActiveSccMemoSession(): SccMemoSession | undefined {
  return activeSession;
}

export function withSccMemoSession<T>(
  cache: SccDocumentCache,
  scopeKey: string,
  run: () => T,
): T {
  const prev = activeSession;
  cache.beginRun(scopeKey);
  activeSession = { cache, scopeKey };
  try {
    return run();
  } finally {
    activeSession = prev;
  }
}

// ---------------------------------------------------------------------------
// Document-level eligibility
// ---------------------------------------------------------------------------

const INELIGIBLE_HEADS = new Set([
  "macro",
  "__macro",
  "form",
  "__form-descriptor",
  "__form-hook",
  "service",
  "layer",
  "__service",
  "__layer",
  "__operation",
  "class",
  "typeclass",
  "__typeclass",
  "instance",
  "error",
  "type",
  "__sum-type",
]);

export function isDocumentEligibleForSccMemo(
  exprs: readonly CoreExpr[],
  rawExprs?: readonly SExpr[],
): boolean {
  for (const expr of exprs) {
    if (
      expr._tag === "TypeDef" ||
      expr._tag === "DefClass" ||
      expr._tag === "Instance" ||
      expr._tag === "DefService" ||
      expr._tag === "DSLForm"
    ) {
      return false;
    }
  }
  if (rawExprs) {
    for (const raw of rawExprs) {
      if (raw._tag === "List" && raw.items[0]?._tag === "Sym" && INELIGIBLE_HEADS.has(raw.items[0].name)) {
        return false;
      }
    }
  }
  if (hasHoles(exprs)) return false;
  return true;
}

export function registriesUnchanged(before: InferenceSnapshot, after: InferenceSnapshot): boolean {
  return (
    before.typeAliases.size === after.typeAliases.size &&
    before.nominalRecords.size === after.nominalRecords.size &&
    before.typeAliasParams.size === after.typeAliasParams.size &&
    before.errorTypes.size === after.errorTypes.size &&
    before.adtRegistry.size === after.adtRegistry.size &&
    before.constructorToType.size === after.constructorToType.size &&
    before.classRegistry.size === after.classRegistry.size &&
    before.instanceRegistry.size === after.instanceRegistry.size
  );
}

// ---------------------------------------------------------------------------
// Closed scheme / env tracking
// ---------------------------------------------------------------------------

const closedSchemeCache = new WeakMap<Scheme, boolean>();

export function isClosedScheme(scheme: Scheme): boolean {
  const cached = closedSchemeCache.get(scheme);
  if (cached !== undefined) return cached;
  const free = freeVarsScheme(scheme);
  const closed = free.tvars.size === 0 && free.rvars.size === 0 && free.evars.size === 0;
  closedSchemeCache.set(scheme, closed);
  return closed;
}

export function isClosedEnv(env: TypeEnv): boolean {
  for (const scheme of env.values()) {
    if (!isClosedScheme(scheme)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Canonical Scheme digest (WeakMap-cached)
// ---------------------------------------------------------------------------

const schemeDigestCache = new WeakMap<Scheme, string>();

function encodeKind(kind: Kind | undefined): string {
  return kind ? JSON.stringify(kind) : "";
}

export function canonicalSchemeDigest(scheme: Scheme): string {
  const cached = schemeDigestCache.get(scheme);
  if (cached !== undefined) return cached;

  const tMap = new Map<string, string>();
  scheme.tvars.forEach((v, i) => tMap.set(v, `T${i}`));
  const rMap = new Map<string, string>();
  scheme.rvars.forEach((v, i) => rMap.set(v, `R${i}`));
  const eMap = new Map<string, string>();
  scheme.evars.forEach((v, i) => eMap.set(v, `E${i}`));

  const encERow = (e: ERow): string => {
    switch (e._tag) {
      case "EEmpty":
        return "E0";
      case "EVar":
        return `EV(${eMap.get(e.id) ?? `F:${e.id}`})`;
      case "EExtend":
        return `EE(${JSON.stringify(e.label)},${encERow(e.tail)})`;
    }
  };

  const encRow = (r: Row): string => {
    switch (r._tag) {
      case "REmpty":
        return "R0";
      case "RVar":
        return `RV(${rMap.get(r.id) ?? `F:${r.id}`})`;
      case "RExtend":
        return `RE(${JSON.stringify(r.label)},${encType(r.type)},${encRow(r.tail)})`;
    }
  };

  const encType = (t: Type): string => {
    let base: string;
    switch (t._tag) {
      case "TVar":
        base = `TV(${tMap.get(t.id) ?? `F:${t.id}`}${t.kind ? `:${encodeKind(t.kind)}` : ""})`;
        break;
      case "TCon":
        base = `TC(${t.name})`;
        break;
      case "TFun":
        base = `TF(${encType(t.arg)},${encType(t.res)},${t.rest ? encType(t.rest) : ""},${t.effect ? encERow(t.effect) : ""})`;
        break;
      case "TVariadic":
        base = `TVar(${encType(t.rest)},${encType(t.res)},${t.effect ? encERow(t.effect) : ""})`;
        break;
      case "TApp":
        base = `TA(${encType(t.con)},[${t.args.map(encType).join(",")}])`;
        break;
      case "TRow":
        base = `TR(${encRow(t.row)})`;
        break;
    }
    if (t.arity !== undefined || t.nullaryResult !== undefined || t.numericOperator !== undefined) {
      base += `{a=${t.arity ?? ""},n=${t.nullaryResult ? encType(t.nullaryResult) : ""},op=${t.numericOperator ?? ""}}`;
    }
    return base;
  };

  const constraints = scheme.constraints
    .map((c) => `${c.className}(${c.args.map(encType).join(",")})`)
    .join(";");
  const digest = `S[${scheme.tvars.length},${scheme.rvars.length},${scheme.evars.length}|${constraints}|${encType(scheme.type)}]`;
  schemeDigestCache.set(scheme, digest);
  return digest;
}

// ---------------------------------------------------------------------------
// Canonical AST + TypeExpr serialization & cache key construction
// ---------------------------------------------------------------------------

function hasMacroOrigins(span: Span | undefined): boolean {
  return span?.macroOrigins !== undefined && span.macroOrigins.length > 0;
}

function encodeSExpr(expr: SExpr): string {
  // Source positions are not semantic; everything else is.
  return JSON.stringify(expr, (key, value) => (key === "loc" ? undefined : value));
}

function encodeLit(lit: Lit): string {
  switch (lit._tag) {
    case "LInt":
      return `LI(${lit.value})`;
    case "LFloat":
      return `LF(${Object.is(lit.value, -0) ? "-0" : lit.value})`;
    case "LString":
      return `LS(${JSON.stringify(lit.value)})`;
    case "LBool":
      return `LB(${lit.value})`;
    case "LKeyword":
      return `LK(${JSON.stringify(lit.value)})`;
    case "LSymbol":
      return `LY(${JSON.stringify(lit.value)})`;
    case "LQuoted":
      return `LQ(${encodeSExpr(lit.value)})`;
    case "LNil":
      return "LN";
  }
}

function encodeTypeExpr(te: TypeExpr): string | null {
  if (hasMacroOrigins(te.span)) return null;
  switch (te._tag) {
    case "TESym":
      return `TY(${te.name})`;
    case "TEFun": {
      const params: string[] = [];
      for (const p of te.params) {
        const enc = encodeTypeExpr(p);
        if (enc === null) return null;
        params.push(enc);
      }
      const ret = encodeTypeExpr(te.ret);
      if (ret === null) return null;
      return `TF([${params.join(",")}],${ret})`;
    }
    case "TEApp": {
      const con = encodeTypeExpr(te.con);
      if (con === null) return null;
      const args: string[] = [];
      for (const a of te.args) {
        const enc = encodeTypeExpr(a);
        if (enc === null) return null;
        args.push(enc);
      }
      return `TA(${con},[${args.join(",")}])`;
    }
    case "TERow": {
      const fields: string[] = [];
      for (const f of te.fields) {
        const enc = encodeTypeExpr(f.type);
        if (enc === null) return null;
        fields.push(`${JSON.stringify(f.label)}:${enc}`);
      }
      return `TR([${fields.join(",")}],${te.tail ?? ""})`;
    }
    case "TERowOp": {
      const ops: string[] = [];
      for (const o of te.operands) {
        const enc = encodeTypeExpr(o);
        if (enc === null) return null;
        ops.push(enc);
      }
      const keys = te.keys.map((k) => JSON.stringify(k.label)).join(",");
      return `TRO(${te.op},[${ops.join(",")}],[${keys}])`;
    }
  }
}

function encodePattern(pattern: Pattern): string {
  switch (pattern._tag) {
    case "PWild":
      return "PW";
    case "PCon":
      return `PC(${pattern.name},[${pattern.vars.join(",")}])`;
    case "PData":
      return `PD(${encodeSExpr(pattern.syntax)})`;
  }
}

function encodeCoreExpr(
  expr: CoreExpr,
  componentNames: ReadonlySet<string>,
  referenced: Set<string>,
): string | null {
  if (hasMacroOrigins(expr.span)) return null;
  switch (expr._tag) {
    case "Lit":
      return encodeLit(expr.lit);
    case "Var":
      if (expr.name.startsWith("?")) return null;
      if (!componentNames.has(expr.name)) referenced.add(expr.name);
      return `V(${expr.name})`;
    case "Lam": {
      const body = encodeCoreExpr(expr.body, componentNames, referenced);
      if (body === null) return null;
      const params = expr.params.map((p) => p.name).join(",");
      return `Lam([${params}],${expr.restParam?.name ?? ""},${body})`;
    }
    case "App": {
      const fn = encodeCoreExpr(expr.fn, componentNames, referenced);
      if (fn === null) return null;
      const args: string[] = [];
      for (const a of expr.args) {
        const enc = encodeCoreExpr(a, componentNames, referenced);
        if (enc === null) return null;
        args.push(enc);
      }
      return `App(${fn},[${args.join(",")}])`;
    }
    case "Let": {
      const bindings: string[] = [];
      for (const b of expr.bindings) {
        if (hasMacroOrigins(b.span)) return null;
        const enc = encodeCoreExpr(b.expr, componentNames, referenced);
        if (enc === null) return null;
        bindings.push(`${b.name}=${enc}`);
      }
      const body = encodeCoreExpr(expr.body, componentNames, referenced);
      if (body === null) return null;
      return `Let([${bindings.join(",")}],${body})`;
    }
    case "EffectDo": {
      const bindings: string[] = [];
      for (const b of expr.bindings) {
        if (hasMacroOrigins(b.span)) return null;
        const enc = encodeCoreExpr(b.expr, componentNames, referenced);
        if (enc === null) return null;
        bindings.push(`${b.name}=${enc}`);
      }
      const body = encodeCoreExpr(expr.body, componentNames, referenced);
      if (body === null) return null;
      return `EDo([${bindings.join(",")}],${body})`;
    }
    case "EffectFail": {
      const payload = encodeCoreExpr(expr.payload, componentNames, referenced);
      if (payload === null) return null;
      return `EFail(${expr.errorName},${payload})`;
    }
    case "EffectCatch": {
      const body = encodeCoreExpr(expr.body, componentNames, referenced);
      if (body === null) return null;
      const handler = encodeCoreExpr(expr.handler, componentNames, referenced);
      if (handler === null) return null;
      return `ECatch(${body},${expr.errorName},${expr.binding.name},${handler})`;
    }
    case "If": {
      const cond = encodeCoreExpr(expr.cond, componentNames, referenced);
      if (cond === null) return null;
      const thenE = encodeCoreExpr(expr.then, componentNames, referenced);
      if (thenE === null) return null;
      const elseE = encodeCoreExpr(expr.else_, componentNames, referenced);
      if (elseE === null) return null;
      return `If(${cond},${thenE},${elseE})`;
    }
    case "Record": {
      const fields: string[] = [];
      for (const f of expr.fields) {
        if (hasMacroOrigins(f.span)) return null;
        const enc = encodeCoreExpr(f.value, componentNames, referenced);
        if (enc === null) return null;
        fields.push(`${JSON.stringify(f.label)}:${enc}`);
      }
      return `Rec([${fields.join(",")}])`;
    }
    case "Get": {
      const record = encodeCoreExpr(expr.record, componentNames, referenced);
      if (record === null) return null;
      const key = expr.key ? encodeCoreExpr(expr.key, componentNames, referenced) : "";
      if (key === null) return null;
      return `Get(${record},${JSON.stringify(expr.label)},${key})`;
    }
    case "Def": {
      const inner = encodeCoreExpr(expr.expr, componentNames, referenced);
      if (inner === null) return null;
      const sig = expr.signature ? encodeTypeExpr(expr.signature) : "";
      if (sig === null) return null;
      return `Def(${expr.name},${sig},${inner})`;
    }
    case "Ascribe": {
      const inner = encodeCoreExpr(expr.expr, componentNames, referenced);
      if (inner === null) return null;
      const te = encodeTypeExpr(expr.typeExpr);
      if (te === null) return null;
      return `Asc(${inner},${te})`;
    }
    case "Match": {
      const scrut = encodeCoreExpr(expr.scrutinee, componentNames, referenced);
      if (scrut === null) return null;
      const arms: string[] = [];
      for (const arm of expr.arms) {
        const body = encodeCoreExpr(arm.body, componentNames, referenced);
        if (body === null) return null;
        arms.push(`${encodePattern(arm.pattern)}=>${body}`);
      }
      return `Match(${scrut},[${arms.join(",")}])`;
    }
    case "DSLForm":
    case "TypeDef":
    case "DefClass":
    case "Instance":
    case "DefService":
    case "DefLayer":
      return null;
  }
}

export function buildComponentCacheKey(
  scopeKey: string,
  component: readonly (CoreExpr & { _tag: "Def" })[],
  env: TypeEnv,
): string | null {
  const componentNames = new Set<string>();
  for (const defExpr of component) {
    if (env.has(defExpr.name)) return null;
    componentNames.add(defExpr.name);
  }

  const referenced = new Set<string>();
  const astParts: string[] = [];
  for (const defExpr of component) {
    const enc = encodeCoreExpr(defExpr, componentNames, referenced);
    if (enc === null) return null;
    astParts.push(enc);
  }

  const refNames = [...referenced].sort();
  const refParts: string[] = [];
  for (const name of refNames) {
    const scheme = env.get(name);
    refParts.push(`${name}=${scheme ? canonicalSchemeDigest(scheme) : "<ext>"}`);
  }

  return `${SCC_MEMO_VERSION}|${scopeKey}|${astParts.join(";")}|${refParts.join(",")}`;
}

// ---------------------------------------------------------------------------
// Deterministic node collection (must match between store and replay)
// ---------------------------------------------------------------------------

export function collectComponentNodes(
  component: readonly (CoreExpr & { _tag: "Def" })[],
): CoreExpr[] {
  const nodes: CoreExpr[] = [];
  const visit = (expr: CoreExpr): void => {
    nodes.push(expr);
    for (const child of exprChildren(expr)) {
      visit(child);
    }
  };
  for (const defExpr of component) {
    visit(defExpr);
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Variable relativization (store) & alpha-renaming (replay)
// ---------------------------------------------------------------------------

function parseVarIndex(id: string, prefixCode: number): number | null {
  if (id.length < 2 || id.charCodeAt(0) !== prefixCode) return null;
  let value = 0;
  for (let i = 1; i < id.length; i++) {
    const c = id.charCodeAt(i);
    if (c < 48 || c > 57) return null;
    value = value * 10 + (c - 48);
  }
  return value;
}

const CODE_T = 116; // 't'
const CODE_R = 114; // 'r'
const CODE_E = 101; // 'e'

function mapERow(
  e: ERow,
  mapE: (id: string) => string | null,
): ERow | null {
  switch (e._tag) {
    case "EEmpty":
      return e;
    case "EVar": {
      const next = mapE(e.id);
      if (next === null) return null;
      return next === e.id ? e : EVar(next);
    }
    case "EExtend": {
      const tail = mapERow(e.tail, mapE);
      if (tail === null) return null;
      return tail === e.tail ? e : EExtend(e.label, tail);
    }
  }
}

function mapRow(
  r: Row,
  mapT: (id: string) => string | null,
  mapR: (id: string) => string | null,
  mapE: (id: string) => string | null,
): Row | null {
  switch (r._tag) {
    case "REmpty":
      return r;
    case "RVar": {
      const next = mapR(r.id);
      if (next === null) return null;
      return next === r.id ? r : RVar(next);
    }
    case "RExtend": {
      const type = mapType(r.type, mapT, mapR, mapE);
      if (type === null) return null;
      const tail = mapRow(r.tail, mapT, mapR, mapE);
      if (tail === null) return null;
      return type === r.type && tail === r.tail ? r : RExtend(r.label, type, tail);
    }
  }
}

function withTypeDecorations(original: Type, mapped: Type, nullaryResult: Type | undefined): Type {
  if (
    original.arity === undefined &&
    original.nullaryResult === undefined &&
    original.numericOperator === undefined
  ) {
    return mapped;
  }
  return {
    ...mapped,
    ...(original.arity !== undefined ? { arity: original.arity } : {}),
    ...(nullaryResult !== undefined ? { nullaryResult } : {}),
    ...(original.numericOperator !== undefined ? { numericOperator: original.numericOperator } : {}),
  };
}

function mapType(
  t: Type,
  mapT: (id: string) => string | null,
  mapR: (id: string) => string | null,
  mapE: (id: string) => string | null,
): Type | null {
  let mappedNullary: Type | undefined;
  if (t.nullaryResult !== undefined) {
    const res = mapType(t.nullaryResult, mapT, mapR, mapE);
    if (res === null) return null;
    mappedNullary = res;
  }

  let base: Type;
  switch (t._tag) {
    case "TVar": {
      const next = mapT(t.id);
      if (next === null) return null;
      base = next === t.id ? t : { ...t, id: next };
      break;
    }
    case "TCon":
      base = t;
      break;
    case "TFun": {
      const arg = mapType(t.arg, mapT, mapR, mapE);
      if (arg === null) return null;
      const res = mapType(t.res, mapT, mapR, mapE);
      if (res === null) return null;
      const rest = t.rest ? mapType(t.rest, mapT, mapR, mapE) : undefined;
      if (rest === null) return null;
      const effect = t.effect ? mapERow(t.effect, mapE) : undefined;
      if (effect === null) return null;
      base =
        arg === t.arg && res === t.res && rest === t.rest && effect === t.effect
          ? t
          : TFun(arg, res, effect, rest);
      break;
    }
    case "TVariadic": {
      const rest = mapType(t.rest, mapT, mapR, mapE);
      if (rest === null) return null;
      const res = mapType(t.res, mapT, mapR, mapE);
      if (res === null) return null;
      const effect = t.effect ? mapERow(t.effect, mapE) : undefined;
      if (effect === null) return null;
      base =
        rest === t.rest && res === t.res && effect === t.effect
          ? t
          : TVariadic(rest, res, effect);
      break;
    }
    case "TApp": {
      const con = mapType(t.con, mapT, mapR, mapE);
      if (con === null) return null;
      let changed = con !== t.con;
      const args: Type[] = [];
      for (const a of t.args) {
        const ma = mapType(a, mapT, mapR, mapE);
        if (ma === null) return null;
        if (ma !== a) changed = true;
        args.push(ma);
      }
      base = changed ? TApp(con, args) : t;
      break;
    }
    case "TRow": {
      const row = mapRow(t.row, mapT, mapR, mapE);
      if (row === null) return null;
      base = row === t.row ? t : TRow(row);
      break;
    }
  }

  if (base === t && mappedNullary === t.nullaryResult) return t;
  return withTypeDecorations(t, base, mappedNullary);
}

function mapConstraint(
  c: Constraint,
  mapT: (id: string) => string | null,
  mapR: (id: string) => string | null,
  mapE: (id: string) => string | null,
): Constraint | null {
  const args: Type[] = [];
  for (const a of c.args) {
    const ma = mapType(a, mapT, mapR, mapE);
    if (ma === null) return null;
    args.push(ma);
  }
  return { className: c.className, args };
}

export function captureCachedSccEntry(params: {
  readonly tStart: number;
  readonly tEnd: number;
  readonly rStart: number;
  readonly rEnd: number;
  readonly eStart: number;
  readonly eEnd: number;
  readonly schemes: readonly Scheme[];
  readonly defTypes: readonly Type[];
  readonly nodeTypes: readonly (Type | undefined)[];
}): CachedSccEntry | null {
  const { tStart, tEnd, rStart, rEnd, eStart, eEnd } = params;
  let hasVars = false;

  const relT = (id: string): string | null => {
    const idx = parseVarIndex(id, CODE_T);
    if (idx === null || idx < tStart || idx >= tEnd) return null;
    hasVars = true;
    return `t${idx - tStart}`;
  };
  const relR = (id: string): string | null => {
    const idx = parseVarIndex(id, CODE_R);
    if (idx === null || idx < rStart || idx >= rEnd) return null;
    hasVars = true;
    return `r${idx - rStart}`;
  };
  const relE = (id: string): string | null => {
    const idx = parseVarIndex(id, CODE_E);
    if (idx === null || idx < eStart || idx >= eEnd) return null;
    hasVars = true;
    return `e${idx - eStart}`;
  };

  const relSchemes: Scheme[] = [];
  for (const scheme of params.schemes) {
    if (!isClosedScheme(scheme)) return null;
    const tvars: string[] = [];
    for (const v of scheme.tvars) {
      const rv = relT(v);
      if (rv === null) return null;
      tvars.push(rv);
    }
    const rvars: string[] = [];
    for (const v of scheme.rvars) {
      const rv = relR(v);
      if (rv === null) return null;
      rvars.push(rv);
    }
    const evars: string[] = [];
    for (const v of scheme.evars) {
      const rv = relE(v);
      if (rv === null) return null;
      evars.push(rv);
    }
    const type = mapType(scheme.type, relT, relR, relE);
    if (type === null) return null;
    const constraints: Constraint[] = [];
    for (const c of scheme.constraints) {
      const mc = mapConstraint(c, relT, relR, relE);
      if (mc === null) return null;
      constraints.push(mc);
    }
    relSchemes.push({ tvars, rvars, evars, type, constraints });
  }

  const relDefTypes: Type[] = [];
  for (const dt of params.defTypes) {
    const m = mapType(dt, relT, relR, relE);
    if (m === null) return null;
    relDefTypes.push(m);
  }

  const relNodeTypes: (Type | undefined)[] = [];
  for (const nt of params.nodeTypes) {
    if (nt === undefined) {
      relNodeTypes.push(undefined);
    } else {
      const m = mapType(nt, relT, relR, relE);
      if (m === null) return null;
      relNodeTypes.push(m);
    }
  }

  return {
    tvarsAllocated: tEnd - tStart,
    rvarsAllocated: rEnd - rStart,
    evarsAllocated: eEnd - eStart,
    hasVars,
    schemes: relSchemes,
    defTypes: relDefTypes,
    nodeTypes: relNodeTypes,
  };
}

export function replayCachedSccEntry(
  entry: CachedSccEntry,
  component: readonly (CoreExpr & { _tag: "Def" })[],
  tBase: number,
  rBase: number,
  eBase: number,
): {
  readonly schemes: readonly Scheme[];
  readonly defTypes: readonly Type[];
  readonly nodeTypes: readonly (Type | undefined)[];
} {
  if (!entry.hasVars) {
    const schemes = entry.schemes.map((scheme, i) => {
      const defExpr = component[i]!;
      return {
        ...scheme,
        declaration: defExpr.span,
        ...(defExpr.signature ? { annotation: defExpr.signature.span } : {}),
      };
    });
    return {
      schemes,
      defTypes: entry.defTypes,
      nodeTypes: entry.nodeTypes,
    };
  }

  const shiftT = (id: string): string => `t${tBase + parseVarIndex(id, CODE_T)!}`;
  const shiftR = (id: string): string => `r${rBase + parseVarIndex(id, CODE_R)!}`;
  const shiftE = (id: string): string => `e${eBase + parseVarIndex(id, CODE_E)!}`;

  const schemes = entry.schemes.map((scheme, i) => {
    const defExpr = component[i]!;
    return {
      tvars: scheme.tvars.map(shiftT),
      rvars: scheme.rvars.map(shiftR),
      evars: scheme.evars.map(shiftE),
      type: mapType(scheme.type, shiftT, shiftR, shiftE)!,
      constraints: scheme.constraints.map((c) => mapConstraint(c, shiftT, shiftR, shiftE)!),
      declaration: defExpr.span,
      ...(defExpr.signature ? { annotation: defExpr.signature.span } : {}),
    };
  });

  const defTypes = entry.defTypes.map((dt) => mapType(dt, shiftT, shiftR, shiftE)!);
  const nodeTypes = entry.nodeTypes.map((nt) =>
    nt === undefined ? undefined : mapType(nt, shiftT, shiftR, shiftE)!,
  );

  return { schemes, defTypes, nodeTypes };
}
