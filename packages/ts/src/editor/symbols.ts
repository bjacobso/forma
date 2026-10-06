/**
 * Symbol index: definitions and references for editor services.
 *
 * Programs are expanded with the evaluator's own expander and resolved in
 * their expanded form, then mapped back to author-written nodes through
 * expansion origins. Forms registered with descriptors define the names in
 * their declaration identifiers. See docs/language-services.md.
 */

import { CORE_FORMS, describeBindingForm, templateExpressions, type BindingStep } from "../language/binding-forms.js";
import { defaultBuiltins } from "../builtins/index.js";
import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import { originOf } from "../expander/provenance.js";
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
  /** Descriptors in addition to the `define-form`s found in the documents. */
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

/** References in executable expanded code, including names a macro introduced. */
export interface ExpandedReference {
  /** Stable provenance address: author id, or expansion call id plus a tree path. */
  readonly key: string;
  readonly name: string;
  readonly sourceId: string;
  readonly resolution: ReferenceResolution;
  /** Stable binding address; globals share the first definition site's key. */
  readonly binding: string;
  readonly definition?: string | undefined;
  readonly nodeId?: string | undefined;
  readonly callNodeId?: string | undefined;
  readonly bindingScope?: "global" | "local" | undefined;
  readonly bindingNodeId?: string | undefined;
  readonly bindingCallNodeId?: string | undefined;
}

export interface SymbolIndex {
  readonly definitions: readonly SymbolDefinition[];
  readonly references: readonly SymbolReference[];
  /** Author node ids reached in executable expression positions after expansion. */
  readonly expressionNodeIds?: Readonly<Record<string, readonly string[]>> | undefined;
  /** Executable references used to check macro capture in semantic edits. */
  readonly expandedReferences?: readonly ExpandedReference[] | undefined;
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
  /** All definition sites of the same global cell (one site for a local). */
  readonly definitionSites?: readonly SymbolDefinition[] | undefined;
  readonly references: readonly SymbolReference[];
}

/** Heads that define their second element when nothing more specific applies. */
const FALLBACK_DEFINING_HEADS = new Set([
  "def",
  "defn",
  "defmacro",
  "define-form",
  "meta-fn",
  "define-elaboration",
  "define-elaboration-primitive",
  "define-protocol",
  "define-payload-contract",
  "defclass",
]);

