/**
 * Transactional content-addressed codebase store (RFC 0029 Stage 2).
 *
 * Provides:
 * - Immutable content-addressed `Snapshot`s and mutable `BranchRef` pointers
 * - O(1) `rename` and `move` without rehashing or re-typechecking dependents
 * - Same-interface rebinding of dependents without re-typechecking their bodies
 * - Interface-change rejection listing exact affected dependent hashes/names,
 *   plus optional `"staging-branch"` and `"add-only"` coexistence modes
 * - Optimistic CAS concurrency on branch heads with disjoint auto-rebase and
 *   structured `ConflictReport`s on overlapping names/dependencies
 * - Pluggable `PolicyEvaluator` hook for Stage 3 branch policies
 * - `diffSnapshots(from, to)`
 *
 * Browser-safe: contains no Node-only imports.
 */

import { Effect, Layer } from "effect";
import type { JsonValue } from "../artifact/artifact.js";
import { canonicalJson, sha256 } from "../artifact/canonical-json.js";
import { parse, toSExprMany, type SExpr } from "../reader/index.js";
import { headSym } from "../reader/types.js";
import {
  InferContext,
  makeOwnedInferContext,
  type MakeInferContextOptions,
} from "../type/context.js";
import type { CoreExpr } from "../type/core-expr.js";
import { resetNodeIds } from "../type/core-expr.js";
import { inferProgram } from "../type/infer-program.js";
import { lowerProgram } from "../type/lower.js";
import type { TypeEnv } from "../type/substitution.js";
import type { Scheme } from "../type/types.js";
import { unifiedFormProvider } from "../type/unified-form-provider.js";
import {
  collectFreeRefsCoreExpr,
  hashDefinitionGroup,
  type DefinitionHashInput,
} from "./def-hash.js";
import {
  buildDefinitionIndexFromSources,
  createDefinitionIndex,
  type BuildDefinitionIndexOptions,
  type DefinitionIndexSource,
} from "./index-builder.js";
import { hashBranchPolicy } from "./policies.js";
import { findDependents, type EvidenceLookup } from "./queries.js";
import {
  SNAPSHOT_HASH_VERSION,
  type AffectedDependent,
  type BranchPolicy,
  type BranchRef,
  type ConflictEntry,
  type InterfaceImpact,
  type PolicyEvaluator,
  type PolicySetHash,
  type QualifiedName,
  type SerializedSnapshot,
  type Snapshot,
  type SnapshotBackend,
  type SnapshotDiff,
  type SnapshotDiffAdded,
  type SnapshotDiffRemoved,
  type SnapshotDiffRenamed,
  type SnapshotDiffUpdated,
  type SnapshotHash,
  type TransactionDiagnostic,
  type TransactionOp,
  type TransactionProposal,
  type TransactionResult,
} from "./tx-types.js";
import {
  DEFAULT_LANGUAGE_PROFILE,
  DEF_HASH_VERSION,
  type DefHash,
  type DefinitionIndex,
  type DefinitionRecord,
  type OpaqueBoundaryRef,
  type PresentationMeta,
  type StoreDefinitionKind,
} from "./types.js";

export * from "./tx-types.js";

export type DefinitionLookup =
  | ReadonlyMap<DefHash, DefinitionRecord>
  | ((hash: DefHash) => DefinitionRecord | undefined);

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function lookupDef(
  lookup: DefinitionLookup | undefined,
  hash: DefHash,
): DefinitionRecord | undefined {
  if (!lookup) return undefined;
  return typeof lookup === "function" ? lookup(hash) : lookup.get(hash);
}

/** Split a `QualifiedName` (`moduleId::localName`) into `{ moduleId, name }`. */
export function splitQualifiedName(qualifiedName: QualifiedName): {
  readonly moduleId: string;
  readonly name: string;
} {
  const idx = qualifiedName.lastIndexOf("::");
  if (idx < 0) {
    return { moduleId: "main", name: qualifiedName };
  }
  return {
    moduleId: qualifiedName.slice(0, idx),
    name: qualifiedName.slice(idx + 2),
  };
}

/** Format a `QualifiedName` from `moduleId` and local `name`. */
export function makeQualifiedName(moduleId: string, name: string): QualifiedName {
  return `${moduleId}::${name}`;
}

// ---------------------------------------------------------------------------
// Hashing & serialization for Snapshots and Policies
// ---------------------------------------------------------------------------

/** Compute deterministic `PolicySetHash` for a `BranchPolicy` (unified with `hashBranchPolicy`). */
export const hashPolicyConfig = hashBranchPolicy;
export { hashBranchPolicy };

/** Compute deterministic `SnapshotHash` over immutable snapshot contents. */
export function computeSnapshotHash(input: {
  readonly parent: SnapshotHash | null;
  readonly bindings: ReadonlyMap<QualifiedName, DefHash>;
  readonly metadata: ReadonlyMap<DefHash, PresentationMeta>;
  readonly policies: PolicySetHash;
  readonly languageProfile: string;
}): SnapshotHash {
  const sortedBindings: Record<string, string> = {};
  for (const key of [...input.bindings.keys()].sort(compareStrings)) {
    sortedBindings[key] = input.bindings.get(key)!;
  }
  const sortedMetadata: Record<string, JsonValue> = {};
  for (const key of [...input.metadata.keys()].sort(compareStrings)) {
    sortedMetadata[key] = input.metadata.get(key)! as unknown as JsonValue;
  }
  const canonical = canonicalJson({
    version: SNAPSHOT_HASH_VERSION,
    parent: input.parent,
    bindings: sortedBindings,
    metadata: sortedMetadata,
    policies: input.policies,
    languageProfile: input.languageProfile,
  });
  return `${SNAPSHOT_HASH_VERSION}:${sha256(canonical)}`;
}

/** Convert a `Snapshot` into a JSON-serializable plain object. */
export function serializeSnapshot(snapshot: Snapshot): SerializedSnapshot {
  const bindings: Record<QualifiedName, DefHash> = {};
  for (const key of [...snapshot.bindings.keys()].sort(compareStrings)) {
    bindings[key] = snapshot.bindings.get(key)!;
  }
  const metadata: Record<DefHash, PresentationMeta> = {};
  for (const key of [...snapshot.metadata.keys()].sort(compareStrings)) {
    metadata[key] = snapshot.metadata.get(key)!;
  }
  return {
    hash: snapshot.hash,
    parent: snapshot.parent,
    bindings,
    metadata,
    policies: snapshot.policies,
    policyConfig: snapshot.policyConfig,
    languageProfile: snapshot.languageProfile,
    ...(snapshot.createdAt !== undefined ? { createdAt: snapshot.createdAt } : {}),
    ...(snapshot.message !== undefined ? { message: snapshot.message } : {}),
  };
}

/** Reconstruct a `Snapshot` from its `SerializedSnapshot` form. */
export function deserializeSnapshot(serialized: SerializedSnapshot): Snapshot {
  const bindings = new Map<QualifiedName, DefHash>();
  for (const key of Object.keys(serialized.bindings).sort(compareStrings)) {
    bindings.set(key, serialized.bindings[key]!);
  }
  const metadata = new Map<DefHash, PresentationMeta>();
  for (const key of Object.keys(serialized.metadata).sort(compareStrings)) {
    metadata.set(key, serialized.metadata[key]!);
  }
  return {
    hash: serialized.hash,
    parent: serialized.parent,
    bindings,
    metadata,
    policies: serialized.policies,
    policyConfig: serialized.policyConfig,
    languageProfile: serialized.languageProfile,
    ...(serialized.createdAt !== undefined ? { createdAt: serialized.createdAt } : {}),
    ...(serialized.message !== undefined ? { message: serialized.message } : {}),
  };
}

// ---------------------------------------------------------------------------
// Interface equivalence & Snapshot -> DefinitionIndex projection
// ---------------------------------------------------------------------------

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Determine whether two definition records expose the exact same interface:
 * same declaration kind, same canonical/resolved type signature, same concrete
 * Effect requirements, and same concrete Effect errors.
 */
export function isSameInterface(a: DefinitionRecord, b: DefinitionRecord): boolean {
  if (a.kind !== b.kind) return false;
  const sigA = a.canonicalSignature ?? a.signature;
  const sigB = b.canonicalSignature ?? b.signature;
  if (sigA !== sigB) return false;
  if (!arraysEqual(a.requirements, b.requirements)) return false;
  if (!arraysEqual(a.errors, b.errors)) return false;
  return true;
}

/**
 * Build a read-only `DefinitionIndex` reflecting a `Snapshot`'s current
 * namespace bindings and presentation metadata.
 */
