/**
 * Canonical content-addressed definition hashing (RFC 0029 Stage 0).
 *
 * Properties:
 * - Alpha-equivalent local binders (de Bruijn indices for Lam, Let, EffectDo,
 *   EffectCatch, Match, DefLayer) so renaming local parameters does not change `DefHash`.
 * - Sorted record fields, row fields, sets, error/requirement sets, maps, and
 *   method/constructor tables so ordering-only edits do not change `DefHash`.
 * - Presentation metadata excluded: spans, node IDs, comments, formatting,
 *   leading docstring literals, and `:doc`/`:title` metadata are excluded from `DefHash`.
 * - Cross-definition references replaced by target `DefHash`.
 * - Mutual recursion and self-recursion canonicalized via Tarjan SCCs into a
 *   single `sccHash` with deterministic `(sccHash, memberIndex)` derivation.
 * - Opaque boundaries (host builtins, external packages, native providers)
 *   pinned by declared Forma signature + explicit package/runtime digest.
 *
 * Browser-safe: uses `../source/sha256.js` and `../artifact/canonical-json.js`
 * with zero Node-only imports.
 */

import type { JsonValue } from "../artifact/artifact.js";
import { canonicalJson, sha256 } from "../artifact/canonical-json.js";
import type { SExpr } from "../reader/types.js";
import type {
  CoreExpr,
  Lit,
  Pattern,
  TypeExpr,
} from "../type/core-expr.js";
import {
  effectSetFromArgs,
  effectSetKindOf,
  isSetVariableKey,
} from "../type/effect-sets.js";
import type { ERow, Row, Scheme, Type } from "../type/types.js";
import { showType } from "../type/types.js";
import {
  DEFAULT_LANGUAGE_PROFILE,
  DEF_HASH_VERSION,
  SCC_HASH_VERSION,
  type DefHash,
  type DefinitionRecord,
  type OpaqueBoundaryRef,
  type PresentationMeta,
  type SccHash,
  type SccMembership,
  type StoreDefinitionKind,
} from "./types.js";

/** Presentation-only metadata keys stripped from canonicalized SExpr forms. */
const PRESENTATION_METADATA_KEYS = new Set([":doc", ":title"]);

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Canonical Scheme & Type serialization (alpha-equivalent, sorted rows/sets)
// ---------------------------------------------------------------------------

/**
 * Canonicalize an HM `Scheme` into a deterministic, alpha-equivalent string.
 * Quantified type/row/effect variables are renamed in first-appearance order,
 * record rows and effect rows are sorted by label, and operational ErrorSet /
 * RequirementSet members are sorted.
 */
export function canonicalizeScheme(scheme: Scheme): string {
  const tBound = new Set(scheme.tvars);
  const rBound = new Set(scheme.rvars);
  const eBound = new Set(scheme.evars);

  const tMap = new Map<string, string>();
  const rMap = new Map<string, string>();
  const eMap = new Map<string, string>();

  const normTVar = (id: string): string => {
    if (!tBound.has(id)) return `FT:${id}`;
    let mapped = tMap.get(id);
    if (!mapped) {
      mapped = `T${tMap.size}`;
      tMap.set(id, mapped);
    }
    return mapped;
  };

  const normRVar = (id: string): string => {
    if (!rBound.has(id)) return `FR:${id}`;
    let mapped = rMap.get(id);
    if (!mapped) {
      mapped = `R${rMap.size}`;
      rMap.set(id, mapped);
    }
    return mapped;
  };

  const normEVar = (id: string): string => {
    if (!eBound.has(id)) return `FE:${id}`;
    let mapped = eMap.get(id);
    if (!mapped) {
      mapped = `E${eMap.size}`;
      eMap.set(id, mapped);
    }
    return mapped;
  };

  const encERow = (row: ERow): string => {
    const labels: string[] = [];
    let cur: ERow = row;
    while (cur._tag === "EExtend") {
      labels.push(cur.label);
      cur = cur.tail;
    }
    labels.sort(compareStrings);
    const tail = cur._tag === "EVar" ? normEVar(cur.id) : "";
    return `ER([${labels.map((l) => JSON.stringify(l)).join(",")}],${tail})`;
  };

  const encRow = (row: Row): string => {
    const fields: Array<{ label: string; type: Type }> = [];
    let cur: Row = row;
    while (cur._tag === "RExtend") {
      fields.push({ label: cur.label, type: cur.type });
      cur = cur.tail;
    }
    fields.sort((a, b) => compareStrings(a.label, b.label));
    const encodedFields = fields.map((f) => `${JSON.stringify(f.label)}:${encType(f.type)}`);
    const tail = cur._tag === "RVar" ? normRVar(cur.id) : "";
    return `RR([${encodedFields.join(",")}],${tail})`;
  };

  const encType = (t: Type): string => {
    let base: string;
    switch (t._tag) {
      case "TVar":
        base = `TV(${normTVar(t.id)}${t.kind ? `:${JSON.stringify(t.kind)}` : ""})`;
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
      case "TApp": {
        const setKind = effectSetKindOf(t);
        if (setKind) {
          const entries = [...effectSetFromArgs(t.args).keys()].sort(compareStrings);
          base = `TS(${setKind},[${entries.map((e) => JSON.stringify(e)).join(",")}])`;
          break;
        }
        base = `TA(${encType(t.con)},[${t.args.map(encType).join(",")}])`;
        break;
      }
      case "TRow":
        base = `TR(${encRow(t.row)})`;
        break;
    }
    if (t.arity !== undefined || t.nullaryResult !== undefined || t.numericOperator !== undefined) {
      base += `{a=${t.arity ?? ""},n=${t.nullaryResult ? encType(t.nullaryResult) : ""},op=${t.numericOperator ?? ""}}`;
    }
    return base;
  };

  const bodyEnc = encType(scheme.type);
  const constraints = scheme.constraints
    .map((c) => `${c.className}(${c.args.map(encType).join(",")})`)
    .sort(compareStrings);

  return `Scheme([${constraints.join(";")}]|${bodyEnc})`;
}

/** Format a human-readable signature string from a `Scheme`. */
export function formatSchemeSignature(scheme: Scheme): string {
  const base = showType(scheme.type);
  if (scheme.constraints.length === 0) return base;
  const cs = scheme.constraints
    .map((c) => `(${c.className} ${c.args.map(showType).join(" ")})`)
    .sort(compareStrings)
    .join(", ");
  return `(${cs}) => ${base}`;
}

/**
 * Extract concrete (non-variable) Effect requirements and error names from an HM `Scheme`.
 */
