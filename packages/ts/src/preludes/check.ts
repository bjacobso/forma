import { bootstrapFromSources, type BootstrapOptions } from "../descriptor/bootstrap.js";
import { checkDescriptors } from "../descriptor/check-descriptors.js";
import { elaborateProgram, ElaborationFailure, type ProgramSource } from "../descriptor/elaborate.js";
import { diagnosticCatalog, type DiagnosticCatalog } from "../diagnostic/catalog.js";
import { diagnosticFromUnknown, type Diagnostic } from "../diagnostic/diagnostic.js";
import { parse, toSExprMany } from "../reader/index.js";
import { headSym, type SExpr } from "../reader/types.js";
import { Env } from "../Env.js";
import { validatePreludeMetacheck } from "../engine/session-validation.js";

export interface CheckPreludeOptions extends BootstrapOptions {
  /** Dependencies are bootstrapped but their documentation is not checked. */
  readonly dependencies?: readonly ProgramSource[];
  readonly catalog?: DiagnosticCatalog;
}

export interface CheckPreludeResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly forms: number;
  readonly examples: number;
  /** Deterministic reference Markdown for the consumer's forms. */
  readonly reference: string;
}

/** Check a consumer prelude without repository scripts or filesystem access.
 * Literal :code fields and diagnostics actually emitted by examples must be
 * registered. Dynamically constructed codes need consumer tests as well.
 */
export function checkPrelude(sources: readonly ProgramSource[], options: CheckPreludeOptions = {}): CheckPreludeResult {
  const inputs = [...options.dependencies ?? [], ...sources];
  const diagnostics: Diagnostic[] = [...checkDescriptors(inputs)];
  const catalog = options.catalog ?? diagnosticCatalog;
  let forms = 0, examples = 0;
  const reference = ["# Prelude reference", ""];
  const result = (): CheckPreludeResult => ({ok:!diagnostics.some(d => d.severity === "error"),diagnostics,forms,examples,reference:reference.join("\n")});
  if (diagnostics.some(d => d.severity === "error")) return result();
  try {
    const prelude = bootstrapFromSources(inputs, options);
    diagnostics.push(...validatePreludeMetacheck(Env.empty(),inputs,prelude));
    if (diagnostics.some(d => d.severity === "error")) return result();
    for (const {sourceId, source} of sources) {
      const expressions = toSExprMany(parse(source).redTree, sourceId);
      const report = (expr: SExpr, code: string, message: string) => diagnostics.push({code,severity:"error",message,span:{sourceId,startOffset:expr.loc.start,endOffset:expr.loc.end}});
      const coverage = (expr: SExpr): void => {
        if (expr._tag === "Map") {
          for (const [key,value] of expr.pairs) {
            if (key._tag === "Sym" && key.name === ":code" && value._tag === "Str" && !catalog.get(value.value))
              report(value,"prelude/diagnostic-coverage",`Register diagnostic ${value.value} in the consumer catalog.`);
            coverage(key); coverage(value);
          }
        } else if ("items" in expr) for (const item of expr.items) coverage(item);
      };
      for (const expr of expressions) {
        coverage(expr);
        if (expr._tag !== "List" || !["form","__form-descriptor"].includes(headSym(expr) ?? "")) continue;
        const signature = expr.items[1];
        const name = signature?._tag === "List" ? signature.items[0] : signature;
        const descriptor = name?._tag === "Sym" ? prelude.descriptions.get(name.name) : undefined;
        if (!descriptor) continue;
        forms++;
        if (!descriptor.doc?.trim()) report(expr,"prelude/docstring",`Form ${descriptor.name} needs a nonempty docstring.`);
        if (!descriptor.examples?.length) report(expr,"prelude/examples",`Form ${descriptor.name} needs at least one :examples entry.`);
        reference.push(`## ${descriptor.name}`, "", descriptor.doc ?? "", "");
        for (const [index,example] of (descriptor.examples ?? []).entries()) {
          examples++;
          const checked = elaborateProgram(example,{prelude,sourceId:`${sourceId}#${descriptor.name}-example-${index + 1}`});
          diagnostics.push(...checked.diagnostics);
          for (const diagnostic of checked.diagnostics) if (!catalog.get(diagnostic.code))
            report(expr,"prelude/diagnostic-coverage",`Register diagnostic ${diagnostic.code} emitted by example ${index + 1}.`);
          // A longer fence preserves examples containing Markdown backticks.
          const fence = "`".repeat(Math.max(3, ...[...example.matchAll(/`+/g)].map(m => m[0].length + 1)));
          reference.push(`${fence}forma`, example, fence, "");
        }
      }
    }
  } catch (error) {
    diagnostics.push(...error instanceof ElaborationFailure ? error.diagnostics : [diagnosticFromUnknown(error,"elaborate",sources[0]?.sourceId ?? "prelude")]);
  }
  return result();
}
