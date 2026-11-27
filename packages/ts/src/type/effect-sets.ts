/**
 * Operational effect provenance sets and implicit-by-case `[e]`/`[r]` set
 * variables for the HM kernel checker (RFC 0023 stage 5).
 *
 * Mirrors the Effect checker's provenance-set model (`mechanics/types.ts` and
 * `mechanics/check.ts`):
 * - Error and requirement sets are unordered finite sets with optional author
 *   source spans (`EffectProvenance`).
 * - Set variables live under `$`-prefixed keys (`$e`, `$r`) inside a provenance
 *   set so they never collide with declared error or service names.
 * - Inside a polymorphic body, set variables are rigid opaque members; escaping
 *   an undeclared error, requirement, or set variable reports
 *   `mechanics/undeclared-error` or `mechanics/undeclared-requirement`.
 * - At a call site, set variables are instantiated fresh and solved as the
 *   union of lower bounds contributed by the arguments, excluding names already
 *   listed in the parameter's own set.
 */
import type { Span, TypeExpr } from "./core-expr.js";
import type { Type } from "./types.js";
import { TApp, TCon, TFun, TVariadic, TRow, RExtend } from "./types.js";

// ---------------------------------------------------------------------------
// Provenance sets & `$name` set-variable keys
// ---------------------------------------------------------------------------

/** Errors and requirements carry the span where they first entered a type. */
export type EffectProvenance = ReadonlyMap<string, Span | undefined>;

export type EffectSetKind = "error" | "requirement";

/** Decomposed operational `(Effect Success [Errors] [Requirements])` type. */
export interface OperationalEffect {
  readonly success: Type;
  readonly errors: EffectProvenance;
  readonly requirements: EffectProvenance;
}

export type EffectSetDiagnosticCode =
  | "mechanics/set-variable-kind"
  | "mechanics/set-variable-position"
  | "mechanics/unbound-set-variable"
  | "mechanics/undeclared-error"
  | "mechanics/undeclared-requirement";

export interface EffectSetDiagnostic {
  readonly code: EffectSetDiagnosticCode;
  readonly message: string;
  readonly span?: Span;
}

export const emptyEffectSet: EffectProvenance = new Map();

/** Implicit-by-case set variable spelling (RFC 0023 §2). */
export const SET_VARIABLE_PATTERN = /^[a-z][A-Za-z0-9_]*$/;

const RESERVED_TYPE_CONSTRUCTORS = new Set([
  "true",
  "false",
]);

/** Whether a surface symbol name spells a set variable (`[e]`, `[r1]`). */
export const isSetVariableName = (name: string): boolean =>
  SET_VARIABLE_PATTERN.test(name) && !RESERVED_TYPE_CONSTRUCTORS.has(name);

/** Whether a provenance-map key represents a set variable (`$e`, `$r`). */
export const isSetVariableKey = (key: string): boolean => key.startsWith("$");

/** Encode a surface set-variable name into its `$`-prefixed provenance key. */
export const setVariableKey = (name: string): string => (name.startsWith("$") ? name : `$${name}`);

/** Decode a `$`-prefixed provenance key back to its surface name. */
export const setVariableName = (key: string): string => (key.startsWith("$") ? key.slice(1) : key);

/** Encode an error/requirement entry name (variable -> `$name`, concrete -> `name`). */
export const effectSetEntryKey = (name: string): string =>
  isSetVariableKey(name) ? name : isSetVariableName(name) ? setVariableKey(name) : name;

/** Whether a provenance set contains at least one set variable. */
export const hasSetVariable = (set: EffectProvenance): boolean =>
  [...set.keys()].some(isSetVariableKey);

/** Build a provenance set from surface names (encoding lowercase names as `$name`). */
export function effectSetOf(names: readonly string[], span?: Span): EffectProvenance {
  const result = new Map<string, Span | undefined>();
  for (const name of names) {
    const key = effectSetEntryKey(name);
    if (!result.has(key)) result.set(key, span);
  }
  return result;
}

