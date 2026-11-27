/**
 * Local hash-keyed evidence cache for RFC 0029 Stage 1.
 *
 * Keys immutable verification and build outputs (`typecheck`, `artifact`,
 * deterministic `test`, bounded `verification`) by
 * `(defHash, kind, toolchainDigest, inputDigest)`, records an explicit trust
 * account on every entry, and rejects caching of non-deterministic or
 * requirement-bearing test evidence.
 *
 * Browser-safe: contains no Node-only imports. Node filesystem persistence is
 * provided via `FileEvidenceBackend` in `../node/evidence-store.ts`.
 */

import { engineVersion } from "../Engine.js";
import type { JsonValue } from "../artifact/artifact.js";
import { canonicalJson, sha256 } from "../artifact/canonical-json.js";
import {
  DEFAULT_TOOLCHAIN_LANGUAGE_PROFILE,
  computeInputDigest,
  type InputDigest,
  type ToolchainDigest,
} from "./toolchain-digest.js";

// ---------------------------------------------------------------------------
// Shared RFC 0029 evidence types (structurally aligned with `./types.ts`)
// ---------------------------------------------------------------------------

export const EVIDENCE_FORMAT_VERSION = "forma-evidence/v1" as const;

/** Tagged SHA-256 content hash of a canonicalized definition (e.g. `def:v1:<hex>`). */
export type DefHash = string;

/** Verification and build evidence kinds (RFC 0029 §3). */
export type EvidenceKind = "typecheck" | "artifact" | "test" | "verification";

/** Composite cache key for immutable evidence records. */
export interface EvidenceKey {
  readonly defHash: DefHash;
  readonly kind: EvidenceKind;
  readonly toolchainDigest: ToolchainDigest;
  readonly inputDigest: InputDigest;
}

/** Explicit trust account naming the checker, kernel, runner, or solver that produced an evidence record. */
export interface EvidenceTrustAccount {
  readonly producer: string;
  readonly version: string;
  readonly profile: string;
  readonly deterministic: boolean;
  readonly assumptions?: readonly string[] | undefined;
  readonly notes?: string | undefined;
}

/** Alias for `EvidenceTrustAccount`. */
export type TrustAccount = EvidenceTrustAccount;

export interface TypecheckEvidencePayload {
  readonly ok: boolean;
  readonly signature?: string | undefined;
  readonly requirements: readonly string[];
  readonly errors: readonly string[];
  readonly diagnostics: readonly {
    readonly code?: string | undefined;
    readonly message: string;
    readonly severity?: string | undefined;
  }[];
}

export interface ArtifactEvidencePayload {
  readonly format: "canonical-ir" | "effect-ts";
  readonly content: string;
  readonly contentHash: string;
}

export interface TestEvidencePayload {
  readonly passed: boolean;
  readonly requirements: readonly string[];
  readonly runnerProfile: string;
  readonly deterministicRunner: boolean;
  readonly summary?: string | undefined;
}

export interface VerificationEvidencePayload {
  readonly result: "holds-in-model" | "counterexample" | "inconclusive";
  readonly bounds: Readonly<Record<string, unknown>>;
  readonly assumptions: readonly string[];
  readonly counterexample?: unknown;
}

export type EvidencePayload =
  | TypecheckEvidencePayload
  | ArtifactEvidencePayload
  | TestEvidencePayload
  | VerificationEvidencePayload;

/** Immutable hash-keyed evidence record. */
export interface EvidenceRecord<TPayload = unknown> {
  readonly formatVersion: typeof EVIDENCE_FORMAT_VERSION;
  readonly key: EvidenceKey;
  readonly trust: EvidenceTrustAccount;
  readonly payload: TPayload;
  readonly createdAt?: string | undefined;
}

/** Summary of cached evidence for a definition (used by read queries). */
export interface EvidenceSummary {
  readonly defHash: DefHash;
  readonly kinds: readonly EvidenceKind[];
  readonly records: readonly EvidenceRecord[];
}

// ---------------------------------------------------------------------------
// Evidence key canonicalization & hashing
// ---------------------------------------------------------------------------

