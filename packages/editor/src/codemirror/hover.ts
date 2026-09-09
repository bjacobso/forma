/**
 * CodeMirror 6 hover tooltip extension.
 *
 * Combines HM type info from LSP analysis with optional domain-specific hover
 * from a HoverProvider.
 */

import { hoverTooltip, type Tooltip } from "@codemirror/view";
import type { EditorAnalysisResult, EditorTypedSpan } from "@formalang/host/types";
import { getDefaultEditorAnalysisHost } from "../analysis-host.js";
import type { HoverProvider } from "./types.js";

export type AnalysisProvider = () => EditorAnalysisResult | null;

export interface HoverExtensionOptions {
  analysisProvider?: AnalysisProvider | undefined;
  hoverProvider?: HoverProvider | undefined;
  findTypeAtOffset?:
    | ((typedSpans: readonly EditorTypedSpan[], offset: number) => EditorTypedSpan | undefined)
    | undefined;
}

export function createHoverExtension(options: HoverExtensionOptions) {
  return hoverTooltip((view, pos): Tooltip | null => {
    const source = view.state.doc.toString();

    // 1. HM type info from cached analysis
    const analysis = options.analysisProvider?.();
    const findTypeAtOffset =
      options.findTypeAtOffset ?? getDefaultEditorAnalysisHost().findTypeAtOffset;
    const hmHover = analysis ? findTypeAtOffset(analysis.typedSpans, pos) : undefined;

    // 2. Domain-specific documentation
    const domainHover = options.hoverProvider?.getHover(source, pos);
    const formContent = domainHover?.content;
    const formRange = domainHover?.range;

    if (!hmHover && !formContent) return null;

    const parts: string[] = [];
    if (hmHover) parts.push(`**type:** \`${hmHover.display}\``);
    if (formContent) parts.push(formContent);

    const from = hmHover ? hmHover.span.startOffset : formRange ? formRange.start : pos;
    const to = hmHover ? hmHover.span.endOffset : formRange ? formRange.end : pos + 1;

    return {
      pos: from,
      end: to,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "cm-lisp-hover";
        dom.style.cssText =
          "padding: 6px 8px; font-size: 13px; font-family: monospace; max-width: 500px; white-space: pre-wrap;";
        dom.textContent = parts.join("\n\n");
        return { dom };
      },
    };
  });
}
