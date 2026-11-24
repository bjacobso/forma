/**
 * `forma:effect` in single-source Effect programs (RFC 0029, stage 1).
 *
 * File modules import the library through the module graph. A single source
 * given to `generateEffectProgram` has no module graph, so this expands calls
 * to the names an `(import "forma:effect" [...])` form selects and leaves every
 * other form exactly as written.
 *
 * @module
 */
import { Effect } from "effect";
import { Env } from "../Env.js";
import { defaultBuiltins } from "../builtins/index.js";
import { authorNames, diagnosticFromUnknown, type Diagnostic } from "../diagnostic/diagnostic.js";
import { evaluateCompileTimeExprs } from "../evaluator/eval.js";
import { copySourceTrace } from "../evaluator/source-trace.js";
import { expandMacroOnce } from "../expander/expand.js";
import { bundledModuleSources } from "../modules/sources.generated.js";
import { parse } from "../reader/parser.js";
import { toSExprMany } from "../reader/to-sexpr.js";
import type { SExpr } from "../reader/types.js";
import { normalizeCoreProgram } from "../surface/core.js";
import type { SExpr as Expr } from "../reader/types.js";

const name = (e: Expr | undefined): string | undefined => e?._tag === "Sym" ? e.name : undefined;
const head = (e: Expr | undefined): string | undefined => e?._tag === "List" ? name(e.items[0]) : undefined;

export const EFFECT_LIBRARY = "forma:effect";

interface Library {
  readonly env: Env;
  readonly exports: ReadonlySet<string>;
}

let library: Library | undefined;

/** The library's macros, with the kernel sugar they use, bound under their own names. */
function effectLibrary(): Library {
  if (library) return library;
  const read = (id: string, source: string) => toSExprMany(parse(source).redTree, id);
  const own = read(EFFECT_LIBRARY, bundledModuleSources.effect);
  const macros = [...read("forma:kernel", bundledModuleSources.kernel), ...own].filter((e) => head(e) === "macro");
  const env = Effect.runSync(
    evaluateCompileTimeExprs(normalizeCoreProgram(macros), { env: Env.empty(), builtins: defaultBuiltins, stepLimit: 100_000 }),
  ).env;
  const exported = own.find((e) => head(e) === "export");
  const exports = new Set(exported?._tag === "List" ? exported.items.slice(1).flatMap((e) => name(e) ?? []) : []);
  return (library = { env, exports });
}

