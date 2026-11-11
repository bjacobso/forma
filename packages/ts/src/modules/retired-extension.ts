import type { Diagnostic, Span } from "../diagnostic/diagnostic.js";

/** The span covers the complete string literal, including its quotes. */
export function retiredExtensionDiagnostic(path: string, span: Span): Diagnostic {
  return {
    code: "module/retired-extension",
    severity: "error",
    phase: "typecheck",
    message: `The .forma source extension is retired: ${path}.`,
    help: "Rename the source file to .lisp and update this path.",
    span,
    fix: [{ span, newText: JSON.stringify(path.slice(0, -6) + ".lisp") }],
  };
}
