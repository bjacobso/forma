/**
 * Pure, read-only semantic graph queries over a content-addressed DefinitionIndex
 * (RFC 0029 Stages 0/1). Browser-safe: no Node-only imports.
 */

export type DefHash = string;
export type SccHash = string;

export type StoreDefinitionKind =
  | "define"
  | "type"
  | "error"
  | "service"
  | "layer"
  | "class"
  | "instance"
  | "form"
  | "macro"
  | "test"
  | "declaration";

export interface OpaqueBoundaryRef {
  readonly kind: "builtin" | "external-package" | "native-provider";
  readonly name: string;
  readonly signature: string;
  readonly runtimeDigest: string;
}

export interface PresentationMeta {
  readonly displayName: string;
  readonly qualifiedName: string;
  readonly moduleId: string;
  readonly authoredSource?: string | undefined;
  readonly docstring?: string | undefined;
  readonly span?:
    | {
        readonly start: number;
        readonly end: number;
        readonly sourceId?: string | undefined;
      }
    | undefined;
}

export interface SccMembership {
  readonly sccHash: SccHash;
  readonly memberIndex: number;
  readonly memberCount: number;
}

/** Structurally aligned with `packages/ts/src/store/types.ts` DefinitionRecord. */
export interface DefinitionRecord {
  readonly hash: DefHash;
  readonly kind: StoreDefinitionKind;
  readonly canonicalForm: string;
  readonly qualifiedName: string;
  readonly name: string;
  readonly moduleId: string;
  readonly signature?: string | undefined;
  readonly canonicalSignature?: string | undefined;
  readonly requirements: readonly string[];
  readonly errors: readonly string[];
  readonly languageProfile: string;
  readonly dependencies: readonly DefHash[];
  readonly formDependencies: readonly DefHash[];
  readonly opaqueRefs: readonly OpaqueBoundaryRef[];
  readonly scc?: SccMembership | undefined;
  readonly meta: PresentationMeta;
}

/** Structurally aligned with `packages/ts/src/store/types.ts` DefinitionIndex. */
export interface DefinitionIndex {
  readonly definitions: ReadonlyMap<DefHash, DefinitionRecord>;
  readonly bindings: ReadonlyMap<string, DefHash>;
  readonly byName: ReadonlyMap<string, readonly DefHash[]>;
  readonly dependents: ReadonlyMap<DefHash, readonly DefHash[]>;
  readonly metadata: ReadonlyMap<DefHash, PresentationMeta>;
  readonly languageProfile: string;
}

export type EvidenceKind = "typecheck" | "artifact" | "test" | "verification";

/** Structurally aligned with `packages/ts/src/store/types.ts` EvidenceSummary. */
export interface EvidenceSummary {
  readonly defHash: DefHash;
  readonly kinds: readonly EvidenceKind[];
  readonly records: readonly unknown[];
}

export type EvidenceLookup =
  | ReadonlyMap<DefHash, EvidenceSummary>
  | ((hash: DefHash) => EvidenceSummary | undefined);

export interface GetDefinitionOptions {
  readonly evidence?: EvidenceLookup | undefined;
}

export interface DefinitionDetails {
  readonly hash: DefHash;
  readonly kind: StoreDefinitionKind;
  readonly name: string;
  readonly qualifiedName: string;
  readonly moduleId: string;
  readonly signature?: string | undefined;
  readonly canonicalSignature?: string | undefined;
  readonly requirements: readonly string[];
  readonly errors: readonly string[];
  readonly authoredSource?: string | undefined;
  readonly docstring?: string | undefined;
  readonly span?: PresentationMeta["span"] | undefined;
  readonly languageProfile: string;
  readonly dependencies: readonly DefHash[];
  readonly formDependencies: readonly DefHash[];
  readonly opaqueRefs: readonly OpaqueBoundaryRef[];
  readonly scc?: SccMembership | undefined;
  readonly evidence?: EvidenceSummary | undefined;
  /** Present when an unqualified name matched multiple definitions. */
  readonly ambiguousMatches?: readonly DefHash[] | undefined;
}

export interface FindDependentsOptions {
  readonly transitive?: boolean | undefined;
  readonly includeSelf?: boolean | undefined;
  readonly maxDepth?: number | undefined;
}

