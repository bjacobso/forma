import { formatMarkdownDocument, markdownFormattingKeymap } from "../codemirror/format.js";
/**
 * MarkdownEditor
 *
 * Generic CodeMirror 6 editor for markdown source files.
 */

import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { closeBrackets } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder as cmPlaceholder } from "@codemirror/view";
import { lispSupport } from "../codemirror/syntax.js";
import { appDarkSyntaxHighlighting, appDarkTheme, appLightTheme } from "../codemirror/theme.js";

export interface MarkdownEditorProps {
  /** Current markdown source (controlled) */
  value?: string;
  /** Called on change */
  onChange?: (source: string) => void;
  /** Read-only mode */
  readOnly?: boolean;
  /** Fixed editor height */
  height?: string;
  /** Show line numbers */
  lineNumbers?: boolean;
  /** Theme */
  theme?: "app-dark" | "vs-dark" | "light";
  /** Additional className for outer container */
  className?: string;
  /** Placeholder text when editor is empty */
  placeholder?: string;
  /** Accessible label for the editable CodeMirror surface */
  ariaLabel?: string;
}

export interface MarkdownEditorRef {
  /** Format Lisp fences in the selection, or throughout the document. */
  format: () => boolean;
  /** Reveal a specific line (centers the line in view) */
  revealLine: (line: number) => void;
  /** Get the underlying CodeMirror EditorView instance */
  getEditor: () => EditorView | null;
}

const ontologyCodeLanguages = [
  LanguageDescription.of({
    name: "lisp",
    alias: ["forma", "clojure", "scheme"],
    extensions: ["lisp", "forma", "clj"],
    support: lispSupport(),
  }),
];

const fixedHeightTheme = EditorView.theme({
  "&": {
    height: "100%",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
});

export const MarkdownEditor = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      value,
      onChange,
      readOnly = false,
      height = "400px",
      lineNumbers: showLineNumbers = true,
      theme = "app-dark",
      className,
      placeholder,
      ariaLabel,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const valueRef = useRef(value ?? "");
    const onChangeRef = useRef(onChange);
    valueRef.current = value ?? "";
    onChangeRef.current = onChange;

    useImperativeHandle(ref, () => ({
      revealLine: (line: number) => {
        const view = viewRef.current;
        if (!view) return;

        const targetLine = Math.max(1, Math.min(line, view.state.doc.lines));
        const lineInfo = view.state.doc.line(targetLine);
        view.dispatch({
          effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
          selection: { anchor: lineInfo.from },
        });
        view.focus();
      },
      getEditor: () => viewRef.current,
      format: () => viewRef.current ? formatMarkdownDocument(viewRef.current) : false,
    }));

    const createEditor = useCallback(() => {
      const container = containerRef.current;
      if (!container) return;

      viewRef.current?.destroy();
      viewRef.current = null;

      const extensions = [
        markdown({
          codeLanguages: ontologyCodeLanguages,
        }),
        theme === "app-dark" || theme === "vs-dark"
          ? [appDarkTheme, appDarkSyntaxHighlighting]
          : [appLightTheme, syntaxHighlighting(defaultHighlightStyle, { fallback: true })],
        fixedHeightTheme,
        history(),
        bracketMatching(),
        closeBrackets(),
        keymap.of([...markdownFormattingKeymap, ...defaultKeymap, ...historyKeymap]),
        ...(showLineNumbers ? [lineNumbers()] : []),
        ...(placeholder ? [cmPlaceholder(placeholder)] : []),
        ...(readOnly ? [EditorState.readOnly.of(true)] : []),
        ...(ariaLabel ? [EditorView.contentAttributes.of({ "aria-label": ariaLabel })] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString());
          }
        }),
        EditorView.lineWrapping,
      ];

      const state = EditorState.create({
        doc: valueRef.current,
        extensions,
      });

      viewRef.current = new EditorView({
        state,
        parent: container,
      });
    }, [ariaLabel, placeholder, readOnly, showLineNumbers, theme]);

    useEffect(() => {
      createEditor();
      return () => {
        viewRef.current?.destroy();
        viewRef.current = null;
      };
    }, [createEditor]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      const currentValue = view.state.doc.toString();
      if (value !== undefined && value !== currentValue) {
        view.dispatch({
          changes: { from: 0, to: currentValue.length, insert: value },
        });
      }
    }, [value]);

    return (
      <div className={className} style={{ height }}>
        <div ref={containerRef} className="h-full" />
      </div>
    );
  },
);
