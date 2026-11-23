import { InferenceError } from "../diagnostic/errors.js";
import type { Diagnostic } from "../diagnostic/diagnostic.js";
import type { SExpr } from "../reader/types.js";

/** Invalid host-supplied syntax has no authored source span. */
export class SurfaceInputError extends Error {
  readonly code = "surface/invalid-input";
  constructor(message: string, readonly path: string) {
    super(message);
    this.name = "SurfaceInputError";
  }
}

/** A malformed surface expression keeps its authored syntax through lowering. */
export function surfaceError(
  message: string, at: SExpr, code = "surface/invalid-form",
  extra: { readonly help?: string; readonly fix?: Diagnostic["fix"]; readonly details?: Record<string, unknown> } = {},
): InferenceError & { loc: SExpr["loc"] } {
  return Object.assign(new InferenceError({ message, details: { ...extra.details, code }, help: extra.help, fix: extra.fix }), { loc: at.loc });
}

/** A text edit replacing the authored source of `at`. */
export function replaceSyntax(at: SExpr, newText: string): NonNullable<Diagnostic["fix"]>[number] {
  return { span: { sourceId: at.loc.sourceId ?? "", startOffset: at.loc.start, endOffset: at.loc.end }, newText };
}
