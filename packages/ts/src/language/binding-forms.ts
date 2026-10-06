/** The binding and expression positions of core forms, in evaluation order. */
import type { SExpr } from "../reader/types.js";
import { children } from "../reader/types.js";

export type BindingKind = "value" | "function" | "macro" | "type" | "constructor" | "method" | "parameter" | "local";
export type BindingStep =
  | { readonly role: "expression" | "type" | "data" | "template"; readonly expr: SExpr }
  | { readonly role: "bind"; readonly expr: SExpr; readonly kind: BindingKind; readonly global?: boolean; readonly pattern?: boolean }
  | { readonly role: "scope"; readonly steps: readonly BindingStep[]; readonly typeVariables?: readonly string[] };

export const CORE_FORMS: ReadonlySet<string> = new Set([
  "fn", "let", "if", "do", "match", "define", "quote", "quasiquote",
  "unquote", "unquote-splicing", "define-macro", "define-type", "define-typeclass",
  "instance", "define-operation", "define-error", "define-schema", "define-service",
  "do!", "<-", "fail", "catch", "succeed", ":", "::", "nil",
]);

export const bindingName = (expr: SExpr | undefined): string | undefined => expr?._tag === "Sym" ? expr.name : undefined;
const expression = (expr: SExpr): BindingStep => ({ role: "expression", expr });
const bind = (expr: SExpr, kind: BindingKind, global = false, pattern = false): BindingStep => ({ role: "bind", expr, kind, global, pattern });
const scope = (steps: readonly BindingStep[]): BindingStep => ({ role: "scope", steps });

/** Undefined means an ordinary application (or a descriptor supplied by a caller). */
export function describeBindingForm(expr: SExpr): readonly BindingStep[] | undefined {
  if (expr._tag !== "List") return undefined;
  const items = expr.items;
  const head = bindingName(items[0]);
  const args = items.slice(1);
  const body = (from: number) => items.slice(from).map(expression);
  switch (head) {
    case "quote": return args.map((expr) => ({ role: "data", expr }));
    case "quasiquote": return args.map((expr) => ({ role: "template", expr }));
    case "define": {
      const target = items[1];
      if (!target) return [];
      if (target._tag === "List") return [
        ...(target.items[0] ? [bind(target.items[0], "function", true)] : []),
        scope([...target.items.slice(1).map((param) => bind(param, "parameter")), ...body(2)]),
      ];
      return [bind(target, bindingName(items[2]?._tag === "List" ? items[2].items[0] : undefined) === "fn" ? "function" : "value", true), ...body(2)];
    }
    case "fn":
    case "define-macro":
    case "define-operation": {
      const named = head !== "fn";
      // An invalid named fn still exposes its parameter vector, but no name binding.
      const position = named || (items[1]?._tag === "Sym" && items[2]?._tag === "Vector") ? 2 : 1;
      const params = items[position];
      return [
        ...(named && items[1] ? [bind(items[1], head === "define-macro" ? "macro" : "function", true)] : []),
        scope([...(params?._tag === "Vector" ? params.items.map((param) => bind(param, "parameter")) : []), ...body(position + 1)]),
      ];
    }
    case "let":
    case "do!": {
      const bindings = items[1];
      const steps: BindingStep[] = [];
      if (bindings?._tag === "Vector") for (let i = 0; i < bindings.items.length; i += 2) {
        if (bindings.items[i + 1]) steps.push(expression(bindings.items[i + 1]!));
        if (bindings.items[i]) steps.push(bind(bindings.items[i]!, "local"));
      }
      return [scope([...steps, ...body(2)])];
    }
    case "match":
    case "catch": {
      const steps: BindingStep[] = items[1] ? [expression(items[1])] : [];
      for (let i = 2; i < items.length; i += 2) steps.push(scope([
        bind(items[i]!, "local", false, true),
        ...(items[i + 1] ? [expression(items[i + 1]!)] : []),
      ]));
      return steps;
    }
    case ":": return [...(items[1] ? [expression(items[1])] : []), ...items.slice(2).map((expr): BindingStep => ({ role: "type", expr }))];
    case "::": return args.map((expr) => ({ role: "type", expr }));
    case "define-type":
    case "define-typeclass": {
      const target = items[1];
      const name = target?._tag === "List" ? target.items[0] : target;
      const variables = target?._tag === "List" ? target.items.slice(1).flatMap((item) => bindingName(item) ?? []) : [];
      return [
        ...(name ? [bind(name, "type", true)] : []),
        { role: "scope", typeVariables: variables, steps: items.slice(2).flatMap((member) => {
          const name = member._tag === "List" ? member.items[0] : member;
          return [...(name ? [bind(name, head === "define-type" ? "constructor" : "method", true)] : []),
            ...(member._tag === "List" ? member.items.slice(1).map((expr): BindingStep => ({ role: "type", expr })) : [])];
        }) },
      ];
    }
    case "define-error":
    case "define-schema": return [...(items[1] ? [bind(items[1], "type", true)] : []), ...items.slice(2).map((expr): BindingStep => ({ role: "type", expr }))];
    // Service and instance members require qualified names; the index handles those.
    case "define-service":
    case "instance": return undefined;
    default: return head && CORE_FORMS.has(head) ? args.map(expression) : undefined;
  }
}

/** The executable unquotes in a template; nested quasiquotes retain their data. */
export function templateExpressions(expr: SExpr, depth = 1): readonly SExpr[] {
  const head = expr._tag === "List" ? bindingName(expr.items[0]) : undefined;
  if (head === "unquote" || head === "unquote-splicing") {
    if (depth === 1) return expr._tag === "List" && expr.items[1] ? [expr.items[1]] : [];
    depth--;
  } else if (head === "quasiquote") depth++;
  return children(expr).flatMap((child) => templateExpressions(child, depth));
}

/** Author positions that evaluate as expressions, shared by extract and scope resolution. */
export function expressionPositions(exprs: readonly SExpr[]): ReadonlySet<SExpr> {
  const positions = new Set<SExpr>();
  const steps = (description: readonly BindingStep[]): void => {
    for (const step of description) {
      if (step.role === "scope") steps(step.steps);
      else if (step.role === "expression") visit(step.expr);
      else if (step.role === "template") templateExpressions(step.expr).forEach(visit);
    }
  };
  const visit = (expr: SExpr): void => {
    positions.add(expr);
    if (expr._tag === "List" && bindingName(expr.items[0]) === "define-macro") return;
    const description = describeBindingForm(expr);
    if (description) steps(description);
    else children(expr).forEach(visit);
  };
  exprs.forEach(visit);
  return positions;
}
