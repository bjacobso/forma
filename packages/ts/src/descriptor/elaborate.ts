import { descriptorPayloadContract, descriptorValidatorNames, checkArtifactDescriptor, checkArtifactPayloadContracts, payloadContractsFromSources } from "../artifact/descriptor-contracts.js";
import { makeArtifactValidatorRegistry } from "../artifact/validator-catalog.js";
import { typeDefinition } from "../surface/type-alias.js";
import { projectContractValue } from "../surface/contract.js";
import { isKKeyword, isKSymbol, mapKeyValue, type KValue } from "../evaluator/types.js";
/**
 * Source-to-declaration elaboration for descriptor-defined DSLs.
 *
 * `elaborateProgram` runs the descriptor pipeline in one call: read the source,
 * recognize and normalize each top-level form against a bootstrapped prelude,
 * declare every named form, apply the descriptor's static checks, run its
 * construct hook, and return JSON payloads with located diagnostics. Failures
 * are reported per form, so one bad declaration does not hide the others.
 *
 * Top-level calls to macros defined in the same source with `__macro` are
 * expanded first. Each declaration records whether it was authored or
 * expanded, and carries a source map from payload paths to authored spans.
 */

import { parsePrelude } from "./meta-fn-decl.js";
import { lowerActionProgram } from "../surface/action.js";
import { matchFormSyntax, unifiedFormHooks } from "../surface/form.js";
import { head, name as surfaceName } from "../surface/effect.js";
import { showType, TCon } from "../type/types.js";
import { Effect, Exit } from "effect";
import type {
  DeclarationOrigin,
  DeclarationSummary,
  JsonValue,
  PackageableDeclaration,
  SourceMapEntry,
} from "../artifact/artifact.js";
import { defaultBuiltins } from "../builtins/index.js";
import type { Diagnostic, Span } from "../diagnostic/diagnostic.js";
import { sourceTraceOf } from "../evaluator/source-trace.js";
import { expandProgramSync } from "../expander/expand.js";
import { parse } from "../reader/parser.js";
import { toSExprMany } from "../reader/to-sexpr.js";
import type { Loc, SExpr } from "../reader/types.js";
import type { BootstrappedPrelude } from "./bootstrap.js";
import type { HookInput } from "./ElaborationHook.js";
import { normalizeForm, type NormalizedForm } from "./normalize.js";
import { recognizeForm } from "./recognize.js";
import { RUNTIME_STRING_LITERAL_KEY, canonicalExprValue, isSExprLike } from "./runtime-expr.js";
import { SimpleSemanticEnvironment } from "./SemanticEnvironment.js";

export interface ElaborateProgramOptions {
  /** Descriptors and hooks, e.g. from `bootstrapOntologyPreludes()`. */
  readonly prelude: BootstrappedPrelude;
  /** Identifies the source in spans and diagnostics. Defaults to `"source.forma"`. */
  readonly sourceId?: string;
  /** Restrict accepted top-level forms. Other recognized forms are reported. */
  readonly forms?: Iterable<string>;
  /** Share declarations across programs. A fresh environment is used by default. */
  readonly semanticEnv?: SimpleSemanticEnvironment;
  readonly payloadContracts?: import("../artifact/descriptor-contracts.js").PayloadContracts;
  readonly validatorRegistry?: import("../artifact/validator-registry.js").ArtifactValidatorRegistry;
}

/** One top-level form elaborated to a JSON payload. */
export interface ElaboratedDeclaration extends PackageableDeclaration {
  readonly formName: string;
  /** The authored span: the form itself, or the macro call that produced it. */
  readonly span: Span;
  readonly origin: DeclarationOrigin;
  readonly sourceMap: readonly SourceMapEntry[];
}

export interface ElaborateProgramResult {
  /** True when no error diagnostics were produced. */
  readonly ok: boolean;
  /** Declarations that elaborated, in source order, even when others failed. */
  readonly declarations: readonly ElaboratedDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
}

/** One named source text in a multi-file program. */
export interface ProgramSource {
  readonly sourceId: string;
  readonly source: string;
}

