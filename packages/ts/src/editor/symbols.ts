/**
 * Symbol index: definitions and references for editor services.
 *
 * Programs are expanded with the evaluator's own expander and resolved in
 * their expanded form, then mapped back to author-written nodes through
 * expansion origins. Forms registered with descriptors define the names in
 * their declaration identifiers. See docs/language-services.md.
 */

import { defaultBuiltins } from "../builtins/index.js";
import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import { sourceOriginsOf } from "../evaluator/source-trace.js";
import { expandProgramSync, getPreludeEnvSync } from "../expander/expand.js";
import type { Env } from "../Env.js";
import { parse, toSExprMany, type SExpr } from "../reader/index.js";
import { children } from "../reader/types.js";
import {
  identifySyntax,
  indexSyntax,
  matchesSyntaxKind,
  type SyntaxIdentity,
  type SyntaxIndex,
  type SyntaxNode,
  type SyntaxSpan,
} from "../syntax/identity.js";
import { editorDescriptors, type DescriptorLookup, type DescriptorSource } from "./descriptors.js";

export interface SymbolDocument {
  readonly sourceId: string;
  readonly source: string;
  /** Ids for this source. A fresh identity is used when omitted. */
  readonly identity?: SyntaxIdentity | undefined;
}

export interface SymbolIndexOptions {
  /** Descriptors in addition to the `__form-descriptor`s found in the documents. */
  readonly descriptors?: DescriptorSource | undefined;
}

export type DefinitionKind =
  | "value"
  | "function"
  | "macro"
  | "type"
  | "constructor"
  | "method"
  | "declaration"
  | "parameter"
  | "local";

export interface SymbolDefinition {
  /** Unique key: `sourceId#nodeId`. */
  readonly key: string;
  readonly name: string;
  readonly kind: DefinitionKind;
  readonly scope: "global" | "local";
  readonly sourceId: string;
  readonly nodeId: string;
  readonly span: SyntaxSpan;
  /** Head of the author-written form that introduced the name, such as `define`, `let`, a macro, or a descriptor form. */
  readonly form: string;
  readonly formNodeId?: string | undefined;
  /** For locals, the node whose extent bounds where the name is visible. */
  readonly scopeNodeId?: string | undefined;
}

export type ReferenceResolution = "definition" | "builtin" | "form" | "unresolved";

export interface SymbolReference {
  readonly name: string;
  readonly sourceId: string;
  readonly nodeId: string;
  readonly span: SyntaxSpan;
  readonly resolution: ReferenceResolution;
  /** Key of the definition the reference resolves to. */
  readonly definition?: string | undefined;
}

export interface SymbolIndex {
  readonly definitions: readonly SymbolDefinition[];
  readonly references: readonly SymbolReference[];
  /** The identity used for each document. */
  readonly identities: Readonly<Record<string, SyntaxIdentity>>;
}

export interface SymbolTarget {
  readonly sourceId: string;
  readonly offset?: number | undefined;
  readonly nodeId?: string | undefined;
}

export interface SymbolOccurrences {
  readonly definition?: SymbolDefinition | undefined;
  readonly references: readonly SymbolReference[];
}

/** Heads that define their second element when nothing more specific applies. */
const FALLBACK_DEFINING_HEADS = new Set([
  "def",
  "defn",
  "defmacro",
  "__form-descriptor",
  "__form-hook",
  "__projection-plan",
  "__projection-primitive",
  "__protocol-descriptor",
  "__payload-contract",
  "defclass",
]);

const SPECIAL_FORMS = new Set([
  "fn",
  "let",
  "if",
  "do",
  "match",
  "define",
  "quote",
  "quasiquote",
  "unquote",
  "unquote-splicing",
  "__macro",
  "__sum-type",
  "__typeclass",
  "instance",
  "__operation",
  "__error",
  "__schema",
  "__service",
  "do!",
  "<-",
  "fail",
  "catch",
  "succeed",
  ":",
  "nil",
]);

interface AuthorNode {
  readonly document: IndexedDocument;
  readonly node: SyntaxNode;
  readonly expr: SExpr;
}