export function extractEffectsFromScheme(scheme: Scheme): {
  readonly requirements: readonly string[];
  readonly errors: readonly string[];
} {
  const requirements = new Set<string>();
  const errors = new Set<string>();

  const visitERow = (row: ERow): void => {
    let cur: ERow = row;
    while (cur._tag === "EExtend") {
      requirements.add(cur.label);
      cur = cur.tail;
    }
  };

  const visit = (t: Type): void => {
    if (t.nullaryResult) visit(t.nullaryResult);
    switch (t._tag) {
      case "TVar":
      case "TCon":
        return;
      case "TFun":
        visit(t.arg);
        visit(t.res);
        if (t.rest) visit(t.rest);
        if (t.effect) visitERow(t.effect);
        return;
      case "TVariadic":
        visit(t.rest);
        visit(t.res);
        if (t.effect) visitERow(t.effect);
        return;
      case "TApp": {
        const setKind = effectSetKindOf(t);
        if (setKind) {
          const target = setKind === "error" ? errors : requirements;
          for (const key of effectSetFromArgs(t.args).keys()) {
            if (!isSetVariableKey(key)) target.add(key);
          }
          return;
        }
        visit(t.con);
        for (const arg of t.args) visit(arg);
        return;
      }
      case "TRow": {
        let cur: Row = t.row;
        while (cur._tag === "RExtend") {
          visit(cur.type);
          cur = cur.tail;
        }
        return;
      }
    }
  };

  visit(scheme.type);
  return {
    requirements: [...requirements].sort(compareStrings),
    errors: [...errors].sort(compareStrings),
  };
}

/**
 * Fallback extraction of concrete error names and service capabilities from a `CoreExpr`
 * (used when no resolved `Scheme` is available, or merged with scheme effects).
 */
export function extractEffectsFromCoreExpr(expr: CoreExpr): {
  readonly requirements: readonly string[];
  readonly errors: readonly string[];
} {
  const requirements = new Set<string>();
  const errors = new Set<string>();

  const visitTypeExpr = (te: TypeExpr): void => {
    switch (te._tag) {
      case "TESym":
        return;
      case "TEFun":
        for (const p of te.params) visitTypeExpr(p);
        visitTypeExpr(te.ret);
        return;
      case "TEApp": {
        if (te.con._tag === "TESym" && te.con.name === "Effect" && te.args.length === 3) {
          visitTypeExpr(te.args[0]!);
          const errArg = te.args[1]!;
          const reqArg = te.args[2]!;
          if (errArg._tag === "TEApp" && errArg.con._tag === "TESym" && errArg.con.name === "ErrorSet") {
            for (const a of errArg.args) {
              if (a._tag === "TESym" && /^[A-Z]/.test(a.name)) errors.add(a.name);
            }
          }
          if (reqArg._tag === "TEApp" && reqArg.con._tag === "TESym" && reqArg.con.name === "RequirementSet") {
            for (const a of reqArg.args) {
              if (a._tag === "TESym" && /^[A-Z]/.test(a.name)) requirements.add(a.name);
            }
          }
          return;
        }
        if (te.con._tag === "TESym" && te.con.name === "ErrorSet") {
          for (const a of te.args) {
            if (a._tag === "TESym" && /^[A-Z]/.test(a.name)) errors.add(a.name);
          }
          return;
        }
        if (te.con._tag === "TESym" && te.con.name === "RequirementSet") {
          for (const a of te.args) {
            if (a._tag === "TESym" && /^[A-Z]/.test(a.name)) requirements.add(a.name);
          }
          return;
        }
        visitTypeExpr(te.con);
        for (const a of te.args) visitTypeExpr(a);
        return;
      }
      case "TERow":
        for (const f of te.fields) visitTypeExpr(f.type);
        return;
      case "TERowOp":
        for (const o of te.operands) visitTypeExpr(o);
        return;
    }
  };

  const visit = (node: CoreExpr): void => {
    switch (node._tag) {
      case "Lit":
        return;
      case "Var":
        // Dotted service capability reference like `Db.get` (starts with uppercase service name)
        if (/^[A-Z][A-Za-z0-9_-]*\.[a-z][A-Za-z0-9_?-]*$/.test(node.name)) {
          requirements.add(node.name);
        }
        return;
      case "Lam":
        visit(node.body);
        return;
      case "App":
        visit(node.fn);
        for (const a of node.args) visit(a);
        return;
      case "Let":
      case "EffectDo":
        for (const b of node.bindings) visit(b.expr);
        visit(node.body);
        return;
      case "EffectFail":
        errors.add(node.errorName);
        visit(node.payload);
        return;
      case "EffectCatch":
        visit(node.body);
        for (const arm of node.arms) visit(arm.handler);
        return;
      case "If":
        visit(node.cond);
        visit(node.then);
        visit(node.else_);
        return;
      case "Record":
        for (const f of node.fields) visit(f.value);
        return;
      case "Get":
        visit(node.record);
        if (node.key) visit(node.key);
        return;
      case "Def":
        if (node.signature) visitTypeExpr(node.signature);
        visit(node.expr);
        return;
      case "Ascribe":
        visit(node.expr);
        visitTypeExpr(node.typeExpr);
        return;
      case "DSLForm":
        for (const c of node.children) visit(c.expr);
        return;
      case "TypeDef":
        if (node.typeExpr) visitTypeExpr(node.typeExpr);
        if (node.constructors) {
          for (const c of node.constructors) {
            for (const f of c.fields) visitTypeExpr(f);
          }
        }
        return;
      case "Match":
        visit(node.scrutinee);
        for (const arm of node.arms) visit(arm.body);
        return;
      case "DefClass":
        for (const m of node.methods) visitTypeExpr(m.typeExpr);
        return;
      case "Instance":
        for (const m of node.methods) visit(m.expr);
        return;
      case "DefService":
        for (const m of node.methods) visitTypeExpr(m.typeExpr);
        return;
      case "DefLayer":
        if (node.signature) visitTypeExpr(node.signature);
        if (node.body.kind === "compose") {
          visit(node.body.expr);
        } else {
          for (const step of node.body.setup) visit(step.binding.expr);
          for (const m of node.body.methods) visit(m.body);
        }
        return;
    }
  };

  visit(expr);
  return {
    requirements: [...requirements].sort(compareStrings),
    errors: [...errors].sort(compareStrings),
  };
}

// ---------------------------------------------------------------------------
// Canonical SExpr serialization (presentation metadata & spans excluded)
// ---------------------------------------------------------------------------

/**
 * Strip presentation-only keyword pairs (`:doc "..."`, `:title "..."`) from a
 * list of SExpr items (e.g., `(form ... :doc "...")` or `(type ... :doc "...")`).
 */
function stripPresentationOptions(items: readonly SExpr[]): SExpr[] {
  const out: SExpr[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (
      item._tag === "Sym" &&
      PRESENTATION_METADATA_KEYS.has(item.name) &&
      i + 1 < items.length
    ) {
      // Skip `:doc <val>` or `:title <val>`
      i++;
      continue;
    }
    out.push(item);
  }
  return out;
}

/**
 * Canonicalize an `SExpr` for hashing:
 * - Excludes `loc` / spans / comments / whitespace.
 * - Excludes `:doc` and `:title` presentation metadata in maps and option lists.
 * - Sorts `Map` pairs by canonical key and `Set` elements canonically.
 */
