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

export interface Diagnostic {
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly phase?: DiagnosticPhase;
  readonly span?: Span | undefined;
  readonly details?: Record<string, unknown> | undefined;
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
      code: typeof candidate.details?.["code"] === "string" ? candidate.details["code"] : candidate._tag ?? `${phase}/error`,
      severity: "error",
      message: candidate.message ?? String(error),
      phase,
      ...(span ? { span } : {}),
      ...(candidate.details ? { details: candidate.details } : {}),
    };
  }
  return {
    code: `${phase}/error`,
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