export const EVIDENCE_KEY_VERSION = "evidence-key:v1" as const;

/** Canonical JSON representation of an `EvidenceKey`. */
export function serializeEvidenceKey(key: EvidenceKey): string {
  return canonicalJson({
    version: EVIDENCE_KEY_VERSION,
    defHash: key.defHash,
    kind: key.kind,
    toolchainDigest: key.toolchainDigest,
    inputDigest: key.inputDigest,
  });
}

/** Deterministic SHA-256 hex key for addressing an `EvidenceRecord` in storage. */
export function hashEvidenceKey(key: EvidenceKey): string {
  return sha256(serializeEvidenceKey(key));
}

function keysEqual(a: EvidenceKey, b: EvidenceKey): boolean {
  return (
    a.defHash === b.defHash &&
    a.kind === b.kind &&
    a.toolchainDigest === b.toolchainDigest &&
    a.inputDigest === b.inputDigest
  );
}

// ---------------------------------------------------------------------------
// Cacheability & trust-boundary guards (RFC 0029 §3)
// ---------------------------------------------------------------------------

export type EvidenceCacheRejectionReason =
  | "missing-trust-account"
  | "non-deterministic-trust-account"
  | "non-empty-test-requirements"
  | "non-deterministic-test-runner"
  | "missing-runner-profile"
  | "verification-missing-bounds";

export type EvidenceCacheabilityResult =
  | { readonly cacheable: true }
  | {
      readonly cacheable: false;
      readonly reason: EvidenceCacheRejectionReason;
      readonly message: string;
    };

/** Error thrown when attempting to persist non-cacheable evidence into `EvidenceCache`. */
export class EvidenceCacheRejectionError extends Error {
  readonly reason: EvidenceCacheRejectionReason;
  readonly key: EvidenceKey;

  constructor(reason: EvidenceCacheRejectionReason, message: string, key: EvidenceKey) {
    super(message);
    this.name = "EvidenceCacheRejectionError";
    this.reason = reason;
    this.key = key;
  }
}

function isTestPayload(payload: unknown): payload is TestEvidencePayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "passed" in payload &&
    "requirements" in payload &&
    "runnerProfile" in payload &&
    "deterministicRunner" in payload
  );
}

function isVerificationPayload(payload: unknown): payload is VerificationEvidencePayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "result" in payload &&
    "bounds" in payload &&
    "assumptions" in payload
  );
}

/**
 * Enforce RFC 0029 §3 cacheability and trust-boundary rules:
 * - Every record must carry a complete `TrustAccount` (`producer`, `version`, `profile`).
 * - `test` evidence is cacheable ONLY when its requirement set is empty AND it ran
 *   under a declared deterministic runner profile (`deterministicRunner: true`,
 *   `trust.deterministic: true`, non-empty `runnerProfile`).
 * - `typecheck` and `artifact` evidence must declare `trust.deterministic: true`.
 * - `verification` evidence must record explicit `bounds` and `assumptions`
 *   (and is never cached as a general proof).
 */
export function checkEvidenceCacheability(record: EvidenceRecord): EvidenceCacheabilityResult {
  const { key, trust, payload } = record;
  if (!trust || !trust.producer.trim() || !trust.version.trim() || !trust.profile.trim()) {
    return {
      cacheable: false,
      reason: "missing-trust-account",
      message: `Evidence record for ${key.defHash} (${key.kind}) must include producer, version, and profile in its trust account.`,
    };
  }

  if (key.kind === "test") {
    if (!isTestPayload(payload)) {
      return {
        cacheable: false,
        reason: "non-deterministic-test-runner",
        message: `Test evidence for ${key.defHash} does not carry a valid TestEvidencePayload.`,
      };
    }
    if (payload.requirements.length > 0) {
      return {
        cacheable: false,
        reason: "non-empty-test-requirements",
        message: `Refusing to cache test evidence for ${key.defHash}: requirement set is non-empty (${payload.requirements.join(", ")}).`,
      };
    }
    if (!payload.deterministicRunner || !trust.deterministic) {
      return {
        cacheable: false,
        reason: "non-deterministic-test-runner",
        message: `Refusing to cache test evidence for ${key.defHash}: runner profile "${payload.runnerProfile}" is not declared deterministic.`,
      };
    }
    if (!payload.runnerProfile.trim()) {
      return {
        cacheable: false,
        reason: "missing-runner-profile",
        message: `Refusing to cache test evidence for ${key.defHash}: runnerProfile must be non-empty.`,
      };
    }
    return { cacheable: true };
  }

  if (!trust.deterministic) {
    return {
      cacheable: false,
      reason: "non-deterministic-trust-account",
      message: `Refusing to cache ${key.kind} evidence for ${key.defHash}: trust account is marked non-deterministic.`,
    };
  }

  if (key.kind === "verification") {
    if (
      !isVerificationPayload(payload) ||
      typeof payload.bounds !== "object" ||
      payload.bounds === null ||
      Object.keys(payload.bounds).length === 0
    ) {
      return {
        cacheable: false,
        reason: "verification-missing-bounds",
        message: `Refusing to cache verification evidence for ${key.defHash}: explicit finite-model bounds are required.`,
      };
    }
  }

  return { cacheable: true };
}