interface IndexedDocument {
  readonly sourceId: string;
  readonly order: number;
  readonly identity: SyntaxIdentity;
  readonly index: SyntaxIndex;
  readonly exprs: readonly SExpr[];
}

class Scope {
  readonly #bindings = new Map<string, SymbolDefinition | null>();
  constructor(readonly parent: Scope | null) {}
  bind(name: string, definition: SymbolDefinition | null): void {
    this.#bindings.set(name, definition);
  }
  lookup(name: string): SymbolDefinition | null | undefined {
    if (this.#bindings.has(name)) return this.#bindings.get(name);
    return this.parent?.lookup(name);
  }
}

const symName = (expr: SExpr | undefined): string | undefined =>
  expr?._tag === "Sym" ? expr.name : undefined;
const headName = (expr: SExpr): string | undefined =>
  expr._tag === "List" ? symName(expr.items[0]) : undefined;
const isKeywordHeaded = (expr: SExpr): boolean => headName(expr)?.startsWith(":") === true;

/** Build the symbol index for one or more documents, in load order. */
export function indexSymbols(
  documents: readonly SymbolDocument[],
  options: SymbolIndexOptions = {},
): SymbolIndex {
  const descriptors = editorDescriptors(
    [...new Map(documents.map((document) => [document.sourceId, document.source])).values()],
    options.descriptors,
  );
  const authors = new Map<SExpr, AuthorNode>();
  // Nodes inside macro definitions. Their templates are copied into every
  // expansion, so they count only while the definition itself is walked.
  const macroNodes = new Set<SExpr>();
  // A later document with the same source id replaces an earlier one.
  const unique = [...new Map(documents.map((document) => [document.sourceId, document])).values()];
  const indexed: IndexedDocument[] = unique.map((document, order) => {
    const identity = document.identity ?? identifySyntax(document.source);
    const index = indexSyntax(identity);
    const exprs = toSExprMany(parse(document.source).redTree);
    const result: IndexedDocument = {
      sourceId: document.sourceId,
      order,
      identity,
      index,
      exprs,
    };
    const visit = (expr: SExpr, inMacro: boolean): void => {
      const node = index.withSpan(expr.loc.start, expr.loc.end);
      if (node && matchesSyntaxKind(expr, node.kind) && !authors.has(expr)) {
        authors.set(expr, { document: result, node, expr });
        if (inMacro) macroNodes.add(expr);
      }
      // A macro's name and parameters are ordinary; its body is template.
      const macroHead = headName(expr);
      const definesMacro = macroHead === "__macro" || macroHead === "macro";
      children(expr).forEach((child, position) => visit(child, inMacro || (definesMacro && position >= (macroHead === "macro" ? 2 : 3))));
    };
    exprs.forEach((expr) => visit(expr, false));
    return result;
  });

  const expanded = expandDocuments(indexed);
  const builtinNames = kernelNames();
  const orders = new Map(indexed.map((document) => [document.sourceId, document.order]));
  const walker = new SymbolWalker(authors, macroNodes, descriptors, builtinNames, orders);
  for (const { document, expr } of expanded.forms) walker.collectGlobals(expr, document);
  for (const { document, expr } of expanded.forms) walker.walk(expr, walker.root, document, null);

  const sorted = <T extends { sourceId: string; span: SyntaxSpan }>(items: Iterable<T>) =>
    [...items].sort(
      (left, right) =>
        orders.get(left.sourceId)! - orders.get(right.sourceId)! ||
        left.span.start - right.span.start,
    );
  return {
    definitions: sorted(walker.definitions.values()),
    references: sorted(walker.references.values()),
    identities: Object.fromEntries(indexed.map((document) => [document.sourceId, document.identity])),
  };
}

/** The definition and every reference of the symbol at a position. */
export function findReferences(index: SymbolIndex, target: SymbolTarget): SymbolOccurrences {
  const hits = (item: { sourceId: string; nodeId: string; span: SyntaxSpan }) =>
    item.sourceId === target.sourceId &&
    (target.nodeId !== undefined
      ? item.nodeId === target.nodeId
      : target.offset !== undefined &&
        item.span.start <= target.offset &&
        target.offset <= item.span.end);
  const definition =
    index.definitions.find(hits) ??
    index.definitions.find(
      (candidate) => candidate.key === index.references.find(hits)?.definition,
    );
  if (!definition) {
    const reference = index.references.find(hits);
    if (!reference) return { references: [] };
    // An unresolved or builtin name: its occurrences are the same name, unresolved.
    return {
      references: index.references.filter(
        (candidate) =>
          candidate.name === reference.name && candidate.resolution === reference.resolution,
      ),
    };
  }
  return {
    definition,
    references: index.references.filter((reference) => reference.definition === definition.key),
  };
}

let kernelNameSet: ReadonlySet<string> | undefined;

/** Names the kernel provides: builtins, special forms, and prelude macros. */
export function kernelNames(): ReadonlySet<string> {
  kernelNameSet ??= new Set([
    ...Object.keys(defaultBuiltins),
    ...SPECIAL_FORMS,
    ...getPreludeEnvSync(defaultBuiltins).bindingNames(),
  ]);
  return kernelNameSet;
}

// =============================================================================
// Expansion
// =============================================================================

interface ExpandedForm {
  readonly document: IndexedDocument;
  readonly expr: SExpr;
}

function expandDocuments(documents: readonly IndexedDocument[]): {
  readonly forms: readonly ExpandedForm[];
} {
  const builtins = defaultBuiltins;
  const prelude = getPreludeEnvSync(builtins);
  let env: Env = prelude;
  const forms: ExpandedForm[] = [];
  for (const document of documents) {
    for (const expr of document.exprs) {
      try {
        const result = expandProgramSync([expr], {
          builtins,
          env,
          includePrelude: false,
          keepMacroDefs: true,
        });
        env = result.env;
        for (const expanded of result.exprs) forms.push({ document, expr: expanded });
      } catch {
        // A form whose expansion fails is indexed as written.
        forms.push({ document, expr });
      }
    }
  }
  return { forms };
}

// =============================================================================
// Resolution
// =============================================================================

class SymbolWalker {
  readonly root = new Scope(null);
  readonly definitions = new Map<string, SymbolDefinition>();
  readonly references = new Map<string, SymbolReference>();
  readonly #globals = new Map<string, SymbolDefinition[]>();

