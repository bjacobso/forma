import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import {
  appDarkSyntaxHighlighting,
  appDarkTheme,
  appLightSyntaxHighlighting,
  appLightTheme,
} from "@formalang/editor/codemirror";
import { useEffect, useRef } from "react";
import { useTheme } from "../lib/theme";
import type { PipelinePreview } from "../pipelines/types";

export function TargetCodeView({
  code,
  language,
}: {
  readonly code: string;
  readonly language: PipelinePreview["language"];
}) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    viewRef.current?.destroy();
    viewRef.current = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: code,
        extensions: [
          ...(theme === "dark"
            ? [appDarkTheme, appDarkSyntaxHighlighting]
            : [appLightTheme, appLightSyntaxHighlighting, syntaxHighlighting(defaultHighlightStyle, { fallback: true })]),
          lineNumbers(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          targetLanguage(language),
          EditorView.contentAttributes.of({
            "aria-label": `${language} target preview`,
          }),
        ],
      }),
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [code, language, theme]);

  return <div className="target-code-view" ref={containerRef} />;
}

function targetLanguage(language: PipelinePreview["language"]) {
  switch (language) {
    case "json":
      return json();
    case "typescript":
      return javascript({ typescript: true });
  }
}