/** Union provenance sets, preserving the earliest span for each entry. */
export function unionEffectSets(...sets: readonly EffectProvenance[]): EffectProvenance {
  const merged = new Map<string, Span | undefined>();
  for (const set of sets) {
    for (const [key, span] of set) {
      if (!merged.has(key)) merged.set(key, span);
    }
  }
  return merged;
}

/** Re-tag every entry in a provenance set with `span` when provided. */
export function reprovenanceEffectSet(set: EffectProvenance, span: Span | undefined): EffectProvenance {
  if (span === undefined) return set;
  const updated = new Map<string, Span | undefined>();
  for (const key of set.keys()) updated.set(key, span);
  return updated;
}

/**
 * A requirement set covers a capability `Service.method` when it lists that
 * capability or the whole `Service`. Set variables match only by identity.
 */
export function coversRequirementKey(declared: EffectProvenance, requirement: string): boolean {
  if (declared.has(requirement)) return true;
  if (isSetVariableKey(requirement)) return false;
  const dot = requirement.indexOf(".");
  if (dot <= 0) return false;
  return declared.has(requirement.slice(0, dot));
}

/**
 * Whether `actual` is included in `declared`.
 *
 * When `allowVariableTarget` is false (rigid body checking), set variables are
 * opaque members matched strictly by identity. When true (call-site argument
 * compatibility), a target set containing a set variable accepts any entries
 * that will flow into that variable.
 */
export function effectSetIncluded(
  actual: EffectProvenance,
  declared: EffectProvenance,
  kind: EffectSetKind,
  allowVariableTarget = false,
): boolean {
  if (allowVariableTarget && hasSetVariable(declared)) return true;
  for (const key of actual.keys()) {
    const covered =
      kind === "requirement" ? coversRequirementKey(declared, key) : declared.has(key);
    if (!covered) return false;
  }
  return true;
}

/** Render a provenance set's entries in surface order (`$e` -> `e`). */
export function showEffectSet(set: EffectProvenance): string {
  return [...set.keys()].map((key) => (isSetVariableKey(key) ? setVariableName(key) : key)).join(" ");
}

// ---------------------------------------------------------------------------
// HM Type <-> EffectProvenance interop
// ---------------------------------------------------------------------------

/** Whether `type` is an `ErrorSet` or `RequirementSet` type constructor. */
export function isEffectSetCon(type: Type): type is Type & { readonly _tag: "TCon"; readonly name: "ErrorSet" | "RequirementSet" } {
  return type._tag === "TCon" && (type.name === "ErrorSet" || type.name === "RequirementSet");
}

/** Whether `type` is `TApp(TCon("ErrorSet" | "RequirementSet"), ...)`. */
export function isEffectSetType(type: Type): type is Type & { readonly _tag: "TApp" } {
  return type._tag === "TApp" && isEffectSetCon(type.con);
}

/** Return the set kind for an `ErrorSet` or `RequirementSet` type application. */
export function effectSetKindOf(type: Type): EffectSetKind | undefined {
  if (type._tag !== "TApp" || !isEffectSetCon(type.con)) return undefined;
  return type.con.name === "ErrorSet" ? "error" : "requirement";
}

/**
 * Convert an HM `ErrorSet` / `RequirementSet` `TApp` into an `EffectProvenance`.
 * Nested set applications (if any arise during substitution) are flattened.
 */
export function effectSetFromType(type: Type, span?: Span): EffectProvenance | undefined {
  if (!isEffectSetType(type)) return undefined;
  return effectSetFromArgs(type.args, span);
}

/** Preserves author provenance spans on `ErrorSet` / `RequirementSet` member `TCon`s. */
const entryProvenance = new WeakMap<Type, Span>();

/** Convert the argument list of an `ErrorSet` / `RequirementSet` `TApp` to `EffectProvenance`. */
export function effectSetFromArgs(args: readonly Type[], span?: Span): EffectProvenance {
  const result = new Map<string, Span | undefined>();
  const add = (entry: Type): void => {
    if (entry._tag === "TCon") {
      const key = effectSetEntryKey(entry.name);
      if (!result.has(key)) result.set(key, entryProvenance.get(entry) ?? span);
      return;
    }
    if (isEffectSetType(entry)) {
      for (const nested of entry.args) add(nested);
    }
  };
  for (const arg of args) add(arg);
  return result;
}

