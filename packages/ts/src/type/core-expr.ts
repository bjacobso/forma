/**
 * CoreExpr — typed AST for Hindley-Milner inference.
 *
 * Every node carries a stable `id` and `span` so diagnostics and the
 * NodeTypeMap can point at exact source locations.
 *
 * The Lisp parser produces SExpr; a lowering pass (`lower.ts`) converts
 * SExpr → CoreExpr before inference runs.
 */

import type { SExpr } from "../reader/types.js";
import type { Type } from "./types.js";
import type { MacroOrigin } from "../evaluator/source-trace.js";

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

let _nodeIdCounter = 0;

export function resetNodeIds(): void {
  _nodeIdCounter = 0;
}

export function freshNodeId(): string {
  return `n${_nodeIdCounter++}`;
}

// ---------------------------------------------------------------------------
// Span
// ---------------------------------------------------------------------------

export interface Span {
  readonly start: number;
  readonly end: number;
  readonly macroOrigins?: readonly MacroOrigin[];
}

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

export type Lit =
  | { readonly _tag: "LInt"; readonly value: number }
  | { readonly _tag: "LFloat"; readonly value: number }
  | { readonly _tag: "LString"; readonly value: string }
  | { readonly _tag: "LBool"; readonly value: boolean }
  | { readonly _tag: "LKeyword"; readonly value: string }
  | { readonly _tag: "LSymbol"; readonly value: string }
  | { readonly _tag: "LQuoted"; readonly value: SExpr }
  | { readonly _tag: "LNil" };

export const LFloat = (value: number): Lit => ({ _tag: "LFloat", value });
export const LInt = (value: number): Lit => ({ _tag: "LInt", value });
export const LString = (value: string): Lit => ({ _tag: "LString", value });
export const LBool = (value: boolean): Lit => ({ _tag: "LBool", value });
export const LKeyword = (value: string): Lit => ({ _tag: "LKeyword", value });
export const LSymbol = (value: string): Lit => ({ _tag: "LSymbol", value });
export const LNil: Lit = { _tag: "LNil" };

// ---------------------------------------------------------------------------
// Parameters and Bindings
// ---------------------------------------------------------------------------

export interface Param {
  readonly id: string;
  readonly span: Span;
  readonly name: string;
}

export interface Binding {
  readonly id: string;
  readonly span: Span;
  readonly name: string;
  readonly expr: CoreExpr;
}

export interface RecordField {
  readonly id: string;
  readonly span: Span;
  readonly label: string;
  readonly value: CoreExpr;
}

// ---------------------------------------------------------------------------
// Type Expressions (parsed type syntax)
// ---------------------------------------------------------------------------

/** Type expression AST — parsed from source, converted to Type during inference */
export type TypeExpr = TESym | TEFun | TEApp | TERow | TERowOp;

/** Type symbol: Num, Str, Bool, or type variable (lowercase) */
export interface TESym {
  readonly _tag: "TESym";
  readonly span: Span;
  readonly name: string;
}

/** Function type: (-> A B C) means A -> B -> C. */
export interface TEFun {
  readonly _tag: "TEFun";
  readonly span: Span;
  readonly params: readonly TypeExpr[];
  readonly ret: TypeExpr;
}

/** Type application: (List Num), (Map Str Num) */
export interface TEApp {
  readonly _tag: "TEApp";
  readonly span: Span;
  readonly con: TypeExpr;
  readonly args: readonly TypeExpr[];
}

/** Row type: {:name Str :age Num} or {:name Str | r} */
export interface TERow {
  readonly _tag: "TERow";
  readonly span: Span;
  readonly fields: readonly { label: string; type: TypeExpr }[];
  readonly tail?: string | undefined; // row variable name, if open
}

/** Built-in row computation; field names are syntax, never value expressions. */
export interface TERowOp {
  readonly _tag: "TERowOp";
  readonly span: Span;
  readonly op: "Pick" | "Omit" | "Merge";
  readonly operands: readonly TypeExpr[];
  readonly keys: readonly { readonly label: string; readonly span: Span }[];
}

// TypeExpr constructors
export const TESym = (span: Span, name: string): TESym => ({ _tag: "TESym", span, name });
export const TEFun = (span: Span, params: readonly TypeExpr[], ret: TypeExpr): TEFun => ({
  _tag: "TEFun",
  span,
  params,
  ret,
});
export const TEApp = (span: Span, con: TypeExpr, args: readonly TypeExpr[]): TEApp => ({
  _tag: "TEApp",
  span,
  con,
  args,
});
export const TERow = (
  span: Span,
  fields: readonly { label: string; type: TypeExpr }[],
  tail?: string,
): TERow => ({ _tag: "TERow", span, fields, tail });

