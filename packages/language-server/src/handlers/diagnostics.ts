import {
  DiagnosticSeverity,
  type Diagnostic,
  type PublishDiagnosticsParams,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Diagnostic as FormaDiagnostic } from "@formalang/ts/analysis";

import { spanToLocation, spanToRange } from "../document.js";
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
      .map((diagnostic) => toLspDiagnostic(document, diagnostic, workspace)),
  };
}

export function toLspDiagnostic(document: TextDocument, diagnostic: FormaDiagnostic, workspace?: FormaWorkspace): Diagnostic {
  return {
    range: spanToRange(document, diagnostic.span ?? { startOffset: 0, endOffset: 0 }),
    message: diagnostic.help ? `${diagnostic.message}\nhelp: ${diagnostic.help}` : diagnostic.message,
    severity:
      diagnostic.severity === "warning"
        ? DiagnosticSeverity.Warning
        : diagnostic.severity === "info"
          ? DiagnosticSeverity.Information
          : DiagnosticSeverity.Error,
    source: "forma",
    code: diagnostic.code,
    ...(diagnostic.related ? {relatedInformation:diagnostic.related.flatMap(note => {
      const location = workspace ? spanToLocation(workspace,note.span)
        : note.span.sourceId === document.uri ? {uri:document.uri,range:spanToRange(document,note.span)} : undefined;
      return location ? [{location,message:note.message}] : [];
    })} : {}),
    data: { fix: diagnostic.fix, details: diagnostic.details },
  };
}
