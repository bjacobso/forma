import { isKFloat } from "../evaluator/types.js";
/** Load phases are pure queries over parsed forms; only the host commits their results.
 * Keep form results separate so RFC 0004 stage 5 can memoize them by syntax identity.
 */
import * as Type from "../Type.js";
import { Effect } from "effect";
import { bootstrapFromSources, type BootstrappedPrelude } from "../descriptor/bootstrap.js";
import { createMetaBuiltins } from "../descriptor/meta-builtins.js";
import { SimpleSemanticEnvironment } from "../descriptor/SemanticEnvironment.js";
import { reachableHelpers } from "../surface/helpers.js";
import { parseMetaFnDecl } from "../descriptor/meta-fn-decl.js";
import { descriptorFormProvider } from "../type/unified-form-provider.js";
import { normalizeForm } from "../descriptor/normalize.js";
import { recognizeForm } from "../descriptor/recognize.js";
import { normalizeCoreProgram } from "../surface/core.js";
import { head, name } from "../surface/effect.js";
import { analyzeLsp, type LspResult } from "../lsp/hm-lsp.js";
import { analyzeOptions, buildPreludeScopes, type Scope } from "../analysis/scope.js";
import { expandKernelExprsSync } from "../evaluator/frontend.js";
import { parse, toSExprMany } from "../reader/index.js";
import type { SExpr } from "../reader/types.js";
import type { LanguageSession } from "../session/session.js";
import type { Env } from "../Env.js";
import { diagnosticFromUnknown, type Diagnostic } from "../diagnostic/diagnostic.js";
import type { TypecheckRequest } from "./operations.js";
import { typeInferOptions, typeProjection } from "./operations.js";

export interface SourceBinding {
  readonly name: string;
  /** Symbol declarations belong to their module; string identities are global. */
  readonly global: boolean;
}
export interface SourceValidation {
  readonly diagnostics: readonly Diagnostic[];
  readonly bindings: readonly SourceBinding[];
}

function located(sourceId: string, expr: SExpr, code: string, message: string): Diagnostic {
  return { code, message, severity: "error", phase: "typecheck", span: {
    sourceId, startOffset: expr.loc.start, endOffset: expr.loc.end,
    startLine: expr.loc.line, startColumn: expr.loc.col,
  } };
}

/** Surface grammar only: quoted syntax is data and unresolved references are legal. */
export function validateSurface(sourceId: string, expr: SExpr): readonly Diagnostic[] {
  try {
    normalizeCoreProgram([expr], false);
    return [];
  } catch (error) {
    const diagnostic = diagnosticFromUnknown(error, "typecheck", sourceId);
    return [{ ...diagnostic, code: "surface/invalid-form", span: diagnostic.span ?? located(sourceId, expr, "", "").span }];
  }
}

/** Module metadata syntax, without resolving imports (bundles can load in either order). */
function validateDirective(sourceId: string, expr: SExpr): readonly Diagnostic[] {
  if (expr._tag !== "List") return [];
  const h = head(expr), args = expr.items.slice(1);
  const scalar = (e: SExpr | undefined) => e?._tag === "Str" || e?._tag === "Sym";
  const names = (e: SExpr | undefined) => e?._tag === "Vector" && e.items.every(scalar);
  const valid = h === "use" ? args.length === 1 && scalar(args[0])
    : h === "import" ? args.length === 2 && scalar(args[0]) && names(args[1]) || args.length === 3 && scalar(args[0]) && name(args[1]) === ":as" && scalar(args[2])
    : h === "export" ? args.length > 0 && args.every(scalar)
    : args.length === 2 && scalar(args[0]) && names(args[1]);
  return valid ? [] : [located(sourceId, expr, `module.${h}.malformed`, `Malformed ${h} declaration.`)];
}

