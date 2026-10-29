/** Route explicitly typed Effect declarations and their signed helpers to the
 * mechanics checker. Unrelated kernel/descriptor forms remain HM inputs.
 */
import type { PackageableDeclaration } from "../artifact/artifact.js";
import type { Diagnostic } from "../diagnostic/diagnostic.js";
import { diagnosticFromUnknown } from "../diagnostic/diagnostic.js";
import type { SExpr } from "../reader/types.js";
import { head, name, normalizeEffectProgram } from "../surface/effect.js";
import { reachableHelpers } from "../surface/helpers.js";
import { mechanicsPackageableDeclarations } from "./artifact.js";
import { checkMechanicsProgram, type CheckedMechanicsDeclarations } from "./checked.js";

export interface MechanicsAnalysisSource {
  readonly sourceId: string;
  readonly expressions: readonly SExpr[];
}
export interface MechanicsAnalysis extends CheckedMechanicsDeclarations {
  /** Authored forms owned by mechanics, including their signatures. */
  readonly owned: ReadonlySet<SExpr>;
}

export function effectType(expr: SExpr | undefined): boolean {
  if (!expr || expr._tag !== "List") return false;
  return ["Effect", "Stream", "Layer"].includes(head(expr) ?? "") ||
    head(expr) === "->" && effectType(expr.items.at(-1));
}

export function analyzeMechanicsSources(sources: readonly MechanicsAnalysisSource[]): MechanicsAnalysis | undefined {
  if (!sources.some(s => hasEffectDeclarations(s.expressions))) return undefined;
  const expressions = sources.flatMap(s => s.expressions);
  const signatures = new Map(expressions.flatMap(e => head(e) === ":" && e._tag === "List" && name(e.items[1])
    ? [[name(e.items[1])!, e] as const] : []));
  const effectNames = new Set([...signatures].filter(([, e]) => e._tag === "List" && effectType(e.items[2])).map(([n]) => n));
  const roots = expressions.filter(e => ["service", "layer", "__service", "__layer", "__operation"].includes(head(e) ?? "") ||
    head(e) === "define" && e._tag === "List" && effectNames.has(name(e.items[1]) ?? ""));
  if (!roots.length && !effectNames.size) return undefined;
  const effectSources = sources.filter(s => hasEffectDeclarations(s.expressions));
  const local = new Set(effectSources.flatMap(s => s.expressions));
  const signedDefinitions = expressions.filter(e => head(e) === "define" && e._tag === "List" && signatures.has(name(e.items[1]) ?? ""));
  const helpers = reachableHelpers(roots, signedDefinitions);
  const schemas = expressions.filter(e => ["type", "class", "error", "__schema", "__class", "__error"].includes(head(e) ?? ""));
  const owned = new Set([...roots, ...helpers, ...schemas.filter(e => local.has(e))]);
  // Pull in only referenced metadata from other prelude/module units. Compiler
  // and domain preludes also contain type declarations owned by their checkers.
  const metadata = new Map(schemas.flatMap(e => e._tag === "List" && name(e.items[1]) ? [[name(e.items[1])!, e] as const] : []));
  const visit = (e: SExpr): void => {
    if (e._tag === "Sym") {
      const definition = metadata.get(e.name);
      if (definition && !owned.has(definition)) { owned.add(definition); visit(definition); }
    } else if (e._tag === "Map") e.pairs.forEach(([,v]) => visit(v));
    else if (e._tag === "List" || e._tag === "Vector") e.items.forEach(visit);
  };
  const names = new Set([...owned].flatMap(e => e._tag === "List" && name(e.items[1]) ? [name(e.items[1])!] : []));
  for (const [n, e] of signatures) if (effectNames.has(n) || names.has(n)) owned.add(e);
  [...owned].forEach(visit);
  // A signed declaration in a later document can use a mechanics-owned schema
  // or helper from a prelude without declaring a new service/Effect itself.
  let changed = true;
  while (changed) {
    changed = false;
    for (const helper of reachableHelpers([...owned], signedDefinitions)) {
      if (owned.has(helper)) continue;
      owned.add(helper);
      const n = helper._tag === "List" ? name(helper.items[1]) : undefined;
      const signature = n ? signatures.get(n) : undefined;
      if (signature) { owned.add(signature); visit(signature); }
      visit(helper);
      changed = true;
    }
    const ownedNames = new Set([...owned].flatMap(e => e._tag === "List" && name(e.items[1]) ? [name(e.items[1])!] : []));
    const referencesOwned = (e: SExpr): boolean => e._tag === "Sym" ? ownedNames.has(e.name.split(".")[0]!) :
      e._tag === "Map" ? e.pairs.some(([,v]) => referencesOwned(v)) :
      e._tag === "List" || e._tag === "Vector" ? head(e) !== "quote" && e.items.some(referencesOwned) : false;
    for (const e of signedDefinitions) {
      const n = e._tag === "List" ? name(e.items[1]) : undefined;
      const signature = n ? signatures.get(n) : undefined;
      if (owned.has(e) || !signature || !referencesOwned(signature) && !referencesOwned(e)) continue;
      owned.add(e);
      owned.add(signature);
      visit(signature);
      visit(e);
      changed = true;
    }
  }
  const diagnostics: Diagnostic[] = [];
  // Validate/recover one form at a time before normalizing in the full scope.
  // Full-scope normalization is needed for signatures, constructors and layers.
  const usable = expressions.filter(e => {
    if (!owned.has(e)) return false;
    try { normalizeEffectProgram([...signatures.values(), e]); return true; }
    catch (error) {
      const sourceId = sources.find(s => s.expressions.includes(e))!.sourceId;
      const d = diagnosticFromUnknown(error, "elaborate", sourceId);
      diagnostics.push({ ...d, span: d.span ?? { sourceId, startOffset: e.loc.start, endOffset: e.loc.end } });
      return false;
    }
  });
  let normalized: readonly SExpr[];
  try { normalized = normalizeEffectProgram(usable); }
  catch (error) {
    const d = diagnosticFromUnknown(error, "elaborate", sources.at(-1)?.sourceId ?? "source");
    return { ...checkMechanicsProgram([]), ok: false, diagnostics: [...diagnostics, d], owned };
  }
  const declarations: PackageableDeclaration[] = [];
  for (const source of sources) {
    const locations = new Set(source.expressions.map(e => e.loc));
    for (const expression of normalized.filter(e => locations.has(e.loc))) {
      const projected = mechanicsPackageableDeclarations([expression], source.sourceId, true, normalized);
      if (projected.ok) declarations.push(...projected.declarations);
      else diagnostics.push(...projected.diagnostics.map(d => ({ ...d, severity: "error" as const, phase: "elaborate" as const })));
    }
  }
  const checked = checkMechanicsProgram(declarations);
  return { ...checked, ok: checked.ok && !diagnostics.some(d => d.severity === "error"), diagnostics: [...diagnostics, ...checked.diagnostics], owned };
}

/** A structural declaration test, never a reason to suppress checks on other forms. */
export function hasEffectDeclarations(expressions: readonly SExpr[]): boolean {
  return expressions.some(e => ["service", "layer", "__service", "__layer", "__operation"].includes(head(e) ?? "") ||
    head(e) === ":" && e._tag === "List" && effectType(e.items[2]));
}