// ---------------------------------------------------------------------------
// Storage backend interface + browser-safe in-memory implementation
// ---------------------------------------------------------------------------

/** Pluggable backing store for `EvidenceCache` (in-memory or Node filesystem). */
export interface EvidenceStoreBackend {
  get(keyHash: string): EvidenceRecord | undefined;
  set(keyHash: string, record: EvidenceRecord): void;
  has(keyHash: string): boolean;
  delete(keyHash: string): boolean;
  listByDefHash(defHash: DefHash): readonly EvidenceRecord[];
  clear(): void;
  size(): number;
}

/** Browser-safe in-memory `EvidenceStoreBackend`. */
export class InMemoryEvidenceBackend implements EvidenceStoreBackend {
  readonly #records = new Map<string, EvidenceRecord>();
  readonly #byDefHash = new Map<DefHash, Set<string>>();

  get(keyHash: string): EvidenceRecord | undefined {
    return this.#records.get(keyHash);
  }

  set(keyHash: string, record: EvidenceRecord): void {
    this.#records.set(keyHash, record);
    let keys = this.#byDefHash.get(record.key.defHash);
    if (!keys) {
      keys = new Set<string>();
      this.#byDefHash.set(record.key.defHash, keys);
    }
    keys.add(keyHash);
  }

  has(keyHash: string): boolean {
    return this.#records.has(keyHash);
  }

  delete(keyHash: string): boolean {
    const existing = this.#records.get(keyHash);
    if (!existing) return false;
    this.#records.delete(keyHash);
    const keys = this.#byDefHash.get(existing.key.defHash);
    if (keys) {
      keys.delete(keyHash);
      if (keys.size === 0) this.#byDefHash.delete(existing.key.defHash);
    }
    return true;
  }

  listByDefHash(defHash: DefHash): readonly EvidenceRecord[] {
    const keys = this.#byDefHash.get(defHash);
    if (!keys) return [];
    const results: EvidenceRecord[] = [];
    for (const keyHash of keys) {
      const record = this.#records.get(keyHash);
      if (record) results.push(record);
    }
    return results.sort(compareEvidenceRecords);
  }

  clear(): void {
    this.#records.clear();
    this.#byDefHash.clear();
  }

  size(): number {
    return this.#records.size;
  }
}

export function compareEvidenceRecords(a: EvidenceRecord, b: EvidenceRecord): number {
  return (
    a.key.kind.localeCompare(b.key.kind) ||
    a.key.toolchainDigest.localeCompare(b.key.toolchainDigest) ||
    a.key.inputDigest.localeCompare(b.key.inputDigest)
  );
}

// ---------------------------------------------------------------------------
// EvidenceCache
// ---------------------------------------------------------------------------

export interface EvidenceCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly stores: number;
  readonly rejections: number;
  readonly entries: number;
}

export interface GetOrComputeResult<TPayload = unknown> {
  readonly record: EvidenceRecord<TPayload>;
  /** True when served from cache without invoking `compute`. */
  readonly hit: boolean;
  /** True when the result is present in the cache (hit or newly stored). */
  readonly cached: boolean;
  /** Present when `compute` produced a non-cacheable record and `rejectUncacheable` was false. */
  readonly rejectionReason?: EvidenceCacheRejectionReason | undefined;
}

