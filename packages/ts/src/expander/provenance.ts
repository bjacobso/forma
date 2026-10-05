/**
 * Expansion provenance.
 *
 * The expander emits a fresh tree: no node object appears twice in an
 * expanded program or is shared with the parse, a macro definition, or
 * another expansion. Every emitted node gets one origin when it is created,
 * and writing a second origin for the same node throws, so sharing is
 * detected where it happens instead of where its facts collide.
 *
 * Origins live in a registry keyed by the fresh nodes rather than in a field,
 * because expanded nodes flow into runtime values (quoted data, macro
 * arguments) that are compared structurally.
 *
 * See "Provenance is data, written once" in docs/language-services.md.
 *
 * @module
 */

import type { Loc, SExpr } from "../reader/types.js";
import { children } from "../reader/types.js";

/** A macro call that a node passed through or was built by. */
export interface MacroOrigin {
  readonly macroName: string;
  /** The call's location, always in the author's document. */
  readonly loc: Loc;
}

/**
 * - `source`: author-written code at this position, including an argument a
 *   macro passed through.
 * - `expansion`: the root of a macro expansion, which stands for the call.
 *   A macro that returns its argument makes a root that is also that
 *   argument's `source`.
 * - `introduced`: built by a macro, from its template or by computation.
 * - `desugared`: written by the expander for an author form, such as a
 *   destructuring temporary or the implicit `do` of a `fn` body.
 */
export type OriginRole = "source" | "expansion" | "introduced" | "desugared";

export interface Origin {
  readonly role: OriginRole;
  /**
   * The author nodes the node stands for: the node a `source` copies, and the
   * calls an `expansion` root stands for. Empty for `introduced` and
   * `desugared` nodes, which stand for no author code.
   */
  readonly authors: readonly SExpr[];
  /**
   * The author node the node is located at: the node itself for `source`, the
   * innermost author-written macro call for `introduced`, the author form for
   * `desugared`. Emitted nodes carry `site.loc` as their `loc`.
   */
  readonly site: SExpr;
  /** The macro calls the node passed through or was built by, innermost first. */
  readonly macroOrigins?: readonly MacroOrigin[];
}

const registry = new WeakMap<SExpr, Origin>();

function record<T extends SExpr>(node: T, origin: Origin): T {
  if (registry.has(node)) {
    throw new Error(`Provenance: the ${node._tag} node already has an origin`);
  }
  // originOf is public: readonly types alone would let a JavaScript consumer
  // rewrite facts shared by derived nodes and later expansions.
  Object.freeze(origin.authors);
  if (origin.macroOrigins) {
    origin.macroOrigins.forEach(Object.freeze);
    Object.freeze(origin.macroOrigins);
  }
  registry.set(node, Object.freeze(origin));
  return node;
}

/** The origin of an emitted node, or undefined for a node the expander did not emit. */
export function originOf(node: SExpr): Origin | undefined {
  return registry.get(node);
}

/**
 * The origin of a node handed to the expander. A node the expander did not
 * emit is input to it: author code that stands for itself.
 */
function inputOrigin(node: SExpr): Origin {
  return registry.get(node) ?? { role: "source", authors: [node], site: node };
}

/** The author nodes a node stands for. A node the expander did not emit stands for itself. */
export function authorsOf(node: SExpr): readonly SExpr[] {
  return inputOrigin(node).authors;
}

/** The author node a node is located at. */
export function siteOf(node: SExpr): SExpr {
  return inputOrigin(node).site;
}

/** The macro calls a node passed through or was built by, innermost first. */
export function macroOriginsOf(node: SExpr): readonly MacroOrigin[] | undefined {
  return registry.get(node)?.macroOrigins;
}

/** A fresh node with `from`'s fields and `items`/`pairs` replaced. */
function rebuild(from: SExpr, items: readonly SExpr[], loc: Loc): SExpr {
  switch (from._tag) {
    case "List":
    case "Vector":
    case "Set":
      return { _tag: from._tag, items, loc };
    case "Map": {
      const pairs: (readonly [SExpr, SExpr])[] = [];
      for (let index = 0; index < items.length; index += 2) {
        pairs.push([items[index]!, items[index + 1]!]);
      }
      return { _tag: "Map", pairs, loc };
    }
    default:
      return { ...from, loc };
  }
}

/** Give `built`, a rebuilt copy of the input node `from`, the origin of `from`. */
export function derive<T extends SExpr>(from: SExpr, built: T): T {
  return record(built, inputOrigin(from));
}

/** A fresh copy of the input tree `node`; each copy has the origin of the node it copies. */
export function copyTree(node: SExpr): SExpr {
  return derive(node, rebuild(node, children(node).map(copyTree), node.loc));
}

/** Give `built`, written by the expander for the author form `form`, a `desugared` origin. */
export function desugar<T extends SExpr>(form: SExpr, built: T): T {
  const origin = inputOrigin(form);
  return record(built, {
    role: "desugared",
    authors: [],
    site: origin.site,
    ...(origin.macroOrigins ? { macroOrigins: origin.macroOrigins } : {}),
  });
}

/**
 * Copy a macro's result into a fresh tree. `args` are the argument nodes the
 * macro received; a node of the result that is one of them, or inside one, is
 * that argument passed through and keeps its origin. Every other node was
 * introduced by the macro and is located at the call. The root stands for the
 * call, and for what the call stands for when the call is itself a root.
 */
export function emitExpansion(
  call: SExpr,
  macroName: string,
  args: readonly SExpr[],
  result: SExpr,
): SExpr {
  const passed = new Map<SExpr, Origin>();
  const collect = (node: SExpr): void => {
    if (passed.has(node)) return;
    passed.set(node, inputOrigin(node));
    children(node).forEach(collect);
  };
  args.forEach(collect);

  const callOrigin = inputOrigin(call);
  const context: MacroOrigin = { macroName, loc: callOrigin.site.loc };
  const within = (outer: readonly MacroOrigin[] | undefined) => [context, ...(outer ?? [])];
  const introduced: Origin = {
    role: "introduced",
    authors: [],
    site: callOrigin.site,
    macroOrigins: within(callOrigin.macroOrigins),
  };

  const copy = (node: SExpr, root: boolean): SExpr => {
    const argument = passed.get(node);
    let origin: Origin = argument
      ? { ...argument, macroOrigins: within(argument.macroOrigins) }
      : introduced;
    if (root) {
      // An introduced call stands for no author node, so its root stands for none.
      const authors = [...origin.authors];
      for (const author of callOrigin.authors) {
        if (!authors.includes(author)) authors.push(author);
      }
      origin = { ...origin, role: "expansion", authors };
    }
    const items = children(node).map((child) => copy(child, false));
    return record(rebuild(node, items, origin.site.loc), origin);
  };
  return copy(result, true);
}