export function buildIndexFromSnapshot(
  snapshot: Snapshot,
  lookup: DefinitionLookup,
): DefinitionIndex {
  const definitions = new Map<DefHash, DefinitionRecord>();
  const bindings = new Map<string, DefHash>();
  const byNameSets = new Map<string, Set<DefHash>>();
  const dependentsSets = new Map<DefHash, Set<DefHash>>();
  const metadata = new Map<DefHash, PresentationMeta>();

  const sortedNames = [...snapshot.bindings.keys()].sort(compareStrings);
  for (const qName of sortedNames) {
    const hash = snapshot.bindings.get(qName)!;
    const stored = lookupDef(lookup, hash);
    if (!stored) continue;

    const { moduleId, name } = splitQualifiedName(qName);
    const snapMeta = snapshot.metadata.get(hash);
    const effectiveMeta: PresentationMeta = snapMeta
      ? { ...snapMeta, qualifiedName: qName, moduleId }
      : { ...stored.meta, qualifiedName: qName, moduleId, displayName: name };

    const projected: DefinitionRecord = {
      ...stored,
      qualifiedName: qName,
      name,
      moduleId,
      meta: effectiveMeta,
    };

    if (!definitions.has(hash)) {
      definitions.set(hash, projected);
      metadata.set(hash, effectiveMeta);
    }
    bindings.set(qName, hash);

    let nameSet = byNameSets.get(name);
    if (!nameSet) {
      nameSet = new Set<DefHash>();
      byNameSets.set(name, nameSet);
    }
    nameSet.add(hash);

    if (!dependentsSets.has(hash)) {
      dependentsSets.set(hash, new Set<DefHash>());
    }
  }

  for (const record of definitions.values()) {
    for (const depHash of record.dependencies) {
      let depSet = dependentsSets.get(depHash);
      if (!depSet) {
        depSet = new Set<DefHash>();
        dependentsSets.set(depHash, depSet);
      }
      depSet.add(record.hash);
    }
    for (const formDep of record.formDependencies) {
      let depSet = dependentsSets.get(formDep);
      if (!depSet) {
        depSet = new Set<DefHash>();
        dependentsSets.set(formDep, depSet);
      }
      depSet.add(record.hash);
    }
  }

  const byName = new Map<string, readonly DefHash[]>();
  for (const [name, hashes] of byNameSets) {
    const sorted = [...hashes].sort(compareStrings);
    byName.set(name, sorted);
    if (sorted.length === 1 && !bindings.has(name)) {
      bindings.set(name, sorted[0]!);
    }
  }

  const dependents = new Map<DefHash, readonly DefHash[]>();
  for (const [hash, depSet] of dependentsSets) {
    dependents.set(hash, [...depSet].sort(compareStrings));
  }

  return {
    definitions,
    bindings,
    byName,
    dependents,
    metadata,
    languageProfile: snapshot.languageProfile,
  };
}

// ---------------------------------------------------------------------------
// Snapshot diffing (RFC 0029 §4)
// ---------------------------------------------------------------------------

/**
 * Compute the semantic diff between two immutable snapshots (`from` -> `to`),
 * identifying added, removed, updated (with interface-change classification),
 * and O(1) renamed definitions (same `DefHash` moved to a new name).
 */
export function diffSnapshots(
  from: Snapshot,
  to: Snapshot,
  lookup?: DefinitionLookup,
): SnapshotDiff {
  const rawAdded: Array<{ readonly qualifiedName: QualifiedName; readonly hash: DefHash }> = [];
  const rawRemoved: Array<{ readonly qualifiedName: QualifiedName; readonly hash: DefHash }> = [];
  const updated: SnapshotDiffUpdated[] = [];

  const fromNames = [...from.bindings.keys()].sort(compareStrings);
  const toNames = [...to.bindings.keys()].sort(compareStrings);

  for (const qName of fromNames) {
    const oldHash = from.bindings.get(qName)!;
    const newHash = to.bindings.get(qName);
    if (newHash === undefined) {
      rawRemoved.push({ qualifiedName: qName, hash: oldHash });
    } else if (newHash !== oldHash) {
      const oldRec = lookupDef(lookup, oldHash);
      const newRec = lookupDef(lookup, newHash);
      const interfaceChanged =
        oldRec && newRec ? !isSameInterface(oldRec, newRec) : true;
      updated.push({
        qualifiedName: qName,
        oldHash,
        newHash,
        kind: newRec?.kind ?? oldRec?.kind ?? "define",
        interfaceChanged,
        ...(oldRec?.signature !== undefined ? { oldSignature: oldRec.signature } : {}),
        ...(newRec?.signature !== undefined ? { newSignature: newRec.signature } : {}),
        oldRequirements: oldRec ? [...oldRec.requirements] : [],
        newRequirements: newRec ? [...newRec.requirements] : [],
        oldErrors: oldRec ? [...oldRec.errors] : [],
        newErrors: newRec ? [...newRec.errors] : [],
      });
    }
  }

  for (const qName of toNames) {
    if (!from.bindings.has(qName)) {
      rawAdded.push({ qualifiedName: qName, hash: to.bindings.get(qName)! });
    }
  }

  // Pair removed & added entries with identical DefHash as renames (1-to-1 deterministic)
  const renamed: SnapshotDiffRenamed[] = [];
  const matchedRemoved = new Set<number>();
  const matchedAdded = new Set<number>();

  for (let i = 0; i < rawRemoved.length; i++) {
    const rem = rawRemoved[i]!;
    for (let j = 0; j < rawAdded.length; j++) {
      if (matchedAdded.has(j)) continue;
      const add = rawAdded[j]!;
      if (rem.hash === add.hash) {
        matchedRemoved.add(i);
        matchedAdded.add(j);
        renamed.push({
          from: rem.qualifiedName,
          to: add.qualifiedName,
          hash: rem.hash,
        });
        break;
      }
    }
  }

  const added: SnapshotDiffAdded[] = [];
  for (let j = 0; j < rawAdded.length; j++) {
    if (matchedAdded.has(j)) continue;
    const entry = rawAdded[j]!;
    const rec = lookupDef(lookup, entry.hash);
    added.push({
      qualifiedName: entry.qualifiedName,
      hash: entry.hash,
      kind: rec?.kind ?? "define",
      ...(rec?.signature !== undefined ? { signature: rec.signature } : {}),
    });
  }

  const removed: SnapshotDiffRemoved[] = [];
  for (let i = 0; i < rawRemoved.length; i++) {
    if (matchedRemoved.has(i)) continue;
    const entry = rawRemoved[i]!;
    const rec = lookupDef(lookup, entry.hash);
    removed.push({
      qualifiedName: entry.qualifiedName,
      hash: entry.hash,
      kind: rec?.kind ?? "define",
      ...(rec?.signature !== undefined ? { signature: rec.signature } : {}),
    });
  }

  return {
    fromSnapshot: from.hash,
    toSnapshot: to.hash,
    added,
    removed,
    updated,
    renamed,
  };
}

// ---------------------------------------------------------------------------
// InMemorySnapshotBackend (browser-safe)
// ---------------------------------------------------------------------------

export class InMemorySnapshotBackend implements SnapshotBackend {
  readonly #snapshots = new Map<SnapshotHash, Snapshot>();
  readonly #definitions = new Map<DefHash, DefinitionRecord>();
  readonly #branches = new Map<string, BranchRef>();

  getSnapshot(hash: SnapshotHash): Snapshot | undefined {
    return this.#snapshots.get(hash);
  }

  putSnapshot(snapshot: Snapshot): void {
    this.#snapshots.set(snapshot.hash, snapshot);
  }

  getDefinition(hash: DefHash): DefinitionRecord | undefined {
    return this.#definitions.get(hash);
  }

  putDefinition(record: DefinitionRecord): void {
    if (!this.#definitions.has(record.hash)) {
      this.#definitions.set(record.hash, record);
    }
  }

  getBranch(name: string): BranchRef | undefined {
    return this.#branches.get(name);
  }

