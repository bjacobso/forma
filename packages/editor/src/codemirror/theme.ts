/** Warm paper and green-black code surfaces, shared by editable and target code. */

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const appLightTheme = EditorView.theme({
  "&": {
    backgroundColor: "#fffdf8",
    color: "#292524",
  },
  ".cm-content": {
    caretColor: "#292524",
    fontFamily: "monospace",
    fontSize: "14px",
    padding: "12px 0",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#292524",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "#d8d2c8",
  },
  ".cm-activeLine": {
    backgroundColor: "#f2eee4",
  },
  ".cm-gutters": {
    backgroundColor: "#fffdf8",
    color: "#57534e",
    borderRight: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#e7e1d7",
    color: "#292524",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 16px",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-placeholder": {
    color: "#57534e",
    fontStyle: "normal",
  },
});

export const appDarkTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#111613",
      color: "#eef0ea",
    },
    ".cm-content": {
      caretColor: "#eef0ea",
      fontFamily: "monospace",
      fontSize: "14px",
      padding: "12px 0",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#eef0ea",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#37513d",
    },
    ".cm-activeLine": {
      backgroundColor: "#1a1f1b",
    },
    ".cm-gutters": {
      backgroundColor: "#111613",
      color: "#b5bcb4",
      borderRight: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#1a1f1b",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 8px 0 16px",
    },
    ".cm-tooltip": {
      backgroundColor: "#1a1f1b",
      border: "1px solid #414a43",
      color: "#eef0ea",
    },
    ".cm-tooltip.cm-tooltip-autocomplete": {
      backgroundColor: "#1a1f1b",
      border: "1px solid #414a43",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "#37513d",
    },
    ".cm-panels": {
      backgroundColor: "#1a1f1b",
      color: "#eef0ea",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      outline: "1px solid #b5bcb4",
    },
    ".cm-matchingBracket": {
      backgroundColor: "#1a1f1b",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
    "&::-webkit-scrollbar, .cm-scroller::-webkit-scrollbar": {
      width: "8px",
      height: "8px",
    },
    "&::-webkit-scrollbar-thumb, .cm-scroller::-webkit-scrollbar-thumb": {
      background: "#414a43",
      borderRadius: "4px",
    },
    "&::-webkit-scrollbar-thumb:hover, .cm-scroller::-webkit-scrollbar-thumb:hover": {
      background: "#67756a",
    },
    ".cm-placeholder": {
      color: "#b5bcb4",
      fontStyle: "normal",
    },
  },
  { dark: true },
);

export const appDarkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "#d2bbef" },
  { tag: t.variableName, color: "#eef0ea" },
  { tag: t.heading, color: "#93c5fd", fontWeight: "700" },
  { tag: t.heading1, color: "#bfdbfe", fontWeight: "700" },
  { tag: t.heading2, color: "#bfdbfe", fontWeight: "700" },
  { tag: t.heading3, color: "#bfdbfe", fontWeight: "700" },
  { tag: t.processingInstruction, color: "#f472b6" },
  { tag: t.link, color: "#7dd3fc", textDecoration: "underline" },
  { tag: t.url, color: "#7dd3fc" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.atom, color: "#9bbaf5" },
  { tag: t.string, color: "#b0d7b5" },
  { tag: t.number, color: "#9bbaf5" },
  { tag: t.bool, color: "#d2bbef" },
  { tag: t.lineComment, color: "#b5bcb4", fontStyle: "italic" },
  { tag: t.paren, color: "#b5bcb4" },
  { tag: t.squareBracket, color: "#b5bcb4" },
  { tag: t.brace, color: "#b5bcb4" },
  { tag: t.meta, color: "#f472b6" },
  // For semantic highlights
  { tag: t.typeName, color: "#9bbaf5" },
  { tag: t.function(t.variableName), color: "#9bbaf5" },
  { tag: t.propertyName, color: "#9bbaf5" },
]);

export const appLightHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "#5b21b6", fontWeight: "600" },
  { tag: t.variableName, color: "#292524" },
  { tag: t.heading, color: "#1e3a8a", fontWeight: "700" },
  { tag: t.heading1, color: "#1e3a8a", fontWeight: "700" },
  { tag: t.heading2, color: "#1e3a8a", fontWeight: "700" },
  { tag: t.heading3, color: "#1e3a8a", fontWeight: "700" },
  { tag: t.processingInstruction, color: "#9d174d", fontWeight: "600" },
  { tag: t.link, color: "#075985", textDecoration: "underline" },
  { tag: t.url, color: "#075985" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.atom, color: "#9a3412", fontWeight: "600" },
  { tag: t.string, color: "#166534" },
  { tag: t.number, color: "#075985" },
  { tag: t.bool, color: "#5b21b6" },
  { tag: t.lineComment, color: "#57534e", fontStyle: "italic" },
  { tag: t.paren, color: "#57534e" },
  { tag: t.squareBracket, color: "#57534e" },
  { tag: t.brace, color: "#57534e" },
  { tag: t.meta, color: "#9d174d" },
  { tag: t.typeName, color: "#1e3a8a", fontWeight: "600" },
  { tag: t.function(t.variableName), color: "#1d4ed8" },
  { tag: t.propertyName, color: "#854d0e" },
]);

export const appDarkSyntaxHighlighting = syntaxHighlighting(appDarkHighlightStyle);
export const appLightSyntaxHighlighting = syntaxHighlighting(appLightHighlightStyle);
