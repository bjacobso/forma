import { Effect } from "effect";
import { checkDescriptors } from "../descriptor/check-descriptors.js";
import { descriptorApplication } from "./descriptor-protocol.js";
import { metaType } from "../descriptor/meta-types.js";
import { headSym, tail } from "../reader/types.js";
import type { SlotSpec } from "../descriptor/FormDescriptor.js";
import type { SExpr } from "../reader/types.js";
import { bootstrapFromSources, type BootstrappedPrelude } from "../descriptor/bootstrap.js";
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
  if (!expressions.some((expression) => ["form", "__form-descriptor", "__form-hook"].includes(head(expression) ?? "")))
    return parent;
  const definitionErrors = checkDescriptors([{sourceId:"source",source}], {prelude:parent?.descriptorPrelude,checkReferences:false});
  const firstError = definitionErrors[0];
  if (firstError) throw new InferenceError({message:firstError.message,details:{code:firstError.code},origin:{nodeId:"descriptor",kind:"descriptor",span:{start:firstError.span!.startOffset,end:firstError.span!.endOffset}}});
  const local = bootstrapFromSources("", "", ...(parent?.descriptorPrelude?.sources ?? []), source);
  const inherited = parent?.descriptorPrelude;
  if (inherited) {
    for (const d of inherited.descriptions.list()) if (!local.descriptions.has(d.name)) local.descriptions.register(d);
  }
  const prelude = {...local, typingHooks: new Map([...(inherited?.typingHooks ?? []), ...(local.typingHooks ?? [])])};
  const applications = expressions.filter((expression) =>
    prelude.descriptions.has(head(expression) ?? ""),
  );
  const validation = expressions.some(e => head(e) === "form") ? elaborateProgram(source, {
    prelude: bootstrapFromSources("", ""),
  }) : { diagnostics: [] };
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
  return descriptorFormProvider(prelude, parent);
}

/**
 * Types descriptor applications with their own hooks; untyped forms default
 * to Declaration. Declaration bindings remain distinct from scoped hook bindings.
 */
export function descriptorFormProvider(
  prelude: BootstrappedPrelude,
  parent?: DSLTypeProvider,
): DSLTypeProvider {
  const metaDefinitions = new Set<string>();
  for (const [name, hook] of prelude.typingHooks ?? []) {
    metaDefinitions.add(name);
    for (const helper of hook.helpers ?? []) if (helper._tag === "List" && helper.items[1]?._tag === "Sym") metaDefinitions.add(helper.items[1].name);
  }
  const provider: DSLTypeProvider = {
    isMetaDefinition: name => metaDefinitions.has(name) || !!parent?.isMetaDefinition?.(name),
    descriptorPrelude: prelude,
    typeApplication: (env, expr, expected) => prelude.descriptions.has(expr.name)
      ? descriptorApplication(prelude, provider, env, expr, expected)
      : parent?.typeApplication?.(env, expr, expected) ?? noDescriptorRule(),
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
    extractTypedSlots: (name, expression) => {
      const descriptor = prelude.descriptions.get(name);
      return descriptor ? typedSlots(expression, descriptor.slots) : parent?.extractTypedSlots(name, expression) ?? [];
    },
  };
  return provider;
}

const noDescriptorRule = () => Effect.succeed(undefined);

function typedSlots(expression: SExpr, specs: readonly SlotSpec[]): {slotName:string;expr:SExpr;expectedType?:import("./types.js").Type}[] {
  const result: {slotName:string;expr:SExpr;expectedType?:import("./types.js").Type}[] = [];
  for (const arg of tail(expression)) {
    const slotName = (arg._tag === "Vector" && arg.items[0]?._tag === "Sym" ? arg.items[0].name : headSym(arg))?.replace(/^:/, "");
    const spec = specs.find(s => s.name === slotName || s.aliases?.includes(slotName ?? ""));
    if (!spec) continue;
    const values = arg._tag === "Vector" ? arg.items.slice(1) : tail(arg);
    for (const value of values) {
      if (spec.type) { result.push({slotName:spec.name,expr:value,expectedType:metaType(spec.type)!}); continue; }
      const shape = spec.childShape;
      if (!shape || value._tag !== "List" && value._tag !== "Vector") continue;
      result.push(...typedSlots(value,shape.slots));
      const positional = value._tag === "Vector" ? value.items : tail(value);
      const offset = shape.identifiers.length;
      for (const [index, slotName] of (shape.positionalSlots ?? []).entries()) {
        const slot = shape.slots.find(s => s.name === slotName);
        const child = positional[offset + index];
        if (child && slot?.type) result.push({slotName:slot.name,expr:child,expectedType:metaType(slot.type)!});
      }
    }
  }
  return result;
}
