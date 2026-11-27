/**
 * Shared types for RFC 0029: Content-addressed codebase store,
 * canonical definition hashing, read-only definition index, and hash-keyed evidence.
 *
 * Browser-safe: contains no Node-only imports.
 */

export const DEF_HASH_VERSION = "def:v1" as const;
export const SCC_HASH_VERSION = "scc:v1" as const;
export const EVIDENCE_FORMAT_VERSION = "forma-evidence/v1" as const;
export const DEFAULT_LANGUAGE_PROFILE = "forma-core-v1" as const;

/** Tagged SHA-256 content hash of a canonicalized definition (e.g. `def:v1:<hex>`). */
export type DefHash = string;

/** Tagged SHA-256 content hash of a mutually recursive strongly connected component (`scc:v1:<hex>`). */
export type SccHash = string;

/** Deterministic digest of the checker/emitter toolchain, language profile, and prelude digests. */
export type ToolchainDigest = string;

/** Deterministic digest of any extra inputs to an evidence computation (e.g. emitter target options). */
export type InputDigest = string;

/** Declaration kinds represented in the content-addressed definition store. */
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

/**
 * Opaque boundary reference for host builtins, external Effect/npm imports,
 * and native providers. Pinned by declared Forma interface signature plus
 * an explicit package/runtime digest.
 */
export interface OpaqueBoundaryRef {
  readonly kind: "builtin" | "external-package" | "native-provider";
  readonly name: string;
  /** Declared Forma interface signature (canonical scheme digest or formatted type). */
  readonly signature: string;
  /** Explicit package or runtime digest pinning this boundary. */
  readonly runtimeDigest: string;
}

/**
 * Presentation metadata stored separately from semantic definition identity.
 * Editing formatting, comments, docstrings, or display names updates this
 * metadata without changing `DefHash`.
 */
export interface PresentationMeta {
  readonly displayName: string;
  readonly qualifiedName: string;
  readonly moduleId: string;
  readonly authoredSource?: string | undefined;
  readonly docstring?: string | undefined;
  readonly span?: {
    readonly start: number;
    readonly end: number;
    readonly sourceId?: string | undefined;
  } | undefined;
}

/** Membership metadata for a definition inside a mutually recursive SCC. */
export interface SccMembership {
  readonly sccHash: SccHash;
  readonly memberIndex: number;
  readonly memberCount: number;
}

/**
 * Immutable content-addressed definition object stored in a `DefinitionIndex`.
 */
export interface DefinitionRecord {
  readonly hash: DefHash;
  readonly kind: StoreDefinitionKind;
  /** Canonical semantic encoding (alpha-equivalent locals, sorted records/sets, DefHash refs) hashed to produce `hash`. */
  readonly canonicalForm: string;
  /** Qualified name in the index (e.g. `moduleId::name`). */
  readonly qualifiedName: string;
  /** Unqualified local name in its module. */
  readonly name: string;
  /** Owning module or document identifier. */
  readonly moduleId: string;
  /** Human-readable resolved type/effect signature, when available. */
  readonly signature?: string | undefined;
  /** Alpha-normalized canonical signature digest included in `hash`, when available. */
  readonly canonicalSignature?: string | undefined;
  /** Sorted concrete Effect requirements (e.g. `["Clock", "Db.get"]`). */
  readonly requirements: readonly string[];
  /** Sorted concrete Effect error names (e.g. `["NotFound"]`). */
  readonly errors: readonly string[];
  /** Language profile identifier pinned in the hash. */
  readonly languageProfile: string;
  /** Sorted `DefHash` list of direct definition dependencies. */
  readonly dependencies: readonly DefHash[];
  /** Sorted `DefHash` list of macro or `form` descriptors that participated in expansion/elaboration. */
  readonly formDependencies: readonly DefHash[];
  /** Sorted pinned opaque external/builtin references used by this definition. */
  readonly opaqueRefs: readonly OpaqueBoundaryRef[];
  /** Present when this definition participates in a recursive or mutually recursive SCC. */
  readonly scc?: SccMembership | undefined;
  /** Presentation metadata (excluded from `hash`). */
  readonly meta: PresentationMeta;
}

/**
 * Read-only in-memory index over content-addressed definitions.
 */
export interface DefinitionIndex {
  /** All definitions keyed by `DefHash`. */
  readonly definitions: ReadonlyMap<DefHash, DefinitionRecord>;
  /** Name-to-hash lookup (`qualifiedName` -> `DefHash`, plus unambiguous unqualified names). */
  readonly bindings: ReadonlyMap<string, DefHash>;
  /** Unqualified name -> matching `DefHash` values (supports coexisting versions / multiple modules). */
  readonly byName: ReadonlyMap<string, readonly DefHash[]>;
  /** Reverse dependency adjacency: `targetDefHash` -> sorted direct dependent `DefHash`es. */
  readonly dependents: ReadonlyMap<DefHash, readonly DefHash[]>;
  /** Presentation metadata table keyed by `DefHash`. */
  readonly metadata: ReadonlyMap<DefHash, PresentationMeta>;
  /** Language profile used to construct this index. */
  readonly languageProfile: string;
}

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