// ---------------------------------------------------------------------------
// CoreExpr
// ---------------------------------------------------------------------------

export type CoreExpr =
  | CLit
  | CVar
  | CLam
  | CApp
  | CLet
  | CEffectDo
  | CEffectFail
  | CEffectCatch
  | CIf
  | CRecord
  | CGet
  | CDef
  | CAscribe
  | CDSLForm
  | CTypeDef
  | CMatch
  | CDefClass
  | CInstance
  | CDefService;

export interface CLit {
  readonly _tag: "Lit";
  readonly id: string;
  readonly span: Span;
  readonly lit: Lit;
}

export interface CVar {
  readonly _tag: "Var";
  readonly id: string;
  readonly span: Span;
  readonly name: string;
}

export interface CLam {
  readonly _tag: "Lam";
  readonly id: string;
  readonly span: Span;
  readonly params: readonly Param[];
  readonly restParam?: Param | undefined;
  readonly body: CoreExpr;
}

export interface CApp {
  readonly _tag: "App";
  readonly id: string;
  readonly span: Span;
  readonly fn: CoreExpr;
  readonly args: readonly CoreExpr[];
}

export interface CLet {
  readonly _tag: "Let";
  readonly id: string;
  readonly span: Span;
  readonly bindings: readonly Binding[];
  readonly body: CoreExpr;
}

export interface CEffectDo {
  readonly _tag: "EffectDo";
  readonly id: string;
  readonly span: Span;
  readonly bindings: readonly Binding[];
  readonly body: CoreExpr;
}

/** A typed failure value: (fail (ErrorName payload)). */
export interface CEffectFail {
  readonly _tag: "EffectFail";
  readonly id: string;
  readonly span: Span;
  readonly errorName: string;
  readonly payload: CoreExpr;
}

/** Recover one typed error: (catch effect (ErrorName binding) handler). */
export interface CEffectCatch {
  readonly _tag: "EffectCatch";
  readonly id: string;
  readonly span: Span;
  readonly body: CoreExpr;
  readonly errorName: string;
  readonly binding: Param;
  readonly handler: CoreExpr;
}

export interface CIf {
  readonly _tag: "If";
  readonly id: string;
  readonly span: Span;
  readonly cond: CoreExpr;
  readonly then: CoreExpr;
  readonly else_: CoreExpr;
}

export interface CRecord {
  readonly _tag: "Record";
  readonly id: string;
  readonly span: Span;
  readonly fields: readonly RecordField[];
}

export interface CGet {
  readonly _tag: "Get";
  readonly id: string;
  readonly span: Span;
  readonly record: CoreExpr;
  readonly label: string;
  readonly key?: CoreExpr;
}

export interface CDef {
  readonly _tag: "Def";
  readonly id: string;
  readonly span: Span;
  readonly name: string;
  readonly expr: CoreExpr;
  readonly signature?: TypeExpr | undefined;
}

/** Type ascription: (: expr Type) */
export interface CAscribe {
  readonly _tag: "Ascribe";
  readonly id: string;
  readonly span: Span;
  readonly expr: CoreExpr;
  readonly typeExpr: TypeExpr;
}

/**
 * DSL form: a form recognized by a DSL handler (e.g., entity-type, action, query).
 *
 * The lowerer produces this node when it encounters a list whose head symbol
 * matches a registered DSL form name. The inferrer delegates to a DSLTypeProvider
 * to determine the result type and to type-check sub-expressions (children).
 */
export interface CDSLForm {
  readonly rawExpr?: import("../reader/types.js").SExpr;
  readonly _tag: "DSLForm";
  readonly id: string;
  readonly span: Span;
  /** The form name (e.g., "entity-type", "action", "query") */
  readonly name: string;
  /** Sub-expressions that should be type-checked via HM inference */
  readonly children: readonly DSLFormChild[];
}

/**
 * Type alias definition: (__sum-type Name TypeExpr)
 *
 * Registers a named alias that can be used in type annotations.
 * The alias is expanded during type expression resolution.
 */
export interface CTypeDef {
  readonly _tag: "TypeDef";
  readonly id: string;
  readonly span: Span;
  readonly name: string;
  readonly typeExpr?: TypeExpr | undefined;
  readonly source?: "type" | "schema" | "error" | "class" | "form" | undefined;
  /** Type parameters for ADTs (e.g., ["a"] for Option) */
  readonly typeParams?: readonly string[] | undefined;
  /** Constructor definitions for ADTs */
  readonly constructors?: readonly ADTConstructor[] | undefined;
}

export interface ADTConstructor {
  readonly name: string;
  readonly fields: readonly TypeExpr[];
}

