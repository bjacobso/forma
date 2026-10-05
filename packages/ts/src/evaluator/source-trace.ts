import type { Loc, SExpr } from "../reader/index.js";
import { children } from "../reader/types.js";

export interface MacroOrigin {
  readonly macroName: string;
  readonly loc: Loc;
}

export interface SourceTrace {
  readonly loc: Loc;
  readonly macroOrigins?: readonly MacroOrigin[];
}

const sourceTraceMap = new WeakMap<SExpr, SourceTrace>();

export function sourceTraceOf(expr: SExpr): SourceTrace {
  return sourceTraceMap.get(expr) ?? { loc: expr.loc };
}

export function sourceLocOf(expr: SExpr): Loc {
  return sourceTraceOf(expr).loc;
}

/** Tag every node in the tree with a macro expansion origin. */
export function tagExpandedExpr(expr: SExpr, macroOrigin: MacroOrigin): void {
  const visit = (node: SExpr): void => {
    const existing = sourceTraceMap.get(node);
    const macroOrigins = existing?.macroOrigins ?? [];
    sourceTraceMap.set(node, {
      loc: macroOrigin.loc,
      macroOrigins: [macroOrigin, ...macroOrigins],
    });
    for (const child of children(node)) {
      visit(child);
    }
  };
  visit(expr);
}

export function copySourceTrace<T extends SExpr>(from: SExpr, to: T): T {
  const trace = sourceTraceMap.get(from);
  if (trace) {
    sourceTraceMap.set(to, trace);
  }
  if (to !== from) {
    originMap.set(to, sourceOriginsOf(from));
  }
  return to;
}

// Origins: the parsed nodes an expanded node stands for. The expander rebuilds
// lists while expanding, so object identity alone cannot connect expanded code
// to the author's parse. Observation and the symbol index use origins to map
// runtime and binding facts back to author-written nodes.
const originMap = new WeakMap<SExpr, readonly SExpr[]>();

/** The parsed nodes this node was rebuilt from, or the node itself. */
export function sourceOriginsOf(expr: SExpr): readonly SExpr[] {
  return originMap.get(expr) ?? [expr];
}

/**
 * Mark `expansion` as the expansion of the macro call `call`. Returns a
 * shallow copy that carries the call as an origin: a macro can return the
 * same template node from every expansion, and that node must not collect
 * every call's origins.
 */
export function markExpansion<T extends SExpr>(call: SExpr, expansion: T): T {
  const root = copySourceTrace(expansion, { ...expansion });
  const origins = sourceOriginsOf(expansion);
  const callOrigins = sourceOriginsOf(call).filter((origin) => !origins.includes(origin));
  originMap.set(root, [...origins, ...callOrigins]);
  return root;
}
