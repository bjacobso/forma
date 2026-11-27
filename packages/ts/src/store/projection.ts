/**
 * RFC 0029 Stage 2: Lossless `.lisp` / Git projection.
 *
 * - `exportSnapshotToSources`: projects an immutable `Snapshot` + `DefinitionIndex`
 *   into deterministic `.lisp` module sources, preserving original authored source,
 *   formatting, comments, docstrings, and spans verbatim for unchanged definitions,
 *   while cleanly updating renamed definitions/references and formatting synthesized
 *   or newly added definitions.
 * - `importSourcesAsTransaction`: parses and indexes edited `.lisp` sources, diffs
 *   them against a base snapshot/index to produce minimal `add`/`update`/`rename`/
 *   `remove`/`move` operations, automatically classifies `test` / refined-contract /
 *   law changes as `"requirement-edit"` vs `"impl-edit"`, and returns a
 *   `TransactionProposal` ready to submit through `TransactionalStore`.
 *
 * Browser-safe: contains zero `node:*` imports.
 */

import { formatSExpr, type LispFormatOptions } from "../Formatter.js";
import { parse, toSExprMany, type SExpr } from "../reader/index.js";
import { headSym } from "../reader/types.js";
import {
  buildDefinitionIndexFromSources,
  type BuildDefinitionIndexOptions,
  type DefinitionIndexSource,
} from "./index-builder.js";
import type {
  DefHash,
  DefinitionIndex,
  DefinitionRecord,
  PresentationMeta,
  StoreDefinitionKind,
} from "./types.js";

// ---------------------------------------------------------------------------
// Structurally compatible Stage 2–3 transaction contract types (`tx-types.ts`)
// ---------------------------------------------------------------------------

export type SnapshotHash = string;
export type PolicySetHash = string;
export type QualifiedName = string;
export type OperationClass = "impl-edit" | "requirement-edit";

/**
 * Minimal snapshot view required for projection (structurally compatible with
 * `Snapshot` in `tx-types.ts`).
 */
export interface ProjectionSnapshot {
  readonly hash: SnapshotHash;
  readonly parent: SnapshotHash | null;
  readonly bindings: ReadonlyMap<QualifiedName, DefHash>;
  readonly metadata: ReadonlyMap<DefHash, PresentationMeta>;
  readonly policies?: PolicySetHash | undefined;
  readonly languageProfile?: string | undefined;
}

export type TransactionOp =
  | {
      readonly kind: "add";
      readonly qualifiedName: QualifiedName;
      readonly source?: string | undefined;
      readonly record?: DefinitionRecord | undefined;
      readonly meta?: Partial<PresentationMeta> | undefined;
    }
  | {
      readonly kind: "update";
      readonly qualifiedName: QualifiedName;
      readonly source?: string | undefined;
      readonly record?: DefinitionRecord | undefined;
      readonly meta?: Partial<PresentationMeta> | undefined;
    }
  | {
      readonly kind: "rename";
      readonly from: QualifiedName;
      readonly to: QualifiedName;
      readonly displayName?: string | undefined;
    }
  | {
      readonly kind: "remove";
      readonly qualifiedName: QualifiedName;
    }
  | {
      readonly kind: "move";
      readonly from: QualifiedName;
      readonly toModuleId: string;
      readonly newName?: string | undefined;
    };

