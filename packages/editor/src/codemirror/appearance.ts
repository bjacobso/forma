import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { appDarkSyntaxHighlighting, appDarkTheme, appLightSyntaxHighlighting, appLightTheme } from "./theme.js";
import { tags } from "@lezer/highlight";

export type SyntaxPalette = "forma" | "ocean" | "orchid";

/** Appearance and token colors are independent; use in a Compartment to preserve undo. */
export function editorAppearance(mode: "light" | "dark", palette: SyntaxPalette = "forma"): Extension {
  const dark = mode === "dark";
  if (palette === "forma") return [dark ? appDarkTheme : appLightTheme, dark ? appDarkSyntaxHighlighting : appLightSyntaxHighlighting];
  const colors = palette === "ocean"
    ? dark ? ["#67e8f9", "#a7f3d0", "#fcd34d", "#93c5fd"] : ["#0e7490", "#047857", "#a16207", "#1d4ed8"]
    : dark ? ["#e9a8ff", "#fecdd3", "#c4b5fd", "#f9a8d4"] : ["#9333a3", "#be185d", "#6d28d9", "#a21caf"];
  return [dark ? appDarkTheme : appLightTheme, syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword, color: colors[0], fontWeight: "600" },
    { tag: tags.string, color: colors[1] },
    { tag: [tags.number, tags.bool], color: colors[2] },
    { tag: [tags.atom, tags.typeName, tags.propertyName, tags.function(tags.variableName)], color: colors[3] },
    { tag: tags.lineComment, color: dark ? "#94a3b8" : "#64748b", fontStyle: "italic" },
    { tag: [tags.paren, tags.squareBracket, tags.brace], color: dark ? "#94a3b8" : "#78716c" },
    { tag: tags.variableName, color: dark ? "#e2e8f0" : "#292524" },
  ]))];
}