/** Elaborate every top-level form of `source` against a bootstrapped prelude. */
export function elaborateProgram(
  source: string,
  options: ElaborateProgramOptions,
): ElaborateProgramResult {
  return elaborateSources([{ sourceId: options.sourceId ?? "source.forma", source }], options);
}

/**
 * Elaborate several sources as one program. Every source's names are declared
 * before any form is constructed, so forms may refer across files.
 */
export function elaborateSources(
  sources: readonly ProgramSource[],
  options: Omit<ElaborateProgramOptions, "sourceId">,
): ElaborateProgramResult {
  const diagnostics: Diagnostic[] = [];
  const report = (
    locate: (loc: Loc) => Span,
    code: string,
    message: string,
    loc: Loc | undefined,
    details?: Record<string, unknown>,
  ): void => {
    diagnostics.push({
      code,
      severity: "error",
      message,
      phase: code.startsWith("parse/") ? "parse" : "elaborate",
      ...(loc ? { span: locate(loc) } : {}),
      ...(details ? { details } : {}),
    });
  };

  const descriptions = options.prelude.descriptions.fork();
  const elaboration = options.prelude.elaboration.fork();
  const authorForms = sources.flatMap(({source})=>toSExprMany(parse(source).redTree));
  const typeDefinitions = new Map<string,SExpr>();
  for (const descriptor of descriptions.list()) for (const [n,t] of descriptor.surface?.types ?? []) typeDefinitions.set(n,t);
  for (const e of authorForms) { const definition=typeDefinition(e); if (definition) typeDefinitions.set(...definition); }
  for (const {source,sourceId} of sources) {
    try {
      for (const descriptor of parsePrelude(source,typeDefinitions,authorForms.filter(e=>head(e)==="define" || head(e)==="macro")).forms) {
        if (descriptor.surface && descriptions.has(descriptor.name)) throw new Error(`Form '${descriptor.name}' is already declared`);
        descriptions.register(descriptor);
      }
    } catch (error) { report(sourceLocator(source,sourceId),"elaborate/form-definition",errorMessage(error),undefined); }
  }
  const contracts = new Map([...options.prelude.payloadContracts ?? [], ...options.payloadContracts ?? [], ...payloadContractsFromSources(sources.map(s => s.source))]);
  const artifactRegistry = options.validatorRegistry ?? makeArtifactValidatorRegistry();
  const invalidArtifacts = new Set<string>();
  const descriptorSpans = new Map<string, Span>();
  const contractSpans = new Map<string, Span>();
  for (const { source, sourceId } of sources) for (const e of toSExprMany(parse(source).redTree)) {
    if (head(e) === "__payload-contract" && e._tag === "List") {
      const n = surfaceName(e.items[1]);
      if (n) contractSpans.set(n, sourceLocator(source, sourceId)(e.loc));
    }
    if (head(e) === "__form-descriptor" && e._tag === "List") {
      const n = surfaceName(e.items[1]);
      if (n) descriptorSpans.set(n, sourceLocator(source, sourceId)(e.loc));
    }
  }
  // Keep these checks for standalone elaboration and document-owned descriptors.
  // Failed session preludes never commit, so their load diagnostics cannot be
  // reported again here. Each phase reports its own diagnostic set once.
  diagnostics.push(...checkArtifactPayloadContracts(contracts, name => contractSpans.get(name)));
  for (const descriptor of descriptions.list()) {
    const span = descriptorSpans.get(descriptor.name);
    const checked = checkArtifactDescriptor(descriptor, { registry: artifactRegistry, contracts, ...(span ? { span } : {}) });
    diagnostics.push(...checked);
    if (checked.some(d => d.severity === "error")) invalidArtifacts.add(descriptor.name);
  }
  for (const descriptor of descriptions.list()) for (const hook of unifiedFormHooks(descriptor,descriptions,options.prelude.formBuiltins,options.prelude.hostedDsls)) elaboration.registerHook(hook);
  const accepted = options.forms ? new Set(options.forms) : undefined;
  const semanticEnv = options.semanticEnv ?? new SimpleSemanticEnvironment();
  for (const expression of authorForms) if (["type", "error", "class"].includes(head(expression) ?? "") && expression._tag === "List") {
    const definition=typeDefinition(expression);
    if (definition) semanticEnv.setFact("type-kind", definition[0], head(expression)!);
  }
  const declared = new Map<string, string>();
  const forms: {
    readonly form: NormalizedForm;
    readonly sourceId: string;
    readonly formIndex: number;
    readonly loc: Loc;
    readonly origin: DeclarationOrigin;
    readonly locate: (loc: Loc) => Span;
    readonly name?: string;
  }[] = [];

  for (const { sourceId, source } of sources) {
    const locate = sourceLocator(source, sourceId);
    const at = report.bind(undefined, locate);
    const parsed = parse(source);
    for (const error of parsed.errors) at("parse/syntax", error.message, error.loc);
    if (parsed.errors.length > 0) continue;

    let authored: readonly SExpr[];
    try {authored=lowerActionProgram(toSExprMany(parsed.redTree), new Set(authorForms.flatMap(e => head(e)===":" && e._tag==="List" && surfaceName(e.items[1]) && (head(e.items[2])==="Action" || e.items[2]?._tag==="List" && head(e.items[2])==="->" && head(e.items[2].items.at(-1))==="Action") ? [surfaceName(e.items[1])!] : [])));}
    catch (error) {at("elaborate/action-definition",errorMessage(error),toSExprMany(parsed.redTree)[0]?.loc);continue;}
    for (const { expr, formIndex, loc, origin } of expandTopLevel(authored, locate, at)) {
      if (["type","form","define",":","do","class","error","service","layer","macro","typeclass","instance"].includes(head(expr) ?? "")) continue;
      const recognized = recognizeForm(expr, descriptions);
      if (!recognized) {
        const head = headName(expr);
        at(
          "elaborate/unknown-form",
          head ? `Unknown form '${head}'` : "Top-level expression is not a recognized form",
          loc,
          head ? { form: head } : undefined,
        );
        continue;
      }
      if (accepted && !accepted.has(recognized.formName)) {
        at("elaborate/unsupported-form", `Form '${recognized.formName}' is not supported here`, loc, {
          form: recognized.formName,
        });
        continue;
      }
      try {
        const form = normalizeForm(recognized, descriptions);
        const name = declaredName(form);
        if (name !== undefined) {
          const previous = declared.get(name);
          if (previous) {
            at("elaborate/duplicate-declaration", `'${name}' is already declared by ${previous}`, loc, {
              form: recognized.formName,
              declaration: name,
            });
            continue;
          }
          if (form.descriptor.surface) {
            const holes = matchFormSyntax(form.descriptor.surface,form.rawExpr);
            semanticEnv.setFact("declaration-hole-values",name,new Map(holes));
            const fields = new Map<string,unknown>();
            for (const [hole,t] of form.descriptor.surface.holes) {
              if (head(t)==="Record" && t._tag==="List" && surfaceName(t.items[1])==="Type") {
                const record=holes.get(hole);
                if (record?._tag==="Map") for (const [key,value] of record.pairs) fields.set(surfaceName(key)!.replace(/^:/,""),value);
              }
            }
            if (fields.size) semanticEnv.setFact("declaration-field-syntax",name,fields);
          }
          declared.set(name, form.formName);
          semanticEnv.declareGlobal(name, form.formName, form.descriptor.surface && form.descriptor.resultType.kind === "constant" ? TCon(form.descriptor.resultType.type) : undefined);
        }
        forms.push({
          form,
          sourceId,
          formIndex,
          loc,
          origin,
          locate,
          ...(name !== undefined ? { name } : {}),
        });
      } catch (error) {
        at("elaborate/malformed-form", errorMessage(error), loc, { form: recognized.formName });
      }
    }
  }

  const declarations: ElaboratedDeclaration[] = [];
  for (const { form, sourceId, formIndex, loc, origin, locate, name } of forms) {
    const at = report.bind(undefined, locate);
    const details = { form: form.formName, ...(name !== undefined ? { declaration: name } : {}) };
    const input: HookInput = {
      formName: form.formName,
      descriptor: form.descriptor,
      normalizedSlots: form.slots,
      identifiers: form.identifiers,
      semanticEnv,
      loc: form.loc,
      rawExpr: form.rawExpr,
    };

    const problems = staticProblems(form);
    for (const problem of problems) at(problem.code, problem.message, loc, details);
    if (problems.length > 0) continue;

    if (form.descriptor.surface && form.descriptor.validation.kind === "hook") {
      const checked = Effect.runSyncExit(elaboration.validate(form.descriptor.validation.fn, input));
      if (Exit.isFailure(checked)) { at("elaborate/validation-failed", failureMessage(checked), loc, details); continue; }
      for (const problem of checked.value) diagnostics.push({code:problem.code ?? "elaborate/hole-type",severity:problem.severity,message:problem.message,phase:"elaborate",span:locate(problem.loc ?? loc),details});
      if (checked.value.some(p => p.severity === "error")) continue;
    }
    let computedResultType: string | undefined;
    if (form.descriptor.resultType.kind === "hook") {
      const computed = Effect.runSyncExit(elaboration.computeResultType(form.descriptor.resultType.fn,input));
      if (Exit.isFailure(computed)) { at("elaborate/result-type-failed",failureMessage(computed),loc,details); continue; }
      computedResultType = showType(computed.value);
      if (name) semanticEnv.declareGlobal(name,form.formName,computed.value);
    }
    const strategy = form.descriptor.elaboration;
    if (strategy.kind !== "hook" && strategy.kind !== "composite") {
      at("elaborate/no-construct-hook", `Form '${form.formName}' has no construct hook`, loc, details);
      continue;
    }
    const exit = Effect.runSyncExit(elaboration.construct(strategy.fn, input));
    if (Exit.isFailure(exit)) {
      at("elaborate/construct-failed", failureMessage(exit), loc, details);
      continue;
    }

    if (invalidArtifacts.has(form.formName)) continue;
    if (containsExecutableValue(exit.value)) { at("artifact/untyped-runtime-declaration", "Declaration payload cannot include executable runtime values.", loc, details); continue; }
    const surface = form.descriptor.surface;
    const payload = toJsonValue(surface?.ir ? projectContractValue(exit.value as import("../evaluator/types.js").KValue,surface.ir,surface.types) : exit.value);
    const span = locate(loc);
    const contract = payloadContract(form);
    declarations.push({
      formName: form.formName,
      summary: summaryOf(payload, form, name, computedResultType),
      summaryRequired: !surface,
      summaryExpectation: {
        ...(form.descriptor.resultType.kind === "constant" ? { resultType: form.descriptor.resultType.type } : {}),
        ...descriptorConstructExpectation(form, name),
      },
      payload,
      sourceId,
      formIndex,
      span,
      origin,
      sourceMap: sourceMapOf(form, payload, span, locate),
      ...(contract ? { payloadContract: contract } : {}),
      payloadConstraints: descriptorPayloadContract(form.descriptor, contracts),
      validators: descriptorValidatorNames(form.descriptor),
    });
  }

  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    declarations,
    diagnostics,
  };
}

