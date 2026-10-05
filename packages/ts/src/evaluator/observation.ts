/**
 * Per-expression observation.
 *
 * When an evaluation is observed, the engine asks `targetsOf` for every
 * expression it compiles (the VM) or evaluates (the evaluator), and reports
 * the values of the ones that have targets. An expression has a target when
 * its origin is author code: a `source` node or an `expansion` root, mapped
 * to the author nodes it stands for (see `expander/provenance.ts`). So a
 * record exists exactly for author nodes the engine evaluated as expressions.
 * The collector keeps only the last raw value and a count per expression;
 * projection happens once, at the end.
 */

import type { Loc, SExpr } from "../reader/index.js";
import { children } from "../reader/types.js";
import type { SyntaxIdentity, SyntaxNode, SyntaxSpan } from "../syntax/identity.js";
import { identifySyntax, indexSyntax, matchesSyntaxKind } from "../syntax/identity.js";
import { authorsOf, siteOf } from "../expander/provenance.js";
import type { KValue } from "./types.js";

/** Receives the values of observed expressions during evaluation. */
export interface KernelObserver {
  /** Observation targets for an expanded expression; empty when it is not observed. */
  targetsOf(expr: SExpr): readonly number[];
  observe(target: number, value: KValue): void;
  /** The expansion of this macro call failed; the failure belongs to the call. */
  expansionFailed?(call: SExpr): void;
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
  /** The syntax node of every node of the author's parse. */
  readonly #nodes = new Map<SExpr, SyntaxNode>();
  readonly #order: ReadonlyMap<string, number>;
  readonly #byNode = new Map<string, number>();
  readonly #maxRecords: number;
  #expansionFailure: number | undefined;
  #recorded = 0;
  #truncated = false;

  constructor(source: string, exprs: readonly SExpr[], options: ObservationOptions = {}) {
    this.#maxRecords = options.maxRecords ?? DEFAULT_MAX_OBSERVATION_RECORDS;
    const index = indexSyntax(options.identity ?? identifySyntax(source));
    this.#order = new Map(index.identity.nodes.map((node, position) => [node.id, position]));
    const visit = (expr: SExpr): void => {
      const node = index.withSpan(expr.loc.start, expr.loc.end);
      if (node && matchesSyntaxKind(expr, node.kind)) this.#nodes.set(expr, node);
      children(expr).forEach(visit);
    };
    exprs.forEach(visit);
  }

  /** The target for an author node, created when the engine first asks for it. */
  #targetOf(author: SExpr): number | undefined {
    const node = this.#nodes.get(author);
    if (!node) return undefined;
    const existing = this.#byNode.get(node.id);
    if (existing !== undefined) return existing;
    const target = this.#targets.length;
    this.#byNode.set(node.id, target);
    this.#targets.push({
      nodeId: node.id,
      span: node.span,
      order: this.#order.get(node.id)!,
      count: 0,
      value: null,
    });
    return target;
  }

  targetsOf(expr: SExpr): readonly number[] {
    const targets: number[] = [];
    for (const author of authorsOf(expr)) {
      const target = this.#targetOf(author);
      if (target !== undefined && !targets.includes(target)) targets.push(target);
    }
    return targets;
  }

  observe(target: number, value: KValue): void {
    const entry = this.#targets[target];
    if (!entry) return;
    if (!this.#admit(entry)) return;
    entry.count++;
    entry.value = value;
  }

  expansionFailed(call: SExpr): void {
    this.#expansionFailure = this.#targetOf(siteOf(call));
  }

  /**
   * Attribute a failure. A failure raised while expanding goes to the macro
   * call; any other goes to the innermost expression the engine evaluated or
   * compiled whose span contains the failure's location.
   */
  fail(error: unknown, loc: Pick<Loc, "start" | "end"> | undefined): void {
    let best =
      this.#expansionFailure !== undefined ? this.#targets[this.#expansionFailure] : undefined;
    if (!best && loc) {
      for (const target of this.#targets) {
        if (target.span.start > loc.start || loc.end > target.span.end) continue;
        if (!best || target.span.end - target.span.start < best.span.end - best.span.start) {
          best = target;
        }
      }
    }
    if (!best || !this.#admit(best)) return;
    best.failure = error;
  }

  /** Count a target against `maxRecords` the first time it has something to report. */
  #admit(target: Target): boolean {
    if (target.count > 0 || target.failure !== undefined) return true;
    if (this.#recorded >= this.#maxRecords) {
      this.#truncated = true;
      return false;
    }
    this.#recorded++;
    return true;
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
