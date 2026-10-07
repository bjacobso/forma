import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { bracketMatching, foldGutter } from "@codemirror/language";
import { closeBrackets } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { setDiagnostics } from "@codemirror/lint";
import { editorAppearance, lispSupport, structuralKeymap, type SyntaxPalette } from "@formalang/editor/codemirror";
import type { Diagnostic } from "../engine/protocol";
import type { SpanRange } from "../lib/artifacts";

export function WorkbenchEditor({ source, onChange, onInspect, diagnostics, mode, palette, reveal, focusOnReveal = true }: {
  source: string;
  onChange: (source: string) => void;
  onInspect: (offset: number) => void;
  diagnostics: readonly Diagnostic[];
  mode: "light" | "dark";
  palette: SyntaxPalette;
  reveal: SpanRange | null;
  focusOnReveal?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const appearance = useRef(new Compartment());
  const callbacks = useRef({ onChange, onInspect });
  callbacks.current = { onChange, onInspect };
  useEffect(() => {
    const editor = new EditorView({
      parent: container.current!,
      state: EditorState.create({ doc: source, extensions: [
        lispSupport(), appearance.current.of(editorAppearance(mode, palette)),
        history(), bracketMatching(), closeBrackets(), lineNumbers(), foldGutter({ openText: "−", closedText: "+" }),
        keymap.of([...defaultKeymap, ...historyKeymap]), structuralKeymap,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Forma source", spellcheck: "false" }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) callbacks.current.onInspect(update.state.selection.main.head);
        }),
        EditorView.domEventHandlers({ mousemove: event => {
          const offset = view.current?.posAtCoords({ x: event.clientX, y: event.clientY });
          if (offset != null) callbacks.current.onInspect(offset);
        }}),
      ] }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, []);
  useEffect(() => {
    view.current?.dispatch({ effects: appearance.current.reconfigure(editorAppearance(mode, palette)) });
  }, [mode, palette]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === source) return;
    let from = 0;
    while (from < current.length && from < source.length && current[from] === source[from]) from++;
    let suffix = 0;
    while (suffix < current.length - from && suffix < source.length - from && current[current.length - suffix - 1] === source[source.length - suffix - 1]) suffix++;
    editor.dispatch({ changes: { from, to: current.length - suffix, insert: source.slice(from, source.length - suffix) } });
  }, [source]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch(setDiagnostics(editor.state, diagnostics.flatMap(d => {
      if (!d.span) return [];
      const from = Math.max(0, Math.min(editor.state.doc.length, d.span.startOffset));
      const to = Math.max(from, Math.min(editor.state.doc.length, d.span.endOffset));
      return [{ from, to, severity: d.severity, message: d.message, source: d.code }];
    })));
  }, [diagnostics]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || !reveal) return;
    const from = Math.max(0, Math.min(editor.state.doc.length, reveal[0]));
    const to = Math.max(from, Math.min(editor.state.doc.length, reveal[1]));
    editor.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
    if (focusOnReveal) editor.focus();
  }, [reveal, focusOnReveal]);
  return <div className="workbench-source" ref={container} />;
}