  listBranches(): readonly BranchRef[] {
    return [...this.#branches.values()].sort((a, b) => compareStrings(a.name, b.name));
  }

  compareAndSwapBranch(
    name: string,
    expectedHead: SnapshotHash | null,
    nextHead: SnapshotHash,
  ): boolean {
    const existing = this.#branches.get(name);
    const currentHead = existing ? existing.head : null;
    if (currentHead !== expectedHead) {
      return false;
    }
    this.#branches.set(name, {
      name,
      head: nextHead,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Source parsing, lowering, and selective typechecking helpers
// ---------------------------------------------------------------------------

function desugarDefineFunctionHeads(exprs: readonly SExpr[]): SExpr[] {
  return exprs.map((expr) => {
    if (
      expr._tag === "List" &&
      expr.items.length >= 3 &&
      expr.items[0]?._tag === "Sym" &&
      expr.items[0].name === "define" &&
      expr.items[1]?._tag === "List" &&
      expr.items[1].items[0]?._tag === "Sym"
    ) {
      const fnHead = expr.items[1];
      const fnName = fnHead.items[0]!;
      const paramsVec: SExpr = {
        _tag: "Vector",
        items: fnHead.items.slice(1),
        loc: fnHead.loc,
      };
      const fnExpr: SExpr = {
        _tag: "List",
        items: [{ _tag: "Sym", name: "fn", loc: fnHead.loc }, paramsVec, ...expr.items.slice(2)],
        loc: fnHead.loc,
      };
      return {
        _tag: "List",
        items: [expr.items[0], fnName, fnExpr],
        loc: expr.loc,
      };
    }
    return expr;
  });
}

function extractDocstring(expr: SExpr | undefined): string | undefined {
  if (!expr || expr._tag !== "List" || expr.items.length < 3) return undefined;
  const h = headSym(expr);
  if (h === "define" && expr.items[1]?._tag === "List" && expr.items.length >= 4 && expr.items[2]?._tag === "Str") {
    return expr.items[2].value;
  }
  for (let i = 1; i < expr.items.length - 1; i++) {
    const item = expr.items[i]!;
    const next = expr.items[i + 1]!;
    if (item._tag === "Sym" && item.name === ":doc" && next._tag === "Str") {
      return next.value;
    }
  }
  return undefined;
}

function inferKindFromRaw(expr: SExpr | undefined): StoreDefinitionKind {
  if (!expr || expr._tag !== "List" || expr.items.length < 2) return "define";
  const h = headSym(expr);
  if (h === "define" || h === "__operation") return "define";
  if (h === "type" || h === "__sum-type") return "type";
  if (h === "error") return "error";
  if (h === "service" || h === "__service") return "service";
  if (h === "layer" || h === "__layer") return "layer";
  if (h === "class" || h === "typeclass" || h === "__typeclass") return "class";
  if (h === "instance") return "instance";
  if (h === "form") return "form";
  if (h === "macro" || h === "__macro") return "macro";
  if (h === "test") return "test";
  return "declaration";
}

function inferKindFromCore(expr: CoreExpr): StoreDefinitionKind {
  switch (expr._tag) {
    case "Def":
      return "define";
    case "TypeDef":
      return expr.source === "error" ? "error" : expr.source === "form" ? "form" : "type";
    case "DefService":
      return "service";
    case "DefLayer":
      return "layer";
    case "DefClass":
      return "class";
    case "Instance":
      return "instance";
    default:
      return "declaration";
  }
}

function coreDeclName(expr: CoreExpr): string | undefined {
  switch (expr._tag) {
    case "Def":
    case "TypeDef":
    case "DefService":
    case "DefLayer":
    case "DefClass":
      return expr.name;
    case "Instance":
      return expr.className;
    default:
      return undefined;
  }
}

interface ParsedOpUnit {
  readonly qualifiedName: QualifiedName;
  readonly moduleId: string;
  readonly name: string;
  readonly source: string;
  readonly rawExprs: readonly SExpr[];
  readonly primaryRaw: SExpr | undefined;
  readonly coreExprs: readonly CoreExpr[];
  readonly primaryCore: CoreExpr | undefined;
  readonly kind: StoreDefinitionKind;
  readonly metaOverride?: Partial<PresentationMeta> | undefined;
}

function parseOpUnit(
  qualifiedName: QualifiedName,
  source: string,
  metaOverride?: Partial<PresentationMeta>,
): { readonly ok: true; readonly unit: ParsedOpUnit } | { readonly ok: false; readonly diagnostic: TransactionDiagnostic } {
  const { moduleId, name } = splitQualifiedName(qualifiedName);
  const parsed = parse(source);
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0]!;
    return {
      ok: false,
      diagnostic: {
        message: first.message,
        qualifiedName,
      },
    };
  }
  const rawExprs = toSExprMany(parsed.redTree, moduleId);
  if (rawExprs.length === 0) {
    return {
      ok: false,
      diagnostic: {
        message: `Empty source for '${qualifiedName}'`,
        qualifiedName,
      },
    };
  }
  for (const expr of rawExprs) {
    if (expr._tag === "Error") {
      return {
        ok: false,
        diagnostic: {
          message: expr.message,
          qualifiedName,
        },
      };
    }
  }

  // Filter out top-level module directives (`import` / `export`) before lowering
  // single-definition transaction units.
  const declRawExprs = rawExprs.filter((expr) => {
    const h = headSym(expr);
    return h !== "import" && h !== "export";
  });
  const effectiveRawExprs = declRawExprs.length > 0 ? declRawExprs : rawExprs;

  let provider: ReturnType<typeof unifiedFormProvider> | undefined;
  try {
    provider = unifiedFormProvider(source, [...effectiveRawExprs]);
  } catch {
    provider = undefined;
  }

  let coreExprs: CoreExpr[] = [];
  const primaryRaw = effectiveRawExprs[effectiveRawExprs.length - 1];
  const rawKind = inferKindFromRaw(primaryRaw);
  const isRawOnly = rawKind === "macro" || rawKind === "test" || rawKind === "form";

  if (!isRawOnly) {
    try {
      coreExprs = lowerProgram(desugarDefineFunctionHeads(effectiveRawExprs), provider);
    } catch (err) {
      return {
        ok: false,
        diagnostic: {
          message: err instanceof Error ? err.message : String(err),
          qualifiedName,
        },
      };
    }
  }

  const primaryCore =
    coreExprs.find((c) => coreDeclName(c) === name) ?? coreExprs[coreExprs.length - 1];
  const kind = primaryCore ? inferKindFromCore(primaryCore) : rawKind;

  return {
    ok: true,
    unit: {
      qualifiedName,
      moduleId,
      name,
      source,
      rawExprs,
      primaryRaw,
      coreExprs,
      primaryCore,
      kind,
      metaOverride,
    },
  };
}

/**
 * Topologically order proposed `ParsedOpUnit`s so dependencies are typechecked
 * before dependents within the same transaction.
 */
function orderParsedUnits(units: readonly ParsedOpUnit[]): ParsedOpUnit[] {
  const byQName = new Map<QualifiedName, ParsedOpUnit>();
  const byLocal = new Map<string, QualifiedName>();
  for (const u of units) {
    byQName.set(u.qualifiedName, u);
    byLocal.set(u.name, u.qualifiedName);
  }

  const visited = new Set<QualifiedName>();
  const visiting = new Set<QualifiedName>();
  const result: ParsedOpUnit[] = [];

  const visit = (qName: QualifiedName): void => {
    if (visited.has(qName) || visiting.has(qName)) return;
    visiting.add(qName);
    const unit = byQName.get(qName);
    if (unit) {
      const refs = new Set<string>();
      for (const c of unit.coreExprs) {
        collectFreeRefsCoreExpr(c, refs);
      }
      for (const ref of refs) {
        const depQ = byQName.has(ref) ? ref : byLocal.get(ref);
        if (depQ && depQ !== qName) {
          visit(depQ);
        }
      }
      visiting.delete(qName);
      visited.add(qName);
      result.push(unit);
    }
  };

  for (const u of units) {
    visit(u.qualifiedName);
  }
  return result;
}

/**
 * Rebind a dependent `DefinitionRecord` by replacing old dependency hashes
 * with new dependency hashes in `canonicalForm`, `dependencies`, and
 * `formDependencies` — without re-typechecking its body.
 */
function rebindDependentRecord(
  record: DefinitionRecord,
  hashReplacements: ReadonlyMap<DefHash, DefHash>,
): DefinitionRecord {
  let canonicalForm = record.canonicalForm;
  for (const [oldHash, newHash] of hashReplacements) {
    if (canonicalForm.includes(oldHash)) {
      canonicalForm = canonicalForm.split(oldHash).join(newHash);
    }
  }

  const newDependencies = [
    ...new Set(record.dependencies.map((d) => hashReplacements.get(d) ?? d)),
  ].sort(compareStrings);
  const newFormDependencies = [
    ...new Set(record.formDependencies.map((d) => hashReplacements.get(d) ?? d)),
  ].sort(compareStrings);

  const newHash: DefHash = `${DEF_HASH_VERSION}:${sha256(canonicalForm)}`;

  return {
    ...record,
    hash: newHash,
    canonicalForm,
    dependencies: newDependencies,
    formDependencies: newFormDependencies,
  };
}

// ---------------------------------------------------------------------------
// TransactionalStore
// ---------------------------------------------------------------------------

export interface TransactionalStoreOptions {
  readonly backend?: SnapshotBackend | undefined;
  readonly languageProfile?: string | undefined;
  readonly policyEvaluator?: PolicyEvaluator | undefined;
  readonly evidence?: EvidenceLookup | undefined;
  readonly opaqueBoundaries?: ReadonlyMap<string, OpaqueBoundaryRef> | undefined;
  readonly inferOptions?: MakeInferContextOptions | undefined;
  /** Instrumentation callback invoked whenever a definition body is typechecked. */
  readonly onTypecheck?: ((qualifiedName: QualifiedName) => void) | undefined;
}

export interface CreateBranchOptions {
  readonly policy?: BranchPolicy | undefined;
  readonly message?: string | undefined;
  readonly indexOptions?: BuildDefinitionIndexOptions | undefined;
}

export class TransactionalStore {
  readonly backend: SnapshotBackend;
  readonly languageProfile: string;
  #policyEvaluator: PolicyEvaluator | undefined;
  #evidence: EvidenceLookup | undefined;
  readonly #opaqueBoundaries: ReadonlyMap<string, OpaqueBoundaryRef> | undefined;
  readonly #inferOptions: MakeInferContextOptions | undefined;
  readonly #onTypecheck: ((qualifiedName: QualifiedName) => void) | undefined;
  /** In-memory cache of resolved HM Schemes keyed by `DefHash` to avoid re-typechecking unchanged defs. */
  readonly #schemeCache = new Map<DefHash, Scheme>();
  /** Auxiliary `TypeEnv` bindings introduced by service/type definitions (e.g. `Db.query`), keyed by `DefHash`. */
  readonly #extraEnvCache = new Map<DefHash, ReadonlyMap<string, Scheme>>();