export interface GetOrComputeOptions {
  /** When true, throw `EvidenceCacheRejectionError` if the computed record is not cacheable. */
  readonly rejectUncacheable?: boolean | undefined;
}

export class EvidenceCache {
  readonly #backend: EvidenceStoreBackend;
  #hits = 0;
  #misses = 0;
  #stores = 0;
  #rejections = 0;

  constructor(backend: EvidenceStoreBackend = new InMemoryEvidenceBackend()) {
    this.#backend = backend;
  }

  get<TPayload = unknown>(
    key: EvidenceKey,
  ): EvidenceRecord<TPayload> | undefined {
    const keyHash = hashEvidenceKey(key);
    const record = this.#backend.get(keyHash);
    if (!record || !keysEqual(record.key, key)) {
      this.#misses++;
      return undefined;
    }
    this.#hits++;
    return record as EvidenceRecord<TPayload>;
  }

  /**
   * Persist an evidence record. Throws `EvidenceCacheRejectionError` if the
   * record violates RFC 0029 §3 cacheability rules (for example, a test with
   * non-empty requirements or a non-deterministic runner).
   */
  set<TPayload = unknown>(record: EvidenceRecord<TPayload>): void {
    const check = checkEvidenceCacheability(record);
    if (!check.cacheable) {
      this.#rejections++;
      throw new EvidenceCacheRejectionError(check.reason, check.message, record.key);
    }
    this.#backend.set(hashEvidenceKey(record.key), record);
    this.#stores++;
  }

  /**
   * Persist an evidence record if cacheable; otherwise return the rejection
   * reason without throwing.
   */
  putIfCacheable<TPayload = unknown>(
    record: EvidenceRecord<TPayload>,
  ):
    | { readonly stored: true }
    | {
        readonly stored: false;
        readonly reason: EvidenceCacheRejectionReason;
        readonly message: string;
      } {
    const check = checkEvidenceCacheability(record);
    if (!check.cacheable) {
      this.#rejections++;
      return { stored: false, reason: check.reason, message: check.message };
    }
    this.#backend.set(hashEvidenceKey(record.key), record);
    this.#stores++;
    return { stored: true };
  }

  has(key: EvidenceKey): boolean {
    const keyHash = hashEvidenceKey(key);
    const record = this.#backend.get(keyHash);
    return record !== undefined && keysEqual(record.key, key);
  }

  delete(key: EvidenceKey): boolean {
    return this.#backend.delete(hashEvidenceKey(key));
  }

  /** Return all cached evidence records for a definition, grouped into an `EvidenceSummary`. */
  summary(defHash: DefHash): EvidenceSummary {
    const records = this.#backend.listByDefHash(defHash);
    const kinds = [...new Set(records.map((r) => r.key.kind))].sort() as EvidenceKind[];
    return { defHash, kinds, records };
  }

  /**
   * Look up cached evidence for `key`; on miss, invoke `compute()`, validate
   * cacheability, store when cacheable, and return the record with hit metadata.
   */
  getOrCompute<TPayload = unknown>(
    key: EvidenceKey,
    compute: () => {
      readonly payload: TPayload;
      readonly trust: EvidenceTrustAccount;
      readonly createdAt?: string | undefined;
    },
    options: GetOrComputeOptions = {},
  ): GetOrComputeResult<TPayload> {
    const existing = this.get<TPayload>(key);
    if (existing !== undefined) {
      return { record: existing, hit: true, cached: true };
    }

    const produced = compute();
    const record: EvidenceRecord<TPayload> = {
      formatVersion: EVIDENCE_FORMAT_VERSION,
      key,
      trust: produced.trust,
      payload: produced.payload,
      createdAt: produced.createdAt ?? new Date().toISOString(),
    };

    const check = checkEvidenceCacheability(record);
    if (!check.cacheable) {
      this.#rejections++;
      if (options.rejectUncacheable) {
        throw new EvidenceCacheRejectionError(check.reason, check.message, key);
      }
      return {
        record,
        hit: false,
        cached: false,
        rejectionReason: check.reason,
      };
    }

    this.#backend.set(hashEvidenceKey(key), record);
    this.#stores++;
    return { record, hit: false, cached: true };
  }

