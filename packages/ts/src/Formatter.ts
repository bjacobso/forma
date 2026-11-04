import { isFloatLiteral } from "./reader/types.js";
import { printFloat } from "./evaluator/types.js";
/**
 * Lisp Formatter / Pretty Printer
 *
 * Provides canonical pretty-printing for parsed S-expressions and raw
 * source strings.
 */

import type { FormDescriptor } from "./descriptor/FormDescriptor.js";
import { tokenizeWithTrivia } from "./reader/lexer.js";
import { Effect } from "effect";
import { parseManyToSExpr } from "./reader/index.js";
import type { ParseError, SExpr } from "./reader/index.js";

export interface LispFormatOptions {
  /** Loaded form patterns supply declaration layout without a head registry. */
  readonly descriptors?: readonly FormDescriptor[];
  /** Soft wrap column for inline rendering. Default: 80 */
  readonly softWrap?: number;
  /** Indentation width. Default: 2 */
  readonly indentSize?: number;
}

const DEFAULT_SOFT_WRAP = 80;
const DEFAULT_INDENT_SIZE = 2;

function escapeString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}


function numberSource(expr: SExpr & { _tag: "Num" }): string {
  if (!isFloatLiteral(expr)) return String(expr.value);
  // The reader accepts overflowing exponents as IEEE infinities. Keep them
  // readable as numbers instead of formatting an unbound `Infinity` symbol.
  if (expr.value === Infinity) return "1e400";
  if (expr.value === -Infinity) return "-1e400";
  return printFloat(expr.value);
}

/** The reader expands these prefixes to ordinary unary lists. */
function readerPrefix(expr: SExpr): string | undefined {
  if (expr._tag !== "List" || expr.items.length !== 2 || expr.items[0]?._tag !== "Sym") return undefined;
  switch (expr.items[0].name) {
    case "quote": return "'";
    case "quasiquote": return "`";
    case "unquote": return "~";
    case "unquote-splicing": return "~@";
    default: return undefined;
  }
}

function flat(expr: SExpr): string {
  switch (expr._tag) {
    case "Num":
      return numberSource(expr);
    case "Str":
      return `"${escapeString(expr.value)}"`;
    case "Bool":
      return expr.value ? "true" : "false";
    case "Sym":
      return expr.name;
    case "Error":
      return `<error: ${expr.message}>`;
    case "List": {
      const prefix = readerPrefix(expr);
      if (prefix) return prefix + flat(expr.items[1]!);
      const items = expr.items.map(flat).join(" ");
      return `(${items})`;
    }
    case "Vector": {
      const items = expr.items.map(flat).join(" ");
      return `[${items}]`;
    }
    case "Map": {
      const pairs = expr.pairs.map(([k, v]) => `${flat(k)} ${flat(v)}`).join(" ");
      return `{${pairs}}`;
    }
    case "Set": {
      const items = expr.items.map(flat).join(" ");
      return `{${items}}`;
    }
  }
}

/** Render alternating names/patterns and values without separating short pairs. */
function pairLines(
  items: readonly SExpr[],
  indent: number,
  softWrap: number,
  indentSize: number,
  patterns: ReadonlyMap<string, readonly SExpr[]>,
): string[] {
  const result: string[] = [];
  const width = Math.max(0, ...items.filter((_, i) => i % 2 === 0).map(item => flat(item).length));
  for (let i = 0; i < items.length; i += 2) {
    const key = items[i]!, value = items[i + 1];
    if (!value) {
      result.push(...lines(key, indent, softWrap, indentSize, patterns));
      continue;
    }
    const inline = `${" ".repeat(indent)}${flat(key).padEnd(width)} ${flat(value)}`;
    if (inline.length <= softWrap) result.push(inline);
    else {
      result.push(...lines(key, indent, softWrap, indentSize, patterns));
      result.push(...lines(value, indent + indentSize, softWrap, indentSize, patterns));
    }
  }
  return result;
}

