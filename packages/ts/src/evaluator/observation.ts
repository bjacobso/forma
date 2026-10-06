/**
 * Per-expression observation.
 *
 * When an evaluation is observed, the compiler emits an `OBSERVE` instruction
 * after every expression whose origin is an author-written node, and the VM
 * reports the value to the observer. The collector keeps only the last raw
 * value and a count per expression; projection happens once, at the end.
 */

import type { Loc, SExpr } from "../reader/index.js";
import { children } from "../reader/types.js";
import type { SyntaxIdentity, SyntaxSpan } from "../syntax/identity.js";
import { identifySyntax, indexSyntax, matchesSyntaxKind } from "../syntax/identity.js";
import { sourceOriginsOf } from "./source-trace.js";
import type { KValue } from "./types.js";

/** Receives the values of observed expressions during evaluation. */
export interface KernelObserver {
  /** Observation targets for an expanded expression; empty when it is not observed. */
  targetsOf(expr: SExpr): readonly number[];
  observe(target: number, value: KValue): void;
}

export interface ObservationOptions {
  /** Ids for records. Defaults to a fresh identity of the evaluated source. */
  readonly identity?: SyntaxIdentity | undefined;
  /** Maximum number of expressions with records. Defaults to 5,000. */
  readonly maxRecords?: number | undefined;
}

export interface ExpressionObservation {
  readonly nodeId: string;
  readonly span: SyntaxSpan;
  /** Times the expression finished evaluating. */
  readonly count: number;
  /** The last value. Meaningful only when `count > 0`. */
  readonly value: KValue;
  /** A failure raised while evaluating this expression. */
  readonly failure?: unknown;
}

export interface ObservationReport {
  /** Records in document order. */
  readonly records: readonly ExpressionObservation[];
  /** True when `maxRecords` dropped records. */
  readonly truncated: boolean;
  readonly maxRecords: number;
}

export const DEFAULT_MAX_OBSERVATION_RECORDS = 5_000;

interface Target {
  readonly nodeId: string;
  readonly span: SyntaxSpan;
  readonly order: number;
  count: number;
  value: KValue;
  failure?: unknown;
}

/** Collects observations for the author-written expressions of one source. */
export class ObservationCollector implements KernelObserver {
  readonly #targets: Target[] = [];
  readonly #byExpr = new Map<SExpr, number>();
  readonly #maxRecords: number;
  #recorded = 0;
  #truncated = false;

  constructor(source: string, exprs: readonly SExpr[], options: ObservationOptions = {}) {
    this.#maxRecords = options.maxRecords ?? DEFAULT_MAX_OBSERVATION_RECORDS;
    const index = indexSyntax(options.identity ?? identifySyntax(source));
    const order = new Map(index.identity.nodes.map((node, position) => [node.id, position]));
    const visit = (expr: SExpr): void => {
      // A macro definition's body runs at expansion time, and its templates
      // are copied into every expansion: neither is author code that runs.
      if (expr._tag === "List" && expr.items[0]?._tag === "Sym" && expr.items[0].name === "__macro") {
        return;
      }
      const node = index.withSpan(expr.loc.start, expr.loc.end);
      if (node && matchesSyntaxKind(expr, node.kind) && !this.#byExpr.has(expr)) {
        this.#byExpr.set(expr, this.#targets.length);
        this.#targets.push({
          nodeId: node.id,
          span: node.span,
          order: order.get(node.id)!,
          count: 0,
          value: null,
        });
      }
      for (const child of children(expr)) visit(child);
    };
    exprs.forEach(visit);
  }

  targetsOf(expr: SExpr): readonly number[] {
    const targets: number[] = [];
    for (const origin of sourceOriginsOf(expr)) {
      const target = this.#byExpr.get(origin);
      if (target !== undefined && !targets.includes(target)) targets.push(target);
    }
    return targets;
  }

  observe(target: number, value: KValue): void {
    const entry = this.#targets[target];
    if (!entry) return;
    if (entry.count === 0 && entry.failure === undefined) {
      if (this.#recorded >= this.#maxRecords) {
        this.#truncated = true;
        return;
      }
      this.#recorded++;
    }
    entry.count++;
    entry.value = value;
  }

  /** Attribute a failure to the innermost author expression containing its location. */
  fail(error: unknown, loc: Pick<Loc, "start" | "end"> | undefined): void {
    if (!loc) return;
    let best: Target | undefined;
    for (const target of this.#targets) {
      if (target.span.start > loc.start || loc.end > target.span.end) continue;
      if (!best || target.span.end - target.span.start < best.span.end - best.span.start) {
        best = target;
      }
    }
    if (!best) return;
    if (best.count === 0 && best.failure === undefined) {
      if (this.#recorded >= this.#maxRecords) {
        this.#truncated = true;
        return;
      }
      this.#recorded++;
    }
    best.failure = error;
  }

  report(): ObservationReport {
    const records = this.#targets
      .filter((target) => target.count > 0 || target.failure !== undefined)
      .sort((left, right) => left.order - right.order)
      .map(
        (target): ExpressionObservation => ({
          nodeId: target.nodeId,
          span: target.span,
          count: target.count,
          value: target.value,
          ...(target.failure !== undefined ? { failure: target.failure } : {}),
        }),
      );
    return { records, truncated: this.#truncated, maxRecords: this.#maxRecords };
  }
}