/** Convert an `EffectProvenance` back to an HM `ErrorSet` / `RequirementSet` `TApp`. */
export function effectSetToType(kind: EffectSetKind, set: EffectProvenance): Type {
  const conName = kind === "error" ? "ErrorSet" : "RequirementSet";
  const args: Type[] = [];
  for (const [key, span] of set) {
    const con = TCon(setVariableName(key));
    if (span) entryProvenance.set(con, span);
    args.push(con);
  }
  return TApp(TCon(conName), args);
}

/** Extract `(Effect Success [Errors] [Requirements])` parts from an HM `Type`. */
export function extractOperationalEffect(type: Type, span?: Span): OperationalEffect | undefined {
  if (type._tag !== "TApp" || type.con._tag !== "TCon" || type.con.name !== "Effect") {
    return undefined;
  }
  if (type.args.length !== 3) return undefined;
  const [success, errorType, reqType] = type.args;
  if (!success || !errorType || !reqType) return undefined;
  if (effectSetKindOf(errorType) !== "error" || effectSetKindOf(reqType) !== "requirement") {
    return undefined;
  }
  const errors = effectSetFromType(errorType, span);
  const requirements = effectSetFromType(reqType, span);
  if (!errors || !requirements) return undefined;
  return { success, errors, requirements };
}

/** Build an HM `(Effect Success [Errors] [Requirements])` `Type`. */
export function buildOperationalEffect(
  success: Type,
  errors: EffectProvenance = emptyEffectSet,
  requirements: EffectProvenance = emptyEffectSet,
): Type {
  return TApp(TCon("Effect"), [
    success,
    effectSetToType("error", errors),
    effectSetToType("requirement", requirements),
  ]);
}

/** Collect all set-variable keys (`$name`) appearing anywhere inside an HM `Type`. */
export function collectEffectSetVariables(type: Type): {
  readonly errors: Set<string>;
  readonly requirements: Set<string>;
} {
  const errors = new Set<string>();
  const requirements = new Set<string>();
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
        return;
      case "TVariadic":
        visit(t.rest);
        visit(t.res);
        return;
      case "TApp": {
        const kind = effectSetKindOf(t);
        if (kind) {
          const target = kind === "error" ? errors : requirements;
          for (const key of effectSetFromArgs(t.args).keys()) {
            if (isSetVariableKey(key)) target.add(key);
          }
          return;
        }
        visit(t.con);
        for (const arg of t.args) visit(arg);
        return;
      }
      case "TRow": {
        let cur = t.row;
        while (cur._tag === "RExtend") {
          visit(cur.type);
          cur = cur.tail;
        }
        return;
      }
    }
  };
  visit(type);
  return { errors, requirements };
}

/** Whether an HM `Type` mentions any error-set or requirement-set variable. */
export function containsEffectSetVariables(type: Type): boolean {
  const { errors, requirements } = collectEffectSetVariables(type);
  return errors.size > 0 || requirements.size > 0;
}

// ---------------------------------------------------------------------------
// Signature validation (RFC 0023 §2)
// ---------------------------------------------------------------------------

export interface ValidateEffectSignatureOptions {
  /** Known declared error names (for case-insensitive typo hints). */
  readonly knownErrors?: ReadonlySet<string>;
  /** Known declared service names (for case-insensitive typo hints). */
  readonly knownServices?: ReadonlySet<string>;
  /** Set to false for service method signatures, where set variables are disallowed. */
  readonly allowSetVariables?: boolean;
}

/**
 * Validate set-variable rules (RFC 0023 §2) on a parsed `TypeExpr` signature:
 * - Kind consistency (`mechanics/set-variable-kind`): a variable cannot be both
 *   an error set and a requirement set, or both a set variable and a type variable.
 * - Position (`mechanics/set-variable-position`): set variables cannot appear
 *   inside the parameters of a function-typed parameter (higher-rank).
 * - Binding (`mechanics/unbound-set-variable`): every set variable in the
 *   result must also appear in at least one parameter.
 */
