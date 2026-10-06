import type { SExpr } from "../reader/types.js";
import { bootstrapFromSources } from "../descriptor/bootstrap.js";
import { elaborateProgram } from "../descriptor/elaborate.js";
import { head } from "../surface/effect.js";
import { matchFormSyntax } from "../surface/form.js";
import { InferenceError } from "./errors.js";
import { mono, TCon } from "./types.js";
import type { DSLTypeProvider } from "./dsl-provider.js";
import { parse, toSExprMany } from "../reader/index.js";

/** Source-local forms use the same validation pipeline as loaded preludes. */
export function unifiedFormProvider(
  source: string,
  expressions: readonly SExpr[],
  parent?: DSLTypeProvider,
): DSLTypeProvider | undefined {
  if (!expressions.some((expression) => head(expression) === "form"))
    return parent;
  const prelude = bootstrapFromSources("", "", source);
  const applications = expressions.filter((expression) =>
    prelude.descriptions.has(head(expression) ?? ""),
  );
  const validation = elaborateProgram(source, {
    prelude: bootstrapFromSources("", ""),
  });
  // Module resolution changes identifier lengths, but the original AST keeps
  // author locations. Pair the parsed validation syntax with that AST before
  // selecting applications or reporting a diagnostic.
  const locations: { generated: SExpr; authored: SExpr }[] = [];
  const pair = (generated: SExpr, authored: SExpr): void => {
    locations.push({ generated, authored });
    if (generated._tag === "Map" && authored._tag === "Map")
      generated.pairs.forEach(([k, v], i) => {
        const p = authored.pairs[i];
        if (p) {
          pair(k, p[0]);
          pair(v, p[1]);
        }
      });
    else if (
      (generated._tag === "List" || generated._tag === "Vector") &&
      (authored._tag === "List" || authored._tag === "Vector")
    )
      generated.items.forEach((e, i) => {
        if (authored.items[i]) pair(e, authored.items[i]!);
      });
  };
  if (validation.diagnostics.length) {
    toSExprMany(parse(source).redTree).forEach((e, i) => {
      if (expressions[i]) pair(e, expressions[i]!);
    });
    locations.sort(
      (a, b) =>
        a.generated.loc.end -
        a.generated.loc.start -
        (b.generated.loc.end - b.generated.loc.start),
    );
  }
  const diagnostics = validation.diagnostics.map((diagnostic) => {
    const span = diagnostic.span;
    const location =
      span &&
      locations.find(
        ({ generated }) =>
          generated.loc.start <= span.startOffset &&
          generated.loc.end >= span.endOffset,
      )?.authored.loc;
    return span && location
      ? {
          ...diagnostic,
          span: {
            ...span,
            startOffset: location.start,
            endOffset: location.end,
            ...(location.sourceId ? { sourceId: location.sourceId } : {}),
          },
        }
      : diagnostic;
  });
  const error = diagnostics.find(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      (diagnostic.code === "elaborate/form-definition" ||
        applications.some(
          (expression) =>
            diagnostic.span &&
            diagnostic.span.startOffset >= expression.loc.start &&
            diagnostic.span.endOffset <= expression.loc.end,
        )),
  );
  if (error)
    throw new InferenceError({
      message: error.message,
      details: { code: error.code },
      ...(error.span
        ? {
            origin: {
              span: {
                start: error.span.startOffset,
                end: error.span.endOffset,
              },
              kind: "form",
              nodeId: "form",
            },
          }
        : {}),
    });
  return {
    isKnownForm: (name) =>
      prelude.descriptions.has(name) || !!parent?.isKnownForm(name),
    getSlots: (name) => parent?.getSlots(name) ?? [],
    getResultType: (name) =>
      prelude.descriptions.has(name)
        ? TCon("Declaration")
        : parent?.getResultType(name),
    getTypeBindings(name, expression) {
      const descriptor = prelude.descriptions.get(name);
      if (!descriptor?.surface)
        return parent?.getTypeBindings(name, expression) ?? new Map();
      const holes = matchFormSyntax(descriptor.surface, expression);
      return new Map(
        descriptor.identifiers
          .filter((identifier) => identifier.declaration)
          .flatMap((identifier) => {
            const hole = holes.get(identifier.name);
            return hole?._tag === "Sym"
              ? [[hole.name, mono(TCon("Declaration"))] as const]
              : [];
          }),
      );
    },
    extractTypedSlots: (name, expression) =>
      prelude.descriptions.has(name)
        ? []
        : (parent?.extractTypedSlots(name, expression) ?? []),
  };
}
