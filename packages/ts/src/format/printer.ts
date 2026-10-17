import type { Doc } from "./doc.js";
interface Command { readonly doc: Doc; readonly depth: number; readonly flat: boolean }

/** Consider the remaining line as well as the candidate group, so that closing
 * delimiters outside a nested group also count toward the column budget. */
function fits(remaining: number, commands: readonly Command[]): boolean {
  const stack = [...commands];
  while (stack.length && remaining >= 0) {
    const { doc, depth, flat } = stack.pop()!;
    switch (doc.kind) {
      case "text": {
        const newline = doc.value.search(/[\r\n]/);
        if (newline >= 0) return !flat && newline <= remaining;
        remaining -= doc.value.length;
        break;
      }
      case "breakParent": if (flat) return false; break;
      case "line": if (!flat) return true; if (doc.hard) return false; remaining -= doc.flat.length; break;
      case "concat": for (let i = doc.parts.length - 1; i >= 0; i--) stack.push({ doc: doc.parts[i]!, depth, flat }); break;
      case "indent": stack.push({ doc: doc.doc, depth, flat }); break;
      default: stack.push({ doc: doc.doc, depth, flat: true }); break;
    }
  }
  return remaining >= 0;
}

export function printDoc(doc: Doc, width = 80, indentSize = 2): string {
  let result = "", column = 0, suffix = "";
  const emit = (value: string) => {
    result += value;
    column = value.includes("\n") ? value.length - value.lastIndexOf("\n") - 1 : column + value.length;
  };
  const stack: Command[] = [{ doc, depth: 0, flat: false }];
  while (stack.length) {
    const { doc: d, depth, flat } = stack.pop()!;
    switch (d.kind) {
      case "text": emit(d.value); break;
      case "concat": for (let i = d.parts.length - 1; i >= 0; i--) stack.push({ doc: d.parts[i]!, depth, flat }); break;
      case "group": stack.push({ doc: d.doc, depth, flat: flat || fits(width - column - suffix.length, [...stack, { doc: d.doc, depth, flat: true }]) }); break;
      case "indent": stack.push({ doc: d.doc, depth: depth + indentSize, flat }); break;
      case "breakParent": break;
      case "lineSuffix": suffix += printDoc(d.doc, Infinity, 0); break;
      case "line":
        if (flat && !d.hard && !suffix) emit(d.flat);
        else { emit(suffix); suffix = ""; emit("\n" + " ".repeat(depth)); }
        break;
    }
  }
  emit(suffix);
  return result;
}