/** Thrown by {@link elaborateProgramOrThrow}; carries every diagnostic. */
export class ElaborationFailure extends Error {
  readonly _tag = "ElaborationFailure" as const;
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    super(diagnostics.filter((d) => d.severity === "error").map(formatDiagnostic).join("\n"));
    this.diagnostics = diagnostics;
  }

  /** The first error's span, for hosts that report a single location. */
  get span(): Span | undefined {
    return this.diagnostics.find((d) => d.severity === "error")?.span;
  }
}

/** Like {@link elaborateProgram}, but throws {@link ElaborationFailure} on errors. */
export function elaborateProgramOrThrow(
  source: string,
  options: ElaborateProgramOptions,
): readonly ElaboratedDeclaration[] {
  const result = elaborateProgram(source, options);
  if (!result.ok) throw new ElaborationFailure(result.diagnostics);
  return result.declarations;
}

/** Render `sourceId:line:column: message` for logs and CLI output. */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const span = diagnostic.span;
  const where = span
    ? `${span.sourceId}${span.startLine !== undefined ? `:${span.startLine}:${span.startColumn ?? 1}` : ""}: `
    : "";
  return `${where}${diagnostic.message}`;
}

/**
 * Build a diagnostic anchored to a declaration, for host-side checks that run
 * on elaborated payloads (unknown references, duplicate names, ...).
 */