export interface FindDependenciesOptions {
  readonly transitive?: boolean | undefined;
  readonly includeFormDependencies?: boolean | undefined;
  readonly includeSelf?: boolean | undefined;
  readonly maxDepth?: number | undefined;
}

function compareRecords(a: DefinitionRecord, b: DefinitionRecord): number {
  const byQualified = a.qualifiedName.localeCompare(b.qualifiedName);
  if (byQualified !== 0) return byQualified;
  return a.hash.localeCompare(b.hash);
}

function sortRecords(records: Iterable<DefinitionRecord>): readonly DefinitionRecord[] {
  return [...records].sort(compareRecords);
}

function lookupEvidence(
  lookup: EvidenceLookup | undefined,
  hash: DefHash,
): EvidenceSummary | undefined {
  if (!lookup) return undefined;
  return typeof lookup === "function" ? lookup(hash) : lookup.get(hash);
}

/**
 * Resolve a `DefHash`, qualified name, or unqualified short name to matching
 * `DefHash` values in deterministic order.
 */
export function resolveDefinitionHashes(
  index: DefinitionIndex,
  nameOrHash: string,
): readonly DefHash[] {
  if (!nameOrHash) return [];
  if (index.definitions.has(nameOrHash)) return [nameOrHash];
  const byQualified = index.bindings.get(nameOrHash);
  if (byQualified !== undefined && index.definitions.has(byQualified)) {
    return [byQualified];
  }
  const byShort = index.byName.get(nameOrHash);
  if (byShort && byShort.length > 0) {
    const records: DefinitionRecord[] = [];
    const seen = new Set<DefHash>();
    for (const hash of byShort) {
      if (seen.has(hash)) continue;
      const record = index.definitions.get(hash);
      if (record) {
        seen.add(hash);
        records.push(record);
      }
    }
    return sortRecords(records).map((record) => record.hash);
  }
  return [];
}

/** Resolve a `DefHash`, qualified name, or short name to a single primary `DefHash`. */
export function resolveDefinitionHash(
  index: DefinitionIndex,
  nameOrHash: string,
): DefHash | undefined {
  return resolveDefinitionHashes(index, nameOrHash)[0];
}

/**
 * Look up a definition by `DefHash`, qualified name, or unqualified name,
 * returning its signature, requirements, errors, authored source, dependencies,
 * and optional cached evidence summary.
 */
export function getDefinition(
  index: DefinitionIndex,
  nameOrHash: string,
  options?: GetDefinitionOptions,
): DefinitionDetails | undefined {
  const matches = resolveDefinitionHashes(index, nameOrHash);
  const hash = matches[0];
  if (!hash) return undefined;
  const record = index.definitions.get(hash);
  if (!record) return undefined;
  const meta = index.metadata.get(hash) ?? record.meta;
  const evidence = lookupEvidence(options?.evidence, hash);
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
    ...(evidence !== undefined ? { evidence } : {}),
    ...(matches.length > 1 ? { ambiguousMatches: matches } : {}),
  };
}

function directDependentHashes(index: DefinitionIndex, targetHash: DefHash): readonly DefHash[] {
  const precomputed = index.dependents.get(targetHash);
  if (precomputed !== undefined) return precomputed;
  const found: DefHash[] = [];
  for (const record of index.definitions.values()) {
    if (
      record.dependencies.includes(targetHash) ||
      record.formDependencies.includes(targetHash)
    ) {
      found.push(record.hash);
    }
  }
  return found;
}

/**
 * Find direct or transitive dependents of a definition (by `DefHash` or name).
 * Cycle-safe across mutually recursive SCCs.
 */
export function findDependents(
  index: DefinitionIndex,
  nameOrHash: string,
  options?: FindDependentsOptions,
): readonly DefinitionRecord[] {
  const targetHash = resolveDefinitionHash(index, nameOrHash);
  if (!targetHash) return [];
  const transitive = options?.transitive === true;
  const includeSelf = options?.includeSelf === true;
  const maxDepth =
    options?.maxDepth !== undefined
      ? Math.max(0, options.maxDepth)
      : transitive
        ? Number.POSITIVE_INFINITY
        : 1;

  const visited = new Set<DefHash>();
  const results = new Map<DefHash, DefinitionRecord>();
  const queue: Array<{ readonly hash: DefHash; readonly depth: number }> = [
    { hash: targetHash, depth: 0 },
  ];
  visited.add(targetHash);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    for (const depHash of directDependentHashes(index, current.hash)) {
      const record = index.definitions.get(depHash);
      if (!record) continue;
      if (depHash === targetHash) {
        if (includeSelf) results.set(depHash, record);
        continue;
      }
      if (!results.has(depHash)) {
        results.set(depHash, record);
      }
      if (!visited.has(depHash)) {
        visited.add(depHash);
        if (transitive && current.depth + 1 < maxDepth) {
          queue.push({ hash: depHash, depth: current.depth + 1 });
        }
      }
    }
  }

  return sortRecords(results.values());
}

