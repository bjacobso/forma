/**
 * Browser-safe read-only DefinitionIndex projection for host operations and MCP tools.
 * Extracts top-level Forma definitions, signatures, capabilities, errors, and
 * cross-definition dependency edges so `@formalang/ts/store-queries` can answer
 * semantic graph queries over inline sources and loaded sessions.
 */
import { Effect } from "effect";
import { sha256 } from "@formalang/ts/artifact";
import { diagnosticFromUnknown, type Diagnostic } from "@formalang/ts/diagnostic";
import { parseManyToSExpr, type SExpr } from "@formalang/ts/reader";
import type {
  DefHash,
  DefinitionDetails,
  DefinitionIndex,
  DefinitionRecord,
  PresentationMeta,
  StoreDefinitionKind,
} from "@formalang/ts/store-queries";

export interface IndexedSourceDocument {
  readonly id: string;
  readonly source: string;
}

export interface BuiltDefinitionIndex {
  readonly index: DefinitionIndex;
  readonly diagnostics: readonly Diagnostic[];
}

const LANGUAGE_PROFILE = "forma-core-v1";
const DECLARATION_HEADS: Readonly<Record<string, StoreDefinitionKind>> = {
  define: "define",
  type: "type",
  error: "error",
  service: "service",
  layer: "layer",
  class: "class",
  instance: "instance",
  form: "form",
  "define-form": "form",
  macro: "macro",
  test: "test",
};

interface ExtractedDecl {
  readonly kind: StoreDefinitionKind;
  readonly name: string;
  readonly qualifiedName: string;
  readonly moduleId: string;
  readonly expr: SExpr;
  readonly canonicalForm: string;
  readonly authoredSource: string;
  readonly docstring?: string | undefined;
  readonly span?: { readonly start: number; readonly end: number; readonly sourceId: string } | undefined;
  readonly signature?: string | undefined;
  readonly requirements: readonly string[];
  readonly errors: readonly string[];
  readonly referencedSymbols: readonly string[];
  readonly referencedForms: readonly string[];
}

function asSymbol(expr: SExpr | undefined): string | undefined {
  return expr?._tag === "Sym" ? expr.name : undefined;
}

function asString(expr: SExpr | undefined): string | undefined {
  return expr?._tag === "Str" ? expr.value : undefined;
}

function formatSExpr(expr: SExpr): string {
  switch (expr._tag) {
    case "Sym":
      return expr.name;
    case "Str":
      return JSON.stringify(expr.value);
    case "Num":
      return String(expr.value);
    case "Bool":
      return expr.value ? "true" : "false";
    case "List":
      return `(${expr.items.map(formatSExpr).join(" ")})`;
    case "Vector":
      return `[${expr.items.map(formatSExpr).join(" ")}]`;
    case "Set":
      return `#{${expr.items.map(formatSExpr).join(" ")}}`;
    case "Map":
      return `{${expr.pairs.map(([k, v]) => `${formatSExpr(k)} ${formatSExpr(v)}`).join(" ")}}`;
    case "Error":
      return `<error:${expr.message}>`;
  }
}

function collectSymbols(expr: SExpr, out: Set<string>, forms: Set<string>, bound: ReadonlySet<string>): void {
  switch (expr._tag) {
    case "Sym":
      if (!bound.has(expr.name)) out.add(expr.name);
      return;
    case "List": {
      if (expr.items.length === 0) return;
      const head = asSymbol(expr.items[0]);
      if (head === "quote") return;
      if (head === "fn" || head === "lambda") {
        const nextBound = new Set(bound);
        const params = expr.items[1];
        if (params && (params._tag === "Vector" || params._tag === "List")) {
          for (const item of params.items) {
            const name = asSymbol(item);
            if (name) nextBound.add(name);
          }
        }
        for (let i = 2; i < expr.items.length; i++) {
          collectSymbols(expr.items[i]!, out, forms, nextBound);
        }
        return;
      }
      if (head === "let" || head === "do!") {
        const nextBound = new Set(bound);
        const bindings = expr.items[1];
        if (bindings && (bindings._tag === "Vector" || bindings._tag === "List")) {
          for (let i = 0; i < bindings.items.length; i += 2) {
            const val = bindings.items[i + 1];
            if (val) collectSymbols(val, out, forms, nextBound);
            const binder = asSymbol(bindings.items[i]);
            if (binder) nextBound.add(binder);
          }
        }
        for (let i = 2; i < expr.items.length; i++) {
          collectSymbols(expr.items[i]!, out, forms, nextBound);
        }
        return;
      }
      if (head) {
        if (!bound.has(head)) {
          out.add(head);
          forms.add(head);
        }
      } else {
        collectSymbols(expr.items[0]!, out, forms, bound);
      }
      for (let i = 1; i < expr.items.length; i++) {
        collectSymbols(expr.items[i]!, out, forms, bound);
      }
      return;
    }
    case "Vector":
    case "Set":
      for (const item of expr.items) collectSymbols(item, out, forms, bound);
      return;
    case "Map":
      for (const [k, v] of expr.pairs) {
        collectSymbols(k, out, forms, bound);
        collectSymbols(v, out, forms, bound);
      }
      return;
    default:
      return;
  }
}

