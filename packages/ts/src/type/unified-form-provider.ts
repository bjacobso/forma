import type { SExpr } from "../reader/types.js";
import { bootstrapFromSources } from "../descriptor/bootstrap.js";
import { elaborateProgram } from "../descriptor/elaborate.js";
import { head } from "../surface/effect.js";
import { matchFormSyntax } from "../surface/form.js";
import { InferenceError } from "./errors.js";
import { mono, TCon } from "./types.js";
import type { DSLTypeProvider } from "./dsl-provider.js";

/** Source-local forms use the same validation pipeline as loaded preludes. */
export function unifiedFormProvider(source: string, expressions: readonly SExpr[], parent?: DSLTypeProvider): DSLTypeProvider | undefined {
  if (!expressions.some(expression => head(expression) === "form")) return parent;
  const prelude = bootstrapFromSources("", "", source);
  const applications = expressions.filter(expression => prelude.descriptions.has(head(expression) ?? ""));
  const validation = elaborateProgram(source, {prelude: bootstrapFromSources("", "")});
  const error = validation.diagnostics.find(diagnostic => diagnostic.severity === "error" &&
    (diagnostic.code === "elaborate/form-definition" || applications.some(expression =>
      diagnostic.span && diagnostic.span.startOffset >= expression.loc.start && diagnostic.span.endOffset <= expression.loc.end)));
  if (error) throw new InferenceError({message:error.message, details:{code:error.code},
    ...(error.span ? {origin:{span:{start:error.span.startOffset,end:error.span.endOffset},kind:"form",nodeId:"form"}} : {})});
  return {
    isKnownForm: name => prelude.descriptions.has(name) || !!parent?.isKnownForm(name),
    getSlots: name => parent?.getSlots(name) ?? [],
    getResultType: name => prelude.descriptions.has(name) ? TCon("Declaration") : parent?.getResultType(name),
    getTypeBindings(name, expression) {
      const descriptor = prelude.descriptions.get(name);
      if (!descriptor?.surface) return parent?.getTypeBindings(name,expression) ?? new Map();
      const holes = matchFormSyntax(descriptor.surface,expression);
      return new Map(descriptor.identifiers.filter(identifier=>identifier.declaration).flatMap(identifier=> {
        const hole = holes.get(identifier.name);
        return hole?._tag === "Sym" ? [[hole.name,mono(TCon("Declaration"))] as const] : [];
      }));
    },
    extractTypedSlots: (name,expression) => prelude.descriptions.has(name) ? [] : parent?.extractTypedSlots(name,expression) ?? [],
  };
}