/**
 * Pattern match expression: (match scrutinee (Pat1 vars) body1 (Pat2 vars) body2 ...)
 */
export interface CMatch {
  readonly _tag: "Match";
  readonly id: string;
  readonly span: Span;
  readonly scrutinee: CoreExpr;
  readonly arms: readonly MatchArm[];
}

export interface MatchArm {
  readonly pattern: Pattern;
  readonly body: CoreExpr;
}

export type Pattern =
  | { readonly _tag: "PCon"; readonly name: string; readonly vars: readonly string[] }
  | { readonly _tag: "PWild" }
  | { readonly _tag: "PData"; readonly syntax: import("../reader/types.js").SExpr };

// ---------------------------------------------------------------------------
// Type Classes
// ---------------------------------------------------------------------------

/** Type class definition: (__typeclass (ClassName params...) (method-name type) ...) */
export interface CDefClass {
  readonly _tag: "DefClass";
  readonly id: string;
  readonly span: Span;
  readonly name: string;
  /** Type parameters with optional kind annotations */
  readonly typeParams: readonly ClassTypeParam[];
  /** Super class constraints */
  readonly supers: readonly ClassConstraint[];
  /** Method declarations: name and type expression */
  readonly methods: readonly ClassMethod[];
}

export interface ClassTypeParam {
  readonly name: string;
  readonly kindAnnotation?: TypeExpr | undefined;
}

export interface ClassConstraint {
  readonly className: string;
  readonly args: readonly TypeExpr[];
}

export interface ClassMethod {
  readonly name: string;
  readonly typeExpr: TypeExpr;
}

/** Type class instance: (instance (ClassName Type...) (define method expr) ...) */
export interface CInstance {
  readonly _tag: "Instance";
  readonly id: string;
  readonly span: Span;
  readonly className: string;
  readonly typeArgs: readonly TypeExpr[];
  /** Instance constraints (e.g., Eq a => ...) */
  readonly constraints: readonly ClassConstraint[];
  /** Method implementations */
  readonly methods: readonly InstanceMethod[];
}

