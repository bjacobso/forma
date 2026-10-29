/** Shared semantic boundary over mechanics IR. The IR objects and check tables
 * belong to one result: cloning/reprojecting them invalidates the WeakMap keys.
 * No source or check result is cached here.
 */
import type { PackageableDeclaration } from "../artifact/artifact.js";
import type { Diagnostic, Span } from "../diagnostic/diagnostic.js";
import { checkMechanicsDeclarations, type CheckInfo } from "./check.js";
import { isRecord, showType } from "./types.js";

export interface MechanicsTypedSpan {
  readonly span: Span;
  readonly display: string;
  readonly exprTag: string;
}
export interface CheckedMechanicsDeclarations {
  readonly ok: boolean;
  readonly declarations: readonly PackageableDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
  readonly check: CheckInfo;
  readonly typedSpans: readonly MechanicsTypedSpan[];
  readonly bindingTypes: ReadonlyMap<string, string>;
}

export function checkMechanicsProgram(declarations: readonly PackageableDeclaration[]): CheckedMechanicsDeclarations {
  const result = checkMechanicsDeclarations(declarations);
  const typedSpans: MechanicsTypedSpan[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!isRecord(value)) return;
    const type = result.info.effectTypes.get(value) ?? result.info.valueTypes.get(value);
    const span = value["span"];
    if (type && type.kind !== "unknown" && isRecord(span) && typeof span["sourceId"] === "string" &&
      typeof span["startOffset"] === "number" && typeof span["endOffset"] === "number") {
      typedSpans.push({ span: { sourceId: span["sourceId"], startOffset: span["startOffset"], endOffset: span["endOffset"] },
        display: showType(type), exprTag: `Mechanics.${String(value["kind"] ?? "Expression")}` });
    }
    for (const [key, child] of Object.entries(value)) if (key !== "span") visit(child);
  };
  declarations.forEach(d => visit(d.payload));
  const bindingTypes = new Map<string, string>();
  for (const [name, signature] of [...result.info.operations, ...result.info.functions]) {
    bindingTypes.set(name, signature.params.length || result.info.functions.has(name)
      ? `(-> ${[...signature.params.map(p => showType(p.type)), showType(signature.result)].join(" ")})`
      : showType(signature.result));
  }
  for (const [name, type] of result.info.constants) bindingTypes.set(name, showType(type));
  for (const [name, layer] of result.info.layers) bindingTypes.set(name, showType({kind:"layer", layer:layer.type}));
  for (const declaration of declarations) {
    const display = declaration.summary.name && bindingTypes.get(declaration.summary.name);
    if (display && declaration.span) typedSpans.push({span:declaration.span, display, exprTag:"Mechanics.Declaration"});
  }
  return { ok: result.ok, declarations, check: result.info, typedSpans, bindingTypes,
    diagnostics: result.diagnostics.map(d => ({ ...d, phase: "typecheck" })) };
}
