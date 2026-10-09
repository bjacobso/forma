/**
 * Lower SExpr -> CoreExpr — entry point.
 *
 * Desugars Lisp surface syntax into the typed core IR:
 *  - (fn [params] body...) -> Lam { params, body: Do(exprs) }
 *  - (let [x e ...] body...) -> Let { bindings, body }
 *  - (define name expr) -> Def { name, expr }
 *  - (if c t e) -> If { cond, then, else }
 *  - (do e1 e2 ...) -> nested Let or last expr
 *  - {k1 v1 k2 v2} -> Record
 *  - (get rec :label) -> Get
 *  - (f args...) -> App
 *  - symbols -> Var
 *  - literals -> Lit
 *
 * Sugar forms (not, when, cond, and, or, ->, ->>) are expanded at the
 * SExpr level by expand.ts BEFORE lowering, so the lowerer only handles
 * core forms.
 */
import { normalizeEffectProgram,head,name,list,sym } from "../surface/effect.js";
import type { SExpr } from "../reader/index.js";
import type { CoreExpr } from "./core-expr.js";
import { CDef, CTypeDef } from "./core-expr.js";
import { parseUnifiedForm } from "../surface/form.js";
import { typeDefinition } from "../surface/type-alias.js";
import { InferenceError } from "./errors.js";
import type { DSLTypeProvider } from "./dsl-provider.js";
import { defaultBuiltins } from "../builtins/index.js";
import { expandKernelExprsSync } from "../evaluator/frontend.js";
import type { Env } from "../Env.js";
import {
  lower,
  setDslProvider,
  setInternalBindingCounter,
  getInternalBindingCounter,
  getDslProvider,
} from "./lower-core.js";
import { parseTypeExpr } from "./type-parser.js";

// Re-export for consumers
export { lower } from "./lower-core.js";
export { parseTypeExpr } from "./type-parser.js";

// ---------------------------------------------------------------------------
// Program lowering with type signature support
// ---------------------------------------------------------------------------

/**
 * Check if an SExpr is a canonical type signature form (: name Type).
 */
function isTypeSig(expr: SExpr): expr is SExpr & { _tag: "List" } {
  return (
    expr._tag === "List" &&
    expr.items.length === 3 &&
    expr.items[0]?._tag === "Sym" &&
    expr.items[0].name === ":" &&
    expr.items[1]?._tag === "Sym"
  );
}

/**
 * Check if an SExpr is a canonical define form (define name expr).
 */
function isDef(expr: SExpr): expr is SExpr & { _tag: "List" } {
  return (
    expr._tag === "List" &&
    expr.items.length >= 3 &&
    expr.items[0]?._tag === "Sym" &&
    (expr.items[0].name === "define" || expr.items[0].name === "__operation")
  );
}

export interface LowerProgramOptions {
  /** Macros visible to the program, such as those its preludes define. Kernel macros are always visible. */
  readonly macroEnv?: Env | undefined;
  readonly includePrelude?: boolean | undefined;
}

/**
 * Lower a sequence of top-level SExprs into CoreExprs.
 *
 * Collects (: name Type) signatures anywhere in the module.
 *
 * @param exprs The parsed SExprs to lower
 * @param dslProvider Optional DSL type provider for recognizing DSL forms.
 *   When provided, forms like (entity ...) are lowered to CDSLForm nodes
 *   instead of CApp nodes (which would fail with "Unbound variable").
 */
export function lowerProgram(
  exprs: readonly SExpr[],
  dslProvider?: DSLTypeProvider,
  options: LowerProgramOptions = {},
): CoreExpr[] {
  const formTypes = new Map(exprs.flatMap(expr => {const entry=typeDefinition(expr);return entry ? [entry] : [];}));
  // Set the module-level provider for use by lower/lowerList/lowerDSLForm
  const prevProvider = getDslProvider();
  const prevInternalBindingCounter = getInternalBindingCounter();
  setDslProvider(dslProvider);
  setInternalBindingCounter(0);
  const effectModule = exprs.some(e => ["service","layer"].includes(head(e) ?? ""));
  const signatures = new Map(exprs.flatMap(e=>head(e)===":" && e._tag === "List" ? [[name(e.items[1])!,e.items[2]!] as const] : []));
  const normalized = effectModule ? normalizeEffectProgram(exprs).map((e, i)=>{
    if (["class", "error"].includes(head(exprs[i]) ?? "")) return exprs[i]!;
    if (head(e)==="__operation" && e._tag === "List" && e.items[2]?._tag === "Vector" && !e.items[2].items.length && head(signatures.get(name(e.items[1])!))==="Effect") return list(e,[sym(e,"define"),e.items[1]!,e.items.length === 4 ? e.items[3]! : list(e,[sym(e,"do"),...e.items.slice(3)])]);
    return e;
  }) : exprs;
  const expanded = expandKernelExprsSync(normalized, {
    builtins: defaultBuiltins,
    ...(options.includePrelude === false ? {includePrelude:false} : {}),
    ...(options.macroEnv ? { env: options.macroEnv } : {}),
  }).expanded;

  try {
    const signatures = new Map<string, ReturnType<typeof parseTypeExpr>>();
    const definitions = new Set<string>();
    for (const expr of expanded) {
      if (isTypeSig(expr)) {
        const name = expr.items[1]!;
        if (name._tag !== "Sym") throw new InferenceError({ message: "Signature name must be a symbol" });
        if (signatures.has(name.name)) throw new InferenceError({ message: `Duplicate signature for '${name.name}'` });
        signatures.set(name.name, parseTypeExpr(expr.items[2]!));
      }
      if (isDef(expr) && expr.items[1]?._tag === "Sym") definitions.add(expr.items[1].name);
    }
    for (const name of signatures.keys()) if (!definitions.has(name)) throw new InferenceError({ message: `Type signature for '${name}' has no matching definition` });
    const result: CoreExpr[] = [];
    for (const expr of expanded) {
      if (isTypeSig(expr)) continue;
      if (head(expr) === "form") {
        const descriptor = parseUnifiedForm(expr, formTypes)!;
        result.push(CTypeDef({start:expr.loc.start,end:expr.loc.end},descriptor.name,undefined,undefined,undefined,"form"));
        continue;
      }
      const lowered = lower(expr);
      const annotation = lowered._tag === "Def" ? signatures.get(lowered.name) : undefined;
      result.push(lowered._tag === "Def" && annotation ? CDef(lowered.span, lowered.name, lowered.expr, annotation) : lowered);
    }

    return result;
  } finally {
    // Restore previous provider (for safety in nested calls)
    setDslProvider(prevProvider);
    setInternalBindingCounter(prevInternalBindingCounter);
  }
}