  constructor(options: TransactionalStoreOptions = {}) {
    this.backend = options.backend ?? new InMemorySnapshotBackend();
    this.languageProfile = options.languageProfile ?? DEFAULT_LANGUAGE_PROFILE;
    this.#policyEvaluator = options.policyEvaluator;
    this.#evidence = options.evidence;
    this.#opaqueBoundaries = options.opaqueBoundaries;
    this.#inferOptions = options.inferOptions;
    this.#onTypecheck = options.onTypecheck;
  }

  setPolicyEvaluator(evaluator: PolicyEvaluator | undefined): void {
    this.#policyEvaluator = evaluator;
  }

  setEvidenceLookup(evidence: EvidenceLookup | undefined): void {
    this.#evidence = evidence;
  }

  getBranch(name: string): BranchRef | undefined {
    return this.backend.getBranch(name);
  }

  listBranches(): readonly BranchRef[] {
    return this.backend.listBranches();
  }

  getSnapshot(hash: SnapshotHash): Snapshot | undefined {
    return this.backend.getSnapshot(hash);
  }

  getBranchSnapshot(branch: string): Snapshot | undefined {
    const ref = this.backend.getBranch(branch);
    return ref ? this.backend.getSnapshot(ref.head) : undefined;
  }

  getDefinition(hash: DefHash): DefinitionRecord | undefined {
    return this.backend.getDefinition(hash);
  }

  getSnapshotIndex(hash: SnapshotHash): DefinitionIndex | undefined {
    const snapshot = this.backend.getSnapshot(hash);
    if (!snapshot) return undefined;
    return buildIndexFromSnapshot(snapshot, (h) => this.backend.getDefinition(h));
  }

  diffSnapshots(fromHash: SnapshotHash, toHash: SnapshotHash): SnapshotDiff | undefined {
    const from = this.backend.getSnapshot(fromHash);
    const to = this.backend.getSnapshot(toHash);
    if (!from || !to) return undefined;
    return diffSnapshots(from, to, (h) => this.backend.getDefinition(h));
  }

  /** Create a new branch pointing at an existing immutable snapshot. */
  createBranch(name: string, fromSnapshot: SnapshotHash): BranchRef {
    const snap = this.backend.getSnapshot(fromSnapshot);
    if (!snap) {
      throw new Error(`Unknown snapshot '${fromSnapshot}'`);
    }
    const ok = this.backend.compareAndSwapBranch(name, null, fromSnapshot);
    if (!ok) {
      throw new Error(`Branch '${name}' already exists`);
    }
    return this.backend.getBranch(name)!;
  }

  /**
   * Bootstrap a branch with an initial immutable snapshot built from `.lisp` sources.
   * Also warms the internal Scheme cache for all definitions so subsequent
   * transactions can typecheck only touched definitions.
   */
  createBranchFromSources(
    branch: string,
    sources: readonly DefinitionIndexSource[],
    options: CreateBranchOptions = {},
  ): Snapshot {
    const index = buildDefinitionIndexFromSources(sources, {
      languageProfile: this.languageProfile,
      opaqueBoundaries: this.#opaqueBoundaries,
      inferOptions: this.#inferOptions,
      ...options.indexOptions,
    });

    // Warm scheme cache from sources
    this.#warmSchemesFromSources(sources, index);

    return this.createBranchFromIndex(branch, index, options);
  }

  /** Bootstrap a branch with an initial immutable snapshot built from a `DefinitionIndex`. */
  createBranchFromIndex(
    branch: string,
    index: DefinitionIndex,
    options: CreateBranchOptions = {},
  ): Snapshot {
    const bindings = new Map<QualifiedName, DefHash>();
    const metadata = new Map<DefHash, PresentationMeta>();

    for (const record of index.definitions.values()) {
      this.backend.putDefinition(record);
      bindings.set(record.qualifiedName, record.hash);
      metadata.set(record.hash, record.meta);
    }

    const policyConfig: BranchPolicy = options.policy ?? { protected: true };
    const policies = hashPolicyConfig(policyConfig);
    const hash = computeSnapshotHash({
      parent: null,
      bindings,
      metadata,
      policies,
      languageProfile: index.languageProfile,
    });

    const snapshot: Snapshot = {
      hash,
      parent: null,
      bindings,
      metadata,
      policies,
      policyConfig,
      languageProfile: index.languageProfile,
      createdAt: new Date().toISOString(),
      ...(options.message !== undefined ? { message: options.message } : {}),
    };

    this.backend.putSnapshot(snapshot);
    const ok = this.backend.compareAndSwapBranch(branch, null, snapshot.hash);
    if (!ok) {
      throw new Error(`Branch '${branch}' already exists`);
    }
    return snapshot;
  }

  #warmSchemesFromSources(
    sources: readonly DefinitionIndexSource[],
    index: DefinitionIndex,
  ): void {
    let cumulativeEnv: TypeEnv = new Map();
    const cumulativeRaw: SExpr[] = [];
    resetNodeIds();
    for (const src of sources) {
      const parsed = parse(src.source);
      const rawExprs = toSExprMany(parsed.redTree, src.id);
      let provider: ReturnType<typeof unifiedFormProvider> | undefined;
      try {
        provider = unifiedFormProvider(src.source, [...cumulativeRaw, ...rawExprs]);
      } catch {
        provider = undefined;
      }
      let coreExprs: CoreExpr[] = [];
      try {
        coreExprs = lowerProgram(desugarDefineFunctionHeads(rawExprs), provider);
      } catch {
        coreExprs = [];
      }
      if (coreExprs.length > 0) {
        try {
          const nextEnv = Effect.runSync(
            Effect.gen(function* () {
              const ctx = yield* makeOwnedInferContext();
              let captured: TypeEnv = new Map(cumulativeEnv);
              yield* Effect.provide(
                inferProgram(coreExprs, cumulativeEnv, provider, rawExprs, (env) => {
                  captured = env;
                }),
                Layer.succeed(InferContext, ctx),
              );
              return captured;
            }),
          );
          cumulativeEnv = nextEnv;
        } catch {
          // Best-effort warming
        }
      }
      cumulativeRaw.push(...rawExprs);
    }

    for (const record of index.definitions.values()) {
      const scheme = cumulativeEnv.get(record.name);
      if (scheme) {
        this.#schemeCache.set(record.hash, scheme);
      }
    }
  }