export type EffectLibraryExpansion =
  | { readonly ok: true; readonly exprs: readonly SExpr[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

const isLibraryImport = (e: SExpr): e is Extract<SExpr, { readonly _tag: "List" }> =>
  e._tag === "List" && head(e) === "import" && e.items[1]?._tag === "Str" && e.items[1].value === EFFECT_LIBRARY;

/**
 * Removes `(import "forma:effect" [...])` forms and expands calls to the names
 * they import. Programs without the import are returned unchanged.
 */
export function expandEffectLibrary(authored: readonly SExpr[], sourceId: string): EffectLibraryExpansion {
  const imports = authored.filter(isLibraryImport);
  if (imports.length === 0) return { ok: true, exprs: authored };
  const { env, exports } = effectLibrary();
  const diagnostics: Diagnostic[] = [];
  const at = (e: SExpr) => ({ sourceId, startOffset: e.loc.start, endOffset: e.loc.end });
  const selected = new Set<string>();
  for (const form of imports) {
    const names = form.items[2];
    if (form.items.length !== 3 || names?._tag !== "Vector") {
      diagnostics.push({ code: "module/directive", severity: "error", phase: "typecheck", span: at(form),
        message: `Import names from ${EFFECT_LIBRARY} in a vector, as in (import "${EFFECT_LIBRARY}" [${[...exports].join(" ")}]).` });
      continue;
    }
    for (const item of names.items) {
      const n = name(item);
      if (n && exports.has(n)) selected.add(n);
      else diagnostics.push({ code: "module/private-export", severity: "error", phase: "typecheck", span: at(item),
        message: `${EFFECT_LIBRARY} does not export ${n ?? "this"}; it exports ${[...exports].join(", ")}.` });
    }
  }
  if (diagnostics.length) return { ok: false, diagnostics };

  // Forms without a library call are returned as they are, so later passes see the authored nodes.
  const expandAll = <T extends SExpr>(items: readonly T[]): readonly T[] => {
    const expanded = items.map(expand) as T[];
    return expanded.every((item, index) => item === items[index]) ? items : expanded;
  };
  const expand = (e: SExpr): SExpr => {
    if (e._tag === "Vector") {
      const items = expandAll(e.items);
      return items === e.items ? e : copySourceTrace(e, { ...e, items });
    }
    if (e._tag === "Map") {
      const pairs = e.pairs.map(([k, v]) => [expand(k), expand(v)] as const);
      return pairs.every(([k, v], index) => k === e.pairs[index]![0] && v === e.pairs[index]![1]) ? e : copySourceTrace(e, { ...e, pairs });
    }
    if (e._tag !== "List" || e.items.length === 0) return e;
    const h = head(e);
    if (h === "quote" || h === "quasiquote") return e;
    if (h && selected.has(h)) {
      const once = expandMacroOnce(e, env, { normalize: false });
      if (once) return expand(once.expr);
      // Declined: the core form keeps its meaning.
      const first = e.items[0]!;
      return copySourceTrace(e, { ...e, items: [copySourceTrace(first, { ...first, name: authorNames(h) } as SExpr), ...expandAll(e.items.slice(1))] });
    }
    const items = expandAll(e.items);
    return items === e.items ? e : copySourceTrace(e, { ...e, items });
  };
  try {
    return { ok: true, exprs: authored.filter((e) => !isLibraryImport(e)).map(expand) };
  } catch (error) {
    return { ok: false, diagnostics: [diagnosticFromUnknown(error, "elaborate", sourceId)] };
  }
}

/**
 * Gives the nodes a library template built the location of the authored
 * syntax they stand for, so diagnostics never point into the library: a
 * member list takes its `(: name Type)` or `(define name ...)` form's, a
 * keyword section spans `:kw val`, a catch-all `(_ err)` takes `err`'s, and
 * everything else takes the call's.
 */
function atAuthoredSyntax(expanded: SExpr, call: SExpr): SExpr {
  const members = call._tag === "List" ? call.items.slice(2) : [];
  const relocate = (node: SExpr): SExpr => {
    const own = node.loc.sourceId === EFFECT_LIBRARY;
    if (node._tag === "List" || node._tag === "Vector") {
      const items = node.items.map(relocate);
      if (node._tag === "List") {
        const member = members.find((m) => m._tag === "List" && m.items[1] !== undefined && m.items[1].loc.start === items[0]?.loc.start && m.items[1].loc.sourceId === items[0]?.loc.sourceId);
        if (member) return copySourceTrace(node, { ...node, items, loc: member.loc } as SExpr);
        // Keyword section `(:provides S)` or `(:setup [...])` constructed from sibling tokens.
        if (own && items.length >= 2 && items[0]?._tag === "Sym" && items[0].name.startsWith(":") && node.items[0]?.loc.sourceId !== EFFECT_LIBRARY) {
          const first = items[0]!.loc;
          const last = items[items.length - 1]!.loc;
          return copySourceTrace(node, { ...node, items, loc: { ...first, end: last.end } } as SExpr);
        }
        // Catch-all shorthand `(_ err)` constructed from a bare binding symbol `err`.
        if (own && items.length === 2 && name(items[0]) === "_" && node.items[0]?.loc.sourceId === EFFECT_LIBRARY && node.items[1]?.loc.sourceId !== EFFECT_LIBRARY) {
          const patLoc = items[1]!.loc;
          return copySourceTrace(node, { ...node, items: [copySourceTrace(items[0]!, { ...items[0]!, loc: patLoc } as SExpr), items[1]!], loc: patLoc } as SExpr);
        }
      }
      return copySourceTrace(node, { ...node, items, loc: own ? call.loc : node.loc } as SExpr);
    }
    return own ? copySourceTrace(node, { ...node, loc: call.loc } as SExpr) : node;
  };
  return relocate(expanded);
}

/** Declarations `forma:effect` lowers in every Effect program, imported or not (RFC 0029, stages 2-3). */
const declarations = new Set(["service", "error", "class", "layer"]);

/** Body forms `forma:effect` lowers in every Effect program, imported or not (RFC 0029, stage 3). */
const bodyForms = new Set(["catch"]);

function rethrowLibraryError(error: unknown, fallbackLoc: SExpr["loc"]): never {
  const failure = error as { readonly message?: string; readonly loc?: SExpr["loc"]; readonly details?: { readonly code?: unknown } };
  throw Object.assign(new Error(authorNames(String(failure.message ?? error))), {
    loc: failure.loc ?? fallbackLoc,
    details: { code: typeof failure.details?.code === "string" ? failure.details.code : "surface/invalid-form" },
  });
}

/**
 * Lowers top-level `service`, `error`, `class`, and `layer` declarations and
 * nested `catch` forms with the library's macros. A malformed form throws an
 * error carrying the `loc` and `details.code` of the form the macro names.
 */
export function expandEffectDeclarations(exprs: readonly SExpr[]): readonly SExpr[] {
  let cachedEnv: Env | undefined;
  const getEnv = (): Env => (cachedEnv ??= effectLibrary().env);

  const expandBodyForms = (node: SExpr): SExpr => {
    if (node._tag === "Vector") {
      const items = node.items.map(expandBodyForms);
      return items.every((item, i) => item === node.items[i]) ? node : copySourceTrace(node, { ...node, items });
    }
    if (node._tag === "Map") {
      const pairs = node.pairs.map(([k, v]) => [k, expandBodyForms(v)] as const);
      return pairs.every(([k, v], i) => k === node.pairs[i]![0] && v === node.pairs[i]![1]) ? node : copySourceTrace(node, { ...node, pairs });
    }
    if (node._tag !== "List" || node.items.length === 0) return node;
    const h = head(node);
    if (h === "quote" || h === "quasiquote") return node;
    const items = node.items.map(expandBodyForms);
    const updated: SExpr = items.every((item, i) => item === node.items[i]) ? node : copySourceTrace(node, { ...node, items });
    if (!h || !bodyForms.has(h)) return updated;
    try {
      const expanded = expandMacroOnce(updated, getEnv(), { normalize: false })?.expr;
      return expanded ? atAuthoredSyntax(expanded, updated) : updated;
    } catch (error) {
      rethrowLibraryError(error, updated.loc);
    }
  };

  return exprs.map((e) => {
    let lowered = e;
    if (declarations.has(head(e) ?? "")) {
      try {
        const expanded = expandMacroOnce(e, getEnv(), { normalize: false })?.expr;
        lowered = expanded ? atAuthoredSyntax(expanded, e) : e;
      } catch (error) {
        rethrowLibraryError(error, e.loc);
      }
    }
    return expandBodyForms(lowered);
  });
}
