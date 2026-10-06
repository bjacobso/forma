import type { CstExpr, SymbolDefinition } from "./protocol.js";

export const BUILTIN_COMPLETIONS: readonly string[] = [
  "define", "fn", "let", "if", "do", "do!", "match", "quote", "quasiquote", "unquote",
  "type", "error", "class", "service", "layer", "form", "macro", "typeclass", ":",
  "list", "vector", "map", "get", "+", "-", "*", "/", "=", "<", "<=", ">", ">=",
  "and", "or", "not", "concat", "count", "first", "rest", "reduce",
];

const definitionHeads = new Set([
  "define", "type", "error", "class", "service", "layer", "form", "macro", "typeclass",
  "entity", "relation", "query", "view", "workspace", "process", "task", "document", "api",
]);

export function collectDefinitions(
  uri: string,
  exprs: readonly CstExpr[],
): readonly SymbolDefinition[] {
  const definitions: SymbolDefinition[] = [];
  const visit = (expr: CstExpr): void => {
    if (expr.kind === "list") {
      const head = expr.items[0];
      const binding = expr.items[1];
      const headName = symbolName(head);
      if (headName === "quote" || headName === "quasiquote") return;
      if (headName && definitionHeads.has(headName) && binding) {
        const name = bindingName(binding);
        const span =
          binding.kind === "list" ? (binding.items[0]?.span ?? binding.span) : binding.span;
        if (name) {
          definitions.push({
            name,
            uri,
            span,
            detail: headName,
          });
        }
      }
    }

    for (const child of childExprs(expr)) {
      visit(child);
    }
  };

  exprs.forEach(visit);
  return definitions;
}

export function collectSymbols(exprs: readonly CstExpr[]): readonly string[] {
  const symbols = new Set<string>();
  const visit = (expr: CstExpr): void => {
    const name = symbolName(expr);
    if (name) symbols.add(name);
    for (const child of childExprs(expr)) {
      visit(child);
    }
  };
  exprs.forEach(visit);
  return [...symbols].sort();
}

export function symbolName(expr: CstExpr | undefined): string | undefined {
  if (!expr) return undefined;
  if ((expr.kind === "symbol" || expr.kind === "keyword") && typeof expr.value === "string") {
    return expr.value;
  }
  return undefined;
}

function bindingName(expr: CstExpr): string | undefined {
  if (expr.kind === "symbol" || expr.kind === "keyword") {
    return typeof expr.value === "string" ? expr.value : undefined;
  }
  if (expr.kind === "list" || expr.kind === "vector") {
    return symbolName(expr.items[0]);
  }
  return undefined;
}

function childExprs(expr: CstExpr): readonly CstExpr[] {
  if (expr.kind === "list" || expr.kind === "vector") return expr.items;
  if (expr.kind === "map") return expr.entries.flatMap((entry) => [entry.key, entry.value]);
  return [];
}