export interface TransactionProposal {
  readonly branch: string;
  readonly baseSnapshot: SnapshotHash;
  readonly operationClass: OperationClass;
  readonly operations: readonly TransactionOp[];
  readonly message?: string | undefined;
  readonly author?: string | undefined;
  readonly onInterfaceChange?: "reject" | "staging-branch" | "add-only" | undefined;
  readonly stagingBranchName?: string | undefined;
  readonly coexistenceSuffix?: string | undefined;
  readonly approvedRequirementEdit?: boolean | undefined;
  readonly waiveEvolution?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Projection option & result types
// ---------------------------------------------------------------------------

export interface ProjectedModuleSource extends DefinitionIndexSource {
  readonly id: string;
  readonly source: string;
}

export interface ExportSnapshotOptions {
  /** Explicit module ordering; unlisted modules follow in deterministic lexicographical order. */
  readonly moduleOrder?: readonly string[] | undefined;
  /**
   * Optional original authored module sources (e.g. from disk or a prior export).
   * When provided:
   * - Modules whose definitions are completely unchanged are emitted verbatim
   *   (preserving file-level comments, blank lines, formatting, and exact spans).
   * - Modules with partial edits splice only changed/added/removed definitions
   *   while leaving unchanged definitions and surrounding comments untouched.
   */
  readonly originalSources?:
    | ReadonlyMap<string, string>
    | readonly DefinitionIndexSource[]
    | undefined;
  /** Formatting options passed to the Lisp pretty-printer for synthesized definitions. */
  readonly formatOptions?: LispFormatOptions | undefined;
  /** Separator between definitions when emitting without an original module template. Default: `"\n\n"`. */
  readonly separator?: string | undefined;
  /**
   * Rewrite free symbol references in callers when a dependency was renamed in
   * `snapshot.bindings` without rehashing the caller. Default: `true`.
   */
  readonly rewriteRenamedReferences?: boolean | undefined;
}

export interface ImportSourcesOptions {
  /** Target branch name for the returned `TransactionProposal`. Default: `"main"`. */
  readonly branch?: string | undefined;
  /** Optional commit message attached to the proposal. */
  readonly message?: string | undefined;
  /** Optional author attached to the proposal. */
  readonly author?: string | undefined;
  /** Explicit override for `operationClass`; auto-classified when omitted. */
  readonly operationClass?: OperationClass | undefined;
  /** Policy / approval flags forwarded into `TransactionProposal`. */
  readonly approvedRequirementEdit?: boolean | undefined;
  readonly waiveEvolution?: boolean | undefined;
  readonly onInterfaceChange?: "reject" | "staging-branch" | "add-only" | undefined;
  readonly stagingBranchName?: string | undefined;
  readonly coexistenceSuffix?: string | undefined;
  /** Options forwarded to `buildDefinitionIndexFromSources`. */
  readonly indexOptions?: BuildDefinitionIndexOptions | undefined;
  /**
   * Emit `update` operations for presentation-only edits (same `DefHash` and
   * `qualifiedName`, e.g. formatting/comment/docstring edits). Defaults to
   * `false` so semantically unchanged definitions produce minimal deltas.
   */
  readonly includeMetadataOnlyUpdates?: boolean | undefined;
  /** Additional definition kinds classified as `"requirement-edit"`. */
  readonly requirementKinds?: readonly StoreDefinitionKind[] | undefined;
  /** Additional top-level form heads classified as `"requirement-edit"`. */
  readonly requirementFormHeads?: readonly string[] | undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const REQUIREMENT_FORM_HEADS = new Set([
  "test",
  "law",
  "invariant",
  "property",
  "prop",
  "contract",
  "spec",
  "verify",
  "assert",
  "axiom",
  "lemma",
  "theorem",
  "refinement",
  "refine",
  "precondition",
  "postcondition",
  "requires",
  "ensures",
]);

const REFINEMENT_HEADS = new Set([
  "refine",
  "refined",
  "where",
  "law",
  "invariant",
  "property",
  "verify",
  "requires",
  "ensures",
  "contract",
  "assert",
]);

const REFINEMENT_KEYWORDS = new Set([
  ":where",
  ":refine",
  ":invariant",
  ":requires",
  ":ensures",
  ":contract",
  ":constraints",
]);

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function splitQualifiedName(
  qualifiedName: QualifiedName,
  fallbackModuleId = "main.lisp",
): { readonly moduleId: string; readonly name: string } {
  const sep = qualifiedName.indexOf("::");
  if (sep < 0) {
    return { moduleId: fallbackModuleId, name: qualifiedName };
  }
  return {
    moduleId: qualifiedName.slice(0, sep),
    name: qualifiedName.slice(sep + 2),
  };
}

function escapeLispString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

interface SpanEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

function applySpanEdits(source: string, edits: readonly SpanEdit[]): string {
  if (edits.length === 0) return source;
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let result = source;
  let lastStart = result.length + 1;
  for (const edit of sorted) {
    if (edit.end > lastStart) continue; // skip overlapping edits defensively
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    lastStart = edit.start;
  }
  return result;
}

interface DeclarationHeaderInfo {
  readonly name: string;
  readonly kind: StoreDefinitionKind;
  readonly nameSpan: { readonly start: number; readonly end: number };
  readonly isStringName: boolean;
}

/**
 * Inspect a top-level S-expression to locate its declared name and the exact
 * character span of the name token for lossless in-place renaming.
 */
function inspectDeclarationHeader(
  expr: SExpr,
  fallbackIndex: number,
): DeclarationHeaderInfo | undefined {
  if (expr._tag !== "List" || expr.items.length < 2) return undefined;
  const h = headSym(expr);
  if (!h) return undefined;
  const second = expr.items[1]!;

  const symOrHead = (
    kind: StoreDefinitionKind,
    allowListHead: boolean,
  ): DeclarationHeaderInfo | undefined => {
    if (second._tag === "Sym") {
      return {
        name: second.name,
        kind,
        nameSpan: { start: second.loc.start, end: second.loc.end },
        isStringName: false,
      };
    }
    if (allowListHead && second._tag === "List" && second.items[0]?._tag === "Sym") {
      const target = second.items[0];
      return {
        name: target.name,
        kind,
        nameSpan: { start: target.loc.start, end: target.loc.end },
        isStringName: false,
      };
    }
    return undefined;
  };

  switch (h) {
    case "define":
    case "__operation":
      return symOrHead("define", true);
    case "type":
    case "__sum-type":
      return symOrHead("type", true);
    case "error":
      return symOrHead("error", true);
    case "service":
    case "__service":
      return symOrHead("service", false);
    case "layer":
    case "__layer":
      return symOrHead("layer", false);
    case "class":
    case "typeclass":
    case "__typeclass":
      return symOrHead("class", true);
    case "instance": {
      if (second._tag === "List" && second.items[0]?._tag === "Sym") {
        const target = second.items[0];
        return {
          name: `instance:${target.name}#${fallbackIndex}`,
          kind: "instance",
          nameSpan: { start: target.loc.start, end: target.loc.end },
          isStringName: false,
        };
      }
      return {
        name: `instance#${fallbackIndex}`,
        kind: "instance",
        nameSpan: { start: second.loc.start, end: second.loc.end },
        isStringName: false,
      };
    }
    case "form":
      return symOrHead("form", true);
    case "macro":
    case "__macro":
      return symOrHead("macro", true);
    case "test": {
      if (second._tag === "Str") {
        return {
          name: second.value,
          kind: "test",
          nameSpan: { start: second.loc.start, end: second.loc.end },
          isStringName: true,
        };
      }
      if (second._tag === "Sym") {
        return {
          name: second.name,
          kind: "test",
          nameSpan: { start: second.loc.start, end: second.loc.end },
          isStringName: false,
        };
      }
      return undefined;
    }
    default: {
      // DSL / custom top-level forms (e.g. `(law commutativity ...)`).
      if (second._tag === "Sym") {
        return {
          name: second.name,
          kind: "declaration",
          nameSpan: { start: second.loc.start, end: second.loc.end },
          isStringName: false,
        };
      }
      if (second._tag === "Str") {
        return {
          name: second.value,
          kind: "declaration",
          nameSpan: { start: second.loc.start, end: second.loc.end },
          isStringName: true,
        };
      }
      return undefined;
    }
  }
}

/** Collect parameter symbol names from a vector/list of parameters or typed binders. */
function collectParamBinders(node: SExpr | undefined, out: Set<string>): void {
  if (!node) return;
  if (node._tag === "Sym") {
    if (!node.name.startsWith(":") && node.name !== "_") out.add(node.name);
    return;
  }
  if (node._tag === "Vector" || node._tag === "List") {
    for (let i = 0; i < node.items.length; i++) {
      const item = node.items[i]!;
      if (item._tag === "Sym") {
        if (item.name === ":" && i + 1 < node.items.length) {
          // Typed binder pattern `(: x Int)` -> skip type position
          const next = node.items[i + 1];
          if (next?._tag === "Sym") out.add(next.name);
          break;
        }
        if (!item.name.startsWith(":") && item.name !== "_") {
          out.add(item.name);
        }
      } else if (item._tag === "List" && item.items[0]?._tag === "Sym" && item.items[0].name === ":") {
        if (item.items[1]?._tag === "Sym") out.add(item.items[1].name);
      }
    }
  }
}

/** Collect variable binders introduced by a `match` pattern. */
function collectPatternBinders(pattern: SExpr, out: Set<string>): void {
  if (pattern._tag === "Sym") {
    if (
      pattern.name !== "_" &&
      !pattern.name.startsWith(":") &&
      !/^[A-Z]/.test(pattern.name)
    ) {
      out.add(pattern.name);
    }
    return;
  }
  if (pattern._tag === "List") {
    // Constructor pattern `(Some x)` -> skip constructor head at index 0
    for (let i = 1; i < pattern.items.length; i++) {
      collectPatternBinders(pattern.items[i]!, out);
    }
    return;
  }
  if (pattern._tag === "Vector") {
    for (const item of pattern.items) collectPatternBinders(item, out);
    return;
  }
  if (pattern._tag === "Map") {
    for (const [, val] of pattern.pairs) collectPatternBinders(val, out);
  }
}

/**
 * Walk a parsed `SExpr` and collect span edits replacing free `Sym` references
 * matching `renames` (`oldName -> newName`), respecting lexical shadowing.
 */
function collectFreeReferenceEdits(
  expr: SExpr,
  renames: ReadonlyMap<string, string>,
  bound: ReadonlySet<string>,
  skipSpan: { readonly start: number; readonly end: number } | undefined,
  edits: SpanEdit[],
): void {
  if (renames.size === 0) return;

  switch (expr._tag) {
    case "Sym": {
      if (
        skipSpan &&
        expr.loc.start === skipSpan.start &&
        expr.loc.end === skipSpan.end
      ) {
        return;
      }
      if (!bound.has(expr.name)) {
        const replacement = renames.get(expr.name);
        if (replacement && replacement !== expr.name) {
          edits.push({ start: expr.loc.start, end: expr.loc.end, replacement });
        }
      }
      return;
    }
    case "Num":
    case "Str":
    case "Bool":
    case "Error":
      return;
    case "Vector":
    case "Set": {
      for (const item of expr.items) {
        collectFreeReferenceEdits(item, renames, bound, skipSpan, edits);
      }
      return;
    }
    case "Map": {
      for (const [k, v] of expr.pairs) {
        collectFreeReferenceEdits(k, renames, bound, skipSpan, edits);
        collectFreeReferenceEdits(v, renames, bound, skipSpan, edits);
      }
      return;
    }
    case "List": {
      if (expr.items.length === 0) return;
      const h = headSym(expr);

      // Quoted data: do not rewrite symbols inside quote
      if (h === "quote") return;

      // (define (f x y) body...)
      if (h === "define" && expr.items.length >= 3) {
        const second = expr.items[1]!;
        if (second._tag === "List" && second.items[0]?._tag === "Sym") {
          const nextBound = new Set(bound);
          for (let i = 1; i < second.items.length; i++) {
            collectParamBinders(second.items[i], nextBound);
          }
          for (let i = 2; i < expr.items.length; i++) {
            collectFreeReferenceEdits(expr.items[i]!, renames, nextBound, skipSpan, edits);
          }
          return;
        }
        // (define x expr)
        for (let i = 2; i < expr.items.length; i++) {
          collectFreeReferenceEdits(expr.items[i]!, renames, bound, skipSpan, edits);
        }
        return;
      }

      // (fn [x y] body...) / (lambda [x y] body...)
      if ((h === "fn" || h === "lambda") && expr.items.length >= 3) {
        const nextBound = new Set(bound);
        collectParamBinders(expr.items[1], nextBound);
        for (let i = 2; i < expr.items.length; i++) {
          collectFreeReferenceEdits(expr.items[i]!, renames, nextBound, skipSpan, edits);
        }
        return;
      }

      // (let [x e1 y e2] body...) / (do [x e1 y e2] body...)
      if ((h === "let" || h === "do" || h === "effect/do") && expr.items.length >= 3) {
        const bindingsNode = expr.items[1]!;
        const nextBound = new Set(bound);
        if (bindingsNode._tag === "Vector" || bindingsNode._tag === "List") {
          for (let i = 0; i + 1 < bindingsNode.items.length; i += 2) {
            const binder = bindingsNode.items[i]!;
            const rhs = bindingsNode.items[i + 1]!;
            collectFreeReferenceEdits(rhs, renames, nextBound, skipSpan, edits);
            collectParamBinders(binder, nextBound);
          }
        }
        for (let i = 2; i < expr.items.length; i++) {
          collectFreeReferenceEdits(expr.items[i]!, renames, nextBound, skipSpan, edits);
        }
        return;
      }

      // (match scrutinee (pat1 body1) (pat2 body2) ...)
      if (h === "match" && expr.items.length >= 2) {
        collectFreeReferenceEdits(expr.items[1]!, renames, bound, skipSpan, edits);
        for (let i = 2; i < expr.items.length; i++) {
          const arm = expr.items[i]!;
          if (arm._tag === "List" && arm.items.length >= 2) {
            const nextBound = new Set(bound);
            collectPatternBinders(arm.items[0]!, nextBound);
            for (let j = 1; j < arm.items.length; j++) {
              collectFreeReferenceEdits(arm.items[j]!, renames, nextBound, skipSpan, edits);
            }
          } else {
            collectFreeReferenceEdits(arm, renames, bound, skipSpan, edits);
          }
        }
        return;
      }

      // Generic list: visit all elements
      for (const item of expr.items) {
        collectFreeReferenceEdits(item, renames, bound, skipSpan, edits);
      }
    }
  }
}

/**
 * Rewrite a definition's authored source when its bound name or any of its
 * referenced dependencies were renamed, preserving all comments and formatting.
 */
function rewriteAuthoredSource(
  authoredSource: string,
  targetLocalName: string,
  depRenames: ReadonlyMap<string, string>,
): string {
  const parsed = parse(authoredSource);
  const exprs = toSExprMany(parsed.redTree, "<authored>");
  const top = exprs[0];
  if (!top) return authoredSource;

  const header = inspectDeclarationHeader(top, 0);
  const edits: SpanEdit[] = [];
  let skipNameSpan: { readonly start: number; readonly end: number } | undefined;

  if (header) {
    skipNameSpan = header.nameSpan;
    if (header.name !== targetLocalName) {
      const replacement = header.isStringName
        ? `"${escapeLispString(targetLocalName)}"`
        : targetLocalName;
      edits.push({
        start: header.nameSpan.start,
        end: header.nameSpan.end,
        replacement,
      });
    }
  }

  if (depRenames.size > 0) {
    collectFreeReferenceEdits(top, depRenames, new Set(), skipNameSpan, edits);
  }

  if (edits.length === 0) return authoredSource;
  return applySpanEdits(authoredSource, edits);
}

/**
 * Synthesize cleanly formatted `.lisp` source for a definition that has no
 * stored `PresentationMeta.authoredSource`.
 */
function synthesizeDefinitionSource(
  localName: string,
  record: DefinitionRecord | undefined,
  meta: PresentationMeta | undefined,
  formatOptions: LispFormatOptions | undefined,
): string {
  const kind: StoreDefinitionKind = record?.kind ?? "define";
  const doc = meta?.docstring;

  let raw: string;
  switch (kind) {
    case "type":
      raw = `(type ${localName} {})`;
      break;
    case "error":
      raw = `(error ${localName} {})`;
      break;
    case "service":
      raw = `(service ${localName})`;
      break;
    case "layer":
      raw = `(layer ${localName} {})`;
      break;
    case "class":
      raw = `(class (${localName} a))`;
      break;
    case "form":
      raw = doc
        ? `(form (${localName} :doc "${escapeLispString(doc)}") {})`
        : `(form (${localName}) {})`;
      break;
    case "macro":
      raw = `(macro (${localName}) {})`;
      break;
    case "test":
      raw = `(test "${escapeLispString(localName)}" true)`;
      break;
    case "define":
    default: {
      const body = doc ? `"${escapeLispString(doc)}"` : "unit";
      raw = `(define ${localName} ${body})`;
      break;
    }
  }

  const parsed = parse(raw);
  const exprs = toSExprMany(parsed.redTree, "<synth>");
  const formatted = exprs[0] ? formatSExpr(exprs[0], formatOptions) : raw;
  const headerComments: string[] = [];
  if (doc && kind !== "form" && kind !== "define") {
    headerComments.push(`; ${doc}`);
  }
  if (record?.signature) {
    headerComments.push(`; signature: ${record.signature}`);
  }
  return headerComments.length > 0 ? `${headerComments.join("\n")}\n${formatted}` : formatted;
}

function normalizeOriginalSources(
  input: ExportSnapshotOptions["originalSources"],
): ReadonlyMap<string, string> {
  if (!input) return new Map();
  if (input instanceof Map) return input;
  const map = new Map<string, string>();
  for (const item of input as readonly DefinitionIndexSource[]) {
    map.set(item.id, item.source);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Public API 1: exportSnapshotToSources
// ---------------------------------------------------------------------------

interface ExportEntry {
  readonly qualifiedName: QualifiedName;
  readonly moduleId: string;
  readonly localName: string;
  readonly defHash: DefHash;
  readonly record: DefinitionRecord | undefined;
  readonly meta: PresentationMeta | undefined;
}

/**
 * Project a snapshot into deterministic `.lisp` module sources (`{ id, source }[]`).
 *
 * - Unchanged definitions preserve their authored formatting, comments, docstrings,
 *   and spans verbatim.
 * - Renamed definitions update their declaration header and (by default) free
 *   caller references without losing surrounding comments or formatting.
 * - Synthesized definitions without `authoredSource` emit cleanly formatted `.lisp`.
 */
export function exportSnapshotToSources(
  snapshot: ProjectionSnapshot,
  index: DefinitionIndex,
  options?: ExportSnapshotOptions,
): ProjectedModuleSource[] {
  const separator = options?.separator ?? "\n\n";
  const rewriteRefs = options?.rewriteRenamedReferences !== false;
  const originalSources = normalizeOriginalSources(options?.originalSources);

  // 1. Collect all snapshot bindings and group by moduleId.
  const entriesByModule = new Map<string, ExportEntry[]>();
  const currentNamesByHash = new Map<DefHash, Set<string>>();
  const allEntries: ExportEntry[] = [];

  for (const [qualifiedName, defHash] of snapshot.bindings) {
    const record = index.definitions.get(defHash);
    const meta = snapshot.metadata.get(defHash) ?? index.metadata.get(defHash) ?? record?.meta;
    const { moduleId, name: localName } = splitQualifiedName(
      qualifiedName,
      meta?.moduleId ?? record?.moduleId ?? "main.lisp",
    );

    const entry: ExportEntry = {
      qualifiedName,
      moduleId,
      localName,
      defHash,
      record,
      meta,
    };
    allEntries.push(entry);

    let modList = entriesByModule.get(moduleId);
    if (!modList) {
      modList = [];
      entriesByModule.set(moduleId, modList);
    }
    modList.push(entry);

    let names = currentNamesByHash.get(defHash);
    if (!names) {
      names = new Set<string>();
      currentNamesByHash.set(defHash, names);
    }
    names.add(localName);
  }

  // 2. Detect O(1) renamed definitions (`defHash` -> `{ oldName, newName }`)
  //    so callers that were not rehashed still project valid references.
  const renameInfoByHash = new Map<DefHash, { readonly oldName: string; readonly newName: string }>();
  if (rewriteRefs) {
    for (const entry of allEntries) {
      const originalName = entry.record?.name ?? entry.meta?.displayName;
      if (!originalName || originalName === entry.localName) continue;
      const boundNames = currentNamesByHash.get(entry.defHash);
      // Only rewrite callers if the original name is no longer bound to this hash
      // and there is a single unambiguous new name.
      if (boundNames && !boundNames.has(originalName) && boundNames.size === 1) {
        renameInfoByHash.set(entry.defHash, {
          oldName: originalName,
          newName: entry.localName,
        });
      }
    }
  }

  // 3. Render each entry's source (preserving authoredSource verbatim when unchanged).
  const renderedByQualified = new Map<QualifiedName, { readonly source: string; readonly modified: boolean }>();

  for (const entry of allEntries) {
    const authored = entry.meta?.authoredSource;
    const depRenames = new Map<string, string>();
    if (rewriteRefs && entry.record) {
      for (const depHash of entry.record.dependencies) {
        const rename = renameInfoByHash.get(depHash);
        if (rename) depRenames.set(rename.oldName, rename.newName);
      }
      for (const formHash of entry.record.formDependencies) {
        const rename = renameInfoByHash.get(formHash);
        if (rename) depRenames.set(rename.oldName, rename.newName);
      }
    }

    if (authored !== undefined) {
      const originalDeclared =
        entry.record?.name ?? entry.meta?.displayName ?? entry.localName;
      const needsHeaderRewrite = originalDeclared !== entry.localName;
      const needsRefRewrite = depRenames.size > 0;

      if (!needsHeaderRewrite && !needsRefRewrite) {
        renderedByQualified.set(entry.qualifiedName, { source: authored, modified: false });
      } else {
        const rewritten = rewriteAuthoredSource(authored, entry.localName, depRenames);
        renderedByQualified.set(entry.qualifiedName, {
          source: rewritten,
          modified: rewritten !== authored,
        });
      }
    } else {
      const synthesized = synthesizeDefinitionSource(
        entry.localName,
        entry.record,
        entry.meta,
        options?.formatOptions,
      );
      renderedByQualified.set(entry.qualifiedName, { source: synthesized, modified: true });
    }
  }

  // 4. Determine deterministic module ordering.
  const moduleIds = [...entriesByModule.keys()];
  const orderRank = new Map<string, number>();
  if (options?.moduleOrder) {
    options.moduleOrder.forEach((id, idx) => {
      if (!orderRank.has(id)) orderRank.set(id, idx);
    });
  }
  moduleIds.sort((a, b) => {
    const ra = orderRank.get(a);
    const rb = orderRank.get(b);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return compareStrings(a, b);
  });

  // 5. Assemble each module source.
  const results: ProjectedModuleSource[] = [];

  for (const moduleId of moduleIds) {
    const entries = entriesByModule.get(moduleId)!;
    const origSource = originalSources.get(moduleId);

    if (origSource !== undefined) {
      const projected = projectModuleWithOriginalSource(
        moduleId,
        origSource,
        entries,
        renderedByQualified,
        separator,
      );
      results.push({ id: moduleId, source: projected });
      continue;
    }

    // Sort definitions by original span start (when from the same module), then by name & hash.
    const sortedEntries = [...entries].sort((a, b) => {
      const aSpan = a.meta?.span?.sourceId === moduleId ? a.meta.span : undefined;
      const bSpan = b.meta?.span?.sourceId === moduleId ? b.meta.span : undefined;
      if (aSpan && bSpan) {
        if (aSpan.start !== bSpan.start) return aSpan.start - bSpan.start;
        if (aSpan.end !== bSpan.end) return aSpan.end - bSpan.end;
      } else if (aSpan) {
        return -1;
      } else if (bSpan) {
        return 1;
      }
      const byName = compareStrings(a.localName, b.localName);
      if (byName !== 0) return byName;
      return compareStrings(a.defHash, b.defHash);
    });

    const renderedParts = sortedEntries.map(
      (entry) => renderedByQualified.get(entry.qualifiedName)!.source,
    );
    const source = renderedParts.length > 0 ? `${renderedParts.join(separator)}\n` : "";
    results.push({ id: moduleId, source });
  }

  return results;
}

/**
 * Project a module using its original source as a lossless template:
 * - If every declaration is unchanged, returns `origSource` byte-for-byte.
 * - Otherwise, splices only modified/renamed/removed declarations in place
 *   and appends new/moved-in declarations, leaving unchanged declarations and
 *   surrounding comments untouched.
 */
function projectModuleWithOriginalSource(
  moduleId: string,
  origSource: string,
  entries: readonly ExportEntry[],
  renderedByQualified: ReadonlyMap<QualifiedName, { readonly source: string; readonly modified: boolean }>,
  separator: string,
): string {
  const parsed = parse(origSource);
  const topExprs = toSExprMany(parsed.redTree, moduleId);

  const origDecls: Array<{
    readonly name: string;
    readonly start: number;
    readonly end: number;
    readonly text: string;
  }> = [];

  topExprs.forEach((expr, idx) => {
    const header = inspectDeclarationHeader(expr, idx);
    if (!header) return;
    origDecls.push({
      name: header.name,
      start: expr.loc.start,
      end: expr.loc.end,
      text: origSource.slice(expr.loc.start, expr.loc.end),
    });
  });

  const entryByLocalName = new Map<string, ExportEntry>();
  for (const entry of entries) {
    entryByLocalName.set(entry.localName, entry);
  }

  const placedQualified = new Set<QualifiedName>();
  const edits: SpanEdit[] = [];
  let anyChange = false;

  for (const decl of origDecls) {
    // 1. Direct match by name
    const direct = entryByLocalName.get(decl.name);
    if (direct && !placedQualified.has(direct.qualifiedName)) {
      placedQualified.add(direct.qualifiedName);
      const rendered = renderedByQualified.get(direct.qualifiedName)!;
      if (rendered.source !== decl.text) {
        anyChange = true;
        edits.push({ start: decl.start, end: decl.end, replacement: rendered.source });
      }
      continue;
    }

    // 2. Match by original span or original name (in-place rename)
    const renamed = entries.find((e) => {
      if (placedQualified.has(e.qualifiedName)) return false;
      const span = e.meta?.span;
      if (span && span.sourceId === moduleId && span.start === decl.start && span.end === decl.end) {
        return true;
      }
      const origName = e.record?.name ?? e.meta?.displayName;
      return origName === decl.name;
    });

    if (renamed) {
      placedQualified.add(renamed.qualifiedName);
      const rendered = renderedByQualified.get(renamed.qualifiedName)!;
      if (rendered.source !== decl.text) {
        anyChange = true;
        edits.push({ start: decl.start, end: decl.end, replacement: rendered.source });
      }
      continue;
    }

    // 3. Declaration was removed or moved out of this module
    anyChange = true;
    let removeStart = decl.start;
    let removeEnd = decl.end;
    // Consume trailing newline(s) cleanly without eating comments on other lines
    while (removeEnd < origSource.length && origSource[removeEnd] === "\n") {
      removeEnd++;
      if (removeEnd - decl.end >= 2) break;
    }
    if (removeStart > 0 && origSource[removeStart - 1] === "\n" && removeEnd === origSource.length) {
      removeStart--;
    }
    edits.push({ start: removeStart, end: removeEnd, replacement: "" });
  }

  // Remaining unplaced entries are newly added or moved into this module
  const unplaced = entries
    .filter((e) => !placedQualified.has(e.qualifiedName))
    .sort((a, b) => compareStrings(a.localName, b.localName) || compareStrings(a.defHash, b.defHash));

  if (!anyChange && unplaced.length === 0) {
    // 100% unchanged: return exact original bytes verbatim!
    return origSource;
  }

  let updated = applySpanEdits(origSource, edits);
  if (unplaced.length > 0) {
    const appended = unplaced
      .map((e) => renderedByQualified.get(e.qualifiedName)!.source)
      .join(separator);
    const trimmedEnd = updated.trimEnd();
    updated = trimmedEnd.length > 0 ? `${trimmedEnd}${separator}${appended}\n` : `${appended}\n`;
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Requirement-edit vs impl-edit classification
// ---------------------------------------------------------------------------

function sexprContainsRefinement(expr: SExpr): boolean {
  switch (expr._tag) {
    case "Sym":
      return REFINEMENT_KEYWORDS.has(expr.name);
    case "List": {
      const h = headSym(expr);
      if (h && REFINEMENT_HEADS.has(h)) return true;
      return expr.items.some(sexprContainsRefinement);
    }
    case "Vector":
    case "Set":
      return expr.items.some(sexprContainsRefinement);
    case "Map":
      return expr.pairs.some(([k, v]) => sexprContainsRefinement(k) || sexprContainsRefinement(v));
    default:
      return false;
  }
}

/**
 * Determine whether a definition represents a test, verification law, or
 * refined contract (whose modification is classified as `"requirement-edit"`).
 */
export function isRequirementDefinition(
  record: DefinitionRecord | undefined,
  meta?: PresentationMeta | undefined,
  options?: Pick<ImportSourcesOptions, "requirementKinds" | "requirementFormHeads">,
): boolean {
  if (record) {
    if (record.kind === "test") return true;
    if (options?.requirementKinds?.includes(record.kind)) return true;
  }

  const authored = meta?.authoredSource ?? record?.meta.authoredSource;
  if (!authored) return false;

  const parsed = parse(authored);
  const exprs = toSExprMany(parsed.redTree, "<classify>");
  const top = exprs[0];
  if (!top || top._tag !== "List") return false;

  const h = headSym(top);
  if (h) {
    if (REQUIREMENT_FORM_HEADS.has(h)) return true;
    if (options?.requirementFormHeads?.includes(h)) return true;
  }

  // Refined contracts: type/error/service/define forms containing refinement/contract clauses
  if (sexprContainsRefinement(top)) {
    return true;
  }

  return false;
}

/**
 * Classify a set of transaction operations as `"requirement-edit"` if any
 * operation adds, updates, removes, renames, or moves a `test`, refined
 * contract, or verification law; otherwise `"impl-edit"`.
 */
export function classifyOperationClass(
  operations: readonly TransactionOp[],
  baseSnapshot: ProjectionSnapshot,
  baseIndex: DefinitionIndex,
  editedIndex: DefinitionIndex,
  options?: Pick<ImportSourcesOptions, "requirementKinds" | "requirementFormHeads">,
): OperationClass {
  const lookupBase = (
    qName: QualifiedName,
  ): { record?: DefinitionRecord | undefined; meta?: PresentationMeta | undefined } => {
    const hash = baseSnapshot.bindings.get(qName);
    if (!hash) return {};
    const record = baseIndex.definitions.get(hash);
    const meta = baseSnapshot.metadata.get(hash) ?? baseIndex.metadata.get(hash) ?? record?.meta;
    return { record, meta };
  };

  const lookupEdited = (
    qName: QualifiedName,
  ): { record?: DefinitionRecord | undefined; meta?: PresentationMeta | undefined } => {
    const hash = editedIndex.bindings.get(qName);
    if (!hash) return {};
    const record = editedIndex.definitions.get(hash);
    const meta = editedIndex.metadata.get(hash) ?? record?.meta;
    return { record, meta };
  };

  for (const op of operations) {
    switch (op.kind) {
      case "add": {
        const edited = lookupEdited(op.qualifiedName);
        const rec = op.record ?? edited.record;
        const meta = (op.meta ? { ...edited.meta, ...op.meta } : edited.meta) as
          | PresentationMeta
          | undefined;
        if (isRequirementDefinition(rec, meta, options)) return "requirement-edit";
        break;
      }
      case "update": {
        const base = lookupBase(op.qualifiedName);
        const edited = lookupEdited(op.qualifiedName);
        const rec = op.record ?? edited.record;
        const meta = (op.meta ? { ...edited.meta, ...op.meta } : edited.meta) as
          | PresentationMeta
          | undefined;
        if (
          isRequirementDefinition(base.record, base.meta, options) ||
          isRequirementDefinition(rec, meta, options)
        ) {
          return "requirement-edit";
        }
        break;
      }
      case "remove": {
        const base = lookupBase(op.qualifiedName);
        if (isRequirementDefinition(base.record, base.meta, options)) {
          return "requirement-edit";
        }
        break;
      }
      case "rename": {
        const base = lookupBase(op.from);
        const edited = lookupEdited(op.to);
        if (
          isRequirementDefinition(base.record, base.meta, options) ||
          isRequirementDefinition(edited.record, edited.meta, options)
        ) {
          return "requirement-edit";
        }
        break;
      }
      case "move": {
        const base = lookupBase(op.from);
        const targetName = op.newName ?? splitQualifiedName(op.from).name;
        const edited = lookupEdited(`${op.toModuleId}::${targetName}`);
        if (
          isRequirementDefinition(base.record, base.meta, options) ||
          isRequirementDefinition(edited.record, edited.meta, options)
        ) {
          return "requirement-edit";
        }
        break;
      }
    }
  }

  return "impl-edit";
}

// ---------------------------------------------------------------------------
// Public API 2: importSourcesAsTransaction
// ---------------------------------------------------------------------------

interface BindingEntry {
  readonly qualifiedName: QualifiedName;
  readonly moduleId: string;
  readonly name: string;
  readonly hash: DefHash;
  readonly record: DefinitionRecord | undefined;
  readonly meta: PresentationMeta | undefined;
}

const DEF_HASH_PATTERN = /def:v1:[0-9a-f]{64}/g;

/**
 * Determine whether `editedRecord` differs from `baseRecord` solely because
 * one or more of its referenced dependency `DefHash`es changed upstream
 * (a dependency hash ripple), while the definition's own canonical body,
 * signature, and kind remained identical.
 */
function isDependencyRippleOnly(
  baseRecord: DefinitionRecord | undefined,
  editedRecord: DefinitionRecord | undefined,
  hashRemap: ReadonlyMap<DefHash, DefHash>,
): boolean {
  if (!baseRecord || !editedRecord) return false;
  if (hashRemap.size === 0) return false;
  if (baseRecord.kind !== editedRecord.kind) return false;
  if (baseRecord.canonicalSignature !== editedRecord.canonicalSignature) return false;

  const remappedBase = baseRecord.canonicalForm.replace(
    DEF_HASH_PATTERN,
    (match) => hashRemap.get(match) ?? match,
  );
  if (remappedBase === editedRecord.canonicalForm) return true;

  // Fallback when `formDependencies` ordering changed after hash remapping.
  try {
    const a = JSON.parse(remappedBase) as Record<string, unknown>;
    const b = JSON.parse(editedRecord.canonicalForm) as Record<string, unknown>;
    if (Array.isArray(a.formDependencies)) a.formDependencies = [...a.formDependencies].sort();
    if (Array.isArray(b.formDependencies)) b.formDependencies = [...b.formDependencies].sort();
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Parse and index edited `.lisp` sources, diff them against `baseSnapshot` and
 * `baseIndex`, detect minimal `add`, `update`, `rename`, `remove`, and `move`
 * operations, automatically classify `test` / refined-contract / law changes as
 * `"requirement-edit"` vs `"impl-edit"`, and return a `TransactionProposal`
 * ready to submit through `TransactionalStore`.
 */
export function importSourcesAsTransaction(
  baseSnapshot: ProjectionSnapshot,
  baseIndex: DefinitionIndex,
  editedSources: readonly DefinitionIndexSource[],
  options?: ImportSourcesOptions,
): TransactionProposal {
  const languageProfile =
    options?.indexOptions?.languageProfile ??
    baseSnapshot.languageProfile ??
    baseIndex.languageProfile;

  const editedIndex = buildDefinitionIndexFromSources(editedSources, {
    ...options?.indexOptions,
    languageProfile,
  });

  // 1. Collect base bindings from `baseSnapshot.bindings`.
  const baseBindings = new Map<QualifiedName, BindingEntry>();
  for (const [qualifiedName, hash] of baseSnapshot.bindings) {
    const record = baseIndex.definitions.get(hash);
    const meta = baseSnapshot.metadata.get(hash) ?? baseIndex.metadata.get(hash) ?? record?.meta;
    const { moduleId, name } = splitQualifiedName(
      qualifiedName,
      meta?.moduleId ?? record?.moduleId ?? "main.lisp",
    );
    baseBindings.set(qualifiedName, {
      qualifiedName,
      moduleId,
      name,
      hash,
      record,
      meta,
    });
  }

  // 2. Collect edited bindings from `editedIndex.definitions`.
  const editedBindings = new Map<QualifiedName, BindingEntry>();
  for (const record of editedIndex.definitions.values()) {
    const meta = editedIndex.metadata.get(record.hash) ?? record.meta;
    editedBindings.set(record.qualifiedName, {
      qualifiedName: record.qualifiedName,
      moduleId: record.moduleId,
      name: record.name,
      hash: record.hash,
      record,
      meta,
    });
  }

  // Build hash remap table (`oldHash -> newHash`) across matching qualified names
  // so unchanged dependents whose hashes rippled due to an upstream edit are not
  // emitted as spurious `update` operations.
  const hashRemap = new Map<DefHash, DefHash>();
  for (const [qName, baseEntry] of baseBindings) {
    const editedEntry = editedBindings.get(qName);
    if (editedEntry && baseEntry.hash !== editedEntry.hash) {
      hashRemap.set(baseEntry.hash, editedEntry.hash);
    }
  }

  const renameOps: Array<Extract<TransactionOp, { kind: "rename" }>> = [];
  const moveOps: Array<Extract<TransactionOp, { kind: "move" }>> = [];
  const addOps: Array<Extract<TransactionOp, { kind: "add" }>> = [];
  const updateOps: Array<Extract<TransactionOp, { kind: "update" }>> = [];
  const removeOps: Array<Extract<TransactionOp, { kind: "remove" }>> = [];

  const disappeared: BindingEntry[] = [];
  const appeared: BindingEntry[] = [];

  // 3. Compare exact qualified-name matches first.
  for (const [qName, baseEntry] of baseBindings) {
    const editedEntry = editedBindings.get(qName);
    if (!editedEntry) {
      disappeared.push(baseEntry);
      continue;
    }

    const directlyChanged =
      baseEntry.hash !== editedEntry.hash &&
      !isDependencyRippleOnly(baseEntry.record, editedEntry.record, hashRemap);

    if (directlyChanged) {
      updateOps.push({
        kind: "update",
        qualifiedName: qName,
        ...(editedEntry.meta?.authoredSource !== undefined
          ? { source: editedEntry.meta.authoredSource }
          : {}),
        ...(editedEntry.record !== undefined ? { record: editedEntry.record } : {}),
        ...(editedEntry.meta !== undefined ? { meta: editedEntry.meta } : {}),
      });
    } else if (options?.includeMetadataOnlyUpdates === true) {
      const sourceChanged = baseEntry.meta?.authoredSource !== editedEntry.meta?.authoredSource;
      const docChanged = baseEntry.meta?.docstring !== editedEntry.meta?.docstring;
      if (sourceChanged || docChanged) {
        updateOps.push({
          kind: "update",
          qualifiedName: qName,
          ...(editedEntry.meta?.authoredSource !== undefined
            ? { source: editedEntry.meta.authoredSource }
            : {}),
          ...(editedEntry.record !== undefined ? { record: editedEntry.record } : {}),
          ...(editedEntry.meta !== undefined ? { meta: editedEntry.meta } : {}),
        });
      }
    }
  }

  for (const [qName, editedEntry] of editedBindings) {
    if (!baseBindings.has(qName)) {
      appeared.push(editedEntry);
    }
  }

  // Sort deterministically before pairing.
  disappeared.sort((a, b) => compareStrings(a.qualifiedName, b.qualifiedName));
  appeared.sort((a, b) => compareStrings(a.qualifiedName, b.qualifiedName));

  // 4. Match disappeared vs appeared by identical `DefHash` to detect `rename` & `move`.
  const matchedDisappeared = new Set<QualifiedName>();
  const matchedAppeared = new Set<QualifiedName>();

  // Pass 4a: Same-module rename (same DefHash, same moduleId, different name).
  for (const baseEntry of disappeared) {
    if (matchedDisappeared.has(baseEntry.qualifiedName)) continue;
    const match = appeared.find(
      (e) =>
        !matchedAppeared.has(e.qualifiedName) &&
        e.hash === baseEntry.hash &&
        e.moduleId === baseEntry.moduleId &&
        e.name !== baseEntry.name,
    );
    if (match) {
      matchedDisappeared.add(baseEntry.qualifiedName);
      matchedAppeared.add(match.qualifiedName);
      renameOps.push({
        kind: "rename",
        from: baseEntry.qualifiedName,
        to: match.qualifiedName,
        displayName: match.name,
      });
    }
  }

  // Pass 4b: Cross-module move (same DefHash, different moduleId; prefer same name first).
  for (const baseEntry of disappeared) {
    if (matchedDisappeared.has(baseEntry.qualifiedName)) continue;
    const sameNameMatch = appeared.find(
      (e) =>
        !matchedAppeared.has(e.qualifiedName) &&
        e.hash === baseEntry.hash &&
        e.moduleId !== baseEntry.moduleId &&
        e.name === baseEntry.name,
    );
    const anyMoveMatch =
      sameNameMatch ??
      appeared.find(
        (e) =>
          !matchedAppeared.has(e.qualifiedName) &&
          e.hash === baseEntry.hash &&
          e.moduleId !== baseEntry.moduleId,
      );
    if (anyMoveMatch) {
      matchedDisappeared.add(baseEntry.qualifiedName);
      matchedAppeared.add(anyMoveMatch.qualifiedName);
      moveOps.push({
        kind: "move",
        from: baseEntry.qualifiedName,
        toModuleId: anyMoveMatch.moduleId,
        ...(anyMoveMatch.name !== baseEntry.name ? { newName: anyMoveMatch.name } : {}),
      });
    }
  }

  // 5. Remaining disappeared -> `remove`; remaining appeared -> `add`.
  for (const baseEntry of disappeared) {
    if (matchedDisappeared.has(baseEntry.qualifiedName)) continue;
    removeOps.push({
      kind: "remove",
      qualifiedName: baseEntry.qualifiedName,
    });
  }

  for (const editedEntry of appeared) {
    if (matchedAppeared.has(editedEntry.qualifiedName)) continue;
    addOps.push({
      kind: "add",
      qualifiedName: editedEntry.qualifiedName,
      ...(editedEntry.meta?.authoredSource !== undefined
        ? { source: editedEntry.meta.authoredSource }
        : {}),
      ...(editedEntry.record !== undefined ? { record: editedEntry.record } : {}),
      ...(editedEntry.meta !== undefined ? { meta: editedEntry.meta } : {}),
    });
  }

  // Deterministic ordering of operations.
  renameOps.sort(
    (a, b) => compareStrings(a.from, b.from) || compareStrings(a.to, b.to),
  );
  moveOps.sort(
    (a, b) => compareStrings(a.from, b.from) || compareStrings(a.toModuleId, b.toModuleId),
  );
  addOps.sort((a, b) => compareStrings(a.qualifiedName, b.qualifiedName));
  updateOps.sort((a, b) => compareStrings(a.qualifiedName, b.qualifiedName));
  removeOps.sort((a, b) => compareStrings(a.qualifiedName, b.qualifiedName));

  const operations: TransactionOp[] = [
    ...renameOps,
    ...moveOps,
    ...addOps,
    ...updateOps,
    ...removeOps,
  ];

  const operationClass: OperationClass =
    options?.operationClass ??
    classifyOperationClass(operations, baseSnapshot, baseIndex, editedIndex, options);

  return {
    branch: options?.branch ?? "main",
    baseSnapshot: baseSnapshot.hash,
    operationClass,
    operations,
    ...(options?.message !== undefined ? { message: options.message } : {}),
    ...(options?.author !== undefined ? { author: options.author } : {}),
    ...(options?.onInterfaceChange !== undefined
      ? { onInterfaceChange: options.onInterfaceChange }
      : {}),
    ...(options?.stagingBranchName !== undefined
      ? { stagingBranchName: options.stagingBranchName }
      : {}),
    ...(options?.coexistenceSuffix !== undefined
      ? { coexistenceSuffix: options.coexistenceSuffix }
      : {}),
    ...(options?.approvedRequirementEdit !== undefined
      ? { approvedRequirementEdit: options.approvedRequirementEdit }
      : {}),
    ...(options?.waiveEvolution !== undefined
      ? { waiveEvolution: options.waiveEvolution }
      : {}),
  };
}
