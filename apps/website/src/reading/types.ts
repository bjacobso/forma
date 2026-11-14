/**
 * Types as the reader shows them. The checker prints two notations: HM
 * (`String -> Effect<Int, ErrorSet<E>, RequirementSet<>>`) and the Effect
 * checker's Forma syntax (`(-> String (Effect Int [E] []))`). Both parse to
 * one tree, which prints in the syntax authors write in `(: name type)`.
 */

export type Ty =
  | { readonly k: "fn"; readonly params: readonly Ty[]; readonly result: Ty; readonly effect?: string | undefined }
  | { readonly k: "effect"; readonly success: Ty; readonly errors: readonly Ty[]; readonly reqs: readonly Ty[] }
  | { readonly k: "app"; readonly head: string; readonly args: readonly Ty[] }
  | { readonly k: "record"; readonly fields: readonly (readonly [string, Ty])[]; readonly rest?: string | undefined }
  | { readonly k: "var"; readonly name: string }
  | { readonly k: "rest"; readonly item: Ty }
  | { readonly k: "lit"; readonly text: string };

export interface Token {
  readonly text: string;
  readonly cls?: "type" | "var" | "kw" | "lit" | "punct" | "error" | "req" | undefined;
}

const TOKEN = /\s*(-\{[^}]*\}->|->|\.\.\.|[()[\]{}<>,&|]|"(?:[^"\\]|\\.)*"|[^\s()[\]{}<>,&|]+)/y;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while (TOKEN.lastIndex < text.length && (match = TOKEN.exec(text))) tokens.push(match[1]!);
  return tokens;
}

const isVar = (name: string) => /^[treab]\d+$/.test(name);

class Parser {
  i = 0;
  readonly tokens: readonly string[];
  constructor(tokens: readonly string[]) { this.tokens = tokens; }
  peek() { return this.tokens[this.i]; }
  next() { return this.tokens[this.i++]; }
  eat(token: string) { if (this.peek() === token) { this.i++; return true; } return false; }

  /** HM arrow chains; S-expression types never contain a bare arrow at this level. */
  type(): Ty {
    const first = this.operand();
    const arrow = this.peek();
    if (arrow !== "->" && !arrow?.startsWith("-{")) return first;
    this.next();
    const rest = this.type();
    const effect = arrow.startsWith("-{") ? arrow.slice(2, -3) : undefined;
    // Curried arrows read as one function; a latent effect on any arrow belongs to the whole call.
    if (rest.k === "fn") return { k: "fn", params: [first, ...rest.params], result: rest.result, ...(effect ?? rest.effect ? { effect: effect ?? rest.effect } : {}) };
    return { k: "fn", params: [first], result: rest, ...(effect ? { effect } : {}) };
  }

  operand(): Ty {
    const token = this.next();
    if (token === undefined) return { k: "lit", text: "?" };
    if (token === "...") return { k: "rest", item: this.operand() };
    if (token === "(") return this.list();
    if (token === "{") return this.record();
    if (token === "[") return { k: "app", head: "List", args: this.until("]") };
    if (this.peek() === "<") {
      this.next();
      const args: Ty[] = [];
      while (this.peek() !== undefined && !this.eat(">")) { args.push(this.type()); this.eat(","); }
      return applied(token, args);
    }
    if (isVar(token)) return { k: "var", name: token };
    if (/^[A-Z]/.test(token)) return { k: "app", head: token, args: [] };
    return { k: "lit", text: token };
  }

  until(close: string): Ty[] {
    const items: Ty[] = [];
    while (this.peek() !== undefined && !this.eat(close)) { items.push(this.type()); this.eat(","); }
    return items;
  }

  list(): Ty {
    const head = this.peek();
    if (head === "->") {
      this.next();
      const items = this.until(")");
      return { k: "fn", params: items.slice(0, -1), result: items.at(-1) ?? { k: "lit", text: "?" } };
    }
    // `(t -> u)` is grouping; `(Option Order)` is an application.
    const inner = this.type();
    if (this.eat(")")) return inner;
    const args = this.until(")");
    return inner.k === "app" && inner.args.length === 0 ? applied(inner.head, args) : inner;
  }

  record(): Ty {
    const fields: [string, Ty][] = [];
    let rest: string | undefined;
    while (this.peek() !== undefined && !this.eat("}")) {
      if (this.eat("&")) { rest = this.next(); continue; }
      const key = this.next()!;
      fields.push([key, this.type()]);
    }
    return { k: "record", fields, ...(rest ? { rest } : {}) };
  }
}

function applied(head: string, args: Ty[]): Ty {
  const items = (set: Ty | undefined): Ty[] => !set ? [] : set.k === "app" && (set.head === "List" || set.head.endsWith("Set")) ? [...set.args] : [set];
  if (head === "Effect") return { k: "effect", success: args[0] ?? { k: "app", head: "Unit", args: [] }, errors: items(args[1]), reqs: items(args[2]) };
  return { k: "app", head, args };
}

export function parseType(display: string): Ty {
  return new Parser(tokenize(display)).type();
}

