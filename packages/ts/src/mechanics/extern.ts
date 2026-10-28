/**
 * `(extern "module" declaration...)` binds exports of an existing TypeScript
 * module under Forma declarations. The declarations are checked exactly like
 * local ones, but the generator imports them instead of defining them, so the
 * module's real implementation (a hand-written layer, an npm function, an
 * Effect schema) is what runs.
 *
 * ```lisp
 * (extern "./payments.js"
 *   (error PaymentDeclined {:reason String})
 *   (service Payments
 *     (: charge (-> OrderId Int (Effect Receipt [PaymentDeclined]))))
 *   (: PaymentsLive (Layer [Payments]))
 *   (: format-cents (-> Int String))
 *   (: random-id (-> String) :export "randomId"))
 * ```
 *
 * Forma trusts the declared types. The TypeScript compiler checks the
 * generated imports against the module's real exports.
 *
 * @module
 */
import type { JsonValue } from "../artifact/artifact.js";
import type { SExpr } from "../reader/types.js";
import { camelIdentifier, isIdentifierName, typeName } from "./naming.js";
import { isRecord } from "./types.js";

/** Where a declaration's implementation lives. */
export interface ExternBinding {
  /** The module specifier, emitted verbatim. */
  readonly module: string;
  /** The TypeScript export name. */
  readonly export: string;
}

/** An imported declaration and the authored form that declared it inside `extern`. */
export interface ExternImport extends ExternBinding {
  readonly loc: SExpr["loc"];
}

export interface ExternDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly expr: SExpr;
}

export interface FlattenedExterns {
  /** Top-level forms with each `extern` replaced by the declarations it contains. */
  readonly exprs: readonly SExpr[];
  /** Declaration name to its TypeScript module, export, and declaring form. */
  readonly externs: ReadonlyMap<string, ExternImport>;
  readonly diagnostics: readonly ExternDiagnostic[];
}

const declarationHeads = new Set(["type", "class", "error", "service"]);
const pascalHeads = new Set(["type", "class", "error", "service"]);

/** The extern payload field, shared by projection and generation. */
export function externJson(binding: ExternBinding): JsonValue {
  // Only the module and export are portable; the declaring form stays in the engine.
  return { module: binding.module, export: binding.export };
}

/** Reads the `extern` field of a declaration payload. */
export function externOf(payload: JsonValue | undefined): ExternBinding | undefined {
  if (!isRecord(payload)) return undefined;
  const extern = payload["extern"];
  if (!isRecord(extern)) return undefined;
  const module = extern["module"];
  const exported = extern["export"];
  return typeof module === "string" && typeof exported === "string" ? { module, export: exported } : undefined;
}

/**
 * Replaces each top-level `extern` with its declarations and records which
 * names are imported. Signatures inside `extern` stay `(: name Type)` forms
 * so that type normalization treats them like any other signature; the
 * projection turns them into body-less declarations.
 */
export function flattenExterns(exprs: readonly SExpr[]): FlattenedExterns {
  if (!exprs.some((expr) => headName(expr) === "extern")) return { exprs, externs: new Map(), diagnostics: [] };
  const flattened: SExpr[] = [];
  const externs = new Map<string, ExternImport>();
  const diagnostics: ExternDiagnostic[] = [];
  const fail = (expr: SExpr, message: string): void => {
    diagnostics.push({ code: "mechanics/extern", message, expr });
  };
  for (const expr of exprs) {
    if (headName(expr) !== "extern" || expr._tag !== "List") {
      flattened.push(expr);
      continue;
    }
    const specifier = expr.items[1];
    if (specifier?._tag !== "Str" || specifier.value.trim() === "") {
      fail(specifier ?? expr, 'extern expects a module specifier string, then declarations: (extern "./module.js" (: name Type) ...).');
      continue;
    }
    if (expr.items.length === 2) {
      fail(expr, `extern "${specifier.value}" declares nothing; list the types, services, and values it exports.`);
      continue;
    }
    for (const member of expr.items.slice(2)) {
      const declaration = externMember(member, fail);
      if (!declaration) continue;
      const previous = externs.get(declaration.name);
      if (previous) {
        fail(member, `${declaration.name} is already imported from "${previous.module}".`);
        continue;
      }
      externs.set(declaration.name, { module: specifier.value, export: declaration.exportName, loc: member.loc });
      flattened.push(declaration.form);
    }
  }
  return { exprs: flattened, externs, diagnostics };
}

function externMember(
  member: SExpr,
  fail: (expr: SExpr, message: string) => void,
): { readonly name: string; readonly exportName: string; readonly form: SExpr } | undefined {
  const head = headName(member);
  if (member._tag !== "List" || (head !== ":" && !declarationHeads.has(head ?? ""))) {
    const what = head === "define" || head === "layer" ? `${head} has a Forma implementation` : "this form is not a declaration";
    fail(member, `extern declares bindings that TypeScript implements; ${what}. Use type, class, error, service, or (: name Type).`);
    return undefined;
  }
  let items = member.items;
  let exportName: string | undefined;
  const exportAt = items.findIndex((item) => item._tag === "Sym" && item.name === ":export");
  if (exportAt >= 0) {
    const value = items[exportAt + 1];
    if (value?._tag !== "Str" || !isIdentifierName(value.value) || exportAt + 2 !== items.length) {
      fail(value ?? items[exportAt]!, ':export must be the last option and name a TypeScript identifier, as in :export "randomUUID".');
      return undefined;
    }
    exportName = value.value;
    items = items.slice(0, exportAt);
  }
  const nameExpr = items[1];
  const name = nameExpr?._tag === "Sym" ? nameExpr.name : undefined;
  if (!name) {
    fail(member, head === ":" ? "An extern signature is (: name Type)." : `extern ${head} needs a name.`);
    return undefined;
  }
  if (head === ":" && items.length !== 3) {
    fail(member, `An extern signature is (: ${name} Type).`);
    return undefined;
  }
  const local = pascalHeads.has(head!) || (head === ":" && isLayerType(items[2])) ? typeName(name) : camelIdentifier(name);
  return {
    name,
    exportName: exportName ?? local,
    form: items === member.items ? member : { ...member, items },
  };
}

/** A signature type that declares a layer rather than a value. */
export function isLayerType(type: SExpr | undefined): boolean {
  return headName(type) === "Layer";
}

function headName(expr: SExpr | undefined): string | undefined {
  return expr?._tag === "List" && expr.items[0]?._tag === "Sym" ? expr.items[0].name : undefined;
}