function lines(
  expr: SExpr,
  indent: number,
  softWrap: number,
  indentSize: number,
  patterns: ReadonlyMap<string, readonly SExpr[]>,
): readonly string[] {
  const pad = " ".repeat(indent);

  switch (expr._tag) {
    case "Num":
      return [`${pad}${numberSource(expr)}`];
    case "Str":
      return [`${pad}"${escapeString(expr.value)}"`];
    case "Bool":
      return [`${pad}${expr.value ? "true" : "false"}`];
    case "Sym":
      return [`${pad}${expr.name}`];
    case "Error":
      return [`${pad}<error: ${expr.message}>`];

    case "List": {
      if (expr.items.length === 0) return [`${pad}()`];

      const oneLine = flat(expr);
      if (indent + oneLine.length <= softWrap) {
        return [`${pad}${oneLine}`];
      }

      const prefix = readerPrefix(expr);
      if (prefix) {
        const body = [...lines(expr.items[1]!, indent + prefix.length, softWrap, indentSize, patterns)];
        body[0] = pad + prefix + body[0]!.slice(indent + prefix.length);
        return body;
      }

      const head = expr.items[0]!;
      // A domain may itself define a `form` component. A list pattern still
      // identifies a core descriptor declaration rather than that application.
      const declaration = head._tag === "Sym" && head.name === "form" && expr.items[1]?._tag === "List";
      const pattern = head._tag === "Sym" && !declaration ? patterns.get(head.name) : undefined;
      if (pattern) {
        let positional = 0;
        for (let i = 0; i < pattern.length; i++) {
          if (pattern[i]?._tag === "Map" || pattern[i + 1]?._tag === "Sym" && (pattern[i + 1] as Extract<SExpr, {_tag: "Sym"}>).name === "...") break;
          positional++;
        }
        let header = `${pad}(${flat(head)}`, cursor = 1;
        while (cursor <= positional && expr.items[cursor] && header.length + 1 + flat(expr.items[cursor]!).length <= softWrap) header += ` ${flat(expr.items[cursor++]!)}`;
        const result = [header];
        const childIndent = indent + indentSize;
        while (cursor < expr.items.length) {
          const item = expr.items[cursor++]!;
          if (item._tag === "Sym" && item.name.startsWith(":") && expr.items[cursor]) {
            const value = expr.items[cursor++]!, inline = `${" ".repeat(childIndent)}${flat(item)} ${flat(value)}`;
            if (inline.length <= softWrap) result.push(inline);
            else { result.push(`${" ".repeat(childIndent)}${flat(item)}`); result.push(...lines(value, childIndent + indentSize, softWrap, indentSize, patterns)); }
          } else result.push(...lines(item, childIndent, softWrap, indentSize, patterns));
        }
        result[result.length - 1] += ")";
        return result;
      }
      const name = head._tag === "Sym" ? head.name : "";
      const childIndent = indent + indentSize;
      let header = `${pad}(${flat(head)}`, cursor = 1;
      // These are core syntax layouts. Domain declarations use descriptors above.
      const headerItems = name === "define" ? (expr.items[2]?._tag === "Vector" ? 2 : 1)
        : ["macro", "fn", "type", "form", "if", "when", "unless", "match", "case"].includes(name) ? 1 : 0;
      while (cursor <= headerItems && expr.items[cursor]) {
        const item = flat(expr.items[cursor]!);
        if (header.length + 1 + item.length > softWrap) break;
        header += ` ${item}`;
        cursor++;
      }
      const result: string[] = [header];
      if (["let", "loop", "do!"].includes(name) && expr.items[1]?._tag === "Vector") {
        const bindings = expr.items[1];
        const inline = flat(bindings);
        if (header.length + 1 + inline.length <= softWrap) result[0] += ` ${inline}`;
        else {
          // Start the vector beside the head and align subsequent binding names.
          const bindingIndent = header.length + 2;
          const pairs = pairLines(bindings.items, bindingIndent, softWrap, indentSize, patterns);
          if (pairs.length) {
            result[0] += ` [${pairs[0]!.slice(bindingIndent)}`;
            result.push(...pairs.slice(1));
            result[result.length - 1] += "]";
          } else result[0] += " []";
        }
        cursor = 2;
      }
      if (name === "cond" || (["match", "case"].includes(name) && cursor === 2)) {
        result.push(...pairLines(expr.items.slice(cursor), childIndent, softWrap, indentSize, patterns));
      } else {
        for (; cursor < expr.items.length; cursor++) {
          const item = expr.items[cursor]!;
          if (name === "form" && item._tag === "Sym" && item.name.startsWith(":") && expr.items[cursor + 1]) {
            result.push(...pairLines(expr.items.slice(cursor, cursor + 2), childIndent, softWrap, indentSize, patterns));
            cursor++;
          } else result.push(...lines(item, childIndent, softWrap, indentSize, patterns));
        }
      }
      result[result.length - 1] += ")";
      return result;
    }

    case "Vector": {
      if (expr.items.length === 0) return [`${pad}[]`];

      const oneLine = flat(expr);
      if (indent + oneLine.length <= softWrap) {
        return [`${pad}${oneLine}`];
      }

      const result: string[] = [`${pad}[`];
      for (const item of expr.items) {
        result.push(...lines(item, indent + indentSize, softWrap, indentSize, patterns));
      }
      result[result.length - 1] += "]";
      return result;
    }

    case "Map": {
      if (expr.pairs.length === 0) return [`${pad}{}`];

      const oneLine = flat(expr);
      if (indent + oneLine.length <= softWrap) {
        return [`${pad}${oneLine}`];
      }

      const result: string[] = [`${pad}{`];
      for (const [k, v] of expr.pairs) {
        const keyFlat = flat(k);
        const valueFlat = flat(v);

        if (indent + indentSize + keyFlat.length + 1 + valueFlat.length <= softWrap) {
          result.push(`${" ".repeat(indent + indentSize)}${keyFlat} ${valueFlat}`);
        } else {
          result.push(`${" ".repeat(indent + indentSize)}${keyFlat}`);
          result.push(...lines(v, indent + indentSize * 2, softWrap, indentSize, patterns));
        }
      }

      result[result.length - 1] += "}";
      return result;
    }

    case "Set": {
      if (expr.items.length === 0) return [`${pad}{}`];

      const oneLine = flat(expr);
      if (indent + oneLine.length <= softWrap) {
        return [`${pad}${oneLine}`];
      }

      const result: string[] = [`${pad}{`];
      for (const item of expr.items) {
        result.push(...lines(item, indent + indentSize, softWrap, indentSize, patterns));
      }
      result[result.length - 1] += "}";
      return result;
    }
  }
}

