/**
 * RFC 0027 (Stages 1–2): Directional contract diffs and checked pure payload migrations.
 *
 * Browser-safe: zero `node:*` imports.
 */

// ---------------------------------------------------------------------------
// Core verdicts, policies, and source locations
// ---------------------------------------------------------------------------

/** Directional compatibility verdict. `unknown` must never silently pass as `compatible`. */
export type CompatibilityVerdict = "compatible" | "incompatible" | "unknown";

/** Decoder behavior when encountering fields not declared in the schema. */
export type UnknownFieldPolicy = "reject" | "ignore";

/** Source location for diagnostics and diff issues. */
export interface SourceSpan {
  readonly file?: string;
  readonly startLine?: number;
  readonly startCol?: number;
  readonly endLine?: number;
  readonly endCol?: number;
  readonly offset?: number;
  readonly length?: number;
}

/** Codec metadata attached to a contract snapshot. */
export interface CodecInfo {
  readonly name: string;
  readonly version: string;
  readonly unknownFieldPolicy?: UnknownFieldPolicy;
  /** When explicitly `false`, the diff engine yields `"unknown"` rather than guessing. */
  readonly supported?: boolean;
  /** When `true`, wire semantics are opaque native code and yield `"unknown"`. */
  readonly opaque?: boolean;
  readonly profile?: string;
}

// ---------------------------------------------------------------------------
// Contract type graph (finite data shapes, refinements, recursion, opaque)
// ---------------------------------------------------------------------------

/** Exact numeric interval refinement. */
export interface NumericInterval {
  readonly min?: number;
  readonly max?: number;
  readonly minExclusive?: boolean;
  readonly maxExclusive?: boolean;
  /** When `true`, only integer values in the interval are accepted. */
  readonly integer?: boolean;
  /** Optional divisibility constraint. */
  readonly multipleOf?: number;
}

/** Exact string length, literal, or regex refinement. */
export interface StringRefinement {
  readonly minLength?: number;
  readonly maxLength?: number;
  /** Finite set of allowed string literals. */
  readonly literals?: readonly string[];
  /** Regex pattern. Implication between distinct regexes yields `"unknown"`. */
  readonly pattern?: string;
}

export type PrimitiveTypeName =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null"
  | "bytes";