  clear(): void {
    this.#backend.clear();
  }

  stats(): EvidenceCacheStats {
    return {
      hits: this.#hits,
      misses: this.#misses,
      stores: this.#stores,
      rejections: this.#rejections,
      entries: this.#backend.size(),
    };
  }

  resetStats(): void {
    this.#hits = 0;
    this.#misses = 0;
    this.#stores = 0;
    this.#rejections = 0;
  }
}

// ---------------------------------------------------------------------------
// Stage 1 typed helpers for `typecheck` and `artifact` evidence
// ---------------------------------------------------------------------------

export interface CachedTypecheckOptions {
  readonly defHash: DefHash;
  readonly toolchainDigest: ToolchainDigest;
  readonly input?: JsonValue | undefined;
  readonly inputDigest?: InputDigest | undefined;
  readonly trust?: Partial<TrustAccount> | undefined;
  readonly compute: () => TypecheckEvidencePayload;
}

/**
 * Reuse cached `typecheck` evidence for `(defHash, toolchainDigest, inputDigest)`,
 * invoking `compute` only on cache miss.
 */
export function cachedTypecheck(
  cache: EvidenceCache,
  options: CachedTypecheckOptions,
): GetOrComputeResult<TypecheckEvidencePayload> {
  const key: EvidenceKey = {
    defHash: options.defHash,
    kind: "typecheck",
    toolchainDigest: options.toolchainDigest,
    inputDigest: options.inputDigest ?? computeInputDigest(options.input),
  };
  return cache.getOrCompute<TypecheckEvidencePayload>(key, () => ({
    payload: options.compute(),
    trust: {
      producer: options.trust?.producer ?? "forma-hm-effect-checker",
      version: options.trust?.version ?? engineVersion,
      profile: options.trust?.profile ?? DEFAULT_TOOLCHAIN_LANGUAGE_PROFILE,
      deterministic: options.trust?.deterministic ?? true,
      ...(options.trust?.notes !== undefined ? { notes: options.trust.notes } : {}),
    },
  }));
}

export interface CachedArtifactOptions {
  readonly defHash: DefHash;
  readonly format: "canonical-ir" | "effect-ts";
  readonly toolchainDigest: ToolchainDigest;
  readonly input?: JsonValue | undefined;
  readonly inputDigest?: InputDigest | undefined;
  readonly trust?: Partial<TrustAccount> | undefined;
  readonly emit: () => string;
}

/**
 * Reuse cached `artifact` evidence (canonical IR or Effect TypeScript) for
 * `(defHash, toolchainDigest, inputDigest)`, invoking `emit` only on cache miss.
 */
export function cachedArtifact(
  cache: EvidenceCache,
  options: CachedArtifactOptions,
): GetOrComputeResult<ArtifactEvidencePayload> {
  const key: EvidenceKey = {
    defHash: options.defHash,
    kind: "artifact",
    toolchainDigest: options.toolchainDigest,
    inputDigest:
      options.inputDigest ??
      computeInputDigest({
        format: options.format,
        ...(options.input !== undefined ? { input: options.input } : {}),
      }),
  };
  return cache.getOrCompute<ArtifactEvidencePayload>(key, () => {
    const content = options.emit();
    return {
      payload: {
        format: options.format,
        content,
        contentHash: sha256(content),
      },
      trust: {
        producer:
          options.trust?.producer ??
          (options.format === "canonical-ir"
            ? "forma-canonical-ir-emitter"
            : "forma-effect-ts-emitter"),
        version: options.trust?.version ?? engineVersion,
        profile: options.trust?.profile ?? DEFAULT_TOOLCHAIN_LANGUAGE_PROFILE,
        deterministic: options.trust?.deterministic ?? true,
        ...(options.trust?.notes !== undefined ? { notes: options.trust.notes } : {}),
      },
    };
  });
}