  constructor(
    private readonly authors: ReadonlyMap<SExpr, AuthorNode>,
    private readonly macroNodes: ReadonlySet<SExpr>,
    private readonly descriptors: DescriptorLookup,
    private readonly builtins: ReadonlySet<string>,
    private readonly orders: ReadonlyMap<string, number>,
  ) {}

  /** True while a `__macro` form itself is walked. */
  #inMacroDefinition = false;

  author(expr: SExpr): AuthorNode | undefined {
    for (const origin of sourceOriginsOf(expr)) {
      const author = this.authors.get(origin);
      if (!author || !matchesSyntaxKind(expr, author.node.kind)) continue;
      if (this.macroNodes.has(origin) && !this.#inMacroDefinition) continue;
      return author;
    }
    return undefined;
  }

  // --- definitions ----------------------------------------------------------

  define(
    expr: SExpr | undefined,
    kind: DefinitionKind,
    form: AuthorNode | undefined,
    formName: string,
    scope: { readonly scope: Scope; readonly node: AuthorNode | undefined } | undefined,
  ): SymbolDefinition | null {
    if (!expr || expr._tag !== "Sym") return null;
    const author = this.author(expr);
    if (!author) {
      scope?.scope.bind(expr.name, null);
      return null;
    }
    const key = `${author.document.sourceId}#${author.node.id}`;
    const existing = this.definitions.get(key);
    if (existing) {
      scope?.scope.bind(expr.name, existing);
      return existing;
    }
    const definition: SymbolDefinition = {
      key,
      name: expr.name,
      kind,
      scope: scope ? "local" : "global",
      sourceId: author.document.sourceId,
      nodeId: author.node.id,
      span: author.node.span,
      form: formName,
      ...(form ? { formNodeId: form.node.id } : {}),
      ...(scope?.node ? { scopeNodeId: scope.node.node.id } : {}),
    };
    this.definitions.set(key, definition);
    this.references.delete(key);
    if (scope) scope.scope.bind(expr.name, definition);
    else {
      const list = this.#globals.get(expr.name) ?? [];
      list.push(definition);
      this.#globals.set(expr.name, list);
    }
    return definition;
  }

  /** The author-written form and its head, for a form in expanded code. */
  formOf(expr: SExpr, fallback: string): { node: AuthorNode | undefined; name: string } {
    const node = this.author(expr);
    const name = node && node.expr._tag === "List" ? symName(node.expr.items[0]) : undefined;
    return { node, name: name ?? fallback };
  }

  collectGlobals(expr: SExpr, document: IndexedDocument): void {
    if (expr._tag !== "List") return;
    const head = headName(expr);
    if (!head) return;
    const items = expr.items;
    const { node, name } = this.formOf(expr, head);
    const defineHead = (target: SExpr | undefined, kind: DefinitionKind) =>
      this.define(
        target?._tag === "List" ? target.items[0] : target,
        target?._tag === "List" ? "function" : kind,
        node,
        name,
        undefined,
      );
    switch (head) {
      case "do":
        for (const item of items.slice(1)) this.collectGlobals(item, document);
        return;
      case "define":
        defineHead(items[1], isFnForm(items[2]) ? "function" : "value");
        // `define` in a body still defines a global.
        for (const item of items.slice(2)) this.collectNestedGlobals(item, document);
        return;
      case "form":
        this.define(items[1]?._tag === "List" ? items[1].items[0] : undefined, "declaration", node, name, undefined);
        return;
      case "__macro":
        this.define(items[1], "macro", node, name, undefined);
        return;
      case "__operation":
        this.define(items[1], "function", node, name, undefined);
        return;
      case "__sum-type":
        this.define(
          items[1]?._tag === "List" ? items[1].items[0] : items[1],
          "type",
          node,
          name,
          undefined,
        );
        for (const constructor of items.slice(2)) {
          this.define(
            constructor._tag === "List" ? constructor.items[0] : constructor,
            "constructor",
            node,
            name,
            undefined,
          );
        }
        return;
      case "__typeclass":
        this.define(
          items[1]?._tag === "List" ? items[1].items[0] : items[1],
          "type",
          node,
          name,
          undefined,
        );
        for (const method of items.slice(2)) {
          if (method._tag === "List") this.define(method.items[0], "method", node, name, undefined);
        }
        return;
      case "__error":
      case "__schema":
        this.define(items[1], "type", node, name, undefined);
        return;
      case "__service": {
        const service = symName(items[1]);
        this.define(items[1], "type", node, name, undefined);
        for (const slot of items.slice(2)) {
          if (headName(slot) !== ":methods" || slot._tag !== "List") continue;
          for (const method of slot.items.slice(1)) {
            const methodName = method._tag === "List" ? method.items[0] : undefined;
            if (service && methodName?._tag === "Sym") {
              this.defineQualified(methodName, `${service}.${methodName.name}`, node, name);
            }
          }
        }
        return;
      }
      case "instance":
        return;
    }
    const descriptor = this.descriptors.get(head);
    if (descriptor) {
      for (const [spec, arg] of identifierArguments(descriptor, items.slice(1))) {
        if (spec.declaration) this.define(arg, "declaration", node, name, undefined);
      }
      return;
    }
    if (FALLBACK_DEFINING_HEADS.has(head)) {
      defineHead(items[1], "declaration");
      return;
    }
    for (const item of items.slice(1)) this.collectNestedGlobals(item, document);
  }

  collectNestedGlobals(expr: SExpr, document: IndexedDocument): void {
    if (expr._tag !== "List") return;
    const head = headName(expr);
    if (head === "quote" || head === "quasiquote" || head === "__macro") return;
    if (head === "define") {
      this.collectGlobals(expr, document);
      return;
    }
    for (const item of expr.items) this.collectNestedGlobals(item, document);
  }

  defineQualified(expr: SExpr, qualified: string, form: AuthorNode | undefined, formName: string) {
    const author = this.author(expr);
    if (!author) return;
    const key = `${author.document.sourceId}#${author.node.id}`;
    const definition: SymbolDefinition = {
      key,
      name: qualified,
      kind: "method",
      scope: "global",
      sourceId: author.document.sourceId,
      nodeId: author.node.id,
      span: author.node.span,
      form: formName,
      ...(form ? { formNodeId: form.node.id } : {}),
    };
    this.definitions.set(key, definition);
    const list = this.#globals.get(qualified) ?? [];
    list.push(definition);
    this.#globals.set(qualified, list);
  }

  // --- references -----------------------------------------------------------

  reference(expr: SExpr, scope: Scope, globalsOnly = false): void {
    if (expr._tag !== "Sym") return;
    const name = expr.name;
    if (name.startsWith(":") || name === "&" || name === "_" || name === "nil") return;
    const author = this.author(expr);
    if (!author) return;
    const key = `${author.document.sourceId}#${author.node.id}`;
    if (this.definitions.has(key) || this.references.has(key)) return;
    const local = globalsOnly ? undefined : scope.lookup(name);
    let resolution: ReferenceResolution;
    let definition: SymbolDefinition | undefined;
    if (local !== undefined) {
      if (local === null) return;
      resolution = "definition";
      definition = local;
    } else {
      definition = this.global(name, author);
      resolution = definition
        ? "definition"
        : this.builtins.has(name)
          ? "builtin"
          : this.descriptors.get(name)
            ? "form"
            : "unresolved";
      if (globalsOnly && !definition) return;
    }
    this.references.set(key, {
      name,
      sourceId: author.document.sourceId,
      nodeId: author.node.id,
      span: author.node.span,
      resolution,
      ...(definition ? { definition: definition.key } : {}),
    });
  }

  /** The latest global definition before the reference, else the first after it. */
  global(name: string, at: AuthorNode): SymbolDefinition | undefined {
    const candidates = this.#globals.get(name);
    if (!candidates || candidates.length === 0) return undefined;
    const before = (definition: SymbolDefinition) => {
      const order = this.orderOf(definition.sourceId);
      return (
        order < at.document.order ||
        (order === at.document.order && definition.span.start <= at.node.span.start)
      );
    };
    return candidates.filter(before).at(-1) ?? candidates[0];
  }

  orderOf(sourceId: string): number {
    return this.orders.get(sourceId) ?? Number.MAX_SAFE_INTEGER;
  }

  // --- walking --------------------------------------------------------------

  walk(expr: SExpr, scope: Scope, document: IndexedDocument, form: AuthorNode | null): void {
    switch (expr._tag) {
      case "Sym":
        this.reference(expr, scope);
        return;
      case "Vector":
      case "Set":
        for (const item of expr.items) this.walk(item, scope, document, form);
        return;
      case "Map":
        for (const [key, value] of expr.pairs) {
          this.walk(key, scope, document, form);
          this.walk(value, scope, document, form);
        }
        return;
      case "List":
        this.walkList(expr, scope, document, this.author(expr) ?? form);
        return;
      default:
        return;
    }
  }

  walkAll(items: readonly SExpr[], scope: Scope, document: IndexedDocument, form: AuthorNode | null) {
    for (const item of items) this.walk(item, scope, document, form);
  }

  walkList(
    expr: SExpr & { _tag: "List" },
    scope: Scope,
    document: IndexedDocument,
    form: AuthorNode | null,
  ): void {
    const items = expr.items;
    const head = headName(expr);
    const formName = (fallback: string) =>
      (form?.expr._tag === "List" ? symName(form.expr.items[0]) : undefined) ?? fallback;
    const local = (kind: DefinitionKind) => {
      const inner = new Scope(scope);
      return {
        inner,
        bind: (pattern: SExpr | undefined) =>
          this.bindPattern(pattern, kind, inner, form ?? undefined, formName(head ?? "fn")),
      };
    };
    switch (head) {
      case "quote":
        return;
      case "quasiquote":
        this.walkTemplate(items[1], scope, document, form);
        return;
      case "define": {
        const target = items[1];
        if (target?._tag === "List") {
          const { inner, bind } = local("parameter");
          for (const param of target.items.slice(1)) bind(param);
          this.walkAll(items.slice(2), inner, document, form);
          return;
        }
        this.walkAll(items.slice(2), scope, document, form);
        return;
      }
      case "__macro": {
        const outer = this.#inMacroDefinition;
        this.#inMacroDefinition = true;
        try {
          this.walkFunction(items, false, scope, document, form, local);
        } finally {
          this.#inMacroDefinition = outer;
        }
        return;
      }
      case "__operation":
      case "fn": {
        this.walkFunction(items, head === "fn", scope, document, form, local);
        return;
      }
      case "let":
      case "do!": {
        const bindings = items[1];
        const { inner, bind } = local("local");
        if (bindings?._tag === "Vector") {
          for (let index = 0; index < bindings.items.length; index += 2) {
            const value = bindings.items[index + 1];
            if (value) this.walk(value, inner, document, form);
            bind(bindings.items[index]);
          }
        }
        this.walkAll(items.slice(2), inner, document, form);
        return;
      }
      case "match": {
        if (items[1]) this.walk(items[1], scope, document, form);
        for (let index = 2; index < items.length; index += 2) {
          const { inner } = local("local");
          this.bindMatchPattern(items[index], inner, form ?? undefined, formName("match"));
          const body = items[index + 1];
          if (body) this.walk(body, inner, document, form);
        }
        return;
      }
      case "catch": {
        if (items[1]) this.walk(items[1], scope, document, form);
        for (let index = 2; index < items.length; index += 2) {
          const { inner } = local("local");
          this.bindMatchPattern(items[index], inner, form ?? undefined, formName("catch"));
          const body = items[index + 1];
          if (body) this.walk(body, inner, document, form);
        }
        return;
      }
      case ":":
        if (items[1]) this.reference(items[1], scope);
        this.walkType(items.slice(2), scope);
        return;
      case "__sum-type":
        for (const constructor of items.slice(2)) {
          if (constructor._tag === "List") this.walkType(constructor.items.slice(1), scope);
        }
        return;
      case "__typeclass":
        for (const method of items.slice(2)) {
          if (method._tag === "List") this.walkType(method.items.slice(1), scope);
        }
        return;
      case "__error":
      case "__schema":
      case "__service":
        this.walkType(items.slice(2), scope);
        return;
      case "instance":
        if (items[1]) this.walkType([items[1]], scope);
        for (const member of items.slice(2)) {
          if (headName(member) === "define" && member._tag === "List") {
            if (member.items[1]) this.reference(member.items[1], scope);
            this.walkAll(member.items.slice(2), scope, document, form);
          } else {
            this.walk(member, scope, document, form);
          }
        }
        return;
    }
    const descriptor = head ? this.descriptors.get(head) : undefined;
    if (descriptor) {
      const args = items.slice(1);
      const declarations = new Set(
        identifierArguments(descriptor, args)
          .filter(([spec]) => spec.declaration)
          .map(([, arg]) => arg),
      );
      for (const arg of args) {
        if (declarations.has(arg)) continue;
        if (isKeywordHeaded(arg) && arg._tag === "List") {
          this.walkAll(arg.items.slice(1), scope, document, form);
        } else {
          this.walk(arg, scope, document, form);
        }
      }
      return;
    }
    if (head && (FALLBACK_DEFINING_HEADS.has(head))) {
      this.walkAll(items.slice(2), scope, document, form);
      return;
    }
    this.walkAll(items, scope, document, form);
  }

  /** `(fn [params] body…)`, `(fn name [params] body…)`, or `(define-x name [params] body…)`. */
  walkFunction(
    items: readonly SExpr[],
    anonymous: boolean,
    _scope: Scope,
    document: IndexedDocument,
    form: AuthorNode | null,
    local: (kind: DefinitionKind) => { inner: Scope; bind: (pattern: SExpr | undefined) => void },
  ): void {
    const named = !anonymous || (items[1]?._tag === "Sym" && items[2]?._tag === "Vector");
    const params = named ? items[2] : items[1];
    const { inner, bind } = local("parameter");
    if (anonymous && named) bind(items[1]);
    if (params?._tag === "Vector") for (const param of params.items) bind(param);
    this.walkAll(items.slice(named ? 3 : 2), inner, document, form);
  }

  /** Symbols in quasiquoted templates refer to globals at the expansion site. */
  walkTemplate(
    expr: SExpr | undefined,
    scope: Scope,
    document: IndexedDocument,
    form: AuthorNode | null,
  ): void {
    if (!expr) return;
    const head = headName(expr);
    if ((head === "unquote" || head === "unquote-splicing") && expr._tag === "List") {
      if (expr.items[1]) this.walk(expr.items[1], scope, document, form);
      return;
    }
    if (expr._tag === "Sym") {
      this.reference(expr, scope, true);
      return;
    }
    for (const child of children(expr)) this.walkTemplate(child, scope, document, form);
  }

  /** Type expressions refer only to global names; everything else in them is structure. */
  walkType(items: readonly SExpr[], scope: Scope): void {
    for (const item of items) {
      if (item._tag === "Sym") this.reference(item, scope, true);
      else for (const child of children(item)) this.walkType([child], scope);
    }
  }

  bindPattern(
    pattern: SExpr | undefined,
    kind: DefinitionKind,
    scope: Scope,
    form: AuthorNode | undefined,
    formName: string,
  ): void {
    if (!pattern) return;
    switch (pattern._tag) {
      case "Sym":
        if (pattern.name === "&" || pattern.name === "_") return;
        this.define(pattern, kind, form, formName, { scope, node: form });
        return;
      case "Vector":
        for (const item of pattern.items) this.bindPattern(item, kind, scope, form, formName);
        return;
      case "Map":
        for (const [key, value] of pattern.pairs) {
          if (key._tag === "Sym" && (key.name === ":keys" || key.name === ":as")) {
            this.bindPattern(value, kind, scope, form, formName);
          } else {
            this.bindPattern(value._tag === "Sym" && !value.name.startsWith(":") ? value : key, kind, scope, form, formName);
          }
        }
        return;
      default:
        return;
    }
  }

  bindMatchPattern(
    pattern: SExpr | undefined,
    scope: Scope,
    form: AuthorNode | undefined,
    formName: string,
  ): void {
    if (!pattern) return;
    switch (pattern._tag) {
      case "Sym": {
        const author = this.author(pattern);
        if (pattern.name === "_" || pattern.name.startsWith(":")) return;
        const constructor = author ? this.global(pattern.name, author) : undefined;
        if (constructor?.kind === "constructor") {
          this.reference(pattern, scope, true);
          return;
        }
        this.define(pattern, "local", form, formName, { scope, node: form });
        return;
      }
      case "List":
        if (pattern.items[0]) this.reference(pattern.items[0], scope, true);
        for (const item of pattern.items.slice(1)) this.bindMatchPattern(item, scope, form, formName);
        return;
      case "Vector":
        for (const item of pattern.items) this.bindMatchPattern(item, scope, form, formName);
        return;
      case "Map":
        for (const [, value] of pattern.pairs) this.bindMatchPattern(value, scope, form, formName);
        return;
      default:
        return;
    }
  }
}

function isFnForm(expr: SExpr | undefined): boolean {
  return expr !== undefined && headName(expr) === "fn";
}

/** Pair a descriptor's identifier specs with the positional arguments they name. */
function identifierArguments(
  descriptor: FormDescriptor,
  args: readonly SExpr[],
): (readonly [FormDescriptor["identifiers"][number], SExpr])[] {
  const positional = args.filter((arg) => !isKeywordHeaded(arg));
  return descriptor.identifiers.flatMap((spec, index) => {
    const arg = positional[index];
    return arg ? [[spec, arg] as const] : [];
  });
}
