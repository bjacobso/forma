/**
 * The diagnostic every compiler phase reports. Spans are offsets into a named
 * source; lines and columns are optional projections.
 *
 * @module
 */

export interface Span {
  readonly sourceId: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly startLine?: number | undefined;
  readonly startColumn?: number | undefined;
  readonly endLine?: number | undefined;
  readonly endColumn?: number | undefined;
}

/** An atomic replacement in author source. Apply a fix's edits together. */
export interface DiagnosticTextEdit {
  readonly span: Span;
  readonly newText: string;
}

/** Open to consumer augmentation; code and detail field meanings are public API. */
export interface DiagnosticDetailsMap {
  "ArityError": { readonly name: string; readonly expected: number | string; readonly actual: number };
  "KernelTypeError": { readonly expected: string; readonly actual: string };
  "StepLimitExceeded": { readonly limit: number };
  "typecheck/type-mismatch": { readonly expected?: string; readonly got?: string; readonly actual?: string };
  "typecheck/unbound-symbol": { readonly name: string; readonly candidates: readonly string[] };
  "elaborate/unknown-form": { readonly form?: string; readonly name?: string; readonly candidates: readonly string[] };
  "elaborate/hole-type": HoleDiagnosticDetails;
  "elaborate/unknown-reference": HoleDiagnosticDetails;
  "elaborate/reference-type": HoleDiagnosticDetails;
  "elaborate/duplicate-declaration": { readonly form: string; readonly declaration: string; readonly previousForm: string };
  "elaborate/unsupported-form": { readonly form: string; readonly candidates: readonly string[] };
  "elaborate/missing-identifier": HoleDiagnosticDetails;
  "elaborate/missing-slot": HoleDiagnosticDetails;
  "elaborate/invalid-slot-value": HoleDiagnosticDetails;
  "descriptor/unknown-slot": HoleDiagnosticDetails;
  "descriptor/unresolved-hook": HoleDiagnosticDetails;
  "descriptor/constructed-by": HoleDiagnosticDetails;
  "abi/unknown-code": { readonly name: string };
}

export interface HoleDiagnosticDetails {
  readonly form: string;
  readonly declaration?: string;
  readonly hole?: string;
  readonly name?: string;
  readonly candidates?: readonly string[];
  /** Printed Forma type or syntax, not a message fragment. */
  readonly expected?: string;
  readonly actual?: string;
}

export type DiagnosticDetails<C extends string> = C extends keyof DiagnosticDetailsMap
  ? DiagnosticDetailsMap[C] : Record<string, unknown>;

export interface Diagnostic<C extends string = string> {
  readonly code: C;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly phase?: DiagnosticPhase;
  readonly span?: Span | undefined;
  readonly details?: DiagnosticDetails<C> | undefined;
  readonly help?: string | undefined;
  readonly fix?: readonly DiagnosticTextEdit[] | undefined;
}

/** Narrow a diagnostic to the detail contract for a known code. */
export function hasDiagnosticCode<C extends keyof DiagnosticDetailsMap>(diagnostic: Diagnostic, code: C): diagnostic is Diagnostic<C> {
  return diagnostic.code === code;
}

export type DiagnosticPhase =
  | "parse"
  | "expand"
  | "typecheck"
  | "evaluate"
  | "elaborate"
  | "host-effect"
  | "emit";

/** A diagnostic for anything a phase threw or failed with. */
interface FailureLoc { readonly sourceId?: string; readonly start: number; readonly end: number; readonly line: number; readonly col: number }
/** Where an evaluation failed: the innermost named function (or the definition
 * `enclosing` finds around the location) and its author location. */
export function failureLocation(error: unknown, enclosing?: (loc: FailureLoc) => string | undefined): string {
  const failure = error as { readonly loc?: FailureLoc; readonly stackTrace?: readonly { readonly name: string; readonly loc?: FailureLoc }[] };
  const frame = failure.stackTrace?.[0];
  const loc = frame?.loc ?? failure.loc;
  const where = loc ? `${loc.sourceId ? `${loc.sourceId} ` : ""}line ${loc.line}, column ${loc.col}` : undefined;
  const helper = frame?.name ? authorNames(frame.name) : loc ? enclosing?.(loc) : undefined;
  return helper && where ? ` (in ${helper}, ${where})` : helper ? ` (in ${helper})` : where ? ` (at ${where})` : "";
}

