import {
  DiagnosticSeverity,
  type Diagnostic,
  type PublishDiagnosticsParams,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Diagnostic as FormaDiagnostic } from "@formalang/ts/analysis";

import { spanToRange } from "../document.js";
import type { FormaWorkspace } from "../workspace.js";

export function getDiagnostics(
  workspace: FormaWorkspace,
  document: TextDocument,
): PublishDiagnosticsParams {
  return {
    uri: document.uri,
    version: document.version,
    diagnostics: workspace.analysis
      .diagnostics(document.uri)
      .map((diagnostic) => toLspDiagnostic(document, diagnostic)),
  };
}

export function toLspDiagnostic(document: TextDocument, diagnostic: FormaDiagnostic): Diagnostic {
  return {
    range: spanToRange(document, diagnostic.span ?? { startOffset: 0, endOffset: 0 }),
    message: diagnostic.message,
    severity:
      diagnostic.severity === "warning"
        ? DiagnosticSeverity.Warning
        : diagnostic.severity === "info"
          ? DiagnosticSeverity.Information
          : DiagnosticSeverity.Error,
    source: "forma",
    code: diagnostic.code,
  };
}