export interface ContractPrimitiveNode {
  readonly kind: "primitive";
  readonly primitive: PrimitiveTypeName;
  readonly interval?: NumericInterval;
  readonly stringRefinement?: StringRefinement;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export interface ContractLiteralNode {
  readonly kind: "literal";
  readonly value: string | number | boolean | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export interface ContractRecordField {
  /** Wire field name. */
  readonly name: string;
  /** Optional stable declaration identity used before falling back to rename map or name. */
  readonly id?: string;
  readonly type: ContractTypeNode;
  /** Whether the field key may be absent on the wire (orthogonal to `nullable`). */
  readonly optional?: boolean;
  /** Whether the field value may be `null` on the wire (orthogonal to `optional`). */
  readonly nullable?: boolean;
  readonly defaultValue?: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export interface ContractRecordNode {
  readonly kind: "record";
  readonly fields: readonly ContractRecordField[];
  /** Per-record override of the snapshot/codec unknown-field policy. */
  readonly unknownFields?: UnknownFieldPolicy;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export interface ContractArrayNode {
  readonly kind: "array";
  readonly element: ContractTypeNode;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export interface ContractTupleNode {
  readonly kind: "tuple";
  readonly elements: readonly ContractTypeNode[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export interface ContractMapNode {
  readonly kind: "map";
  readonly key: ContractTypeNode;
  readonly value: ContractTypeNode;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export interface ContractUnionVariant {
  /** Wire discriminator tag value. */
  readonly tag: string;
  /** Optional stable declaration identity. */
  readonly id?: string;
  readonly payload: ContractTypeNode;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export interface ContractTaggedUnionNode {
  readonly kind: "tagged-union";
  readonly tagField: string;
  readonly variants: readonly ContractUnionVariant[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export interface ContractUnionNode {
  readonly kind: "union";
  readonly members: readonly ContractTypeNode[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export type OptionRepresentation = "nullable" | "absent" | "tagged";

export interface ContractOptionNode {
  readonly kind: "option";
  readonly inner: ContractTypeNode;
  /** Wire encoding of `Option`: `nullable` (`T | null`), `absent` (`T | undefined`), or `tagged`. */
  readonly representation?: OptionRepresentation;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export interface ContractRefNode {
  readonly kind: "ref";
  /** Name of a declaration in `snapshot.types`. */
  readonly target: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export interface ContractOpaqueNode {
  readonly kind: "opaque";
  readonly codec?: string;
  readonly reason: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export interface ContractGenericRowNode {
  readonly kind: "generic-row";
  readonly constraint: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export interface ContractUnsupportedNode {
  readonly kind: "unsupported";
  readonly reason: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

export type ContractTypeNode =
  | ContractPrimitiveNode
  | ContractLiteralNode
  | ContractRecordNode
  | ContractArrayNode
  | ContractTupleNode
  | ContractMapNode
  | ContractTaggedUnionNode
  | ContractUnionNode
  | ContractOptionNode
  | ContractRefNode
  | ContractOpaqueNode
  | ContractGenericRowNode
  | ContractUnsupportedNode;

/** Named type declaration inside a snapshot's resolved type graph. */
export interface ContractTypeDecl {
  /** Stable declaration identity (preferred over name for structural matching). */
  readonly id?: string;
  readonly name: string;
  readonly type: ContractTypeNode;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

// ---------------------------------------------------------------------------
// Operation signatures and contract snapshots
// ---------------------------------------------------------------------------

/** Error member in an operation's observable error set. */
export interface ContractErrorDef {
  readonly name: string;
  readonly id?: string;
  readonly payload?: ContractTypeNode;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

/** Exported operation signature with request, response, errors, and host requirements. */
export interface ContractOperationSig {
  readonly id?: string;
  readonly name: string;
  readonly request: ContractTypeNode;
  readonly response: ContractTypeNode;
  readonly errors: readonly ContractErrorDef[];
  readonly requirements: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

/**
 * Explicitly supplied, validated contract snapshot (RFC 0027).
 * Records source revision, contract IDs, resolved type graph, codec/version, and profile.
 */
export interface ContractSnapshot {
  readonly revision: string;
  readonly contractId?: string;
  readonly irContractId?: string;
  readonly payloadContractId?: string;
  readonly codec: CodecInfo;
  readonly profile?: string;
  readonly unknownFieldPolicy?: UnknownFieldPolicy;
  /** Optional root type name for standalone payload snapshots. */
  readonly rootType?: string;
  /** Resolved type graph; missing graph yields `"unknown"` when types are required. */
  readonly types?: Readonly<Record<string, ContractTypeDecl | ContractTypeNode>>;
  /** Exported operation signatures for request/response/error/requirement diffing. */
  readonly operations?: readonly ContractOperationSig[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Diff options, issues, and directional report
// ---------------------------------------------------------------------------

export interface ContractDiffOptions {
  /**
   * General explicit rename map (`oldName -> newName`) applied to types and operations.
   * Structural comparison never guesses renames from similar spelling.
   */
  readonly renameMap?: Readonly<Record<string, string>>;
  /** Explicit type rename map (`oldTypeName -> newTypeName`). */
  readonly typeRenames?: Readonly<Record<string, string>>;
  /** Explicit operation rename map (`oldOpName -> newOpName`). */
  readonly operationRenames?: Readonly<Record<string, string>>;
  /**
   * Explicit field rename map keyed by scope path or type/operation name:
   * e.g. `{ "User": { "fullName": "displayName" } }`.
   */
  readonly fieldRenames?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /**
   * Explicit tagged-union variant tag rename map keyed by scope path or type name:
   * e.g. `{ "Event": { "Created": "OrderCreated" } }`.
   */
  readonly tagRenames?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Optional override for the unknown-field policy during comparison. */
  readonly unknownFieldPolicy?: UnknownFieldPolicy;
}

export type CompatibilityRole =
  | "request"
  | "response"
  | "error"
  | "requirement"
  | "payload"
  | "operation"
  | "codec"
  | "metadata";

export type CompatibilityDirection =
  | "old-client-new-server"
  | "new-client-old-server"
  | "old-to-new"
  | "new-to-old";

export interface CompatibilityIssue {
  readonly verdict: CompatibilityVerdict;
  readonly code: string;
  readonly role: CompatibilityRole;
  readonly direction: CompatibilityDirection;
  readonly path: string;
  readonly message: string;
  readonly oldSpan?: SourceSpan;
  readonly newSpan?: SourceSpan;
  readonly assumptions?: readonly string[];
}

export interface MetadataChange {
  readonly path: string;
  readonly key: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly oldSpan?: SourceSpan;
  readonly newSpan?: SourceSpan;
}

export interface DirectionalVerdicts {
  /** Backward compatibility: old client talking to new server (or new reader decoding old payload). */
  readonly backward: CompatibilityVerdict;
  /** Forward compatibility: new client talking to old server (or old reader decoding new payload). */
  readonly forward: CompatibilityVerdict;
  /** Old client request -> new server decoder. */
  readonly request: CompatibilityVerdict;
  /** New server response -> old client decoder. */
  readonly response: CompatibilityVerdict;
  /** New server error set ⊆ old client handled error set. */
  readonly errors: CompatibilityVerdict;
  /** New server requirement set ⊆ old host granted capability set. */
  readonly requirements: CompatibilityVerdict;
}

export interface DirectionalDiffReport {
  readonly oldRevision: string;
  readonly newRevision: string;
  readonly oldContractId?: string;
  readonly newContractId?: string;
  readonly contractIdChanged: boolean;
  /**
   * True when structural wire compatibility is `"compatible"` in both directions
   * and only metadata or contract identity (e.g. docs/alias names) changed.
   */
  readonly metadataOnlyChange: boolean;
  /** Overall backward-compatibility verdict (`incompatible > unknown > compatible`). */
  readonly verdict: CompatibilityVerdict;
  readonly directions: DirectionalVerdicts;
  readonly issues: readonly CompatibilityIssue[];
  readonly metadataChanges: readonly MetadataChange[];
  readonly assumptions: readonly string[];
}

// ---------------------------------------------------------------------------
// Stage 2: Checked pure payload migrations
// ---------------------------------------------------------------------------

export interface MigrationFixture<TOld = unknown, TNew = unknown> {
  readonly name: string;
  readonly before: TOld;
  readonly expectedAfter?: TNew;
}

export interface InverseFixture<TNew = unknown, TOld = unknown> {
  readonly name: string;
  readonly after: TNew;
  readonly expectedBefore?: TOld;
}

export type InformationLossKind =
  | "dropped-field"
  | "narrowed-interval"
  | "narrowed-string"
  | "dropped-variant"
  | "narrowed-optionality"
  | "narrowed-nullability"
  | "precision-loss"
  | "narrowed-collection";

export interface InformationLossItem {
  readonly kind: InformationLossKind;
  readonly path: string;
  readonly message: string;
  readonly oldSpan?: SourceSpan;
  readonly newSpan?: SourceSpan;
}

export type InformationLossPolicy = "report" | "forbid";

export interface PureMigrationSpec<TOld = unknown, TNew = unknown> {
  readonly name: string;
  readonly oldSnapshot: ContractSnapshot;
  readonly newSnapshot: ContractSnapshot;
  /** Inline type node or type name in `oldSnapshot.types` (defaults to `oldSnapshot.rootType`). */
  readonly oldType?: ContractTypeNode | string;
  /** Inline type node or type name in `newSnapshot.types` (defaults to `newSnapshot.rootType`). */
  readonly newType?: ContractTypeNode | string;
  /** Optional explicit migration implementation hash; computed automatically if omitted. */
  readonly implementationHash?: string;
  /** Pure migration function from old decoded value to new decoded value. */
  readonly migrate: (oldValue: TOld) => TNew;
  /** Optional inverse function checked against both round-trip laws over the declared domain. */
  readonly inverse?: (newValue: TNew) => TOld;
  /** Independent before/after fixtures in the old domain. */
  readonly fixtures: readonly MigrationFixture<TOld, TNew>[];
  /** Optional independent fixtures in the new domain for the `migrate(inverse(y)) === y` law. */
  readonly inverseFixtures?: readonly InverseFixture<TNew, TOld>[];
  /** Explicit field renames so renamed fields are not reported as dropped. */
  readonly fieldRenames?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Policy for detected information loss (`"report"` by default; `"forbid"` fails the check). */
  readonly informationLossPolicy?: InformationLossPolicy;
}

export interface MigrationFixtureResult {
  readonly name: string;
  readonly ok: boolean;
  readonly actualAfter?: unknown;
  readonly errors: readonly string[];
}

export interface RoundTripCaseResult {
  readonly name: string;
  readonly law: "inverse-after-migrate" | "migrate-after-inverse";
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export interface RoundTripCheckResult {
  readonly ok: boolean;
  readonly cases: readonly RoundTripCaseResult[];
}

export interface MigrationCheckResult {
  readonly ok: boolean;
  readonly verdict: CompatibilityVerdict;
  readonly name: string;
  readonly oldRevision: string;
  readonly newRevision: string;
  readonly oldContractId?: string;
  readonly newContractId?: string;
  readonly implementationHash: string;
  readonly fixtureResults: readonly MigrationFixtureResult[];
  readonly informationLoss: readonly InformationLossItem[];
  readonly roundTrip?: RoundTripCheckResult;
  readonly errors: readonly string[];
  readonly caveats: readonly string[];
}