/** Strip module-resolution suffixes (`name__forma_<module>_d<name>`), leaving author names. */
export function authorNames(text: string): string {
  return text.replace(/__forma_[0-9a-f]+_d[0-9a-f]+/g, "");
}

export function diagnosticFromUnknown(
  error: unknown,
  phase: DiagnosticPhase,
  sourceId: string,
): Diagnostic {
  const cause = effectCauseFromUnknown(error);
  if (cause?._tag === "Fail") {
    return diagnosticFromUnknown(cause.error, phase, sourceId);
  }
  if (cause?._tag === "Die") {
    return diagnosticFromUnknown(cause.defect, phase, sourceId);
  }
  if (error && typeof error === "object") {
    const candidate = error as {
      _tag?: string;
      message?: string;
      origin?: { span?: { start?: number; end?: number } };
      loc?: { sourceId?: string; start?: number; end?: number; line?: number; col?: number };
      details?: Record<string, unknown>;
      expected?: string | number;
      got?: string | number;
      name?: string;
      limit?: number;
      help?: string;
      fix?: readonly DiagnosticTextEdit[];
    };
    const span: Span | undefined = candidate.origin?.span
      ? {
          sourceId,
          startOffset: candidate.origin.span.start ?? 0,
          endOffset: candidate.origin.span.end ?? candidate.origin.span.start ?? 0,
        }
      : candidate.loc
        ? {
            sourceId:candidate.loc.sourceId ?? sourceId,
            startOffset: candidate.loc.start ?? 0,
            endOffset: candidate.loc.end ?? candidate.loc.start ?? 0,
            ...(candidate.loc.line !== undefined ? { startLine: candidate.loc.line } : {}),
            ...(candidate.loc.col !== undefined ? { startColumn: candidate.loc.col } : {}),
          }
        : undefined;
    return {
      code: typeof candidate.details?.["code"] === "string"
        ? candidate.details["code"]
        : candidate._tag === "InferenceError"
          ? "typecheck/type-mismatch"
          : candidate._tag === "ParseError"
            ? readerCode(candidate.message ?? "")
            : candidate.loc && !candidate._tag
              ? "surface/invalid-form"
              : candidate._tag ?? "internal/error",
      severity: "error",
      message: candidate.message ?? String(error),
      phase,
      ...(span ? { span } : {}),
      details: {
        ...(candidate.expected !== undefined ? {expected:candidate.expected} : {}),
        ...(candidate.got !== undefined ? {actual:candidate.got} : {}),
        ...(candidate._tag === "ArityError" ? {name:candidate.name} : {}),
        ...(candidate.limit !== undefined ? {limit:candidate.limit} : {}),
        ...candidate.details,
      },
      ...(candidate.help ? {help:candidate.help} : {}),
      ...(candidate.fix ? {fix:candidate.fix} : {}),
    };
  }
  return {
    code: "internal/error",
    severity: "error",
    message: String(error),
    phase,
  };
}

function effectCauseFromUnknown(error: unknown):
  | {
      readonly _tag: string;
      readonly error?: unknown;
      readonly defect?: unknown;
    }
  | undefined {
  if (!error || typeof error !== "object") return undefined;
  for (const symbol of Object.getOwnPropertySymbols(error)) {
    if (symbol.description === "effect/Runtime/FiberFailure/Cause") {
      const cause = (error as Record<symbol, unknown>)[symbol];
      return cause && typeof cause === "object"
        ? (cause as { readonly _tag: string; readonly error?: unknown; readonly defect?: unknown })
        : undefined;
    }
  }
  return undefined;
}

/** Reader errors have one tag; the parser retains the precise failure message. */
function readerCode(message: string): string {
  if (message.startsWith("Unterminated string escape")) return "reader/unterminated-string-escape";
  if (message.startsWith("Unterminated")) return "reader/unterminated-string";
  if (message.startsWith("Invalid number")) return "reader/invalid-number";
  if (message.startsWith("Unexpected character")) return "reader/unexpected-character";
  if (message.startsWith("Map requires")) return "reader/map-entry-missing-value";
  if (message.startsWith("Unclosed map")) return "reader/unclosed-map";
  if (message.startsWith("Unclosed")) return "reader/unclosed-sequence";
  if (message.startsWith("Expected form") || message.includes("EOF")) return "reader/unexpected-eof";
  if (message.startsWith("Unexpected")) return "reader/unexpected-close";
  return "reader/error";
}