function extractEffectSetsFromType(
  expr: SExpr,
  errors: Set<string>,
  requirements: Set<string>,
): void {
  if (expr._tag === "List" && expr.items.length > 0) {
    const head = asSymbol(expr.items[0]);
    if (head === "Effect") {
      // (Effect Value [Errors...] [Requirements...])
      const errNode = expr.items[2];
      if (errNode && (errNode._tag === "Vector" || errNode._tag === "List")) {
        for (const item of errNode.items) {
          const name = asSymbol(item);
          if (name) errors.add(name);
        }
      }
      const reqNode = expr.items[3];
      if (reqNode && (reqNode._tag === "Vector" || reqNode._tag === "List")) {
        for (const item of reqNode.items) {
          const name = asSymbol(item);
          if (name) requirements.add(name);
        }
      }
    }
    for (const item of expr.items) extractEffectSetsFromType(item, errors, requirements);
  } else if (expr._tag === "Vector" || expr._tag === "Set") {
    for (const item of expr.items) extractEffectSetsFromType(item, errors, requirements);
  } else if (expr._tag === "Map") {
    for (const [k, v] of expr.pairs) {
      extractEffectSetsFromType(k, errors, requirements);
      extractEffectSetsFromType(v, errors, requirements);
    }
  }
}

function extractBodyEffects(
  expr: SExpr,
  knownErrors: ReadonlySet<string>,
  knownServices: ReadonlySet<string>,
  errors: Set<string>,
  requirements: Set<string>,
): void {
  if (expr._tag === "List" && expr.items.length > 0) {
    const head = asSymbol(expr.items[0]);
    if (head === "fail" && expr.items[1]?._tag === "List" && expr.items[1].items.length > 0) {
      const errName = asSymbol(expr.items[1].items[0]);
      if (errName) errors.add(errName);
    }
    if (head && head.includes(".")) {
      const service = head.slice(0, head.indexOf("."));
      if (knownServices.has(service) || /^[A-Z]/u.test(service)) {
        requirements.add(head);
      }
    }
    if (head && knownErrors.has(head)) {
      errors.add(head);
    }
    for (const item of expr.items) {
      extractBodyEffects(item, knownErrors, knownServices, errors, requirements);
    }
  } else if (expr._tag === "Vector" || expr._tag === "Set") {
    for (const item of expr.items) {
      extractBodyEffects(item, knownErrors, knownServices, errors, requirements);
    }
  } else if (expr._tag === "Map") {
    for (const [k, v] of expr.pairs) {
      extractBodyEffects(k, knownErrors, knownServices, errors, requirements);
      extractBodyEffects(v, knownErrors, knownServices, errors, requirements);
    }
  }
}

function declNameFromExpr(kind: StoreDefinitionKind, items: readonly SExpr[]): string | undefined {
  const target = items[1];
  if (!target) return undefined;
  const direct = asSymbol(target);
  if (direct) return direct;
  // (form (greeting name message) ...) or (macro (twice x) ...) or (define (f x) ...)
  if (target._tag === "List" && target.items.length > 0) {
    return asSymbol(target.items[0]);
  }
  if (kind === "test") {
    return asString(target);
  }
  return undefined;
}

function initialBoundNames(kind: StoreDefinitionKind, items: readonly SExpr[], name: string): Set<string> {
  const bound = new Set<string>([name]);
  if (kind === "define") {
    const target = items[1];
    if (target?._tag === "List") {
      for (let i = 1; i < target.items.length; i++) {
        const param = asSymbol(target.items[i]);
        if (param) bound.add(param);
      }
    } else if (items[2]?._tag === "Vector") {
      for (const param of items[2].items) {
        const p = asSymbol(param);
        if (p) bound.add(p);
      }
    }
  } else if (kind === "form" || kind === "macro") {
    const target = items[1];
    if (target?._tag === "List") {
      for (let i = 1; i < target.items.length; i++) {
        const param = asSymbol(target.items[i]);
        if (param) bound.add(param);
      }
    }
  }
  return bound;
}

function sliceAuthoredSource(source: string, expr: SExpr): string {
  const loc = expr.loc;
  if (loc && loc.start >= 0 && loc.end <= source.length && loc.end > loc.start) {
    return source.slice(loc.start, loc.end);
  }
  return formatSExpr(expr);
}

