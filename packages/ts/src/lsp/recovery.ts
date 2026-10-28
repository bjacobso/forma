import { identifySyntax } from "../syntax/identity.js";

/** Blank only broken top-level forms, preserving author offsets and lines. */
export function blankBrokenForms(text: string): string {
  const identity = identifySyntax(text);
  const broken = identity.nodes.filter(
    (node) =>
      node.parent === null &&
      (node.kind === "Error" ||
        identity.errors.some(
          (error) => error.span.start < node.span.end && node.span.start <= error.span.start,
        )),
  );
  let result = text;
  for (const node of broken) {
    const blank = text.slice(node.span.start, node.span.end).replace(/[^\n]/g, " ");
    result = result.slice(0, node.span.start) + blank + result.slice(node.span.end);
  }
  return result;
}