/** Static descriptor shape checks only; hooks and reference typing belong to analysis. */
export function validateSourceForms(
  sourceId: string,
  expressions: readonly SExpr[],
  prelude: BootstrappedPrelude,
): SourceValidation {
  const diagnostics: Diagnostic[] = [], bindings: SourceBinding[] = [];
  const seen = new Set<string>();
  for (const expr of expressions) {
    if (["use", "import", "export", "export-from"].includes(head(expr) ?? "")) {
      diagnostics.push(...validateDirective(sourceId, expr));
      continue;
    }
    diagnostics.push(...validateSurface(sourceId, expr));
    try {
      const recognized = recognizeForm(expr, prelude.descriptions);
      if (!recognized) continue;
      const form = normalizeForm(recognized, prelude.descriptions);
      for (const id of form.descriptor.identifiers) {
        if (!form.identifiers.has(id.name)) diagnostics.push(located(sourceId, expr, "descriptor/missing-identifier", `${form.formName} is missing its ${id.name}`));
      }
      for (const slot of form.descriptor.slots) {
        if (slot.required && !form.slots.has(slot.name)) diagnostics.push(located(sourceId, expr, "descriptor/missing-slot", `${form.formName} requires :${slot.name}`));
      }
      for (const id of form.descriptor.identifiers) {
        const type = form.descriptor.surface?.holes.get(id.name);
        const declares = type ? head(type) === "Declares" : form.descriptor.bindings.kind !== "none";
        const binding = form.identifiers.get(id.name);
        if (!declares || binding === undefined) continue;
        if (seen.has(binding)) diagnostics.push(located(sourceId, expr, "surface/invalid-form", `Duplicate declaration ${binding}`));
        seen.add(binding);
        bindings.push({ name: binding, global: id.kind === "String" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unknownSlot = /Unknown (?:slot|option) (:\S+)/.exec(message);
      const target = unknownSlot && expr._tag === "List"
        ? expr.items.find(item => name(item) === unknownSlot[1] || head(item) === unknownSlot[1]) ?? expr : expr;
      diagnostics.push(located(sourceId, target, unknownSlot ? "descriptor/unknown-slot" : "descriptor/invalid-application", message));
    }
  }
  return { diagnostics, bindings };
}

export function validateSourceLoad(session: LanguageSession, sourceId: string, expressions: readonly SExpr[], source: string): SourceValidation {
  try {
    const hasMetadata = expressions.some(e => ["type", "class", "error", "form", "__form-descriptor"].includes(head(e) ?? ""));
    const prelude = hasMetadata ? bootstrapFromSources("", "", ...session.orderedSources("prelude").map(s => s.text), source)
      : session.scope.prelude ?? bootstrapFromSources("", "");
    const result = validateSourceForms(sourceId, expressions, prelude);
    const diagnostics = [...result.diagnostics];
    for (const [owner, syntax] of session.parsedSources) {
      if (owner === sourceId) continue;
      const otherPrelude = syntax.some(e => head(e) === "form" || head(e) === "__form-descriptor")
        ? bootstrapFromSources("", "", ...session.orderedSources("prelude").map(s => s.text), session.sourceText(owner) ?? "") : prelude;
      const other = validateSourceForms(owner, syntax, otherPrelude).bindings;
      for (const binding of result.bindings) {
        if (binding.global && other.some(b => b.global && b.name === binding.name)) {
          const expr = expressions.find(e => e._tag === "List" && e.items.some(i => i._tag === "Str" && i.value === binding.name)) ?? expressions[0]!;
          diagnostics.push(located(sourceId, expr, "surface/invalid-form", `Duplicate declaration ${binding.name}`));
        }
      }
    }
    return { ...result, diagnostics };
  } catch (error) {
    return { bindings: [], diagnostics: [{ ...diagnosticFromUnknown(error, "typecheck", sourceId), span: { sourceId, startOffset: expressions[0]?.loc.start ?? 0, endOffset: expressions[0]?.loc.end ?? 0 } }] };
  }
}

export function inferenceDiagnostics(sourceId: string, result: LspResult): readonly Diagnostic[] {
  return [
    ...result.errors.map(error => ({ code: error.diagnosticCode ?? "typecheck/error", severity: "error" as const, message: error.message, phase: "typecheck" as const,
      ...(error.span ? { span: { sourceId, startOffset: error.span.start, endOffset: error.span.end } } : {}) })),
    ...result.diagnostics.map(d => ({ code: d.code ?? "typecheck/diagnostic", severity: d.severity, message: d.message, phase: "typecheck" as const,
      ...(d.span ? { span: { sourceId, startOffset: d.span.start, endOffset: d.span.end } } : {}) })),
  ];
}

/** Compile-time helpers use hosted meta builtins and the descriptor type system.
 * Their contracts belong to the metacheck seam, rather than kernel HM inference.
 */
function descriptorTypingInputs(
  sources: readonly { readonly sourceId: string; readonly text: string }[],
  prelude: BootstrappedPrelude,
): { readonly sources: readonly { readonly sourceId: string; readonly text: string }[]; readonly helpers: ReadonlySet<string> } {
  const parsed = sources.map(source => ({ ...source, expressions: toSExprMany(parse(source.text).redTree) }));
  const definitions = parsed.flatMap(source => source.expressions.filter(expr => head(expr) === "define"));
  const metaNames = new Set(Object.keys(createMetaBuiltins(new SimpleSemanticEnvironment())));
  const referencesMeta = (expr: SExpr): boolean => expr._tag === "Sym" ? metaNames.has(expr.name)
    : expr._tag === "Map" ? expr.pairs.some(([, value]) => referencesMeta(value))
    : expr._tag === "List" || expr._tag === "Vector" ? head(expr) !== "quote" && expr.items.some(referencesMeta) : false;
  // parsePrelude treats functions in a descriptor module as hosted helpers,
  // including unused helpers. Their Map/record and meta vocabulary differs from
  // kernel HM; the descriptor metacheck owns these bodies as well as hook bodies.
  const descriptorHelpers = parsed.filter(source => source.expressions.some(expr => head(expr) === "form" || head(expr) === "__form-hook"))
    .flatMap(source => source.expressions.filter(expr => head(expr) === "define" && expr._tag === "List"
      && (expr.items[2]?._tag === "Vector" && expr.items.length >= 4 || head(expr.items[2]) === "fn")));
  const roots = [...definitions.filter(referencesMeta), ...descriptorHelpers];
  const hooks = parsed.flatMap(source => source.expressions.flatMap(expr => { const hook = parseMetaFnDecl(expr); return hook ? [hook.body] : []; }));
  const helpers = new Set([
    ...prelude.descriptions.list().flatMap(descriptor => descriptor.surface?.helpers ?? []),
    ...reachableHelpers([...roots, ...hooks], definitions),
    ...roots,
  ].flatMap(expr => expr._tag === "List" && name(expr.items[1]) ? [name(expr.items[1])!] : []));
  return {
    helpers,
    sources: parsed.map(({ sourceId, text, expressions }) => {
      const omitted = expressions.filter(expr => ["form", "__form-descriptor", "__form-hook", "__elaboration"].includes(head(expr) ?? "")
        || head(expr) === "define" && expr._tag === "List" && helpers.has(name(expr.items[1]) ?? ""));
      for (const expr of omitted) text = text.slice(0, expr.loc.start) + text.slice(expr.loc.start, expr.loc.end).replace(/[^\r\n]/g, " ") + text.slice(expr.loc.end);
      return { sourceId, text };
    }),
  };
}

/** Rebuild after replacements so neither removed values nor removed schemes survive. */
export function validatePreludeTypes(
  sources: readonly { readonly sourceId: string; readonly text: string }[],
  options: Pick<TypecheckRequest, "hostBuiltins" | "typePolicy">,
  configurationEnv?: Env,
): { readonly scope?: Scope; readonly diagnostics: readonly Diagnostic[] } {
  try {
    // Bootstrap errors must be fatal here; editor analysis deliberately recovers them.
    const prelude = bootstrapFromSources("", "", ...sources.map(s => s.text));
    const inputs = descriptorTypingInputs(sources, prelude);
    const inferOptions = typeInferOptions(options);
    const scopes = buildPreludeScopes(inputs.sources, {
      ...inferOptions,
      unboundSymbolType: name => inputs.helpers.has(name) ? Type.tUnknown
        : configurationEnv?.has(name) ? configuredBindingType(configurationEnv, name)
        : inferOptions.unboundSymbolType?.(name),
    });
    const typeEnv = new Map(scopes.scope.typeEnv);
    for (const helper of inputs.helpers) if (!typeEnv.has(helper)) typeEnv.set(helper, Type.mono(Type.tUnknown));
    return { scope: { ...scopes.scope, typeEnv, prelude, formProvider: descriptorFormProvider(prelude) },
      diagnostics: scopes.layers.flatMap(layer => inferenceDiagnostics(layer.sourceId, layer.analysis)) };
  } catch (error) {
    const source = sources.at(-1);
    const diagnostic = diagnosticFromUnknown(error, "typecheck", source?.sourceId ?? "prelude");
    return { diagnostics: [{ ...diagnostic, span: diagnostic.span ?? { sourceId: source?.sourceId ?? "prelude", startOffset: 0, endOffset: source?.text.length ?? 0 } }] };
  }
}

/** Analyze a session snapshot using retained schemes rather than typing every binding as Any. */
export function checkSessionTypes(request: TypecheckRequest & { readonly session: LanguageSession; readonly source: string }, sourceId: string, dslProvider?: Type.DSLTypeProvider): import("./operations.js").TypecheckResult {
  const result = Effect.runSync(analyzeLsp(request.source, {
    ...analyzeOptions(request.session.scope, typeInferOptions(request)),
    ...(dslProvider ? {dslProvider} : {}),
    macroEnv: request.session.scope.macroEnv ?? request.session.env.flatten(),
  }));
  const display = result.resultTypeString;
  return {
    sourceId, pass: "typecheck", ...(display ? { display, type: typeProjection(display) } : {}),
    diagnostics: inferenceDiagnostics(sourceId, result),
    ...(request.result === "per-expression" ? { expressionTypes: toSExprMany(parse(request.source).redTree).map((expr, index) => {
      const display = result.typedSpans.find(span => span.span.start === expr.loc.start && span.span.end === expr.loc.end)?.typeString ?? "Unit";
      return { expressionId: `${sourceId}:${index}`, formIndex: index, display, type: typeProjection(display) };
    }) } : {}),
  };
}

function configuredBindingType(env: Env, name: string): Type.Type {
  const value = env.lookup(name);
  return isKFloat(value) ? Type.tFloat : typeof value === "number" ? Type.tInt : typeof value === "string" ? Type.tStr
    : typeof value === "boolean" ? Type.tBool : value === null ? Type.tNil : Type.tUnknown;
}

export function checkReplSubmission(session: LanguageSession, sourceId: string, source: string, options: Pick<TypecheckRequest, "hostBuiltins" | "typePolicy">) {
  // A REPL definition shadows the old scheme, including when its type changes.
  const initialEnv = new Map(session.scope.typeEnv);
  for (const binding of session.configurationEnv.bindingNames()) {
    if (initialEnv.has(binding)) continue;
    initialEnv.set(binding, Type.mono(configuredBindingType(session.configurationEnv, binding)));
  }
  let expanded: readonly SExpr[];
  try { expanded = expandKernelExprsSync(toSExprMany(parse(source).redTree), { env: session.env.flatten() }).expanded; }
  catch (error) { return { typeEnv: initialEnv, inferenceState: session.scope.inferenceState, display: "Unit", diagnostics: [diagnosticFromUnknown(error, "expand", sourceId)] }; }
  for (const expr of expanded) {
    if (head(expr) === "define" && expr._tag === "List") {
      const binding = name(expr.items[1]);
      if (binding) initialEnv.delete(binding);
    }
  }
  let typeEnv: Scope["typeEnv"] = initialEnv;
  let inferenceState = session.scope.inferenceState;
  const result = Effect.runSync(analyzeLsp(source, {
    ...analyzeOptions({ ...session.scope, typeEnv: initialEnv }, typeInferOptions(options)),
    macroEnv: session.env.flatten(),
    captureEnv: env => { typeEnv = env; },
    captureState: state => { inferenceState = state; },
  }));
  return { typeEnv, inferenceState, display: result.resultTypeString ?? "Unit", diagnostics: inferenceDiagnostics(sourceId, result) };
}

/** Descriptor metacheck seam: wire Descriptor_metacheck.validate's TS port here
 * when the descriptor workspace exports it. Bootstrap validation is already run,
 * but hook body/type contracts are intentionally owned by that workspace.
 */
export function validatePreludeMetacheck(_env: import("../Env.js").Env, _expressions: readonly SExpr[]): readonly Diagnostic[] {
  return [];
}