export function declarationDiagnostic(
  declaration: Pick<ElaboratedDeclaration, "span" | "formName" | "summary">,
  code: string,
  message: string,
  severity: Diagnostic["severity"] = "error",
): Diagnostic {
  return {
    code,
    severity,
    message,
    phase: "elaborate",
    span: declaration.span,
    details: {
      form: declaration.formName,
      ...(declaration.summary.name !== undefined ? { declaration: declaration.summary.name } : {}),
    },
  };
}

/** Compute a full span (with end line and column) for a reader location. */
export function sourceLocator(source: string, sourceId: string): (loc: Loc) => Span {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }
  const position = (offset: number): { line: number; column: number } => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: offset - lineStarts[low]! + 1 };
  };
  return (loc) => {
    const end = position(loc.end);
    return {
      sourceId,
      startOffset: loc.start,
      endOffset: loc.end,
      startLine: loc.line,
      startColumn: loc.col,
      endLine: end.line,
      endColumn: end.column,
    };
  };
}

/**
 * Convert construct output (maps, sets, vectors) to plain JSON. Map keys
 * become object keys. Reader nodes that hooks pass through unchanged, such as
 * a `(Ref Customer)` field type, are lowered like runtime expressions: lists
 * become arrays and symbols strings, while string literals keep their marker
 * object so they remain distinguishable from symbols.
 */
