import { InferenceError } from "../diagnostic/errors.js";
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
export function surfaceError(message: string, at: SExpr, code = "surface/invalid-form"): InferenceError & { loc: SExpr["loc"] } {
  return Object.assign(new InferenceError({ message, details: { code } }), { loc: at.loc });
}