export interface InstanceMethod {
  readonly name: string;
  readonly expr: CoreExpr;
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

/** Service interface definition: (__service Name (:methods ...)) */
export interface CDefService {
  readonly _tag: "DefService";
  readonly id: string;
  readonly span: Span;
  readonly name: string;
  /** Methods are registered as dotted symbols such as Service.method. */
  readonly methods: readonly ServiceMethod[];
}

export interface ServiceMethod {
  readonly name: string;
  readonly typeExpr: TypeExpr;
}

/**
 * A child expression within a DSL form that should be type-checked.
 * Corresponds to a slot with mode "immediate" or "deferred".
 */
export interface DSLFormChild {
  /** Slot name from the handler's slot definitions */
  readonly slotName: string;
  /** The lowered CoreExpr for this sub-expression */
  readonly expr: CoreExpr;
  /** Expected type from the slot definition (if declared) */
  readonly expectedType?: Type | undefined;
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export const CLit = (span: Span, lit: Lit): CLit => ({
  _tag: "Lit",
  id: freshNodeId(),
  span,
  lit,
});

export const CVar = (span: Span, name: string): CVar => ({
  _tag: "Var",
  id: freshNodeId(),
  span,
  name,
});

export const CLam = (
  span: Span,
  params: readonly Param[],
  body: CoreExpr,
  restParam?: Param,
): CLam => ({
  _tag: "Lam",
  id: freshNodeId(),
  span,
  params,
  ...(restParam ? { restParam } : {}),
  body,
});

export const CApp = (span: Span, fn: CoreExpr, args: readonly CoreExpr[]): CApp => ({
  _tag: "App",
  id: freshNodeId(),
  span,
  fn,
  args,
});

export const CLet = (span: Span, bindings: readonly Binding[], body: CoreExpr): CLet => ({
  _tag: "Let",
  id: freshNodeId(),
  span,
  bindings,
  body,
});

export const CEffectDo = (span: Span, bindings: readonly Binding[], body: CoreExpr): CEffectDo => ({
  _tag: "EffectDo",
  id: freshNodeId(),
  span,
  bindings,
  body,
});

export const CEffectFail = (
  span: Span,
  errorName: string,
  payload: CoreExpr,
): CEffectFail => ({
  _tag: "EffectFail",
  id: freshNodeId(),
  span,
  errorName,
  payload,
});

export const CEffectCatch = (
  span: Span,
  body: CoreExpr,
  errorName: string,
  binding: Param,
  handler: CoreExpr,
): CEffectCatch => ({
  _tag: "EffectCatch",
  id: freshNodeId(),
  span,
  body,
  errorName,
  binding,
  handler,
});

export const CIf = (span: Span, cond: CoreExpr, then: CoreExpr, else_: CoreExpr): CIf => ({
  _tag: "If",
  id: freshNodeId(),
  span,
  cond,
  then,
  else_,
});

export const CRecord = (span: Span, fields: readonly RecordField[]): CRecord => ({
  _tag: "Record",
  id: freshNodeId(),
  span,
  fields,
});

export const CGet = (span: Span, record: CoreExpr, label: string): CGet => ({
  _tag: "Get",
  id: freshNodeId(),
  span,
  record,
  label,
});

export const CDef = (span: Span, name: string, expr: CoreExpr, signature?: TypeExpr): CDef => ({
  _tag: "Def",
  id: freshNodeId(),
  span,
  name,
  expr,
  signature,
});

export const CAscribe = (span: Span, expr: CoreExpr, typeExpr: TypeExpr): CAscribe => ({
  _tag: "Ascribe",
  id: freshNodeId(),
  span,
  expr,
  typeExpr,
});

export const CDSLForm = (
  span: Span,
  name: string,
  children: readonly DSLFormChild[],
): CDSLForm => ({
  _tag: "DSLForm",
  id: freshNodeId(),
  span,
  name,
  children,
});

export const CTypeDef = (
  span: Span,
  name: string,
  typeExpr?: TypeExpr,
  typeParams?: readonly string[],
  constructors?: readonly ADTConstructor[],
  source?: "type" | "schema" | "error" | "class" | "form",
): CTypeDef => ({
  _tag: "TypeDef",
  id: freshNodeId(),
  span,
  name,
  typeExpr,
  typeParams,
  constructors,
  source,
});

export const CMatch = (span: Span, scrutinee: CoreExpr, arms: readonly MatchArm[]): CMatch => ({
  _tag: "Match",
  id: freshNodeId(),
  span,
  scrutinee,
  arms,
});

export const mkParam = (span: Span, name: string): Param => ({
  id: freshNodeId(),
  span,
  name,
});

export const mkBinding = (span: Span, name: string, expr: CoreExpr): Binding => ({
  id: freshNodeId(),
  span,
  name,
  expr,
});

export const mkRecordField = (span: Span, label: string, value: CoreExpr): RecordField => ({
  id: freshNodeId(),
  span,
  label,
  value,
});

export const CDefClass = (
  span: Span,
  name: string,
  typeParams: readonly ClassTypeParam[],
  supers: readonly ClassConstraint[],
  methods: readonly ClassMethod[],
): CDefClass => ({
  _tag: "DefClass",
  id: freshNodeId(),
  span,
  name,
  typeParams,
  supers,
  methods,
});

export const CInstance = (
  span: Span,
  className: string,
  typeArgs: readonly TypeExpr[],
  constraints: readonly ClassConstraint[],
  methods: readonly InstanceMethod[],
): CInstance => ({
  _tag: "Instance",
  id: freshNodeId(),
  span,
  className,
  typeArgs,
  constraints,
  methods,
});

export const CDefService = (
  span: Span,
  name: string,
  methods: readonly ServiceMethod[],
): CDefService => ({
  _tag: "DefService",
  id: freshNodeId(),
  span,
  name,
  methods,
});

// ---------------------------------------------------------------------------
// Structural combinators
// ---------------------------------------------------------------------------

/** Get the immediate child CoreExpr nodes. */
export const exprChildren = (expr: CoreExpr): readonly CoreExpr[] => {
  switch (expr._tag) {
    case "Lit":
      return [];
    case "Var":
      return [];
    case "Lam":
      return [expr.body];
    case "App":
      return [expr.fn, ...expr.args];
    case "Let":
      return [...expr.bindings.map((b) => b.expr), expr.body];
    case "EffectDo":
      return [...expr.bindings.map((b) => b.expr), expr.body];
    case "EffectFail":
      return [expr.payload];
    case "EffectCatch":
      return [expr.body, expr.handler];
    case "If":
      return [expr.cond, expr.then, expr.else_];
    case "Record":
      return expr.fields.map((f) => f.value);
    case "Get":
      return [expr.record,...(expr.key ? [expr.key] : [])];
    case "Def":
      return [expr.expr];
    case "Ascribe":
      return [expr.expr];
    case "DSLForm":
      return expr.children.map((c) => c.expr);
    case "TypeDef":
      return [];
    case "Match":
      return [expr.scrutinee, ...expr.arms.map((a) => a.body)];
    case "DefClass":
      return [];
    case "Instance":
      return expr.methods.map((m) => m.expr);
    case "DefService":
      return [];
  }
};