  /**
   * Build a `TypeEnv` for upstream dependencies of the proposed units without
   * ever typechecking downstream dependents.
   */
  #buildUpstreamTypeEnv(
    baseSnapshot: Snapshot,
    proposedUnits: readonly ParsedOpUnit[],
    excludeQNames: ReadonlySet<QualifiedName>,
  ): TypeEnv {
    const env = new Map<string, Scheme>();

    // Map local & qualified names in baseSnapshot -> DefHash
    const localToHash = new Map<string, DefHash>();
    const hashToQName = new Map<DefHash, QualifiedName>();
    for (const [qName, hash] of baseSnapshot.bindings) {
      hashToQName.set(hash, qName);
      if (excludeQNames.has(qName)) continue;
      const { name } = splitQualifiedName(qName);
      localToHash.set(name, hash);
      localToHash.set(qName, hash);
    }

    // Populate any already-cached schemes immediately (O(1), zero typechecking)
    for (const [qName, hash] of baseSnapshot.bindings) {
      if (excludeQNames.has(qName)) continue;
      const cached = this.#schemeCache.get(hash);
      if (cached) {
        const { name } = splitQualifiedName(qName);
        env.set(name, cached);
      }
      const extra = this.#extraEnvCache.get(hash);
      if (extra) {
        for (const [k, s] of extra) {
          env.set(k, s);
        }
      }
    }

    // Collect free symbols referenced by proposed units that aren't in `env` yet
    const neededHashes = new Set<DefHash>();
    const collectUpstream = (hash: DefHash): void => {
      if (this.#schemeCache.has(hash) || neededHashes.has(hash)) return;
      const rec = this.backend.getDefinition(hash);
      if (!rec) return;
      for (const depHash of rec.dependencies) {
        collectUpstream(depHash);
      }
      neededHashes.add(hash);
    };

    for (const unit of proposedUnits) {
      const refs = new Set<string>();
      for (const c of unit.coreExprs) {
        collectFreeRefsCoreExpr(c, refs);
      }
      for (const ref of refs) {
        const hash = localToHash.get(ref);
        if (hash && !this.#schemeCache.has(hash)) {
          collectUpstream(hash);
        }
      }
    }

    // Lazily recover schemes ONLY for missing upstream dependencies (e.g. after loading from disk)
    for (const hash of neededHashes) {
      const rec = this.backend.getDefinition(hash);
      const source = rec?.meta.authoredSource;
      if (!rec || !source) continue;
      const parsed = parseOpUnit(hashToQName.get(hash) ?? rec.qualifiedName, source);
      if (!parsed.ok || parsed.unit.coreExprs.length === 0) continue;
      try {
        const nextEnv = Effect.runSync(
          Effect.gen(function* () {
            const ctx = yield* makeOwnedInferContext();
            let captured: TypeEnv = new Map(env);
            yield* Effect.provide(
              inferProgram(
                parsed.unit.coreExprs as CoreExpr[],
                env,
                undefined,
                parsed.unit.rawExprs as SExpr[],
                (e) => {
                  captured = e;
                },
              ),
              Layer.succeed(InferContext, ctx),
            );
            return captured;
          }),
        );
        const scheme = nextEnv.get(rec.name);
        if (scheme) {
          this.#schemeCache.set(hash, scheme);
          env.set(rec.name, scheme);
        }
      } catch {
        // Ignore un-inferrable raw forms
      }
    }

    return env;
  }

  /**
   * Submit an atomic transactional update against `proposal.baseSnapshot`.
   *
   * Pipeline (RFC 0029 §5):
   * 1. Validate branch & baseSnapshot.
   * 2. Check optimistic CAS status against current branch head; if head moved,
   *    verify disjointness (names + dependencies) or return structured `ConflictReport`.
   * 3. Parse, lower, typecheck, and hash ONLY proposed `add`/`update` definitions.
   * 4. Apply O(1) `rename` / `move` and `remove`.
   * 5. Classify `InterfaceImpact` for every updated name:
   *    - Same-interface -> structurally rebind transitive dependents without re-typechecking.
   *    - Interface-changed -> reject with exact affected dependent list (or handle
   *      `"staging-branch"` / `"add-only"` coexistence mode).
   * 6. Run pluggable `PolicyEvaluator` hook against candidate snapshot.
   * 7. Atomically commit via `backend.compareAndSwapBranch`.
   */
  submitTransaction(proposal: TransactionProposal): TransactionResult {
    const branchRef = this.backend.getBranch(proposal.branch);
    if (!branchRef) {
      return {
        ok: false,
        reason: "unknown-branch",
        message: `Unknown branch '${proposal.branch}'`,
      };
    }

    const baseSnapshot = this.backend.getSnapshot(proposal.baseSnapshot);
    if (!baseSnapshot) {
      return {
        ok: false,
        reason: "unknown-snapshot",
        message: `Unknown base snapshot '${proposal.baseSnapshot}'`,
      };
    }

    const maxCasRetries = 3;
    for (let attempt = 0; attempt < maxCasRetries; attempt++) {
      const currentRef = this.backend.getBranch(proposal.branch);
      if (!currentRef) {
        return {
          ok: false,
          reason: "unknown-branch",
          message: `Unknown branch '${proposal.branch}'`,
        };
      }
      const headSnapshot = this.backend.getSnapshot(currentRef.head);
      if (!headSnapshot) {
        return {
          ok: false,
          reason: "unknown-snapshot",
          message: `Unknown head snapshot '${currentRef.head}'`,
        };
      }

      const needsRebase = headSnapshot.hash !== baseSnapshot.hash;

      // If head moved since proposal.baseSnapshot, evaluate against baseSnapshot first
      // to determine the exact names & dependency hashes read against baseSnapshot,
      // verify disjointness, and only then rebase onto headSnapshot.
      if (needsRebase) {
        const baseEval = this.#evaluateProposal(proposal, baseSnapshot, false);
        if (!baseEval.ok) {
          // Even if baseEval fails (e.g. parse error), surface that; unless a name collision
          // or dependency conflict explains it against head.
          return baseEval;
        }
        const conflicts = this.#detectConcurrentConflicts(
          proposal,
          baseSnapshot,
          headSnapshot,
          baseEval.touchedNames,
          baseEval.readDependencyHashes,
          baseEval.updatedOrRemovedBaseHashes,
        );
        if (conflicts.length > 0) {
          return {
            ok: false,
            reason: "cas-conflict",
            message: `Concurrent transaction conflict on branch '${proposal.branch}': ${conflicts.length} conflict(s)`,
            conflict: {
              branch: proposal.branch,
              baseSnapshot: baseSnapshot.hash,
              headSnapshot: headSnapshot.hash,
              conflicts,
            },
          };
        }
      }

      const evaluation = this.#evaluateProposal(
        proposal,
        needsRebase ? headSnapshot : baseSnapshot,
        needsRebase,
      );

      if (!evaluation.ok) {
        return evaluation;
      }

      // Persist new definitions & candidate snapshot
      for (const rec of evaluation.newRecords) {
        this.backend.putDefinition(rec);
      }
      this.backend.putSnapshot(evaluation.candidateSnapshot);

      // Handle staging-branch mode: leave target branch untouched, update staging branch
      if (evaluation.stagingBranch !== undefined) {
        const existingStaging = this.backend.getBranch(evaluation.stagingBranch);
        this.backend.compareAndSwapBranch(
          evaluation.stagingBranch,
          existingStaging ? existingStaging.head : null,
          evaluation.candidateSnapshot.hash,
        );
        return {
          ok: true,
          branch: evaluation.stagingBranch,
          snapshot: evaluation.candidateSnapshot,
          previousHead: baseSnapshot.hash,
          impacts: evaluation.impacts,
          diff: evaluation.diff,
          metrics: {
            typecheckedCount: evaluation.typecheckedCount,
            reboundCount: evaluation.reboundCount,
            rebased: needsRebase,
          },
          stagingBranch: evaluation.stagingBranch,
        };
      }

      // Atomic CAS on target branch head
      const committed = this.backend.compareAndSwapBranch(
        proposal.branch,
        headSnapshot.hash,
        evaluation.candidateSnapshot.hash,
      );
      if (committed) {
        return {
          ok: true,
          branch: proposal.branch,
          snapshot: evaluation.candidateSnapshot,
          previousHead: headSnapshot.hash,
          impacts: evaluation.impacts,
          diff: evaluation.diff,
          metrics: {
            typecheckedCount: evaluation.typecheckedCount,
            reboundCount: evaluation.reboundCount,
            rebased: needsRebase,
          },
          ...(evaluation.coexistingBindings !== undefined
            ? { coexistingBindings: evaluation.coexistingBindings }
            : {}),
        };
      }
      // Underlying CAS raced with another writer; retry loop will re-check conflicts against new head
    }

    const latestHead = this.backend.getBranch(proposal.branch)!.head;
    return {
      ok: false,
      reason: "cas-conflict",
      message: `CAS contention on branch '${proposal.branch}' after ${maxCasRetries} attempts`,
      conflict: {
        branch: proposal.branch,
        baseSnapshot: baseSnapshot.hash,
        headSnapshot: latestHead,
        conflicts: [],
      },
    };
  }

  #evaluateProposal(
    proposal: TransactionProposal,
    effectiveBase: Snapshot,
    rebased: boolean,
  ):
    | {
        readonly ok: true;
        readonly candidateSnapshot: Snapshot;
        readonly newRecords: readonly DefinitionRecord[];
        readonly impacts: readonly InterfaceImpact[];
        readonly diff: SnapshotDiff;
        readonly typecheckedCount: number;
        readonly reboundCount: number;
        readonly touchedNames: ReadonlySet<QualifiedName>;
        readonly readDependencyHashes: ReadonlySet<DefHash>;
        readonly updatedOrRemovedBaseHashes: ReadonlySet<DefHash>;
        readonly stagingBranch?: string | undefined;
        readonly coexistingBindings?: Readonly<Record<QualifiedName, QualifiedName>> | undefined;
      }
    | Extract<TransactionResult, { readonly ok: false }> {
    const baseIndex = buildIndexFromSnapshot(effectiveBase, (h) => this.backend.getDefinition(h));
    const nextBindings = new Map<QualifiedName, DefHash>(effectiveBase.bindings);
    const nextMetadata = new Map<DefHash, PresentationMeta>(effectiveBase.metadata);
    const touchedNames = new Set<QualifiedName>();
    const updatedNames = new Set<QualifiedName>();
    const removedNames = new Set<QualifiedName>();
    const updatedOrRemovedBaseHashes = new Set<DefHash>();

    // Phase 1: Validate operations & collect parse units for add/update
    const parseUnits: ParsedOpUnit[] = [];
    const prebuiltRecords = new Map<QualifiedName, { readonly op: "add" | "update"; readonly record: DefinitionRecord }>();
    const addOrUpdateOps: Array<{ readonly op: "add" | "update"; readonly qualifiedName: QualifiedName }> = [];

    for (const op of proposal.operations) {
      switch (op.kind) {
        case "add": {
          if (effectiveBase.bindings.has(op.qualifiedName) && !removedNames.has(op.qualifiedName)) {
            return {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot add '${op.qualifiedName}': binding already exists`,
            };
          }
          touchedNames.add(op.qualifiedName);
          addOrUpdateOps.push({ op: "add", qualifiedName: op.qualifiedName });
          if (op.record) {
            prebuiltRecords.set(op.qualifiedName, { op: "add", record: op.record });
          } else if (op.source !== undefined) {
            const parsed = parseOpUnit(op.qualifiedName, op.source, op.meta);
            if (!parsed.ok) {
              return {
                ok: false,
                reason: "parse-or-typecheck-error",
                message: parsed.diagnostic.message,
                diagnostics: [parsed.diagnostic],
              };
            }
            parseUnits.push(parsed.unit);
          } else {
            return {
              ok: false,
              reason: "invalid-operation",
              message: `Add operation for '${op.qualifiedName}' requires either 'source' or 'record'`,
            };
          }
          break;
        }

        case "update": {
          const existingHash = effectiveBase.bindings.get(op.qualifiedName);
          if (!existingHash) {
            return {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot update '${op.qualifiedName}': binding does not exist`,
            };
          }
          touchedNames.add(op.qualifiedName);
          updatedNames.add(op.qualifiedName);
          updatedOrRemovedBaseHashes.add(existingHash);
          addOrUpdateOps.push({ op: "update", qualifiedName: op.qualifiedName });
          if (op.record) {
            prebuiltRecords.set(op.qualifiedName, { op: "update", record: op.record });
          } else if (op.source !== undefined) {
            const parsed = parseOpUnit(op.qualifiedName, op.source, op.meta);
            if (!parsed.ok) {
              return {
                ok: false,
                reason: "parse-or-typecheck-error",
                message: parsed.diagnostic.message,
                diagnostics: [parsed.diagnostic],
              };
            }
            parseUnits.push(parsed.unit);
          } else {
            return {
              ok: false,
              reason: "invalid-operation",
              message: `Update operation for '${op.qualifiedName}' requires either 'source' or 'record'`,
            };
          }
          break;
        }

        case "rename": {
          const hash = nextBindings.get(op.from);
          if (!hash) {
            return {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot rename '${op.from}': binding does not exist`,
            };
          }
          if (nextBindings.has(op.to) && op.to !== op.from) {
            return {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot rename '${op.from}' to '${op.to}': target already exists`,
            };
          }
          touchedNames.add(op.from);
          touchedNames.add(op.to);
          nextBindings.delete(op.from);
          nextBindings.set(op.to, hash);
          const { moduleId, name } = splitQualifiedName(op.to);
          const prevMeta = nextMetadata.get(hash) ?? this.backend.getDefinition(hash)?.meta;
          nextMetadata.set(hash, {
            ...(prevMeta ?? { displayName: name, qualifiedName: op.to, moduleId }),
            displayName: op.displayName ?? name,
            qualifiedName: op.to,
            moduleId,
          });
          break;
        }

        case "move": {
          const hash = nextBindings.get(op.from);
          if (!hash) {
            return {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot move '${op.from}': binding does not exist`,
            };
          }
          const { name: oldName } = splitQualifiedName(op.from);
          const targetName = op.newName ?? oldName;
          const targetQName = makeQualifiedName(op.toModuleId, targetName);
          if (nextBindings.has(targetQName) && targetQName !== op.from) {
            return {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot move '${op.from}' to '${targetQName}': target already exists`,
            };
          }
          touchedNames.add(op.from);
          touchedNames.add(targetQName);
          nextBindings.delete(op.from);
          nextBindings.set(targetQName, hash);
          const prevMeta = nextMetadata.get(hash) ?? this.backend.getDefinition(hash)?.meta;
          nextMetadata.set(hash, {
            ...(prevMeta ?? { displayName: targetName, qualifiedName: targetQName, moduleId: op.toModuleId }),
            displayName: targetName,
            qualifiedName: targetQName,
            moduleId: op.toModuleId,
          });
          break;
        }

        case "remove": {
          const hash = nextBindings.get(op.qualifiedName);
          if (!hash) {
            return {
              ok: false,
              reason: "invalid-operation",
              message: `Cannot remove '${op.qualifiedName}': binding does not exist`,
            };
          }
          touchedNames.add(op.qualifiedName);
          removedNames.add(op.qualifiedName);
          updatedOrRemovedBaseHashes.add(hash);
          nextBindings.delete(op.qualifiedName);
          break;
        }
      }
    }

    // Phase 2: Selectively typecheck and hash ONLY proposed `add`/`update` units
    let typecheckedCount = 0;
    const orderedUnits = orderParsedUnits(parseUnits);
    const excludeFromBaseEnv = new Set<QualifiedName>([
      ...orderedUnits.map((u) => u.qualifiedName),
      ...removedNames,
    ]);

    let workingEnv: TypeEnv =
      orderedUnits.length > 0
        ? this.#buildUpstreamTypeEnv(effectiveBase, orderedUnits, excludeFromBaseEnv)
        : new Map();

    const inferredSchemes = new Map<QualifiedName, Scheme>();
    const inferredExtraEnv = new Map<QualifiedName, ReadonlyMap<string, Scheme>>();

    for (const unit of orderedUnits) {
      if (unit.coreExprs.length > 0) {
        this.#onTypecheck?.(unit.qualifiedName);
        typecheckedCount++;
        try {
          const inferOpts = this.#inferOptions;
          const prevEnvKeys = new Set(workingEnv.keys());
          const nextEnv = Effect.runSync(
            Effect.gen(function* () {
              const ctx = yield* makeOwnedInferContext(inferOpts);
              let captured: TypeEnv = new Map(workingEnv);
              yield* Effect.provide(
                inferProgram(
                  unit.coreExprs as CoreExpr[],
                  workingEnv,
                  undefined,
                  unit.rawExprs as SExpr[],
                  (e) => {
                    captured = e;
                  },
                ),
                Layer.succeed(InferContext, ctx),
              );
              return captured;
            }),
          );
          workingEnv = nextEnv;
          const scheme = nextEnv.get(unit.name);
          if (scheme) {
            inferredSchemes.set(unit.qualifiedName, scheme);
          }
          const addedBindings = new Map<string, Scheme>();
          for (const [k, s] of nextEnv) {
            if (!prevEnvKeys.has(k) && k !== unit.name) {
              addedBindings.set(k, s);
            }
          }
          if (addedBindings.size > 0) {
            inferredExtraEnv.set(unit.qualifiedName, addedBindings);
          }
        } catch (err) {
          return {
            ok: false,
            reason: "parse-or-typecheck-error",
            message: err instanceof Error ? err.message : String(err),
            diagnostics: [
              {
                message: err instanceof Error ? err.message : String(err),
                qualifiedName: unit.qualifiedName,
              },
            ],
          };
        }
      }
    }

    // Build reference resolver & externalHashes from unchanged bindings in nextBindings
    const localToQName = new Map<string, QualifiedName>();
    const externalHashes = new Map<QualifiedName, DefHash>();
    const parsedQNameSet = new Set(orderedUnits.map((u) => u.qualifiedName));

    for (const [qName, hash] of nextBindings) {
      if (!parsedQNameSet.has(qName) && !prebuiltRecords.has(qName)) {
        externalHashes.set(qName, hash);
      }
      const { name } = splitQualifiedName(qName);
      localToQName.set(name, qName);
      localToQName.set(qName, qName);
    }
    for (const unit of orderedUnits) {
      localToQName.set(unit.name, unit.qualifiedName);
      localToQName.set(unit.qualifiedName, unit.qualifiedName);
    }
    for (const [qName, entry] of prebuiltRecords) {
      externalHashes.set(qName, entry.record.hash);
      const { name } = splitQualifiedName(qName);
      localToQName.set(name, qName);
      localToQName.set(qName, qName);
    }

    const hashInputs: DefinitionHashInput[] = orderedUnits.map((unit) => {
      const span = unit.primaryRaw
        ? { start: unit.primaryRaw.loc.start, end: unit.primaryRaw.loc.end, sourceId: unit.moduleId }
        : { start: 0, end: unit.source.length, sourceId: unit.moduleId };
      const isFormOrMacro = unit.kind === "form" || unit.kind === "macro";
      return {
        qualifiedName: unit.qualifiedName,
        name: unit.name,
        moduleId: unit.moduleId,
        kind: unit.kind,
        coreExpr: isFormOrMacro && unit.primaryRaw ? undefined : unit.primaryCore,
        rawExpr: isFormOrMacro || !unit.primaryCore ? unit.primaryRaw : undefined,
        scheme: inferredSchemes.get(unit.qualifiedName),
        resolveReference: (sym: string) => localToQName.get(sym),
        meta: {
          displayName: unit.metaOverride?.displayName ?? unit.name,
          qualifiedName: unit.qualifiedName,
          moduleId: unit.moduleId,
          authoredSource: unit.metaOverride?.authoredSource ?? unit.source,
          docstring: unit.metaOverride?.docstring ?? extractDocstring(unit.primaryRaw),
          span: unit.metaOverride?.span ?? span,
        },
      };
    });

    const hashedRecords =
      hashInputs.length > 0
        ? hashDefinitionGroup(hashInputs, {
            languageProfile: effectiveBase.languageProfile,
            externalHashes,
            opaqueBoundaries: this.#opaqueBoundaries,
          })
        : [];

    const newRecordByQName = new Map<QualifiedName, DefinitionRecord>();
    const newRecords: DefinitionRecord[] = [];
    const readDependencyHashes = new Set<DefHash>();

    for (const rec of hashedRecords) {
      newRecordByQName.set(rec.qualifiedName, rec);
      newRecords.push(rec);
      const scheme = inferredSchemes.get(rec.qualifiedName);
      if (scheme) {
        this.#schemeCache.set(rec.hash, scheme);
      }
      const extraEnv = inferredExtraEnv.get(rec.qualifiedName);
      if (extraEnv) {
        this.#extraEnvCache.set(rec.hash, extraEnv);
      }
      for (const dep of rec.dependencies) {
        if (!hashedRecords.some((r) => r.hash === dep)) {
          readDependencyHashes.add(dep);
        }
      }
    }

    for (const [qName, entry] of prebuiltRecords) {
      newRecordByQName.set(qName, entry.record);
      newRecords.push(entry.record);
      for (const dep of entry.record.dependencies) {
        readDependencyHashes.add(dep);
      }
    }

    // Apply added/updated records to nextBindings & nextMetadata
    for (const { qualifiedName } of addOrUpdateOps) {
      const rec = newRecordByQName.get(qualifiedName);
      if (rec) {
        nextBindings.set(qualifiedName, rec.hash);
        nextMetadata.set(rec.hash, rec.meta);
      }
    }

    // Phase 3: Classify InterfaceImpact for every updated name
    const impacts: InterfaceImpact[] = [];
    const sameInterfaceReplacements = new Map<DefHash, DefHash>();
    let hasBreakingUnupdated = false;
    const breakingUpdates: Array<{
      readonly qualifiedName: QualifiedName;
      readonly oldHash: DefHash;
      readonly newRecord: DefinitionRecord;
    }> = [];

    for (const qName of [...updatedNames].sort(compareStrings)) {
      const oldHash = effectiveBase.bindings.get(qName)!;
      const oldRec = this.backend.getDefinition(oldHash);
      const newRec = newRecordByQName.get(qName);
      if (!oldRec || !newRec) continue;

      const dependents = findDependents(baseIndex, oldHash, { transitive: true });
      const affectedDependents: AffectedDependent[] = dependents.map((d) => ({
        qualifiedName: d.qualifiedName,
        hash: d.hash,
      }));

      const sameIface = isSameInterface(oldRec, newRec);
      if (sameIface) {
        if (oldHash !== newRec.hash) {
          sameInterfaceReplacements.set(oldHash, newRec.hash);
        }
        impacts.push({
          qualifiedName: qName,
          oldHash,
          newHash: newRec.hash,
          kind: "same-interface",
          ...(oldRec.signature !== undefined ? { oldSignature: oldRec.signature } : {}),
          ...(newRec.signature !== undefined ? { newSignature: newRec.signature } : {}),
          oldRequirements: [...oldRec.requirements],
          newRequirements: [...newRec.requirements],
          oldErrors: [...oldRec.errors],
          newErrors: [...newRec.errors],
          affectedDependents,
          reboundDependents: [],
          unupdatedDependents: [],
        });
      } else {
        const unupdatedDependents = affectedDependents.filter(
          (d) => !updatedNames.has(d.qualifiedName) && !removedNames.has(d.qualifiedName),
        );
        if (unupdatedDependents.length > 0) {
          hasBreakingUnupdated = true;
          breakingUpdates.push({ qualifiedName: qName, oldHash, newRecord: newRec });
        }
        impacts.push({
          qualifiedName: qName,
          oldHash,
          newHash: newRec.hash,
          kind: "interface-changed",
          ...(oldRec.signature !== undefined ? { oldSignature: oldRec.signature } : {}),
          ...(newRec.signature !== undefined ? { newSignature: newRec.signature } : {}),
          oldRequirements: [...oldRec.requirements],
          newRequirements: [...newRec.requirements],
          oldErrors: [...oldRec.errors],
          newErrors: [...newRec.errors],
          affectedDependents,
          reboundDependents: [],
          unupdatedDependents,
        });
      }
    }

    // Phase 4: Handle interface-changing updates with un-updated dependents
    const activePolicy = proposal.nextPolicy ?? effectiveBase.policyConfig;
    const isProtected = activePolicy.protected !== false;
    const mode = proposal.onInterfaceChange ?? "reject";
    let stagingBranch: string | undefined;
    let coexistingBindings: Record<QualifiedName, QualifiedName> | undefined;

    if (hasBreakingUnupdated && isProtected) {
      if (mode === "reject") {
        const brokenList = impacts
          .filter((imp) => imp.kind === "interface-changed" && imp.unupdatedDependents.length > 0)
          .map(
            (imp) =>
              `${imp.qualifiedName} breaks ${imp.unupdatedDependents.map((d) => `${d.qualifiedName} (${d.hash})`).join(", ")}`,
          )
          .join("; ");
        return {
          ok: false,
          reason: "interface-change",
          message: `Interface-changing update rejected on protected branch '${proposal.branch}': ${brokenList}`,
          impacts,
        };
      } else if (mode === "add-only") {
        coexistingBindings = {};
        const suffix = proposal.coexistenceSuffix ?? "v2";
        for (const brk of breakingUpdates) {
          // Restore original binding so existing dependents remain valid and unbroken
          nextBindings.set(brk.qualifiedName, brk.oldHash);

          // Find an unused coexisting qualified name
          let candidateName = `${brk.qualifiedName}@${suffix}`;
          let counter = 2;
          while (nextBindings.has(candidateName)) {
            counter++;
            candidateName = `${brk.qualifiedName}@v${counter}`;
          }
          const { moduleId, name } = splitQualifiedName(candidateName);
          const coexistingMeta: PresentationMeta = {
            ...brk.newRecord.meta,
            displayName: name,
            qualifiedName: candidateName,
            moduleId,
          };
          nextBindings.set(candidateName, brk.newRecord.hash);
          nextMetadata.set(brk.newRecord.hash, coexistingMeta);
          touchedNames.add(candidateName);
          coexistingBindings[brk.qualifiedName] = candidateName;
        }
      }
      // For mode === "staging-branch", we proceed to create the snapshot and direct commit to stagingBranch below.
    }

    // Phase 5: Same-interface rebinding of transitive dependents WITHOUT re-typechecking
    let reboundCount = 0;
    const finalImpacts: InterfaceImpact[] = impacts.map((imp) => ({
      ...imp,
      reboundDependents: [...imp.reboundDependents],
    }));

    if (sameInterfaceReplacements.size > 0) {
      const hashMap = new Map<DefHash, DefHash>(sameInterfaceReplacements);
      const reboundByOldHash = new Map<DefHash, AffectedDependent>();

      // Collect all transitive dependents in dependency-first order
      const toRebind = new Map<DefHash, DefinitionRecord>();
      for (const oldHash of sameInterfaceReplacements.keys()) {
        for (const dep of findDependents(baseIndex, oldHash, { transitive: true })) {
          if (updatedNames.has(dep.qualifiedName) || removedNames.has(dep.qualifiedName)) {
            continue;
          }
          toRebind.set(dep.hash, dep);
        }
      }

      // Topological sort of `toRebind` so direct dependents rebind before transitive dependents
      const orderedRebind: DefinitionRecord[] = [];
      const visitedRebind = new Set<DefHash>();
      const visitRebind = (rec: DefinitionRecord): void => {
        if (visitedRebind.has(rec.hash)) return;
        visitedRebind.add(rec.hash);
        for (const depHash of rec.dependencies) {
          const upstream = toRebind.get(depHash);
          if (upstream) visitRebind(upstream);
        }
        orderedRebind.push(rec);
      };
      for (const rec of toRebind.values()) {
        visitRebind(rec);
      }

      for (const dep of orderedRebind) {
        const rebound = rebindDependentRecord(dep, hashMap);
        if (rebound.hash !== dep.hash) {
          hashMap.set(dep.hash, rebound.hash);
          newRecords.push(rebound);
          nextBindings.set(dep.qualifiedName, rebound.hash);
          nextMetadata.set(rebound.hash, rebound.meta);
          touchedNames.add(dep.qualifiedName);
          const cachedScheme = this.#schemeCache.get(dep.hash);
          if (cachedScheme) {
            this.#schemeCache.set(rebound.hash, cachedScheme);
          }
          reboundCount++;
          reboundByOldHash.set(dep.hash, {
            qualifiedName: dep.qualifiedName,
            hash: rebound.hash,
          });
        }
      }

      // Populate reboundDependents on each same-interface impact
      for (let i = 0; i < finalImpacts.length; i++) {
        const imp = finalImpacts[i]!;
        if (imp.kind !== "same-interface") continue;
        const reboundList: AffectedDependent[] = [];
        for (const aff of imp.affectedDependents) {
          const rb = reboundByOldHash.get(aff.hash);
          if (rb) reboundList.push(rb);
        }
        finalImpacts[i] = {
          ...imp,
          reboundDependents: reboundList,
        };
      }
    }

    // Phase 6: Construct candidate Snapshot & SnapshotDiff
    const policies = hashPolicyConfig(activePolicy);
    const snapshotHash = computeSnapshotHash({
      parent: effectiveBase.hash,
      bindings: nextBindings,
      metadata: nextMetadata,
      policies,
      languageProfile: effectiveBase.languageProfile,
    });

    const candidateSnapshot: Snapshot = {
      hash: snapshotHash,
      parent: effectiveBase.hash,
      bindings: nextBindings,
      metadata: nextMetadata,
      policies,
      policyConfig: activePolicy,
      languageProfile: effectiveBase.languageProfile,
      createdAt: new Date().toISOString(),
      ...(proposal.message !== undefined ? { message: proposal.message } : {}),
    };

    if (hasBreakingUnupdated && isProtected && mode === "staging-branch") {
      stagingBranch =
        proposal.stagingBranchName ?? `${proposal.branch}--staging-${snapshotHash.slice(-8)}`;
    }

    const combinedLookup = (h: DefHash): DefinitionRecord | undefined => {
      const newly = newRecords.find((r) => r.hash === h);
      return newly ?? this.backend.getDefinition(h);
    };
    const candidateIndex = buildIndexFromSnapshot(candidateSnapshot, combinedLookup);
    const diff = diffSnapshots(effectiveBase, candidateSnapshot, combinedLookup);

    // Phase 7: Evaluate pluggable branch policies
    if (this.#policyEvaluator) {
      const violations = this.#policyEvaluator({
        proposal,
        policy: activePolicy,
        baseSnapshot: effectiveBase,
        baseIndex,
        candidateSnapshot,
        candidateIndex,
        impacts: finalImpacts,
        diff,
        evidence: this.#evidence,
      });
      if (violations.length > 0) {
        return {
          ok: false,
          reason: "policy-violation",
          message: `Transaction rejected by branch policy (${violations.length} violation(s)): ${violations[0]!.message}`,
          policyViolations: violations,
        };
      }
    }

    void rebased;
    return {
      ok: true,
      candidateSnapshot,
      newRecords,
      impacts: finalImpacts,
      diff,
      typecheckedCount,
      reboundCount,
      touchedNames,
      readDependencyHashes,
      updatedOrRemovedBaseHashes,
      ...(stagingBranch !== undefined ? { stagingBranch } : {}),
      ...(coexistingBindings !== undefined ? { coexistingBindings } : {}),
    };
  }

  /**
   * Detect name collisions or dependency invalidations between a concurrent
   * `baseSnapshot -> headSnapshot` advance and the proposed transaction.
   */
  #detectConcurrentConflicts(
    proposal: TransactionProposal,
    baseSnapshot: Snapshot,
    headSnapshot: Snapshot,
    touchedNames: ReadonlySet<QualifiedName>,
    readDependencyHashes: ReadonlySet<DefHash>,
    updatedOrRemovedBaseHashes: ReadonlySet<DefHash>,
  ): ConflictEntry[] {
    const conflicts: ConflictEntry[] = [];
    const lookup = (h: DefHash) => this.backend.getDefinition(h);
    const baseToHead = diffSnapshots(baseSnapshot, headSnapshot, lookup);

    const headChangedNames = new Set<QualifiedName>();
    for (const a of baseToHead.added) headChangedNames.add(a.qualifiedName);
    for (const r of baseToHead.removed) headChangedNames.add(r.qualifiedName);
    for (const u of baseToHead.updated) headChangedNames.add(u.qualifiedName);
    for (const rn of baseToHead.renamed) {
      headChangedNames.add(rn.from);
      headChangedNames.add(rn.to);
    }

    // 1. Name collisions: same binding touched by both head and proposal
    const reportedNames = new Set<QualifiedName>();
    for (const name of [...touchedNames].sort(compareStrings)) {
      if (headChangedNames.has(name)) {
        reportedNames.add(name);
        conflicts.push({
          reason: "name-collision",
          qualifiedName: name,
          baseHash: baseSnapshot.bindings.get(name),
          headHash: headSnapshot.bindings.get(name),
          message: `Binding '${name}' was concurrently modified on branch '${proposal.branch}'`,
        });
      }
    }

    // 2. Upstream dependency changed or removed in head
    const baseHashToNames = new Map<DefHash, QualifiedName[]>();
    for (const [qName, hash] of baseSnapshot.bindings) {
      const list = baseHashToNames.get(hash) ?? [];
      list.push(qName);
      baseHashToNames.set(hash, list);
    }

    for (const depHash of readDependencyHashes) {
      const depNames = baseHashToNames.get(depHash) ?? [];
      for (const depName of depNames) {
        if (reportedNames.has(depName)) continue;
        const headHash = headSnapshot.bindings.get(depName);
        if (headHash === undefined) {
          reportedNames.add(depName);
          conflicts.push({
            reason: "removed-dependency",
            qualifiedName: depName,
            baseHash: depHash,
            headHash: undefined,
            message: `Dependency '${depName}' (${depHash}) was removed on branch '${proposal.branch}'`,
          });
        } else if (headHash !== depHash) {
          reportedNames.add(depName);
          conflicts.push({
            reason: "dependency-changed",
            qualifiedName: depName,
            baseHash: depHash,
            headHash,
            message: `Dependency '${depName}' changed from ${depHash} to ${headHash} on branch '${proposal.branch}'`,
          });
        }
      }
    }

    // 3. Reverse dependency invalidation: head added/updated a definition depending on a hash this tx modifies/removes
    if (updatedOrRemovedBaseHashes.size > 0) {
      const headNewOrUpdated = [
        ...baseToHead.added.map((a) => ({ qualifiedName: a.qualifiedName, hash: a.hash })),
        ...baseToHead.updated.map((u) => ({ qualifiedName: u.qualifiedName, hash: u.newHash })),
      ];
      for (const entry of headNewOrUpdated) {
        if (reportedNames.has(entry.qualifiedName)) continue;
        const rec = this.backend.getDefinition(entry.hash);
        if (!rec) continue;
        const hitsModified = rec.dependencies.some((d) => updatedOrRemovedBaseHashes.has(d));
        if (hitsModified) {
          reportedNames.add(entry.qualifiedName);
          conflicts.push({
            reason: "dependency-changed",
            qualifiedName: entry.qualifiedName,
            baseHash: baseSnapshot.bindings.get(entry.qualifiedName),
            headHash: entry.hash,
            message: `Concurrent definition '${entry.qualifiedName}' on branch '${proposal.branch}' depends on a definition modified by this transaction`,
          });
        }
      }
    }

    return conflicts;
  }
}