export function validateEffectSignature(
  texpr: TypeExpr,
  options: ValidateEffectSignatureOptions = {},
): readonly EffectSetDiagnostic[] {
  const diagnostics: EffectSetDiagnostic[] = [];
  const allowSetVariables = options.allowSetVariables ?? true;
  const knownErrors = options.knownErrors ?? new Set<string>();
  const knownServices = options.knownServices ?? new Set<string>();

  const kinds = new Map<string, EffectSetKind>();
  const typeVariables = new Set<string>();
  const inParameters = new Set<string>();
  const inResult: Array<{ readonly name: string; readonly kind: EffectSetKind; readonly span: Span }> = [];
  const reportedKinds = new Set<string>();

  const visit = (node: TypeExpr, region: "parameter" | "result", callbackParameters: boolean): void => {
    switch (node._tag) {
      case "TESym": {
        const name = node.name;
        if (isSetVariableName(name) && !knownErrors.has(name) && !knownServices.has(name)) {
          typeVariables.add(name);
          if (kinds.has(name) && !reportedKinds.has(name)) {
            diagnostics.push({
              code: "mechanics/set-variable-kind",
              message: `${name} is used both as a set variable and as a type variable.`,
              span: node.span,
            });
            reportedKinds.add(name);
          }
        }
        return;
      }
      case "TEFun": {
        for (const param of node.params) {
          visit(param, region, region === "parameter" ? true : callbackParameters);
        }
        visit(node.ret, region, callbackParameters);
        return;
      }
      case "TEApp": {
        if (
          node.con._tag === "TESym" &&
          (node.con.name === "ErrorSet" || node.con.name === "RequirementSet")
        ) {
          const kind: EffectSetKind = node.con.name === "ErrorSet" ? "error" : "requirement";
          for (const arg of node.args) {
            if (arg._tag !== "TESym" || !isSetVariableName(arg.name)) continue;
            const variable = arg.name;
            if (!allowSetVariables) {
              diagnostics.push({
                code: "mechanics/set-variable-position",
                message: `Set variable ${variable} is only allowed in operation signatures, not in service methods.`,
                span: arg.span,
              });
              continue;
            }
            const existing = kinds.get(variable);
            if (typeVariables.has(variable)) {
              if (!reportedKinds.has(variable)) {
                diagnostics.push({
                  code: "mechanics/set-variable-kind",
                  message: `${variable} is used as both a set variable and a type variable.`,
                  span: arg.span,
                });
                reportedKinds.add(variable);
              }
            } else if (existing !== undefined && existing !== kind) {
              if (!reportedKinds.has(variable)) {
                diagnostics.push({
                  code: "mechanics/set-variable-kind",
                  message: `${variable} is used as both an error set and a requirement set.`,
                  span: arg.span,
                });
                reportedKinds.add(variable);
              }
            } else {
              kinds.set(variable, kind);
            }

            if (region === "parameter") {
              inParameters.add(variable);
              if (callbackParameters) {
                diagnostics.push({
                  code: "mechanics/set-variable-position",
                  message: `Set variable ${variable} cannot appear in the parameters of a callback; that would make the callback higher-rank.`,
                  span: arg.span,
                });
              }
            } else {
              inResult.push({ name: variable, kind, span: arg.span });
            }
          }
          return;
        }
        visit(node.con, region, callbackParameters);
        for (const arg of node.args) visit(arg, region, callbackParameters);
        return;
      }
      case "TERow": {
        for (const field of node.fields) visit(field.type, region, callbackParameters);
        return;
      }
      case "TERowOp": {
        for (const operand of node.operands) visit(operand, region, callbackParameters);
        return;
      }
    }
  };

  if (texpr._tag === "TEFun") {
    for (const param of texpr.params) visit(param, "parameter", false);
    visit(texpr.ret, "result", false);
  } else {
    visit(texpr, "result", false);
  }

  const reportedUnbound = new Set<string>();
  for (const variable of inResult) {
    if (inParameters.has(variable.name) || reportedUnbound.has(variable.name)) continue;
    reportedUnbound.add(variable.name);
    const errorMatch = [...knownErrors].find(
      (candidate) => candidate.toLowerCase() === variable.name.toLowerCase(),
    );
    const serviceMatch = [...knownServices].find(
      (candidate) => candidate.toLowerCase() === variable.name.toLowerCase(),
    );
    const hint = errorMatch
      ? ` Did you mean the error ${errorMatch}?`
      : serviceMatch
        ? ` Did you mean the service ${serviceMatch}?`
        : "";
    diagnostics.push({
      code: "mechanics/unbound-set-variable",
      message: `Set variable ${variable.name} appears in the result but in no parameter, so nothing can solve it.${hint}`,
      span: variable.span,
    });
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Rigid body checking (RFC 0023 §4)
// ---------------------------------------------------------------------------

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

/**
 * Rigidly check `actual` against `declared` for one set kind (`error` or `requirement`).
 * Concrete entries match by name (`Service` covers `Service.method` for requirements);
 * set variables (`$e`, `$r`) are opaque rigid members matched strictly by identity.
 */
export function checkEffectSetInclusion(
  actual: EffectProvenance,
  declared: EffectProvenance,
  kind: EffectSetKind,
  owner = "expression",
  fallbackSpan?: Span,
): readonly EffectSetDiagnostic[] {
  const diagnostics: EffectSetDiagnostic[] = [];
  const declaredDisplay = [...declared.keys()].map((key) =>
    isSetVariableKey(key) ? setVariableName(key) : key,
  );

  for (const [entry, span] of actual) {
    const covered =
      kind === "requirement" ? coversRequirementKey(declared, entry) : declared.has(entry);
    if (covered) continue;

    const entrySpan = span ?? fallbackSpan;
    if (kind === "error") {
      const subject = isSetVariableKey(entry) ? `the errors of ${setVariableName(entry)}` : entry;
      diagnostics.push({
        code: "mechanics/undeclared-error",
        message: `${capitalize(owner)} can fail with ${subject}, but its signature declares ${declaredDisplay.length === 0 ? "no errors" : `only [${declaredDisplay.join(" ")}]`}.`,
        ...(entrySpan ? { span: entrySpan } : {}),
      });
    } else {
      const subject = isSetVariableKey(entry)
        ? `the requirements of ${setVariableName(entry)}`
        : entry;
      diagnostics.push({
        code: "mechanics/undeclared-requirement",
        message: `${capitalize(owner)} requires ${subject}, but its signature declares ${declaredDisplay.length === 0 ? "no requirements" : `only [${declaredDisplay.join(" ")}]`}.`,
        ...(entrySpan ? { span: entrySpan } : {}),
      });
    }
  }

  return diagnostics;
}

/** Rigidly check both error and requirement sets of an operational `Effect` against a signature. */
export function checkOperationalEffectAgainst(
  actual: OperationalEffect,
  declared: OperationalEffect,
  owner = "expression",
  fallbackSpan?: Span,
): readonly EffectSetDiagnostic[] {
  return [
    ...checkEffectSetInclusion(actual.errors, declared.errors, "error", owner, fallbackSpan),
    ...checkEffectSetInclusion(
      actual.requirements,
      declared.requirements,
      "requirement",
      owner,
      fallbackSpan,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Call-site instantiation & lower-bound solving (RFC 0023 §3)
// ---------------------------------------------------------------------------

let freshSetVarCounter = 0;

/**
 * Rename every set variable in `type` to a fresh lowercase name so each call
 * site solves its own independent set variables.
 */
export function instantiateEffectSignature(
  type: Type,
  freshName: (original: string) => string = (original) => `${original}_${++freshSetVarCounter}`,
): {
  readonly type: Type;
  readonly errorRenaming: ReadonlyMap<string, string>;
  readonly requirementRenaming: ReadonlyMap<string, string>;
} {
  const errorRenaming = new Map<string, string>();
  const requirementRenaming = new Map<string, string>();

  const renameSet = (args: readonly Type[], renaming: Map<string, string>): readonly Type[] =>
    args.map((arg) => {
      if (arg._tag !== "TCon") return arg;
      const key = effectSetEntryKey(arg.name);
      if (!isSetVariableKey(key)) return arg;
      const raw = setVariableName(key);
      let fresh = renaming.get(raw);
      if (!fresh) {
        fresh = freshName(raw);
        renaming.set(raw, fresh);
      }
      return TCon(fresh);
    });

  const rewrite = (t: Type): Type => {
    if (t.nullaryResult) {
      const { nullaryResult, ...base } = t;
      return { ...rewrite(base), nullaryResult: rewrite(nullaryResult) };
    }
    switch (t._tag) {
      case "TVar":
      case "TCon":
        return t;
      case "TFun":
        return {
          ...t,
          ...TFun(
            rewrite(t.arg),
            rewrite(t.res),
            t.effect,
            t.rest ? rewrite(t.rest) : undefined,
          ),
        };
      case "TVariadic":
        return TVariadic(rewrite(t.rest), rewrite(t.res), t.effect);
      case "TApp": {
        const kind = effectSetKindOf(t);
        if (kind) {
          return TApp(
            t.con,
            renameSet(t.args, kind === "error" ? errorRenaming : requirementRenaming),
          );
        }
        return { ...t, ...TApp(rewrite(t.con), t.args.map(rewrite)) };
      }
      case "TRow": {
        const rewriteRow = (r: typeof t.row): typeof t.row =>
          r._tag === "RExtend" ? RExtend(r.label, rewrite(r.type), rewriteRow(r.tail)) : r;
        return { ...t, ...TRow(rewriteRow(t.row)) };
      }
    }
  };

  return { type: rewrite(type), errorRenaming, requirementRenaming };
}

/**
 * Solves error-set and requirement-set variables from the arguments of a call
 * (RFC 0023 §3): each variable is the union of the lower-bound entries flowing
 * into it, excluding concrete names already listed in the parameter's own set.
 */
export class EffectSetSolver {
  private readonly errorBounds = new Map<string, Map<string, Span | undefined>>();
  private readonly requirementBounds = new Map<string, Map<string, Span | undefined>>();

  /** Match a parameter type against an argument's actual type, collecting set lower bounds. */
  match(param: Type, actual: Type, actualSpan?: Span): void {
    if (param._tag === "TFun" && actual._tag === "TFun") {
      this.match(param.res, actual.res, actualSpan);
      return;
    }
    if (param._tag === "TApp" && actual._tag === "TApp") {
      const paramKind = effectSetKindOf(param);
      const actualKind = effectSetKindOf(actual);
      if (paramKind && paramKind === actualKind) {
        this.collect(
          effectSetFromArgs(param.args),
          effectSetFromArgs(actual.args, actualSpan),
          paramKind === "error" ? this.errorBounds : this.requirementBounds,
          paramKind,
        );
        return;
      }
      if (param.args.length === actual.args.length) {
        for (let i = 0; i < param.args.length; i++) {
          this.match(param.args[i]!, actual.args[i]!, actualSpan);
        }
      }
    }
  }

  private collect(
    declared: EffectProvenance,
    actual: EffectProvenance,
    bounds: Map<string, Map<string, Span | undefined>>,
    kind: EffectSetKind,
  ): void {
    for (const key of declared.keys()) {
      if (!isSetVariableKey(key)) continue;
      const bound = bounds.get(key) ?? new Map<string, Span | undefined>();
      for (const [entry, span] of actual) {
        // A name the parameter lists itself is not the variable's to carry (RFC 0023 §3).
        if (
          !isSetVariableKey(entry) &&
          (kind === "requirement" ? coversRequirementKey(declared, entry) : declared.has(entry))
        ) {
          continue;
        }
        if (!bound.has(entry)) bound.set(entry, span);
      }
      bounds.set(key, bound);
    }
  }

  /** Solve a provenance set by replacing every set variable with its lower-bound union. */
  solve(set: EffectProvenance, kind: EffectSetKind, callSpan?: Span): EffectProvenance {
    const bounds = kind === "error" ? this.errorBounds : this.requirementBounds;
    const closed = new Map<string, Span | undefined>();
    for (const [key, originalSpan] of set) {
      if (isSetVariableKey(key)) {
        for (const [entry, entrySpan] of bounds.get(key) ?? []) {
          if (!closed.has(entry)) closed.set(entry, entrySpan);
        }
      } else if (!closed.has(key)) {
        closed.set(key, callSpan ?? originalSpan);
      }
    }
    return closed;
  }

  /** Rewrite every `ErrorSet` and `RequirementSet` in `type` with its solved sets. */
  apply(type: Type, callSpan?: Span): Type {
    const rewrite = (t: Type): Type => {
      if (t.nullaryResult) {
        const { nullaryResult, ...base } = t;
        return { ...rewrite(base), nullaryResult: rewrite(nullaryResult) };
      }
      switch (t._tag) {
        case "TVar":
        case "TCon":
          return t;
        case "TFun":
          return {
            ...t,
            ...TFun(
              rewrite(t.arg),
              rewrite(t.res),
              t.effect,
              t.rest ? rewrite(t.rest) : undefined,
            ),
          };
        case "TVariadic":
          return TVariadic(rewrite(t.rest), rewrite(t.res), t.effect);
        case "TApp": {
          const kind = effectSetKindOf(t);
          if (kind) {
            return effectSetToType(kind, this.solve(effectSetFromArgs(t.args), kind, callSpan));
          }
          return { ...t, ...TApp(rewrite(t.con), t.args.map(rewrite)) };
        }
        case "TRow": {
          const rewriteRow = (r: typeof t.row): typeof t.row =>
            r._tag === "RExtend" ? RExtend(r.label, rewrite(r.type), rewriteRow(r.tail)) : r;
          return { ...t, ...TRow(rewriteRow(t.row)) };
        }
      }
    };
    return rewrite(type);
  }
}

export interface SolveEffectCallOptions {
  readonly callSpan?: Span;
  readonly argSpans?: readonly (Span | undefined)[];
}

export interface SolvedEffectCall {
  /** Callee type with all set variables solved and closed for this call site. */
  readonly calleeType: Type;
  /** Result type after peeling `argTypes.length` parameters from `calleeType`. */
  readonly resultType: Type;
  /** Solved provenance sets when `resultType` is an operational `Effect`. */
  readonly effect?: OperationalEffect;
}

/**
 * Instantiate an effect-polymorphic callee signature, solve its set variables
 * from `argTypes` by lower-bound union, and return the closed call-site type.
 */
export function solveEffectCall(
  calleeType: Type,
  argTypes: readonly Type[],
  options: SolveEffectCallOptions = {},
): SolvedEffectCall {
  const { type: instantiated } = instantiateEffectSignature(calleeType);
  const solver = new EffectSetSolver();

  let cursor = instantiated;
  for (let i = 0; i < argTypes.length; i++) {
    if (cursor._tag !== "TFun") break;
    solver.match(cursor.arg, argTypes[i]!, options.argSpans?.[i]);
    cursor = cursor.res;
  }

  const closedCallee = solver.apply(instantiated, options.callSpan);
  let resultType = closedCallee;
  for (let i = 0; i < argTypes.length && resultType._tag === "TFun"; i++) {
    resultType = resultType.res;
  }

  const rawEffect = extractOperationalEffect(cursor);
  const solvedEffect: OperationalEffect | undefined = rawEffect
    ? {
        success: extractOperationalEffect(resultType)?.success ?? rawEffect.success,
        errors: solver.solve(rawEffect.errors, "error", options.callSpan),
        requirements: solver.solve(rawEffect.requirements, "requirement", options.callSpan),
      }
    : undefined;

  return {
    calleeType: closedCallee,
    resultType,
    ...(solvedEffect ? { effect: solvedEffect } : {}),
  };
}