function formPatterns(exprs: readonly SExpr[], options?: LispFormatOptions): ReadonlyMap<string, readonly SExpr[]> {
  const patterns = new Map((options?.descriptors ?? []).flatMap(d => d.surface ? [[d.name, d.surface.pattern] as const] : []));
  for (const e of exprs) if (e._tag === "List" && e.items[0]?._tag === "Sym" && e.items[0].name === "form" && e.items[1]?._tag === "List" && e.items[1].items[0]?._tag === "Sym") patterns.set(e.items[1].items[0].name, e.items[1].items.slice(1));
  return patterns;
}

/**
 * Pretty-print a single S-expression.
 */
export function formatSExpr(expr: SExpr, options?: LispFormatOptions): string {
  const softWrap = options?.softWrap ?? DEFAULT_SOFT_WRAP;
  const indentSize = options?.indentSize ?? DEFAULT_INDENT_SIZE;
  const canonical = expr;

  const oneLine = flat(canonical);
  if (oneLine.length <= softWrap) return oneLine;

  return lines(canonical, 0, softWrap, indentSize, formPatterns([expr], options)).join("\n");
}

/**
 * Pretty-print multiple top-level S-expressions.
 */
export function formatSExprMany(exprs: readonly SExpr[], options?: LispFormatOptions): string {
  const softWrap = options?.softWrap ?? DEFAULT_SOFT_WRAP;
  const indentSize = options?.indentSize ?? DEFAULT_INDENT_SIZE;

  const patterns = formPatterns(exprs, options);
  const rendered = exprs.map((expr) => {
    const canonical = expr;
    const oneLine = flat(canonical);
    if (oneLine.length <= softWrap) return oneLine;
    return lines(canonical, 0, softWrap, indentSize, patterns).join("\n");
  });

  return rendered.join("\n").trimEnd() + "\n";
}

/** Attach each comment to the next authored token, using matching AST spans.
 * Matching trees also handles reader shorthand expanded by pretty-printing. */
function restoreComments(source: string, original: readonly SExpr[], rendered: string, formatted: readonly SExpr[], indentSize: number): string {
  const comments = tokenizeWithTrivia(source).flatMap(token => token.leadingTrivia.filter(t => t.kind === "line-comment"));
  if (!comments.length) return rendered;
  const anchors: {source: number; target: number; indent: number}[] = [];
  const pair = (a: SExpr, b: SExpr, indent: number): void => {
    anchors.push({source:a.loc.start,target:b.loc.start,indent});
    const children = (e: SExpr): readonly SExpr[] => e._tag === "Map" ? e.pairs.flatMap(([k,v])=>[k,v]) : e._tag === "List" || e._tag === "Vector" || e._tag === "Set" ? e.items : [];
    const ac=children(a), bc=children(b);
    if (ac.length) anchors.push({source:a.loc.end-1,target:b.loc.end-1,indent});
    ac.forEach((child,i)=>{if(bc[i]) pair(child,bc[i]!,indent+indentSize);});
  };
  original.forEach((expr,i)=>{if(formatted[i]) pair(expr,formatted[i]!,0);});
  anchors.sort((a,b)=>a.source-b.source);
  const insertions = new Map<number,{indent:number;comments:string[]}>();
  for (const comment of comments) {
    const anchor=anchors.find(a=>a.source>=comment.loc.end) ?? {target:rendered.length,indent:0};
    const entry=insertions.get(anchor.target) ?? {indent:anchor.indent,comments:[]};
    entry.comments.push(comment.text); insertions.set(anchor.target,entry);
  }
  let result=rendered;
  for (const [offset,entry] of [...insertions].sort(([a],[b])=>b-a)) {
    const prefix=result.slice(0,offset), pad=" ".repeat(entry.indent);
    result=prefix+(prefix.trimEnd().length ? "\n" : "")+entry.comments.map(c=>pad+c).join("\n")+"\n"+pad+result.slice(offset);
  }
  return result.replace(/[ \t]+\n/g,"\n").trimEnd()+"\n";
}

/**
 * Parse and pretty-print raw Lisp source.
 */
export function formatLispSource(
  source: string,
  options?: LispFormatOptions,
): Effect.Effect<string, ParseError> {
  return Effect.gen(function* () {
    const exprs = yield* parseManyToSExpr(source);
    const rendered = formatSExprMany(exprs, options);
    if (!tokenizeWithTrivia(source).some(t=>t.leadingTrivia.some(trivia=>trivia.kind === "line-comment"))) return rendered;
    const formatted = yield* parseManyToSExpr(rendered);
    return restoreComments(source,exprs,rendered,formatted,options?.indentSize ?? DEFAULT_INDENT_SIZE);
  });
}