/** Rename checker variables (`t4`, `r0`, `e6`) to `a`, `b`, … in order of appearance. */
export function friendlyVars(ty: Ty): Ty {
  const names = new Map<string, string>();
  const rename = (name: string) => {
    if (!names.has(name)) {
      const prefix = name[0] === "r" ? "r" : name[0] === "e" ? "ε" : "";
      const index = [...names.keys()].filter(n => (n[0] === "r" ? "r" : n[0] === "e" ? "ε" : "") === prefix).length;
      names.set(name, prefix ? `${prefix}${index || ""}` : String.fromCharCode(97 + (index % 26)));
    }
    return names.get(name)!;
  };
  const walk = (t: Ty): Ty => {
    switch (t.k) {
      case "var": return { k: "var", name: rename(t.name) };
      case "fn": return { k: "fn", params: t.params.map(walk), result: walk(t.result), ...(t.effect ? { effect: rename(t.effect) } : {}) };
      case "effect": return { k: "effect", success: walk(t.success), errors: t.errors.map(walk), reqs: t.reqs.map(walk) };
      case "app": return { k: "app", head: t.head, args: t.args.map(walk) };
      case "record": return { k: "record", fields: t.fields.map(([key, value]) => [key, walk(value)] as const), ...(t.rest ? { rest: rename(t.rest) } : {}) };
      case "rest": return { k: "rest", item: walk(t.item) };
      case "lit": return t;
    }
  };
  return walk(ty);
}

/** The type as tokens of Forma signature syntax, broken over lines when long. */
export function printType(ty: Ty, width = 52): Token[] {
  const flat = tokensOf(ty, null);
  return textOf(flat).length <= width ? flat : tokensOf(ty, "");
}

export function textOf(tokens: readonly Token[]): string {
  return tokens.map(token => token.text).join("");
}

function tokensOf(ty: Ty, indent: string | null): Token[] {
  const p = (text: string): Token => ({ text, cls: "punct" });
  const sep = (inner: string | null): Token => ({ text: inner === null ? " " : `\n${inner}` });
  const flat = (t: Ty) => tokensOf(t, null);
  switch (ty.k) {
    case "var": return [{ text: ty.name, cls: "var" }];
    case "lit": return [{ text: ty.text, cls: "lit" }];
    case "rest": return [p("..."), ...flat(ty.item)];
    case "app":
      if (ty.args.length === 0) return [{ text: ty.head, cls: "type" }];
      return [p("("), { text: ty.head, cls: "type" }, ...ty.args.flatMap(arg => [sep(null), ...flat(arg)]), p(")")];
    case "record": {
      const parts: Token[] = [p("{")];
      ty.fields.forEach(([key, value], index) => {
        if (index) parts.push({ text: " " });
        parts.push({ text: key, cls: "kw" }, { text: " " }, ...flat(value));
      });
      if (ty.rest) parts.push({ text: ty.fields.length ? " " : "" }, p("& "), { text: ty.rest, cls: "var" });
      parts.push(p("}"));
      return parts;
    }
    case "effect": {
      const inner = indent === null ? null : `${indent}  `;
      return [p("("), { text: "Effect", cls: "type" }, { text: " " }, ...flat(ty.success),
        sep(inner), p("["), ...ty.errors.flatMap((e, i) => [...(i ? [{ text: " " }] : []), ...flat(e).map(t => ({ ...t, cls: t.cls === "type" ? "error" as const : t.cls }))]), p("]"),
        sep(inner), p("["), ...ty.reqs.flatMap((r, i) => [...(i ? [{ text: " " }] : []), ...flat(r).map(t => ({ ...t, cls: t.cls === "type" ? "req" as const : t.cls }))]), p("]"), p(")")];
    }
    case "fn": {
      const inner = indent === null ? null : `${indent}    `;
      const arrow = "->";
      const params = ty.params.flatMap((param, index) => [...(index ? [sep(inner)] : [{ text: " " }]), ...flat(param)]);
      return [p("("), { text: arrow, cls: "punct" }, ...params, sep(inner), ...tokensOf(ty.result, inner), p(")")];
    }
  }
}

/** Every named type mentioned, for linking to declarations. */
export function namesIn(ty: Ty, into = new Set<string>()): Set<string> {
  switch (ty.k) {
    case "app": into.add(ty.head); ty.args.forEach(a => namesIn(a, into)); break;
    case "fn": ty.params.forEach(a => namesIn(a, into)); namesIn(ty.result, into); break;
    case "effect": namesIn(ty.success, into); ty.errors.forEach(a => namesIn(a, into)); ty.reqs.forEach(a => namesIn(a, into)); break;
    case "record": ty.fields.forEach(([, v]) => namesIn(v, into)); break;
    case "rest": namesIn(ty.item, into); break;
  }
  return into;
}

/** The final Effect a type produces: the type itself, or a function's result. */
export function effectOf(ty: Ty): Extract<Ty, { k: "effect" }> | undefined {
  if (ty.k === "effect") return ty;
  if (ty.k === "fn") return effectOf(ty.result);
  return undefined;
}

/** Plain-language checker node names. */
export function describeTag(tag: string): string {
  const name = tag.replace(/^Mechanics\./, "");
  const known: Record<string, string> = {
    Def: "definition", Lam: "function", App: "call", Var: "name", Lit: "literal", Let: "let binding",
    If: "conditional", Get: "field access", Record: "record", Declaration: "Effect declaration",
    Do: "do! sequence", ServiceCall: "service call", Match: "match", Fail: "fail", Succeed: "succeed",
    Pure: "pure value", Combinator: "Effect combinator", List: "call", Literal: "literal", Expr: "key",
    DSLForm: "prelude form", TypeDef: "type declaration", EffectFail: "fail",
  };
  return known[name] ?? name;
}

export const checkerOf = (tag: string) => (tag.startsWith("Mechanics.") ? "Effect checker" : "HM inference");
