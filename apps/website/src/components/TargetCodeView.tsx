import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { editorAppearance, type SyntaxPalette } from "@formalang/editor/codemirror";
import { useEffect, useRef } from "react";
import { useTheme } from "../lib/theme";
import type { PipelinePreview } from "../pipelines/types";

export function TargetCodeView({
  code,
  language,
  palette = "forma",
  mode,
}: {
  readonly code: string;
  readonly language: PipelinePreview["language"];
  readonly palette?: SyntaxPalette;
  readonly mode?: "light" | "dark";
}) {
  const { theme } = useTheme();
  const appearanceMode = mode ?? theme;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const appearance = useRef(new Compartment());
  const syntax = useRef(new Compartment());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    viewRef.current = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: code,
        extensions: [
          appearance.current.of(editorAppearance(appearanceMode, palette)),
          lineNumbers(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          syntax.current.of([
            targetLanguage(language),
            EditorView.contentAttributes.of({ "aria-label": `${language} target preview` }),
          ]),
        ],
      }),
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: appearance.current.reconfigure(editorAppearance(appearanceMode, palette)) });
  }, [appearanceMode, palette]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: syntax.current.reconfigure([
      targetLanguage(language),
      EditorView.contentAttributes.of({ "aria-label": `${language} target preview` }),
    ]) });
  }, [language]);

  useEffect(() => {
    const editor = viewRef.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === code) return;
    // Keep the editor, selection, and scroll position as output changes.
    let from = 0;
    while (from < current.length && from < code.length && current[from] === code[from]) from++;
    let suffix = 0;
    while (suffix < current.length - from && suffix < code.length - from && current[current.length - suffix - 1] === code[code.length - suffix - 1]) suffix++;
    editor.dispatch({ changes: { from, to: current.length - suffix, insert: code.slice(from, code.length - suffix) } });
  }, [code]);

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