/**
 * Find direct or transitive dependencies of a definition (by `DefHash` or name).
 * Cycle-safe across mutually recursive SCCs.
 */
export function findDependencies(
  index: DefinitionIndex,
  nameOrHash: string,
  options?: FindDependenciesOptions,
): readonly DefinitionRecord[] {
  const targetHash = resolveDefinitionHash(index, nameOrHash);
  if (!targetHash) return [];
  const transitive = options?.transitive === true;
  const includeFormDependencies = options?.includeFormDependencies !== false;
  const includeSelf = options?.includeSelf === true;
  const maxDepth =
    options?.maxDepth !== undefined
      ? Math.max(0, options.maxDepth)
      : transitive
        ? Number.POSITIVE_INFINITY
        : 1;

  const visited = new Set<DefHash>();
  const results = new Map<DefHash, DefinitionRecord>();
  const queue: Array<{ readonly hash: DefHash; readonly depth: number }> = [
    { hash: targetHash, depth: 0 },
  ];
  visited.add(targetHash);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    const record = index.definitions.get(current.hash);
    if (!record) continue;
    const edges = includeFormDependencies
      ? [...record.dependencies, ...record.formDependencies]
      : record.dependencies;
    for (const depHash of edges) {
      const depRecord = index.definitions.get(depHash);
      if (!depRecord) continue;
      if (depHash === targetHash) {
        if (includeSelf) results.set(depHash, depRecord);
        continue;
      }
      if (!results.has(depHash)) {
        results.set(depHash, depRecord);
      }
      if (!visited.has(depHash)) {
        visited.add(depHash);
        if (transitive && current.depth + 1 < maxDepth) {
          queue.push({ hash: depHash, depth: current.depth + 1 });
        }
      }
    }
  }

  return sortRecords(results.values());
}

function matchesCapability(requirement: string, serviceOrOp: string): boolean {
  const query = serviceOrOp.trim();
  if (!query) return false;
  if (query.endsWith(".*")) {
    const service = query.slice(0, -2);
    return requirement === service || requirement.startsWith(`${service}.`);
  }
  if (requirement === query) return true;
  if (!query.includes(".") && requirement.startsWith(`${query}.`)) return true;
  return false;
}

/**
 * Find all definitions that require a given service or operation capability
 * (e.g. `"Users"` matches `"Users"` and `"Users.find"`; `"Users.find"` matches
 * `"Users.find"`).
 */
export function queryByCapability(
  index: DefinitionIndex,
  serviceOrOp: string,
): readonly DefinitionRecord[] {
  const query = serviceOrOp.trim();
  if (!query) return [];
  const matches: DefinitionRecord[] = [];
  for (const record of index.definitions.values()) {
    if (record.requirements.some((req) => matchesCapability(req, query))) {
      matches.push(record);
    }
  }
  return sortRecords(matches);
}

function matchesError(error: string, errorName: string): boolean {
  const query = errorName.trim();
  if (!query) return false;
  if (error === query) return true;
  if (!query.includes("/") && !query.includes(":")) {
    return error.endsWith(`/${query}`) || error.endsWith(`:${query}`);
  }
  return false;
}

/**
 * Find all definitions whose declared or inferred error set includes `errorName`.
 */
export function queryByError(
  index: DefinitionIndex,
  errorName: string,
): readonly DefinitionRecord[] {
  const query = errorName.trim();
  if (!query) return [];
  const matches: DefinitionRecord[] = [];
  for (const record of index.definitions.values()) {
    if (record.errors.some((err) => matchesError(err, query))) {
      matches.push(record);
    }
  }
  return sortRecords(matches);
}