function wireMapKey(key: string): string {
  const decoded = mapKeyValue(key);
  return isKKeyword(decoded) ? decoded.name.slice(1) : String(decoded);
}

export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (isKKeyword(value as KValue) || isKSymbol(value as KValue)) return String(value);
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value) || value instanceof Set) return [...value].map(toJsonValue);
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([key, item]) => [wireMapKey(String(key)), toJsonValue(item)]));
  }
  if (isSExprLike(value) && "loc" in value) {
    return toJsonValue(canonicalExprValue(value));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]),
    );
  }
  return null;
}

/** True for the JSON form of a runtime string literal. */
export function isJsonRuntimeStringLiteral(
  value: JsonValue | undefined,
): value is { readonly [RUNTIME_STRING_LITERAL_KEY]: "string-literal"; readonly value: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, JsonValue>)[RUNTIME_STRING_LITERAL_KEY] === "string-literal" &&
    typeof (value as Record<string, JsonValue>)["value"] === "string"
  );
}

interface TopLevelForm {
  readonly expr: SExpr;
  readonly formIndex: number;
  /** Authored location: the form itself, or the macro call that produced it. */
  readonly loc: Loc;
  readonly origin: DeclarationOrigin;
}

const authored: DeclarationOrigin = { kind: "authored" };

/**
 * Drop `__macro` forms and expand top-level calls to those macros, so a
 * source may abbreviate its own declarations. A `(do ...)` expansion yields
 * several forms. Other forms pass through untouched.
 */
