// UI-free source authoring helpers shared by structural and source-based hosts.
import { identifySyntax, indexSyntax, type SyntaxIdentity } from "./Syntax.js";

export * from "./authoring/rows.js";

/** Only resolved source facts are needed to propagate capability requirements. */
export interface RequirementSymbol {
  readonly kind: string;
  readonly name: string;
  readonly definition?: string;
}
export interface RequirementDefinition {
  readonly key: string;
  readonly formNodeId: string | null;
}
export interface ReplAnalysis {
  readonly document: { readonly source: string; readonly identity: SyntaxIdentity };
  readonly requirements: Readonly<Record<string, ReadonlyArray<string>>>;
}

/** Propagate capabilities through form children and resolved definitions, including recursive calls. */
export const requirementsFor = (
  identity: SyntaxIdentity,
  symbols: Readonly<Record<string, RequirementSymbol>>,
  definitions: ReadonlyArray<RequirementDefinition>,
): Readonly<Record<string, ReadonlyArray<string>>> => {
  const sets = new Map(identity.nodes.map((node) => [node.id, new Set<string>()]));
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const add = (to: Set<string>, from: ReadonlySet<string>) => {
    const before = to.size;
    for (const name of from) to.add(name);
    return to.size !== before;
  };
  for (const [id, symbol] of Object.entries(symbols))
    if (symbol.kind === "capability") sets.get(id)?.add(symbol.name);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of [...identity.nodes].reverse()) {
      const own = sets.get(node.id)!;
      const fact = symbols[node.id];
      const definition = fact?.definition === undefined ? undefined : byKey.get(fact.definition);
      const inherited =
        definition?.formNodeId == null ? undefined : sets.get(definition.formNodeId);
      if (inherited !== undefined) changed = add(own, inherited) || changed;
      const parent = node.parent === null ? undefined : sets.get(node.parent);
      if (parent !== undefined) changed = add(parent, own) || changed;
    }
  }
  return Object.fromEntries(
    [...sets].filter(([, names]) => names.size > 0).map(([id, names]) => [id, [...names].sort()]),
  );
};

/** Replaces the text of spans with spaces, keeping line breaks, so offsets do not move. */
export const blank = (
  source: string,
  spans: ReadonlyArray<{ start: number; end: number }>,
): string => {
  if (spans.length === 0) return source;
  const units = source.split("");
  for (const { start, end } of spans) {
    for (let at = start; at < end && at < units.length; at += 1) {
      if (units[at] !== "\n") units[at] = " ";
    }
  }
  return units.join("");
};

/** Top-level forms whose head is a domain form a prelude registered. */
export const descriptorForms = (
  identity: SyntaxIdentity,
  source: string,
  isDescriptor: (head: string) => boolean,
): ReadonlyArray<{ start: number; end: number; nodeId: string; head: string }> => {
  const index = indexSyntax(identity);
  return index.children(null).flatMap((node) => {
    if (node.kind !== "List") return [];
    const head = index.children(node.id)[0];
    if (head?.kind !== "Symbol") return [];
    const name = source.slice(head.span.start, head.span.end);
    return isDescriptor(name) ? [{ ...node.span, nodeId: node.id, head: name }] : [];
  });
};

const definitions = new Set([
  "define",
  "macro",
  "type",
  "typeclass",
  "class",
  "instance",
  "form",
  ":",
  "import",
  "export",
  "export-from",
]);

/** Later scratch declarations replace earlier bindings, as in an interactive REPL. */
export const mergeReplSource = (...sources: readonly string[]): string => {
  const declarations: { text: string; key: string | undefined }[] = [];
  for (const source of sources) {
    const identity = identifySyntax(source);
    if (identity.errors.length) return sources.join("\n");
    const syntax = indexSyntax(identity);
    for (const node of syntax.children(null)) {
      const [head, name] = syntax.children(node.id);
      const kind = head ? source.slice(head.span.start, head.span.end) : "";
      const named =
        name?.kind === "Symbol"
          ? name
          : name?.kind === "List"
            ? syntax.children(name.id)[0]
            : undefined;
      const key =
        node.kind === "List" &&
        named?.kind === "Symbol" &&
        definitions.has(kind) &&
        !["import", "export", "export-from", "instance"].includes(kind)
          ? `${kind}:${source.slice(named.span.start, named.span.end)}`
          : undefined;
      if (key) {
        const index = declarations.findIndex((entry) => entry.key === key);
        if (index !== -1) declarations.splice(index, 1);
      }
      declarations.push({ text: source.slice(node.span.start, node.span.end), key });
    }
  }
  return declarations.map((entry) => entry.text).join("\n");
};

/** Keep declarations, skipping application expressions and capability-dependent definitions. */
export const replDefinitions = (source: string, analysis?: ReplAnalysis | null): string => {
  const identity =
    analysis?.document.source === source ? analysis.document.identity : identifySyntax(source);
  const syntax = indexSyntax(identity);
  return syntax
    .children(null)
    .flatMap((node) => {
      const head = syntax.children(node.id)[0];
      if (
        node.kind !== "List" ||
        head?.kind !== "Symbol" ||
        !definitions.has(source.slice(head.span.start, head.span.end)) ||
        (analysis?.requirements[node.id]?.length ?? 0) > 0
      )
        return [];
      return [source.slice(node.span.start, node.span.end)];
    })
    .join("\n");
};