export function canonicalizeSExpr(
  expr: SExpr,
  resolveSymbol?: (name: string) => string | undefined,
): string {
  switch (expr._tag) {
    case "Sym": {
      if (expr.name.startsWith(":")) return `K(${JSON.stringify(expr.name)})`;
      const resolved = resolveSymbol?.(expr.name);
      return resolved !== undefined ? resolved : `S(${JSON.stringify(expr.name)})`;
    }
    case "Str":
      return `Str(${JSON.stringify(expr.value)})`;
    case "Num":
      return `Num(${expr.numericKind ?? "num"},${Object.is(expr.value, -0) ? "-0" : expr.value})`;
    case "Bool":
      return `Bool(${expr.value})`;
    case "Error":
      return `Err(${JSON.stringify(expr.message)})`;
    case "Vector":
      return `[${expr.items.map((i) => canonicalizeSExpr(i, resolveSymbol)).join(",")}]`;
    case "Set": {
      const items = expr.items
        .map((i) => canonicalizeSExpr(i, resolveSymbol))
        .sort(compareStrings);
      return `#{${items.join(",")}}`;
    }
    case "Map": {
      const pairs: string[] = [];
      for (const [k, v] of expr.pairs) {
        if (k._tag === "Sym" && PRESENTATION_METADATA_KEYS.has(k.name)) continue;
        pairs.push(`${canonicalizeSExpr(k, resolveSymbol)}:${canonicalizeSExpr(v, resolveSymbol)}`);
      }
      pairs.sort(compareStrings);
      return `{${pairs.join(",")}}`;
    }
    case "List": {
      const cleaned = stripPresentationOptions(expr.items);
      return `(${cleaned.map((i) => canonicalizeSExpr(i, resolveSymbol)).join(",")})`;
    }
  }
}

// ---------------------------------------------------------------------------
// Canonical CoreExpr & TypeExpr encoding (de Bruijn alpha-equivalence)
// ---------------------------------------------------------------------------

interface EncodeContext {
  /** Stack of local variable bindings (innermost at the end). */
  readonly locals: string[];
  /** Type parameter normalization map (name -> TP0, TP1, ...). */
  readonly typeParams: Map<string, string>;
  /** Resolve a non-local value/type symbol to its canonical tag (`REF(...)`, `SCC(...)`, `OPAQUE(...)`, or `undefined`). */
  readonly resolveGlobal: (name: string) => string | undefined;
}

function lookupLocal(locals: readonly string[], name: string): number {
  for (let i = locals.length - 1; i >= 0; i--) {
    if (locals[i] === name) {
      return locals.length - 1 - i;
    }
  }
  return -1;
}

/** Check whether `name` occurs free inside `expr` (respecting local shadowing). */
function isFreeInCoreExpr(expr: CoreExpr, target: string): boolean {
  switch (expr._tag) {
    case "Lit":
      return false;
    case "Var":
      return expr.name === target;
    case "Lam": {
      if (expr.params.some((p) => p.name === target) || expr.restParam?.name === target) {
        return false;
      }
      return isFreeInCoreExpr(expr.body, target);
    }
    case "App":
      return isFreeInCoreExpr(expr.fn, target) || expr.args.some((a) => isFreeInCoreExpr(a, target));
    case "Let":
    case "EffectDo": {
      for (const b of expr.bindings) {
        if (isFreeInCoreExpr(b.expr, target)) return true;
        if (b.name === target) return false;
      }
      return isFreeInCoreExpr(expr.body, target);
    }
    case "EffectFail":
      return isFreeInCoreExpr(expr.payload, target);
    case "EffectCatch":
      if (isFreeInCoreExpr(expr.body, target)) return true;
      return expr.arms.some(
        (arm) => arm.binding.name !== target && isFreeInCoreExpr(arm.handler, target),
      );
    case "If":
      return (
        isFreeInCoreExpr(expr.cond, target) ||
        isFreeInCoreExpr(expr.then, target) ||
        isFreeInCoreExpr(expr.else_, target)
      );
    case "Record":
      return expr.fields.some((f) => isFreeInCoreExpr(f.value, target));
    case "Get":
      return isFreeInCoreExpr(expr.record, target) || (expr.key ? isFreeInCoreExpr(expr.key, target) : false);
    case "Def":
      return isFreeInCoreExpr(expr.expr, target);
    case "Ascribe":
      return isFreeInCoreExpr(expr.expr, target);
    case "DSLForm":
      return expr.children.some((c) => isFreeInCoreExpr(c.expr, target));
    case "TypeDef":
    case "DefClass":
    case "DefService":
      return false;
    case "Match":
      if (isFreeInCoreExpr(expr.scrutinee, target)) return true;
      return expr.arms.some((arm) => {
        if (arm.pattern._tag === "PCon" && arm.pattern.vars.includes(target)) return false;
        return isFreeInCoreExpr(arm.body, target);
      });
    case "Instance":
      return expr.methods.some((m) => isFreeInCoreExpr(m.expr, target));
    case "DefLayer": {
      if (expr.body.kind === "compose") return isFreeInCoreExpr(expr.body.expr, target);
      for (const step of expr.body.setup) {
        if (isFreeInCoreExpr(step.binding.expr, target)) return true;
        if (step.binding.name === target) return false;
      }
      return expr.body.methods.some((m) => {
        if (m.params?.some((p) => p.name === target)) return false;
        return isFreeInCoreExpr(m.body, target);
      });
    }
  }
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
      return `LQ(${canonicalizeSExpr(lit.value)})`;
    case "LNil":
      return "LN";
  }
}