const expandTopLevel = (
  exprs: readonly SExpr[],
  locate: (loc: Loc) => Span,
  at: (code: string, message: string, loc: Loc | undefined, details?: Record<string, unknown>) => void,
): readonly TopLevelForm[] => {
  const macroDefs = exprs.filter((expr) => ["macro","__macro"].includes(headName(expr) ?? ""));
  const macroNames = new Set(
    macroDefs.flatMap((expr) => (expr._tag === "List" && expr.items[1]?._tag === "Sym" ? [expr.items[1].name] : expr._tag === "List" && expr.items[1]?._tag === "List" && surfaceName(expr.items[1].items[0]) ? [surfaceName(expr.items[1].items[0])!] : [])),
  );
  return exprs.flatMap((expr, formIndex): readonly TopLevelForm[] => {
    const head = headName(expr);
    if (head === "__macro" || head === "macro") return [];
    if (head === "do" && expr._tag === "List") {
      return expandTopLevel([...macroDefs, ...expr.items.slice(1)], locate, at).map(node => ({ ...node, formIndex }));
    }
    if (head === undefined || !macroNames.has(head)) return [{ expr, formIndex, loc: expr.loc, origin: authored }];
    try {
      const [expanded] = expandProgramSync([...macroDefs, expr], { builtins: defaultBuiltins }).exprs;
      if (!expanded) return [];
      const produced =
        headName(expanded) === "do" && expanded._tag === "List" ? expanded.items.slice(1) : [expanded];
      return produced.map((node) => {
        const trace = sourceTraceOf(node);
        const macros = (trace.macroOrigins ?? []).map((origin) => ({
          macroName: origin.macroName,
          span: locate(origin.loc),
        }));
        return {
          expr: node,
          formIndex,
          loc: trace.macroOrigins?.length ? trace.loc : expr.loc,
          origin: macros.length > 0 ? { kind: "expanded", macros } : authored,
        };
      });
    } catch (error) {
      at("elaborate/expansion-failed", `Expanding '${head}' failed: ${errorMessage(error)}`, expr.loc, {
        form: head,
      });
      return [];
    }
  });
};

/**
 * Map the payload root to the declaration, and each array item built from a
 * child form (`(:field ...)` → `/fields/0`) to that child's authored span.
 * A slot maps to the payload key with its name or plural that has one item
 * per child form.
 */
const sourceMapOf = (
  form: NormalizedForm,
  payload: JsonValue,
  span: Span,
  locate: (loc: Loc) => Span,
): readonly SourceMapEntry[] => {
  const entries: SourceMapEntry[] = [{ path: "", span }];
  const record = jsonObject(payload);
  if (!record) return entries;
  for (const slot of form.descriptor.slots) {
    const syntax = form.slots.getExpr(slot.name);
    const body = form.descriptor.surface?.body;
    const mentions = (expression: SExpr): boolean => expression._tag === "Sym" ? expression.name === slot.name
      : expression._tag === "List" || expression._tag === "Vector" ? expression.items.some(mentions)
      : expression._tag === "Map" ? expression.pairs.some(([, value]) => mentions(value)) : false;
    const projectedKey = Array.isArray(record[slot.name]) ? slot.name : body?._tag === "Map"
      ? body.pairs.find(([key, value]) => mentions(value) && Array.isArray(record[surfaceName(key)?.replace(/^:/, "") ?? ""]))?.[0] : undefined;
    const outputKey = typeof projectedKey === "string" ? projectedKey : projectedKey ? surfaceName(projectedKey)?.replace(/^:/, "") : undefined;
    const projected = outputKey ? record[outputKey] : undefined;
    if (form.descriptor.surface && syntax?._tag === "Map" && outputKey && Array.isArray(projected) && projected.length === syntax.pairs.length) {
      syntax.pairs.forEach(([key, value], index) => entries.push({
        path: `/${jsonPointerToken(outputKey)}/${index}`,
        span: locate({...key.loc, end: Math.max(key.loc.end, value.loc.end)}),
      }));
    }
    const children = form.slots.getChildForms(slot.name);
    if (children.length === 0) continue;
    const key = [slot.name, `${slot.name}s`, `${slot.name}es`].find((candidate) => {
      const value = record[candidate];
      return Array.isArray(value) && value.length === children.length;
    });
    if (key === undefined) continue;
    children.forEach((child, index) => {
      entries.push({
        path: `/${jsonPointerToken(key)}/${index}`,
        span: locate(sourceTraceOf(child.rawExpr).loc),
      });
    });
  }
  return entries;
};

const jsonPointerToken = (key: string): string => key.replaceAll("~", "~0").replaceAll("/", "~1");

/** The descriptor's `(:artifact (:payload (:contract ...)))` extension, if any. */
const payloadContract = (form: NormalizedForm): string | undefined => {
  const artifact = form.descriptor.extensions?.["artifact"];
  const payload =
    artifact && typeof artifact === "object" && !Array.isArray(artifact)
      ? (artifact as Record<string, unknown>)["payload"]
      : undefined;
  const contract =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)["contract"]
      : undefined;
  return typeof contract === "string" ? contract : form.descriptor.produces;
};

