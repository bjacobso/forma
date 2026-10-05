import type { Loc, SExpr } from "../reader/index.js";
import { authorsOf, macroOriginsOf, type MacroOrigin } from "../expander/provenance.js";

export type { MacroOrigin } from "../expander/provenance.js";

export interface SourceTrace {
  readonly loc: Loc;
  readonly macroOrigins?: readonly MacroOrigin[];
}

/**
 * Where diagnostics locate a node, and the macro calls it came through. An
 * expanded node's own location is already in the author's document (see
 * `expander/provenance.ts`); the macro calls are context, not a replacement.
 */
export function sourceTraceOf(expr: SExpr): SourceTrace {
  const macroOrigins = macroOriginsOf(expr);
  return macroOrigins ? { loc: expr.loc, macroOrigins } : { loc: expr.loc };
}

export function sourceLocOf(expr: SExpr): Loc {
  return expr.loc;
}

/**
 * The author-written nodes an expanded node stands for: the node it copies,
 * or the macro calls an expansion root stands for. Nodes a macro introduced
 * or the expander desugared stand for none. A node the expander did not emit
 * stands for itself.
 */
export function sourceOriginsOf(expr: SExpr): readonly SExpr[] {
  return authorsOf(expr);
}