function encodeTypeExpr(te: TypeExpr, ctx: EncodeContext): string {
  switch (te._tag) {
    case "TESym": {
      // Lowercase symbols in type expressions are type/row/effect variables -> alpha-normalize
      if (/^[a-z][A-Za-z0-9_']*$/.test(te.name)) {
        let mapped = ctx.typeParams.get(te.name);
        if (!mapped) {
          mapped = `TP${ctx.typeParams.size}`;
          ctx.typeParams.set(te.name, mapped);
        }
        return `TV(${mapped})`;
      }
      const resolved = ctx.resolveGlobal(te.name);
      return resolved !== undefined ? `T(${resolved})` : `TC(${te.name})`;
    }
    case "TEFun":
      return `TF([${te.params.map((p) => encodeTypeExpr(p, ctx)).join(",")}],${encodeTypeExpr(te.ret, ctx)})`;
    case "TEApp": {
      if (
        te.con._tag === "TESym" &&
        (te.con.name === "ErrorSet" || te.con.name === "RequirementSet")
      ) {
        const sortedArgs = te.args.map((a) => encodeTypeExpr(a, ctx)).sort(compareStrings);
        return `TSet(${te.con.name},[${sortedArgs.join(",")}])`;
      }
      return `TA(${encodeTypeExpr(te.con, ctx)},[${te.args.map((a) => encodeTypeExpr(a, ctx)).join(",")}])`;
    }
    case "TERow": {
      const fields = [...te.fields]
        .sort((a, b) => compareStrings(a.label, b.label))
        .map((f) => `${JSON.stringify(f.label)}:${encodeTypeExpr(f.type, ctx)}`);
      let tail = "";
      if (te.tail) {
        let mapped = ctx.typeParams.get(te.tail);
        if (!mapped) {
          mapped = `TP${ctx.typeParams.size}`;
          ctx.typeParams.set(te.tail, mapped);
        }
        tail = mapped;
      }
      return `TR([${fields.join(",")}],${tail})`;
    }
    case "TERowOp": {
      const ops = te.operands.map((o) => encodeTypeExpr(o, ctx));
      const keys = [...te.keys].map((k) => JSON.stringify(k.label)).sort(compareStrings);
      return `TRO(${te.op},[${ops.join(",")}],[${keys.join(",")}])`;
    }
  }
}

function encodePattern(pattern: Pattern, ctx: EncodeContext): { readonly encoded: string; readonly boundVars: readonly string[] } {
  switch (pattern._tag) {
    case "PWild":
      return { encoded: "PW", boundVars: [] };
    case "PCon": {
      const resolved = ctx.resolveGlobal(pattern.name) ?? `C(${pattern.name})`;
      return { encoded: `PC(${resolved},${pattern.vars.length})`, boundVars: pattern.vars };
    }
    case "PData":
      return { encoded: `PD(${canonicalizeSExpr(pattern.syntax)})`, boundVars: [] };
  }
}

/**
 * Encode a `CoreExpr` into an alpha-equivalent canonical string.
 * - Strips spans, node IDs, and unused pure string docstring bindings in `Let`.
 * - Replaces local variables with de Bruijn indices `B(i)`.
 * - Replaces cross-definition references via `ctx.resolveGlobal`.
 */
export function canonicalizeCoreExpr(
  expr: CoreExpr,
  resolveGlobal: (name: string) => string | undefined = () => undefined,
): string {
  const ctx: EncodeContext = {
    locals: [],
    typeParams: new Map(),
    resolveGlobal,
  };
  return encodeCore(expr, ctx);
}

function encodeCore(expr: CoreExpr, ctx: EncodeContext): string {
  switch (expr._tag) {
    case "Lit":
      return encodeLit(expr.lit);

    case "Var": {
      const idx = lookupLocal(ctx.locals, expr.name);
      if (idx >= 0) return `B(${idx})`;
      const resolved = ctx.resolveGlobal(expr.name);
      return resolved !== undefined ? resolved : `FREE(${JSON.stringify(expr.name)})`;
    }

    case "Lam": {
      const savedLen = ctx.locals.length;
      for (const p of expr.params) ctx.locals.push(p.name);
      if (expr.restParam) ctx.locals.push(expr.restParam.name);
      const body = encodeCore(expr.body, ctx);
      ctx.locals.length = savedLen;
      return `Lam(${expr.params.length},${expr.restParam ? 1 : 0},${body})`;
    }

    case "App": {
      const fn = encodeCore(expr.fn, ctx);
      const args = expr.args.map((a) => encodeCore(a, ctx));
      return `App(${fn},[${args.join(",")}])`;
    }

    case "Let": {
      // Filter out pure discarded string literal bindings (e.g. docstrings lowered via implicit `do`).
      const activeBindings: typeof expr.bindings[number][] = [];
      for (let i = 0; i < expr.bindings.length; i++) {
        const b = expr.bindings[i]!;
        const isPureString = b.expr._tag === "Lit" && b.expr.lit._tag === "LString";
        if (isPureString) {
          let used = false;
          for (let j = i + 1; j < expr.bindings.length; j++) {
            if (isFreeInCoreExpr(expr.bindings[j]!.expr, b.name)) {
              used = true;
              break;
            }
            if (expr.bindings[j]!.name === b.name) break;
          }
          if (!used && isFreeInCoreExpr(expr.body, b.name)) {
            used = true;
          }
          if (!used) continue;
        }
        activeBindings.push(b);
      }

      if (activeBindings.length === 0) {
        return encodeCore(expr.body, ctx);
      }

      const savedLen = ctx.locals.length;
      const encodedBindings: string[] = [];
      for (const b of activeBindings) {
        encodedBindings.push(encodeCore(b.expr, ctx));
        ctx.locals.push(b.name);
      }
      const body = encodeCore(expr.body, ctx);
      ctx.locals.length = savedLen;
      return `Let([${encodedBindings.join(",")}],${body})`;
    }

    case "EffectDo": {
      const savedLen = ctx.locals.length;
      const encodedBindings: string[] = [];
      for (const b of expr.bindings) {
        encodedBindings.push(encodeCore(b.expr, ctx));
        ctx.locals.push(b.name);
      }
      const body = encodeCore(expr.body, ctx);
      ctx.locals.length = savedLen;
      return `EDo([${encodedBindings.join(",")}],${body})`;
    }

    case "EffectFail": {
      const errRef = ctx.resolveGlobal(expr.errorName) ?? `ERR(${JSON.stringify(expr.errorName)})`;
      return `EFail(${errRef},${encodeCore(expr.payload, ctx)})`;
    }

    case "EffectCatch": {
      const body = encodeCore(expr.body, ctx);
      const arms = expr.arms.map((arm) => {
        const errRef =
          arm.errorName === "_"
            ? "_"
            : (ctx.resolveGlobal(arm.errorName) ?? `ERR(${JSON.stringify(arm.errorName)})`);
        const savedLen = ctx.locals.length;
        ctx.locals.push(arm.binding.name);
        const handler = encodeCore(arm.handler, ctx);
        ctx.locals.length = savedLen;
        return `Arm(${errRef},${handler})`;
      });
      return `ECatch(${body},[${arms.join(",")}])`;
    }

    case "If":
      return `If(${encodeCore(expr.cond, ctx)},${encodeCore(expr.then, ctx)},${encodeCore(expr.else_, ctx)})`;

    case "Record": {
      const sorted = [...expr.fields].sort((a, b) => compareStrings(a.label, b.label));
      return `Rec([${sorted.map((f) => `${JSON.stringify(f.label)}:${encodeCore(f.value, ctx)}`).join(",")}])`;
    }

    case "Get":
      return `Get(${encodeCore(expr.record, ctx)},${JSON.stringify(expr.label)},${expr.key ? encodeCore(expr.key, ctx) : ""})`;

    case "Def": {
      // Note: Def's own display name is excluded from its semantic body hash
      // (so renaming a definition updates namespace bindings, not DefHash).
      const sig = expr.signature ? encodeTypeExpr(expr.signature, ctx) : "";
      return `Def(${sig},${encodeCore(expr.expr, ctx)})`;
    }

    case "Ascribe":
      return `Asc(${encodeCore(expr.expr, ctx)},${encodeTypeExpr(expr.typeExpr, ctx)})`;

    case "DSLForm": {
      const formRef = ctx.resolveGlobal(expr.name) ?? `FORM(${JSON.stringify(expr.name)})`;
      const children = [...expr.children]
        .sort((a, b) => compareStrings(a.slotName, b.slotName))
        .map((c) => `${JSON.stringify(c.slotName)}:${encodeCore(c.expr, ctx)}`);
      const raw = expr.rawExpr ? canonicalizeSExpr(expr.rawExpr, ctx.resolveGlobal) : "";
      return `DSL(${formRef},[${children.join(",")}],${raw})`;
    }

    case "TypeDef": {
      const localCtx: EncodeContext = {
        locals: ctx.locals,
        typeParams: new Map(),
        resolveGlobal: ctx.resolveGlobal,
      };
      if (expr.typeParams) {
        for (const tp of expr.typeParams) {
          localCtx.typeParams.set(tp, `TP${localCtx.typeParams.size}`);
        }
      }
      const typeEnc = expr.typeExpr ? encodeTypeExpr(expr.typeExpr, localCtx) : "";
      const ctors = expr.constructors
        ? [...expr.constructors]
            .sort((a, b) => compareStrings(a.name, b.name))
            .map((c) => `${JSON.stringify(c.name)}(${c.fields.map((f) => encodeTypeExpr(f, localCtx)).join(",")})`)
        : [];
      return `TypeDef(${expr.source ?? "type"},${expr.typeParams?.length ?? 0},${expr.tagField ?? ""},${typeEnc},[${ctors.join(",")}])`;
    }

    case "Match": {
      const scrutinee = encodeCore(expr.scrutinee, ctx);
      const arms = expr.arms.map((arm) => {
        const { encoded, boundVars } = encodePattern(arm.pattern, ctx);
        const savedLen = ctx.locals.length;
        for (const v of boundVars) ctx.locals.push(v);
        const body = encodeCore(arm.body, ctx);
        ctx.locals.length = savedLen;
        return `MArm(${encoded},${body})`;
      });
      return `Match(${scrutinee},[${arms.join(",")}])`;
    }

    case "DefClass": {
      const localCtx: EncodeContext = {
        locals: ctx.locals,
        typeParams: new Map(),
        resolveGlobal: ctx.resolveGlobal,
      };
      const params = expr.typeParams.map((tp) => {
        const mapped = `TP${localCtx.typeParams.size}`;
        localCtx.typeParams.set(tp.name, mapped);
        return `${mapped}${tp.kindAnnotation ? `:${encodeTypeExpr(tp.kindAnnotation, localCtx)}` : ""}`;
      });
      const supers = expr.supers
        .map((s) => `${s.className}(${s.args.map((a) => encodeTypeExpr(a, localCtx)).join(",")})`)
        .sort(compareStrings);
      const methods = [...expr.methods]
        .sort((a, b) => compareStrings(a.name, b.name))
        .map((m) => `${JSON.stringify(m.name)}:${encodeTypeExpr(m.typeExpr, localCtx)}`);
      return `Class([${params.join(",")}],[${supers.join(",")}],[${methods.join(",")}])`;
    }

    case "Instance": {
      const localCtx: EncodeContext = {
        locals: ctx.locals,
        typeParams: new Map(),
        resolveGlobal: ctx.resolveGlobal,
      };
      const classRef = ctx.resolveGlobal(expr.className) ?? `CLS(${JSON.stringify(expr.className)})`;
      const typeArgs = expr.typeArgs.map((a) => encodeTypeExpr(a, localCtx));
      const constraints = expr.constraints
        .map((c) => `${c.className}(${c.args.map((a) => encodeTypeExpr(a, localCtx)).join(",")})`)
        .sort(compareStrings);
      const methods = [...expr.methods]
        .sort((a, b) => compareStrings(a.name, b.name))
        .map((m) => `${JSON.stringify(m.name)}:${encodeCore(m.expr, ctx)}`);
      return `Inst(${classRef},[${typeArgs.join(",")}],[${constraints.join(",")}],[${methods.join(",")}])`;
    }

    case "DefService": {
      const methods = [...expr.methods]
        .sort((a, b) => compareStrings(a.name, b.name))
        .map((m) => {
          const localCtx: EncodeContext = {
            locals: ctx.locals,
            typeParams: new Map(),
            resolveGlobal: ctx.resolveGlobal,
          };
          return `${JSON.stringify(m.name)}:${encodeTypeExpr(m.typeExpr, localCtx)}`;
        });
      return `Service([${methods.join(",")}])`;
    }

    case "DefLayer": {
      const sig = expr.signature ? encodeTypeExpr(expr.signature, ctx) : "";
      if (expr.body.kind === "compose") {
        return `Layer(compose,${sig},${encodeCore(expr.body.expr, ctx)})`;
      }
      const svcRef = ctx.resolveGlobal(expr.body.service) ?? `SVC(${JSON.stringify(expr.body.service)})`;
      const savedLen = ctx.locals.length;
      const setup = expr.body.setup.map((step) => {
        const enc = encodeCore(step.binding.expr, ctx);
        ctx.locals.push(step.binding.name);
        return `${step.kind}:${enc}`;
      });
      const methods = [...expr.body.methods]
        .sort((a, b) => compareStrings(a.name, b.name))
        .map((m) => {
          const mSaved = ctx.locals.length;
          for (const p of m.params ?? []) ctx.locals.push(p.name);
          const body = encodeCore(m.body, ctx);
          ctx.locals.length = mSaved;
          return `${JSON.stringify(m.name)}(${m.params?.length ?? 0}):${body}`;
        });
      ctx.locals.length = savedLen;
      return `Layer(provide,${sig},${svcRef},[${setup.join(",")}],[${methods.join(",")}])`;
    }
  }
}

// ---------------------------------------------------------------------------
// Free reference collection (for dependency graph & SCC detection)
// ---------------------------------------------------------------------------

/** Collect all free symbol names referenced by a `CoreExpr` (excluding locally bound variables). */
export function collectFreeRefsCoreExpr(expr: CoreExpr, out: Set<string> = new Set()): Set<string> {
  const locals: string[] = [];

  const visitTypeExpr = (te: TypeExpr): void => {
    switch (te._tag) {
      case "TESym":
        if (!/^[a-z][A-Za-z0-9_']*$/.test(te.name)) out.add(te.name);
        return;
      case "TEFun":
        for (const p of te.params) visitTypeExpr(p);
        visitTypeExpr(te.ret);
        return;
      case "TEApp":
        visitTypeExpr(te.con);
        for (const a of te.args) visitTypeExpr(a);
        return;
      case "TERow":
        for (const f of te.fields) visitTypeExpr(f.type);
        return;
      case "TERowOp":
        for (const o of te.operands) visitTypeExpr(o);
        return;
    }
  };

  const visit = (node: CoreExpr): void => {
    switch (node._tag) {
      case "Lit":
        return;
      case "Var":
        if (lookupLocal(locals, node.name) < 0) {
          out.add(node.name);
        }
        return;
      case "Lam": {
        const saved = locals.length;
        for (const p of node.params) locals.push(p.name);
        if (node.restParam) locals.push(node.restParam.name);
        visit(node.body);
        locals.length = saved;
        return;
      }
      case "App":
        visit(node.fn);
        for (const a of node.args) visit(a);
        return;
      case "Let":
      case "EffectDo": {
        const saved = locals.length;
        for (const b of node.bindings) {
          visit(b.expr);
          locals.push(b.name);
        }
        visit(node.body);
        locals.length = saved;
        return;
      }
      case "EffectFail":
        out.add(node.errorName);
        visit(node.payload);
        return;
      case "EffectCatch":
        visit(node.body);
        for (const arm of node.arms) {
          if (arm.errorName !== "_") out.add(arm.errorName);
          const saved = locals.length;
          locals.push(arm.binding.name);
          visit(arm.handler);
          locals.length = saved;
        }
        return;
      case "If":
        visit(node.cond);
        visit(node.then);
        visit(node.else_);
        return;
      case "Record":
        for (const f of node.fields) visit(f.value);
        return;
      case "Get":
        visit(node.record);
        if (node.key) visit(node.key);
        return;
      case "Def":
        if (node.signature) visitTypeExpr(node.signature);
        visit(node.expr);
        return;
      case "Ascribe":
        visit(node.expr);
        visitTypeExpr(node.typeExpr);
        return;
      case "DSLForm":
        out.add(node.name);
        for (const c of node.children) visit(c.expr);
        if (node.rawExpr) collectRefsSExpr(node.rawExpr, out);
        return;
      case "TypeDef":
        if (node.typeExpr) visitTypeExpr(node.typeExpr);
        if (node.constructors) {
          for (const c of node.constructors) {
            for (const f of c.fields) visitTypeExpr(f);
          }
        }
        return;
      case "Match":
        visit(node.scrutinee);
        for (const arm of node.arms) {
          if (arm.pattern._tag === "PCon") out.add(arm.pattern.name);
          const saved = locals.length;
          if (arm.pattern._tag === "PCon") {
            for (const v of arm.pattern.vars) locals.push(v);
          }
          visit(arm.body);
          locals.length = saved;
        }
        return;
      case "DefClass":
        for (const s of node.supers) {
          out.add(s.className);
          for (const a of s.args) visitTypeExpr(a);
        }
        for (const m of node.methods) visitTypeExpr(m.typeExpr);
        return;
      case "Instance":
        out.add(node.className);
        for (const a of node.typeArgs) visitTypeExpr(a);
        for (const c of node.constraints) {
          out.add(c.className);
          for (const a of c.args) visitTypeExpr(a);
        }
        for (const m of node.methods) visit(m.expr);
        return;
      case "DefService":
        for (const m of node.methods) visitTypeExpr(m.typeExpr);
        return;
      case "DefLayer":
        if (node.signature) visitTypeExpr(node.signature);
        if (node.body.kind === "compose") {
          visit(node.body.expr);
        } else {
          out.add(node.body.service);
          const saved = locals.length;
          for (const step of node.body.setup) {
            visit(step.binding.expr);
            locals.push(step.binding.name);
          }
          for (const m of node.body.methods) {
            const mSaved = locals.length;
            for (const p of m.params ?? []) locals.push(p.name);
            visit(m.body);
            locals.length = mSaved;
          }
          locals.length = saved;
        }
        return;
    }
  };

  visit(expr);
  return out;
}

function extractEffectsFromSExpr(expr: SExpr): {
  readonly requirements: readonly string[];
  readonly errors: readonly string[];
} {
  const requirements = new Set<string>();
  const errors = new Set<string>();

  const visit = (node: SExpr): void => {
    switch (node._tag) {
      case "Sym":
        if (/^[A-Z][A-Za-z0-9_-]*\.[a-z][A-Za-z0-9_?-]*$/.test(node.name)) {
          requirements.add(node.name);
        }
        return;
      case "List": {
        if (
          node.items[0]?._tag === "Sym" &&
          node.items[0].name === "fail" &&
          node.items[1]?._tag === "List" &&
          node.items[1].items[0]?._tag === "Sym"
        ) {
          errors.add(node.items[1].items[0].name);
        }
        for (const item of node.items) visit(item);
        return;
      }
      case "Vector":
      case "Set":
        for (const item of node.items) visit(item);
        return;
      case "Map":
        for (const [k, v] of node.pairs) {
          visit(k);
          visit(v);
        }
        return;
      default:
        return;
    }
  };

  visit(expr);
  return {
    requirements: [...requirements].sort(compareStrings),
    errors: [...errors].sort(compareStrings),
  };
}

function collectRefsSExpr(expr: SExpr, out: Set<string>): void {
  switch (expr._tag) {
    case "Sym":
      if (!expr.name.startsWith(":")) out.add(expr.name);
      return;
    case "List":
      for (const item of stripPresentationOptions(expr.items)) collectRefsSExpr(item, out);
      return;
    case "Vector":
    case "Set":
      for (const item of expr.items) collectRefsSExpr(item, out);
      return;
    case "Map":
      for (const [k, v] of expr.pairs) {
        if (k._tag === "Sym" && PRESENTATION_METADATA_KEYS.has(k.name)) continue;
        collectRefsSExpr(k, out);
        collectRefsSExpr(v, out);
      }
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// Tarjan's Strongly Connected Components (dependency-first topological order)
// ---------------------------------------------------------------------------

/**
 * Compute strongly connected components of a directed graph using Tarjan's algorithm.
 * Returns components in dependency-first topological order: if A depends on B,
 * B's SCC appears before A's SCC.
 */
export function computeSccs(
  nodes: readonly string[],
  edges: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongConnect = (v: string): void => {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = [...(edges.get(v) ?? [])].sort(compareStrings);
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  };

  for (const node of [...nodes].sort(compareStrings)) {
    if (!indices.has(node)) {
      strongConnect(node);
    }
  }

  return sccs;
}

// ---------------------------------------------------------------------------
// Definition Group Hashing (with SCC canonicalization & opaque boundaries)
// ---------------------------------------------------------------------------

export interface DefinitionHashInput {
  readonly qualifiedName: string;
  readonly name: string;
  readonly moduleId: string;
  readonly kind: StoreDefinitionKind;
  readonly coreExpr?: CoreExpr | undefined;
  readonly rawExpr?: SExpr | undefined;
  readonly scheme?: Scheme | undefined;
  readonly signature?: string | undefined;
  readonly requirements?: readonly string[] | undefined;
  readonly errors?: readonly string[] | undefined;
  /** Qualified names of macros or `form` descriptors that participated in expanding/elaborating this definition. */
  readonly formDependencyNames?: readonly string[] | undefined;
  /** Map a symbol appearing inside this definition to the `qualifiedName` of another definition in the group (or an already-hashed `DefHash`). */
  readonly resolveReference?: ((symbolName: string) => string | undefined) | undefined;
  readonly meta: PresentationMeta;
}

export interface HashDefinitionsOptions {
  readonly languageProfile?: string | undefined;
  /** Already-hashed definitions outside this group (`qualifiedName` -> `DefHash`). */
  readonly externalHashes?: ReadonlyMap<string, DefHash> | undefined;
  /** Pinned opaque boundaries (`symbolName` -> `OpaqueBoundaryRef`). */
  readonly opaqueBoundaries?: ReadonlyMap<string, OpaqueBoundaryRef> | undefined;
}

function encodeOpaqueRef(ref: OpaqueBoundaryRef): string {
  return `OPAQUE(${ref.kind},${JSON.stringify(ref.name)},${JSON.stringify(ref.signature)},${JSON.stringify(ref.runtimeDigest)})`;
}

function computeCanonicalPayload(params: {
  readonly kind: StoreDefinitionKind;
  readonly body: string;
  readonly canonicalSignature?: string | undefined;
  readonly languageProfile: string;
  readonly formDependencies: readonly DefHash[];
  readonly opaqueRefs: readonly OpaqueBoundaryRef[];
}): string {
  const payload: Record<string, JsonValue> = {
    version: DEF_HASH_VERSION,
    kind: params.kind,
    languageProfile: params.languageProfile,
    body: params.body,
    canonicalSignature: params.canonicalSignature ?? null,
    formDependencies: [...params.formDependencies],
    opaqueRefs: params.opaqueRefs.map((o) => ({
      kind: o.kind,
      name: o.name,
      signature: o.signature,
      runtimeDigest: o.runtimeDigest,
    })),
  };
  return canonicalJson(payload);
}

/**
 * Hash a group of definitions into immutable `DefinitionRecord`s.
 *
 * Handles:
 * - Topological dependency ordering via Tarjan's SCCs
 * - Cross-definition `DefHash` substitution
 * - Mutually recursive & self-recursive SCC canonicalization (`sccHash` + deterministic `memberIndex`)
 * - Pinned opaque external/builtin boundaries
 * - Presentation metadata exclusion
 */
export function hashDefinitionGroup(
  inputs: readonly DefinitionHashInput[],
  options: HashDefinitionsOptions = {},
): readonly DefinitionRecord[] {
  const languageProfile = options.languageProfile ?? DEFAULT_LANGUAGE_PROFILE;
  const externalHashes = options.externalHashes ?? new Map<string, DefHash>();
  const opaqueBoundaries = options.opaqueBoundaries ?? new Map<string, OpaqueBoundaryRef>();

  const byQualified = new Map<string, DefinitionHashInput>();
  for (const input of inputs) {
    byQualified.set(input.qualifiedName, input);
  }

  // Build intra-group dependency graph
  const edges = new Map<string, Set<string>>();
  for (const input of inputs) {
    const deps = new Set<string>();
    const rawRefs = new Set<string>();
    if (input.coreExpr) {
      collectFreeRefsCoreExpr(input.coreExpr, rawRefs);
    } else if (input.rawExpr) {
      collectRefsSExpr(input.rawExpr, rawRefs);
    }
    for (const sym of rawRefs) {
      const target = input.resolveReference?.(sym);
      if (target && byQualified.has(target)) {
        deps.add(target);
      }
      // Also support dotted Service.method referencing Service
      const dot = sym.indexOf(".");
      if (dot > 0) {
        const baseTarget = input.resolveReference?.(sym.slice(0, dot));
        if (baseTarget && byQualified.has(baseTarget)) {
          deps.add(baseTarget);
        }
      }
    }
    for (const formDep of input.formDependencyNames ?? []) {
      if (byQualified.has(formDep)) deps.add(formDep);
    }
    edges.set(input.qualifiedName, deps);
  }

  const sccs = computeSccs(
    inputs.map((i) => i.qualifiedName),
    edges,
  );

  const resolvedHashes = new Map<string, DefHash>(externalHashes);
  const records: DefinitionRecord[] = [];

  for (const sccNames of sccs) {
    const isSingle = sccNames.length === 1;
    const singleName = sccNames[0]!;
    const isSelfRecursive = isSingle && (edges.get(singleName)?.has(singleName) ?? false);
    const isCyclic = !isSingle || isSelfRecursive;

    const encodeMember = (
      input: DefinitionHashInput,
      sccSlotLookup: (targetQualified: string) => string | undefined,
    ): {
      readonly body: string;
      readonly canonicalSignature: string | undefined;
      readonly signature: string | undefined;
      readonly requirements: readonly string[];
      readonly errors: readonly string[];
      readonly dependencies: readonly DefHash[];
      readonly formDependencies: readonly DefHash[];
      readonly opaqueRefs: readonly OpaqueBoundaryRef[];
    } => {
      const depHashes = new Set<DefHash>();
      const formDepHashes = new Set<DefHash>();
      const usedOpaque = new Map<string, OpaqueBoundaryRef>();

      for (const fd of input.formDependencyNames ?? []) {
        const h = resolvedHashes.get(fd);
        if (h) {
          formDepHashes.add(h);
          depHashes.add(h);
        }
      }

      const resolveGlobal = (sym: string): string | undefined => {
        const opaque = opaqueBoundaries.get(sym);
        if (opaque) {
          usedOpaque.set(opaque.name, opaque);
          return encodeOpaqueRef(opaque);
        }

        const target = input.resolveReference?.(sym);
        if (target) {
          const sccTag = sccSlotLookup(target);
          if (sccTag !== undefined) return sccTag;
          const h = resolvedHashes.get(target);
          if (h) {
            depHashes.add(h);
            return `REF(${h})`;
          }
          // If target itself is already a DefHash
          if (target.startsWith(`${DEF_HASH_VERSION}:`)) {
            depHashes.add(target);
            return `REF(${target})`;
          }
        }

        // Dotted `Service.method` reference: link dependency to `Service` if resolved
        const dot = sym.indexOf(".");
        if (dot > 0) {
          const prefix = sym.slice(0, dot);
          const suffix = sym.slice(dot + 1);
          const baseOpaque = opaqueBoundaries.get(prefix);
          if (baseOpaque) {
            usedOpaque.set(baseOpaque.name, baseOpaque);
            return `DOT(${encodeOpaqueRef(baseOpaque)},${JSON.stringify(suffix)})`;
          }
          const baseTarget = input.resolveReference?.(prefix);
          if (baseTarget) {
            const sccTag = sccSlotLookup(baseTarget);
            if (sccTag !== undefined) return `DOT(${sccTag},${JSON.stringify(suffix)})`;
            const h = resolvedHashes.get(baseTarget);
            if (h) {
              depHashes.add(h);
              return `DOT(REF(${h}),${JSON.stringify(suffix)})`;
            }
          }
        }

        return undefined;
      };

      const body = input.coreExpr
        ? canonicalizeCoreExpr(input.coreExpr, resolveGlobal)
        : input.rawExpr
          ? canonicalizeSExpr(input.rawExpr, resolveGlobal)
          : `EMPTY(${input.kind})`;

      const canonicalSignature = input.scheme
        ? canonicalizeScheme(input.scheme)
        : input.signature;
      const signature = input.signature ?? (input.scheme ? formatSchemeSignature(input.scheme) : undefined);

      const schemeEffects = input.scheme ? extractEffectsFromScheme(input.scheme) : undefined;
      const coreEffects = input.coreExpr
        ? extractEffectsFromCoreExpr(input.coreExpr)
        : input.rawExpr
          ? extractEffectsFromSExpr(input.rawExpr)
          : undefined;

      const reqSet = new Set<string>([
        ...(input.requirements ?? []),
        ...(schemeEffects?.requirements ?? []),
        ...(coreEffects?.requirements ?? []),
      ]);
      // A `service` declaration defines its own capability rather than requiring it;
      // the HM environment attaches the service's own capability label to its provided methods.
      if (input.kind === "service") {
        const selfPrefix = `${input.name}.`;
        for (const req of [...reqSet]) {
          if (req === input.name || req.startsWith(selfPrefix)) {
            reqSet.delete(req);
          }
        }
      }
      const errSet = new Set<string>([
        ...(input.errors ?? []),
        ...(schemeEffects?.errors ?? []),
        ...(coreEffects?.errors ?? []),
      ]);

      const sortedOpaque = [...usedOpaque.values()].sort((a, b) => compareStrings(a.name, b.name));

      return {
        body,
        canonicalSignature,
        signature,
        requirements: [...reqSet].sort(compareStrings),
        errors: [...errSet].sort(compareStrings),
        dependencies: [...depHashes].sort(compareStrings),
        formDependencies: [...formDepHashes].sort(compareStrings),
        opaqueRefs: sortedOpaque,
      };
    };

    if (!isCyclic) {
      const input = byQualified.get(singleName)!;
      const encoded = encodeMember(input, () => undefined);
      const canonicalForm = computeCanonicalPayload({
        kind: input.kind,
        body: encoded.body,
        canonicalSignature: encoded.canonicalSignature,
        languageProfile,
        formDependencies: encoded.formDependencies,
        opaqueRefs: encoded.opaqueRefs,
      });
      const hash: DefHash = `${DEF_HASH_VERSION}:${sha256(canonicalForm)}`;
      resolvedHashes.set(input.qualifiedName, hash);

      records.push({
        hash,
        kind: input.kind,
        canonicalForm,
        qualifiedName: input.qualifiedName,
        name: input.name,
        moduleId: input.moduleId,
        signature: encoded.signature,
        canonicalSignature: encoded.canonicalSignature,
        requirements: encoded.requirements,
        errors: encoded.errors,
        languageProfile,
        dependencies: encoded.dependencies,
        formDependencies: encoded.formDependencies,
        opaqueRefs: encoded.opaqueRefs,
        meta: input.meta,
      });
      continue;
    }

    // Cyclic SCC (self-recursive or mutually recursive):
    // Step 1: Compute name-independent structural fingerprints for symmetry breaking.
    const sccSet = new Set(sccNames);
    const fingerprints = sccNames.map((qName) => {
      const input = byQualified.get(qName)!;
      const fpEncoded = encodeMember(input, (target) => {
        if (!sccSet.has(target)) return undefined;
        return target === qName ? "SCC_SELF" : "SCC_PEER";
      });
      const fp = computeCanonicalPayload({
        kind: input.kind,
        body: fpEncoded.body,
        canonicalSignature: fpEncoded.canonicalSignature,
        languageProfile,
        formDependencies: fpEncoded.formDependencies,
        opaqueRefs: fpEncoded.opaqueRefs,
      });
      return { qName, fp };
    });

    // Sort canonically by structural fingerprint, tie-breaking by qualifiedName only for exact automorphisms.
    fingerprints.sort((a, b) => compareStrings(a.fp, b.fp) || compareStrings(a.qName, b.qName));

    const memberIndexByQualified = new Map<string, number>();
    fingerprints.forEach((entry, idx) => memberIndexByQualified.set(entry.qName, idx));

    // Step 2: Re-encode each member with deterministic `SCC_MEMBER(idx)` slots.
    const memberResults = fingerprints.map(({ qName }) => {
      const input = byQualified.get(qName)!;
      const encoded = encodeMember(input, (target) => {
        const idx = memberIndexByQualified.get(target);
        return idx !== undefined ? `SCC_MEMBER(${idx})` : undefined;
      });
      const canonicalForm = computeCanonicalPayload({
        kind: input.kind,
        body: encoded.body,
        canonicalSignature: encoded.canonicalSignature,
        languageProfile,
        formDependencies: encoded.formDependencies,
        opaqueRefs: encoded.opaqueRefs,
      });
      return { input, encoded, canonicalForm };
    });

    // Step 3: Compute `sccHash` over the canonically ordered member payloads.
    const sccPayload = canonicalJson({
      version: SCC_HASH_VERSION,
      languageProfile,
      members: memberResults.map((m) => m.canonicalForm),
    });
    const sccHash: SccHash = `${SCC_HASH_VERSION}:${sha256(sccPayload)}`;

    // Step 4: Derive deterministic per-member `DefHash` from `(sccHash, memberIndex)`.
    const memberHashes: DefHash[] = memberResults.map((_, idx) => {
      const memberIdentity = canonicalJson({
        version: DEF_HASH_VERSION,
        sccHash,
        memberIndex: idx,
      });
      return `${DEF_HASH_VERSION}:${sha256(memberIdentity)}`;
    });

    memberResults.forEach((m, idx) => {
      resolvedHashes.set(m.input.qualifiedName, memberHashes[idx]!);
    });

    // Step 5: Emit records, including intra-SCC peer dependencies in `dependencies`.
    memberResults.forEach(({ input, encoded, canonicalForm }, idx) => {
      const hash = memberHashes[idx]!;
      const depSet = new Set<DefHash>(encoded.dependencies);
      for (const peerQualified of edges.get(input.qualifiedName) ?? []) {
        const peerHash = resolvedHashes.get(peerQualified);
        if (peerHash && peerHash !== hash) {
          depSet.add(peerHash);
        }
      }
      const scc: SccMembership = {
        sccHash,
        memberIndex: idx,
        memberCount: memberResults.length,
      };
      records.push({
        hash,
        kind: input.kind,
        canonicalForm,
        qualifiedName: input.qualifiedName,
        name: input.name,
        moduleId: input.moduleId,
        signature: encoded.signature,
        canonicalSignature: encoded.canonicalSignature,
        requirements: encoded.requirements,
        errors: encoded.errors,
        languageProfile,
        dependencies: [...depSet].sort(compareStrings),
        formDependencies: encoded.formDependencies,
        opaqueRefs: encoded.opaqueRefs,
        scc,
        meta: input.meta,
      });
    });
  }

  return records;
}

/**
 * Convenience helper to hash a single standalone definition.
 */
export function hashSingleDefinition(
  input: DefinitionHashInput,
  options: HashDefinitionsOptions = {},
): DefinitionRecord {
  return hashDefinitionGroup([input], options)[0]!;
}