const SPECIAL_FORMS = CORE_FORMS;

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
  readonly #bindingKeys = new Map<string, string>();
  constructor(readonly parent: Scope | null) {}
  bind(name: string, definition: SymbolDefinition | null, key?: string): void {
    this.#bindings.set(name, definition);
    if (key ?? definition?.key) this.#bindingKeys.set(name, key ?? definition!.key);
  }
  bindingKey(name: string): string | undefined { return this.#bindings.has(name) ? this.#bindingKeys.get(name) : this.parent?.bindingKey(name); }
  hasOwn(name: string): boolean { return this.#bindings.has(name); }
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
    const visit = (expr: SExpr): void => {
      const node = index.withSpan(expr.loc.start, expr.loc.end);
      if (node && matchesSyntaxKind(expr, node.kind) && !authors.has(expr)) {
        authors.set(expr, { document: result, node, expr });
      }
      children(expr).forEach(visit);
    };
    exprs.forEach(visit);
    return result;
  });

  const expanded = expandDocuments(indexed);
  const builtinNames = kernelNames();
  const orders = new Map(indexed.map((document) => [document.sourceId, document.order]));
  const walker = new SymbolWalker(authors, descriptors, builtinNames, orders);
  walker.address(expanded.forms);
  for (const { document, expr } of expanded.forms) walker.collectGlobalsDeep(expr, document);
  for (const { document, expr } of expanded.forms) walker.walk(expr, walker.root, document, null);

  const sorted = <T extends { sourceId: string; span: SyntaxSpan }>(items: Iterable<T>) =>
    [...items].sort(
      (left, right) =>
        orders.get(left.sourceId)! - orders.get(right.sourceId)! ||
        left.span.start - right.span.start,
    );
  return {
    expressionNodeIds: Object.fromEntries(indexed.map((document) => [document.sourceId, [...(walker.expressionNodeIds.get(document.sourceId) ?? [])]])),
    expandedReferences: [...walker.expandedReferences.values()],
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
  const definitionSites = definition.scope === "global"
    ? index.definitions.filter((site) => site.scope === "global" && site.name === definition.name)
    : [definition];
  const keys = new Set(definitionSites.map((site) => site.key));
  return {
    definition,
    definitionSites,
    references: index.references.filter((reference) => reference.definition !== undefined && keys.has(reference.definition)),
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
          maxExpansionNodes: 20_000,
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
  readonly expandedReferences = new Map<string, ExpandedReference>();
  readonly #addresses = new Map<SExpr, { key: string; sourceId: string; callNodeId?: string }>();
  readonly #available = new Map<string, number>();
  readonly #bindingAddresses = new Map<string, { nodeId?: string; callNodeId?: string }>();
  #template = false;
  #macroDefinition = false;
  readonly expressionNodeIds = new Map<string, Set<string>>();

  constructor(
    private readonly authors: ReadonlyMap<SExpr, AuthorNode>,
    private readonly descriptors: DescriptorLookup,
    private readonly builtins: ReadonlySet<string>,
    private readonly orders: ReadonlyMap<string, number>,
  ) {}

  /**
   * The author node for a node of the expanded program. Template code a macro
   * introduced stands for no author node, so only the definition itself
   * reports its template's symbols.
   */
  author(expr: SExpr): AuthorNode | undefined {
    for (const origin of sourceOriginsOf(expr)) {
      const author = this.authors.get(origin);
      if (author && matchesSyntaxKind(expr, author.node.kind)) return author;
    }
    return undefined;
  }

  /** Address expanded nodes by the author call and a path within that expansion. */
  address(forms: readonly ExpandedForm[]): void {
    const visit = (expr: SExpr, document: IndexedDocument, path: string, call?: string): void => {
      const origin = originOf(expr);
      const site = origin ? this.authors.get(origin.site) : undefined;
      if (origin?.role === "expansion" && site && origin.authors.length > 0) { call = site.node.id; path = ""; }
      const author = this.author(expr);
      const key = call ? `${document.sourceId}#${call}@${path}` : author ? `${document.sourceId}#${author.node.id}` : `${document.sourceId}@${path}`;
      this.#addresses.set(expr, { key, sourceId: document.sourceId, ...(call ? { callNodeId: call } : {}) });
      this.#bindingAddresses.set(key, { ...(author ? { nodeId: author.node.id } : {}), ...(call ? { callNodeId: call } : {}) });
      children(expr).forEach((child, i) => visit(child, document, `${path}.${i}`, call));
    };
    forms.forEach(({ document, expr }, i) => visit(expr, document, String(i)));
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
    const origin = originOf(expr);
    const direct = this.author(expr);
    const author = direct ?? (!scope && origin ? this.authors.get(origin.site) : undefined);
    if (!author) {
      scope?.scope.bind(expr.name, null, this.#addresses.get(expr)?.key);
      return null;
    }
    const key = `${author.document.sourceId}#${author.node.id}${direct ? "" : `:${expr.name}`}`;
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
    if (!head) {
      for (const item of expr.items) this.collectGlobalsDeep(item, document);
      return;
    }
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
    const description = describeBindingForm(expr);
    if (description) {
      const collect = (steps: readonly BindingStep[]): void => {
        for (const step of steps) {
          if (step.role === "scope") collect(step.steps);
          else if (step.role === "bind" && step.global) {
            const definition = this.define(step.expr, step.kind, node, name, undefined);
            if (definition && head === "define") this.#available.set(definition.key, expr.loc.end);
          }
          else if (step.role === "expression" && head !== "define-macro") this.collectGlobalsDeep(step.expr, document);
          else if (step.role === "template") for (const item of templateExpressions(step.expr)) this.collectGlobalsDeep(item, document);
        }
      };
      collect(description);
      return;
    }
    switch (head) {
      case "define-service": {
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
    if (FALLBACK_DEFINING_HEADS.has(head) || head.startsWith("define-")) {
      defineHead(items[1], "declaration");
      return;
    }
    for (const item of items.slice(1)) this.collectNestedGlobals(item, document);
  }

  collectNestedGlobals(expr: SExpr, document: IndexedDocument): void {
    this.collectGlobalsDeep(expr, document);
  }

  collectGlobalsDeep(expr: SExpr, document: IndexedDocument): void {
    if (expr._tag === "List") this.collectGlobals(expr, document);
    else for (const child of children(expr)) this.collectGlobalsDeep(child, document);
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
    const origin = originOf(expr);
    const site = author ?? (origin ? this.authors.get(origin.site) : undefined);
    const local = globalsOnly ? undefined : scope.lookup(name);
    const definition = local !== undefined ? local ?? undefined : site ? this.global(name, site) : undefined;
    const resolution: ReferenceResolution = local !== undefined || definition ? "definition" : this.builtins.has(name) ? "builtin" : this.descriptors.get(name) ? "form" : "unresolved";
    const address = this.#addresses.get(expr);
    if (address && !this.#template && !this.#macroDefinition) {
      const binding = local !== undefined ? scope.bindingKey(name) ?? `${address.key}:hidden` : definition ? this.#globals.get(name)![0]!.key : `${resolution}:${name}`;
      this.expandedReferences.set(address.key, {
        ...address, name, resolution, binding,
        ...(local !== undefined ? { bindingScope: "local" as const, bindingNodeId: local?.nodeId ?? this.#bindingAddresses.get(binding)?.nodeId, bindingCallNodeId: this.#bindingAddresses.get(binding)?.callNodeId } : definition ? { bindingScope: "global" as const, bindingNodeId: definition.nodeId } : {}),
        ...(definition ? { definition: definition.key } : {}),
        ...(author ? { nodeId: author.node.id } : {}),
      });
    }
    if (!author || local === null || (globalsOnly && !definition)) return;
    const key = `${author.document.sourceId}#${author.node.id}`;
    if (this.definitions.has(key) || this.references.has(key)) return;
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
        (order === at.document.order && (this.#available.get(definition.key) ?? definition.span.start) <= at.node.span.start)
      );
    };
    return candidates.filter(before).at(-1) ?? candidates[0];
  }

  orderOf(sourceId: string): number {
    return this.orders.get(sourceId) ?? Number.MAX_SAFE_INTEGER;
  }

  // --- walking --------------------------------------------------------------

  walk(expr: SExpr, scope: Scope, document: IndexedDocument, form: AuthorNode | null): void {
    const origin = originOf(expr);
    if (origin && !this.#macroDefinition && !this.#template && headName(expr) !== "define-macro") {
      for (const source of sourceOriginsOf(expr)) {
        const author = this.authors.get(source);
        if (!author) continue;
        const ids = this.expressionNodeIds.get(author.document.sourceId) ?? new Set<string>();
        ids.add(author.node.id);
        this.expressionNodeIds.set(author.document.sourceId, ids);
      }
      if (origin.role === "expansion") {
        const call = this.authors.get(origin.site)?.expr;
        if (call?._tag === "List" && call.items[0]) this.reference(call.items[0], this.root, true);
      }
    }
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
    const description = describeBindingForm(expr);
    if (description) {
      const previous = this.#macroDefinition;
      this.#macroDefinition ||= head === "define-macro";
      this.walkSteps(description, scope, document, form, formName(head ?? "fn"), head === "define-macro");
      this.#macroDefinition = previous;
      return;
    }
    if (head === "define-service") {
      this.walkType(items.slice(2), scope);
      return;
    }
    if (head === "instance") {
      if (items[1]) this.walkType([items[1]], scope);
      for (const member of items.slice(2)) {
        if (headName(member) === "define" && member._tag === "List") {
          if (member.items[1]) this.reference(member.items[1], scope);
          this.walkAll(member.items.slice(2), scope, document, form);
        } else this.walk(member, scope, document, form);
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
    if (head && (FALLBACK_DEFINING_HEADS.has(head) || head.startsWith("define-"))) {
      this.walkAll(items.slice(2), scope, document, form);
      return;
    }
    this.walkAll(items, scope, document, form);
  }

  walkSteps(steps: readonly BindingStep[], scope: Scope, document: IndexedDocument, form: AuthorNode | null, formName: string, macro = false): void {
    for (const step of steps) {
      if (step.role === "scope") {
        const inner = new Scope(scope);
        for (const name of step.typeVariables ?? []) inner.bind(name, null);
        this.walkSteps(step.steps, inner, document, form, formName, macro);
      } else if (step.role === "bind") {
        if (step.global) continue;
        if (step.pattern) this.bindMatchPattern(step.expr, scope, form ?? undefined, formName);
        else this.bindPattern(step.expr, step.kind, scope, form ?? undefined, formName);
      } else if (step.role === "expression") {
        if (macro && headName(step.expr) === "quasiquote" && step.expr._tag === "List") {
          const previous = this.#template;
          this.#template = true;
          this.walkMacroTemplate(step.expr.items[1], scope, document, form);
          this.#template = previous;
        } else this.walk(step.expr, scope, document, form);
      } else if (step.role === "template") this.walkTemplate(step.expr, scope, document, form);
      else if (step.role === "type") this.walkType([step.expr], scope);
    }
  }

  /** Macro templates use core scopes; their binders are data, not author definitions. */
  walkMacroTemplate(expr: SExpr | undefined, scope: Scope, document: IndexedDocument, form: AuthorNode | null): void {
    if (!expr) return;
    const head = headName(expr);
    if ((head === "unquote" || head === "unquote-splicing") && expr._tag === "List") {
      if (expr.items[1]) this.walk(expr.items[1], scope, document, form);
      return;
    }
    const description = describeBindingForm(expr);
    if (description) {
      const visit = (steps: readonly BindingStep[], scope: Scope): void => {
        for (const step of steps) {
          if (step.role === "scope") visit(step.steps, new Scope(scope));
          else if (step.role === "bind") {
            const names = (expr: SExpr): void => {
              if (expr._tag === "Sym") scope.bind(expr.name, null);
              else children(expr).forEach(names);
            };
            names(step.expr);
          } else if (step.role === "expression") this.walkMacroTemplate(step.expr, scope, document, form);
        }
      };
      visit(description, scope);
    } else if (expr._tag === "Sym") this.reference(expr, scope);
    else for (const child of children(expr)) this.walkMacroTemplate(child, scope, document, form);
  }

  /** Runtime template symbols are data; only active unquotes execute. */
  walkTemplate(
    expr: SExpr | undefined,
    scope: Scope,
    document: IndexedDocument,
    form: AuthorNode | null,
  ): void {
    if (expr) for (const item of templateExpressions(expr)) this.walk(item, scope, document, form);
  }

  /** Type expressions refer only to global names; everything else in them is structure. */
  walkType(items: readonly SExpr[], scope: Scope): void {
    for (const item of items) {
      if (item._tag === "Sym" && scope.lookup(item.name) !== null) this.reference(item, scope, true);
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
        if (pattern.name === "&" || pattern.name === "_" || pattern.name === "nil" || pattern.name.startsWith(":")) return;
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
        if (scope.hasOwn(pattern.name)) this.reference(pattern, scope);
        else this.define(pattern, "local", form, formName, { scope, node: form });
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
