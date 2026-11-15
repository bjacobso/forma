import type { AstNode, Span, TimedPassResult } from "../engine/protocol";

export type SpanRange = readonly [number, number];

export function spanRange(span: Span | undefined): SpanRange | null {
  if (!span) return null;
  return [span.startOffset, span.endOffset];
}

export function sameSpan(a: SpanRange | null, b: SpanRange | null): boolean {
  return Boolean(a && b && a[0] === b[0] && a[1] === b[1]);
}

export function passOf<P extends TimedPassResult["pass"]>(
  results: readonly TimedPassResult[],
  pass: P,
): Extract<TimedPassResult, { readonly pass: P }> | null {
  return (results.find((result) => result.pass === pass) as Extract<
    TimedPassResult,
    { readonly pass: P }
  > | undefined) ?? null;
}

export function astToSource(nodes: readonly AstNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return "";
  return nodes.map((node) => nodeToSource(node)).join("\n");
}

export function nodeToSource(node: AstNode): string {
  switch (node.kind) {
    case "nil":
      return "nil";
    case "bool":
      return node.value ? "true" : "false";
    case "int":
    case "float":
      return String(node.value);
    case "string":
      return JSON.stringify(node.value);
    case "symbol":
    case "keyword":
      return node.value;
    case "list":
      return `(${node.items.map(nodeToSource).join(" ")})`;
    case "vector":
      return `[${node.items.map(nodeToSource).join(" ")}]`;
    case "set":
      return `{${node.items.map(nodeToSource).join(" ")}}`;
    case "map":
      return `{${node.entries
        .map((entry) => `${nodeToSource(entry.key)} ${nodeToSource(entry.value)}`)
        .join(" ")}}`;
    case "error":
      return `<error: ${node.message}>`;
  }
}

export function formatJsonish(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
