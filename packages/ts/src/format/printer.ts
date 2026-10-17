import type { Doc } from "./doc.js";

function flatWidth(doc: Doc): number {
  switch (doc.kind) {
    case "text": return /[\r\n]/.test(doc.value) ? Infinity : doc.value.length;
    case "breakParent": return Infinity;
    case "line": return doc.hard ? Infinity : doc.flat.length;
    case "concat": return doc.parts.reduce((n, part) => n + flatWidth(part), 0);
    default: return flatWidth(doc.doc);
  }
}

export function printDoc(doc: Doc, width = 80, indentSize = 2): string {
  let result = "", column = 0, suffix = "";
  const emit = (value: string) => {
    result += value;
    column = value.includes("\n") ? value.length - value.lastIndexOf("\n") - 1 : column + value.length;
  };
  const visit = (d: Doc, depth: number, flat: boolean): void => {
    switch (d.kind) {
      case "text": emit(d.value); break;
      case "concat": for (const part of d.parts) visit(part, depth, flat); break;
      case "group": visit(d.doc, depth, flat || column + flatWidth(d.doc) <= width); break;
      case "indent": visit(d.doc, depth + indentSize, flat); break;
      case "breakParent": break;
      case "lineSuffix": {
        // Suffixes contain only comment text, never layout.
        const save = result, col = column;
        result = ""; column = 0; visit(d.doc, 0, true);
        suffix += result; result = save; column = col;
        break;
      }
      case "line":
        if (flat && !d.hard && !suffix) emit(d.flat);
        else { emit(suffix); suffix = ""; emit("\n" + " ".repeat(depth)); }
        break;
    }
  };
  visit(doc, 0, false);
  emit(suffix);
  return result;
}