const headName = (expr: SExpr): string | undefined => {
  if (expr._tag !== "List") return undefined;
  const head = expr.items[0];
  return head?._tag === "Sym" ? head.name : undefined;
};

const declaredName = (form: NormalizedForm): string | undefined => {
  const identifier = form.descriptor.identifiers.find((spec) => spec.declaration)?.name ?? "name";
  return form.identifiers.get(identifier);
};

/**
 * Descriptor-level checks that need no type information: positional
 * identifiers, required slots, and `one-of` slot values. Typed validate and
 * infer hooks run in the type checker, not here.
 */
const staticProblems = (form: NormalizedForm): readonly { code: string; message: string }[] => {
  const { descriptor, formName } = form;
  const problems: { code: string; message: string }[] = [];
  for (const identifier of descriptor.identifiers) {
    if (!form.identifiers.has(identifier.name)) {
      problems.push({
        code: "elaborate/missing-identifier",
        message: `${formName} is missing its ${identifier.name}`,
      });
    }
  }
  const checks =
    descriptor.validation.kind === "static" || descriptor.validation.kind === "composite"
      ? descriptor.validation.checks
      : [];
  const required = new Set([
    ...descriptor.slots.filter((slot) => slot.required).map((slot) => slot.name),
    ...checks.flatMap((check) => (check.kind === "required" && check.slot ? [check.slot] : [])),
  ]);
  for (const slot of required) {
    if (!form.slots.has(slot)) {
      problems.push({ code: "elaborate/missing-slot", message: `${formName} requires :${slot}` });
    }
  }
  for (const check of checks) {
    if (check.kind !== "one-of" || !check.slot || !check.values) continue;
    const value = form.slots.getString(check.slot);
    if (value !== undefined && !check.values.includes(value)) {
      problems.push({
        code: "elaborate/invalid-slot-value",
        message: `${formName} :${check.slot} must be one of ${check.values.join(", ")}`,
      });
    }
  }
  return problems;
};

const summaryOf = (payload: JsonValue, form: NormalizedForm, name: string | undefined, computedResultType?: string): DeclarationSummary => {
  const record = jsonObject(payload);
  const summary = jsonObject(record?.["$summary"]);
  const kind = stringField(summary, "kind") ?? stringField(record, "kind") ?? form.formName;
  const declared = stringField(summary, "name") ?? stringField(record, "name") ?? name;
  const resultType =
    stringField(summary, "resultType") ?? computedResultType ??
    (form.descriptor.resultType.kind === "constant" ? form.descriptor.resultType.type : kind);
  return { kind, resultType, ...(declared !== undefined ? { name: declared } : {}) };
};

const jsonObject = (value: JsonValue | undefined): Record<string, JsonValue> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined;

const stringField = (record: Record<string, JsonValue> | undefined, key: string): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const failureMessage = (exit: Exit.Exit<unknown, unknown>): string => {
  if (Exit.isSuccess(exit)) return "";
  const error = exit.cause.reasons.map((reason) =>
    reason._tag === "Fail" ? reason.error : reason._tag === "Die" ? reason.defect : "interrupted",
  )[0];
  return errorMessage(error);
};


function containsExecutableValue(value: unknown): boolean {
  if (!value || typeof value !== "object") return typeof value === "function";
  if ("_tag" in value && ["KFn", "KBuiltin", "KMacro"].includes(String(value._tag))) return true;
  if (value instanceof Map) return [...value.values()].some(containsExecutableValue);
  return Object.values(value).some(containsExecutableValue);
}
function descriptorConstructExpectation(form: NormalizedForm, declaredName: string | undefined): Partial<DeclarationSummary> {
  const result: { kind?: string; name?: string } = {};
  for (const field of form.descriptor.construct?.fields ?? []) {
    if (field.name === "kind" && field.expr.startsWith('"')) { try { result.kind = JSON.parse(field.expr); } catch { /* An expression is not a literal expectation. */ } }
    if (field.name === "name" && field.expr.includes("declaration-name") && declaredName !== undefined) result.name = declaredName;
  }
  return result;
}