/**
 * Build a read-only `DefinitionIndex` from one or more Forma source documents.
 */
export function buildSessionDefinitionIndex(
  documents: readonly IndexedSourceDocument[],
): BuiltDefinitionIndex {
  const diagnostics: Diagnostic[] = [];
  const parsedDocs: Array<{ readonly doc: IndexedSourceDocument; readonly exprs: readonly SExpr[] }> = [];
  const knownErrors = new Set<string>();
  const knownServices = new Set<string>();

  for (const doc of documents) {
    const read = Effect.runSync(Effect.result(parseManyToSExpr(doc.source, doc.id)));
    if (read._tag === "Failure") {
      diagnostics.push(diagnosticFromUnknown(read.failure, "parse", doc.id));
      continue;
    }
    parsedDocs.push({ doc, exprs: read.success });
    for (const expr of read.success) {
      if (expr._tag !== "List" || expr.items.length < 2) continue;
      const head = asSymbol(expr.items[0]);
      const name = asSymbol(expr.items[1]);
      if (head === "error" && name) knownErrors.add(name);
      if (head === "service" && name) knownServices.add(name);
    }
  }

  const extracted: ExtractedDecl[] = [];
  for (const { doc, exprs } of parsedDocs) {
    const signatures = new Map<string, { readonly signature: string; readonly expr: SExpr }>();
    for (const expr of exprs) {
      if (expr._tag !== "List" || expr.items.length < 3) continue;
      if (asSymbol(expr.items[0]) === ":") {
        const name = asSymbol(expr.items[1]);
        if (name) {
          signatures.set(name, { signature: formatSExpr(expr.items[2]!), expr: expr.items[2]! });
        }
      }
    }

    for (const expr of exprs) {
      if (expr._tag !== "List" || expr.items.length < 2) continue;
      const head = asSymbol(expr.items[0]);
      if (!head) continue;
      const kind = DECLARATION_HEADS[head];
      if (!kind) continue;
      const name = declNameFromExpr(kind, expr.items);
      if (!name) continue;

      const qualifiedName = `${doc.id}#${name}`;
      const sigEntry = signatures.get(name);
      const errors = new Set<string>();
      const requirements = new Set<string>();
      if (sigEntry) {
        extractEffectSetsFromType(sigEntry.expr, errors, requirements);
      }
      if (kind === "define" || kind === "layer" || kind === "test") {
        extractBodyEffects(expr, knownErrors, knownServices, errors, requirements);
      }
      if (kind === "service") {
        for (let i = 2; i < expr.items.length; i++) {
          extractEffectSetsFromType(expr.items[i]!, errors, requirements);
        }
      }

      const refs = new Set<string>();
      const formRefs = new Set<string>();
      const bound = initialBoundNames(kind, expr.items, name);
      for (let i = 2; i < expr.items.length; i++) {
        collectSymbols(expr.items[i]!, refs, formRefs, bound);
      }
      if (sigEntry) {
        collectSymbols(sigEntry.expr, refs, formRefs, bound);
      }
      // Also connect Service.op calls back to the Service definition.
      for (const sym of [...refs]) {
        if (sym.includes(".")) {
          refs.add(sym.slice(0, sym.indexOf(".")));
        }
      }
      refs.delete(name);
      formRefs.delete(name);

      const authoredSource = sliceAuthoredSource(doc.source, expr);
      const canonicalForm = formatSExpr(expr);
      const span = expr.loc
        ? { start: expr.loc.start, end: expr.loc.end, sourceId: doc.id }
        : undefined;
      const docstring =
        kind === "define" && expr.items.length >= 4 && asString(expr.items[2]) !== undefined
          ? asString(expr.items[2])
          : undefined;

      extracted.push({
        kind,
        name,
        qualifiedName,
        moduleId: doc.id,
        expr,
        canonicalForm,
        authoredSource,
        ...(docstring !== undefined ? { docstring } : {}),
        ...(span !== undefined ? { span } : {}),
        ...(sigEntry !== undefined ? { signature: sigEntry.signature } : {}),
        requirements: [...requirements].sort(),
        errors: [...errors].sort(),
        referencedSymbols: [...refs].sort(),
        referencedForms: [...formRefs].sort(),
      });
    }
  }

  // First pass: assign deterministic DefHashes.
  const hashByQualified = new Map<string, DefHash>();
  const hashesByName = new Map<string, DefHash[]>();
  const kindByHash = new Map<DefHash, StoreDefinitionKind>();

  for (const decl of extracted) {
    const payload = JSON.stringify({
      v: "def:v1",
      kind: decl.kind,
      moduleId: decl.moduleId,
      name: decl.name,
      signature: decl.signature ?? null,
      requirements: decl.requirements,
      errors: decl.errors,
      canonicalForm: decl.canonicalForm,
      profile: LANGUAGE_PROFILE,
    });
    const hash: DefHash = `def:v1:${sha256(payload)}`;
    hashByQualified.set(decl.qualifiedName, hash);
    const list = hashesByName.get(decl.name) ?? [];
    if (!list.includes(hash)) list.push(hash);
    hashesByName.set(decl.name, list);
    kindByHash.set(hash, decl.kind);
  }

  // Second pass: resolve cross-definition dependencies & reverse dependents.
  const definitions = new Map<DefHash, DefinitionRecord>();
  const bindings = new Map<string, DefHash>();
  const byName = new Map<string, DefHash[]>();
  const dependents = new Map<DefHash, DefHash[]>();
  const metadata = new Map<DefHash, PresentationMeta>();

  for (const decl of extracted) {
    const hash = hashByQualified.get(decl.qualifiedName)!;
    const depSet = new Set<DefHash>();
    const formDepSet = new Set<DefHash>();

    const resolveTarget = (sym: string): DefHash | undefined => {
      const sameModule = hashByQualified.get(`${decl.moduleId}#${sym}`);
      if (sameModule && sameModule !== hash) return sameModule;
      const globalMatches = hashesByName.get(sym);
      if (globalMatches && globalMatches.length > 0) {
        return globalMatches.find((h) => h !== hash);
      }
      return undefined;
    };

    for (const sym of decl.referencedSymbols) {
      const target = resolveTarget(sym);
      if (!target) continue;
      if (
        decl.referencedForms.includes(sym) &&
        (kindByHash.get(target) === "form" || kindByHash.get(target) === "macro")
      ) {
        formDepSet.add(target);
      } else {
        depSet.add(target);
      }
    }

    const meta: PresentationMeta = {
      displayName: decl.name,
      qualifiedName: decl.qualifiedName,
      moduleId: decl.moduleId,
      authoredSource: decl.authoredSource,
      ...(decl.docstring !== undefined ? { docstring: decl.docstring } : {}),
      ...(decl.span !== undefined ? { span: decl.span } : {}),
    };

    const record: DefinitionRecord = {
      hash,
      kind: decl.kind,
      canonicalForm: decl.canonicalForm,
      qualifiedName: decl.qualifiedName,
      name: decl.name,
      moduleId: decl.moduleId,
      ...(decl.signature !== undefined ? { signature: decl.signature } : {}),
      requirements: decl.requirements,
      errors: decl.errors,
      languageProfile: LANGUAGE_PROFILE,
      dependencies: [...depSet].sort(),
      formDependencies: [...formDepSet].sort(),
      opaqueRefs: [],
      meta,
    };

    definitions.set(hash, record);
    bindings.set(decl.qualifiedName, hash);
    const list = byName.get(decl.name) ?? [];
    if (!list.includes(hash)) list.push(hash);
    byName.set(decl.name, list);
    metadata.set(hash, meta);
  }

  for (const record of definitions.values()) {
    for (const dep of [...record.dependencies, ...record.formDependencies]) {
      const list = dependents.get(dep) ?? [];
      if (!list.includes(record.hash)) list.push(record.hash);
      dependents.set(dep, list);
    }
  }

  return {
    index: {
      definitions,
      bindings,
      byName,
      dependents,
      metadata,
      languageProfile: LANGUAGE_PROFILE,
    },
    diagnostics,
  };
}

/** Project a `DefinitionRecord` into a JSON-safe `DefinitionDetails` payload. */
export function recordToDetails(
  index: DefinitionIndex,
  record: DefinitionRecord,
): DefinitionDetails {
  const meta = index.metadata.get(record.hash) ?? record.meta;
  return {
    hash: record.hash,
    kind: record.kind,
    name: record.name,
    qualifiedName: record.qualifiedName,
    moduleId: record.moduleId,
    ...(record.signature !== undefined ? { signature: record.signature } : {}),
    ...(record.canonicalSignature !== undefined
      ? { canonicalSignature: record.canonicalSignature }
      : {}),
    requirements: [...record.requirements],
    errors: [...record.errors],
    ...(meta.authoredSource !== undefined ? { authoredSource: meta.authoredSource } : {}),
    ...(meta.docstring !== undefined ? { docstring: meta.docstring } : {}),
    ...(meta.span !== undefined ? { span: meta.span } : {}),
    languageProfile: record.languageProfile,
    dependencies: [...record.dependencies],
    formDependencies: [...record.formDependencies],
    opaqueRefs: [...record.opaqueRefs],
    ...(record.scc !== undefined ? { scc: record.scc } : {}),
  };
}
