import { TextDocument } from "vscode-languageserver-textdocument";
import {
  findEditorTypeAtOffset,
  type Diagnostic,
  type EditorAnalysisRequest,
  type EditorAnalysisResult,
  type EditorTypedSpan,
  type Span,
  type TypeProjection,
} from "@formalang/host";

import type { AbiDiagnostic, AbiSpan } from "./protocol.js";
import { isRecord } from "./protocol.js";
import { editorDiagnostics, editorValue, OcamlWorkspaceSession } from "./session.js";

export interface OcamlEditorAnalysisHostOptions {
  readonly workspaceRoot?: string;
  readonly artifactPath?: string;
  readonly preludeNames?: readonly string[];
}

export interface OcamlEditorAnalysisHost {
  analyzeEditor(request: EditorAnalysisRequest): Promise<EditorAnalysisResult>;
  findTypeAtOffset(
    typedSpans: readonly EditorTypedSpan[],
    offset: number,
  ): EditorTypedSpan | undefined;
  close(): Promise<void>;
}

export function createOcamlEditorAnalysisHost(
  options: OcamlEditorAnalysisHostOptions = {},
): OcamlEditorAnalysisHost {
  const session = new OcamlWorkspaceSession(options);

  return {
    async analyzeEditor(request) {
      const sourceId = request.sourceId ?? "editor";
      const uri = sourceId.startsWith("file://")
        ? sourceId
        : `file:///workspace/${encodeURIComponent(sourceId)}`;
      const document = TextDocument.create(uri, "lisp", 1, request.source);
      const analysis = await session.updateDocument(document);
      return editorAnalysisResultFromOcamlResponse({
        sourceId,
        source: request.source,
        responseValue: editorValue(analysis.response),
        diagnostics: editorDiagnostics(analysis.response),
      });
    },
    findTypeAtOffset: (typedSpans, offset) => findEditorTypeAtOffset(typedSpans, offset),
    close: () => session.close(),
  };
}

export function editorAnalysisResultFromOcamlResponse({
  sourceId,
  source,
  responseValue,
  diagnostics,
}: {
  sourceId: string;
  source: string;
  responseValue: Record<string, unknown>;
  diagnostics: readonly AbiDiagnostic[];
}): EditorAnalysisResult {
  const typedCore = isRecord(responseValue["typedCore"]) ? responseValue["typedCore"] : null;
  const resultTypeDisplay =
    typeof typedCore?.["resultType"] === "string" ? typedCore["resultType"] : undefined;
  const diagnosticResults = diagnostics.map((diagnostic) =>
    toEditorDiagnostic(sourceId, diagnostic),
  );

  return {
    sourceId,
    success: diagnosticResults.every((diagnostic) => diagnostic.severity !== "error"),
    ...(resultTypeDisplay
      ? {
          resultTypeDisplay,
          resultType: typeProjection(resultTypeDisplay),
        }
      : {}),
    typedSpans: typedCore ? typedSpansFromTypedCore(sourceId, source, typedCore) : [],
    errors: [],
    diagnostics: diagnosticResults,
    parse: {
      errors: [],
      greenTree: null,
      redTree: null,
    },
  };
}

function typedSpansFromTypedCore(
  sourceId: string,
  source: string,
  typedCore: Record<string, unknown>,
): readonly EditorTypedSpan[] {
  const annotations = Array.isArray(typedCore["annotations"]) ? typedCore["annotations"] : [];

  return annotations.filter(isRecord).flatMap((annotation, index): EditorTypedSpan[] => {
    const span = toSpan(sourceId, annotation["span"]);
    const display = typeof annotation["type"] === "string" ? annotation["type"] : null;
    if (!span || !display) return [];

    const expr = isRecord(annotation["expr"]) ? annotation["expr"] : null;
    return [
      {
        id:
          typeof annotation["nodeId"] === "number"
            ? `ocaml:${annotation["nodeId"]}`
            : `ocaml:${index}`,
        span,
        display,
        type: typeProjection(display),
        code: source.slice(span.startOffset, span.endOffset),
        exprTag: typeof expr?.["kind"] === "string" ? expr["kind"] : "expr",
      },
    ];
  });
}

function toEditorDiagnostic(sourceId: string, diagnostic: AbiDiagnostic): Diagnostic {
  return {
    code: diagnostic.code ? `ocaml/${diagnostic.code}` : "ocaml/diagnostic",
    severity: diagnosticSeverity(diagnostic.severity),
    message: diagnostic.message ?? "OCaml language diagnostic",
    phase: "typecheck",
    ...(diagnostic.span ? { span: toSpan(sourceId, diagnostic.span) ?? undefined } : {}),
  };
}

function toSpan(sourceId: string, value: unknown): Span | null {
  if (!isAbiSpan(value)) return null;
  return {
    sourceId: value.sourceId ?? sourceId,
    startOffset: value.startOffset,
    endOffset: value.endOffset,
  };
}

function isAbiSpan(
  value: unknown,
): value is Required<Pick<AbiSpan, "startOffset" | "endOffset">> & AbiSpan {
  return (
    isRecord(value) &&
    typeof value["startOffset"] === "number" &&
    typeof value["endOffset"] === "number"
  );
}

function diagnosticSeverity(severity: string | undefined): Diagnostic["severity"] {
  switch (severity) {
    case "warning":
      return "warning";
    case "information":
    case "hint":
      return "info";
    case "error":
    default:
      return "error";
  }
}

function typeProjection(display: string): TypeProjection {
  return { kind: "display", display };
}
