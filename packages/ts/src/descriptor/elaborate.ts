/**
 * Source-to-declaration elaboration for descriptor-defined DSLs.
 *
 * `elaborateProgram` runs the descriptor pipeline in one call: read the source,
 * recognize and normalize each top-level form against a bootstrapped prelude,
 * declare every named form, apply the descriptor's static checks, run its
 * construct hook, and return JSON payloads with located diagnostics. Failures
 * are reported per form, so one bad declaration does not hide the others.
 */

import { Effect, Exit } from "effect";
import type {
  DeclarationSummary,
  JsonValue,
  PackageableDeclaration,
} from "../artifact/artifact.js";
import type { Diagnostic, Span } from "../engine/operations.js";
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
}

/** One top-level form elaborated to a JSON payload. */
export interface ElaboratedDeclaration extends PackageableDeclaration {
  readonly formName: string;
  readonly span: Span;
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

  const { descriptions, elaboration } = options.prelude;
  const accepted = options.forms ? new Set(options.forms) : undefined;
  const semanticEnv = options.semanticEnv ?? new SimpleSemanticEnvironment();
  const declared = new Map<string, string>();
  const forms: {
    readonly form: NormalizedForm;
    readonly sourceId: string;
    readonly formIndex: number;
    readonly locate: (loc: Loc) => Span;
    readonly name?: string;
  }[] = [];

  for (const { sourceId, source } of sources) {
    const locate = sourceLocator(source, sourceId);
    const at = report.bind(undefined, locate);
    const parsed = parse(source);
    for (const error of parsed.errors) at("parse/syntax", error.message, error.loc);
    if (parsed.errors.length > 0) continue;

    toSExprMany(parsed.redTree).forEach((expr, formIndex) => {
      const recognized = recognizeForm(expr, descriptions);
      if (!recognized) {
        const head = headName(expr);
        at(
          "elaborate/unknown-form",
          head ? `Unknown form '${head}'` : "Top-level expression is not a recognized form",
          expr.loc,
          head ? { form: head } : undefined,
        );
        return;
      }
      if (accepted && !accepted.has(recognized.formName)) {
        at(
          "elaborate/unsupported-form",
          `Form '${recognized.formName}' is not supported here`,
          expr.loc,
          { form: recognized.formName },
        );
        return;
      }
      try {
        const form = normalizeForm(recognized, descriptions);
        const name = declaredName(form);
        if (name !== undefined) {
          const previous = declared.get(name);
          if (previous) {
            at("elaborate/duplicate-declaration", `'${name}' is already declared by ${previous}`, expr.loc, {
              form: recognized.formName,
              declaration: name,
            });
            return;
          }
          declared.set(name, form.formName);
          semanticEnv.declareGlobal(name, form.formName);
        }
        forms.push({ form, sourceId, formIndex, locate, ...(name !== undefined ? { name } : {}) });
      } catch (error) {
        at("elaborate/malformed-form", errorMessage(error), expr.loc, { form: recognized.formName });
      }
    });
  }

  const declarations: ElaboratedDeclaration[] = [];
  for (const { form, sourceId, formIndex, locate, name } of forms) {
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
    for (const problem of problems) at(problem.code, problem.message, form.loc, details);
    if (problems.length > 0) continue;

    const strategy = form.descriptor.elaboration;
    if (strategy.kind !== "hook" && strategy.kind !== "composite") {
      at("elaborate/no-construct-hook", `Form '${form.formName}' has no construct hook`, form.loc, details);
      continue;
    }
    const exit = Effect.runSyncExit(elaboration.construct(strategy.fn, input));
    if (Exit.isFailure(exit)) {
      at("elaborate/construct-failed", failureMessage(exit), form.loc, details);
      continue;
    }

    const payload = toJsonValue(exit.value);
    const span = locate(form.loc);
    declarations.push({
      formName: form.formName,
      summary: summaryOf(payload, form, name),
      payload,
      sourceId,
      formIndex,
      span,
      ...(form.descriptor.produces ? { payloadContract: form.descriptor.produces } : {}),
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
export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value) || value instanceof Set) return [...value].map(toJsonValue);
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([key, item]) => [String(key), toJsonValue(item)]));
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

const summaryOf = (payload: JsonValue, form: NormalizedForm, name: string | undefined): DeclarationSummary => {
  const record = jsonObject(payload);
  const summary = jsonObject(record?.["$summary"]);
  const kind = stringField(summary, "kind") ?? stringField(record, "kind") ?? form.formName;
  const declared = stringField(summary, "name") ?? stringField(record, "name") ?? name;
  const resultType =
    stringField(summary, "resultType") ??
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
