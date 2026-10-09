import { makeArtifactValidatorRegistry } from "./validator-catalog.js";
import type { ArtifactValidatorRegistry } from "./validator-registry.js";
import type { PayloadContract as DescriptorPayloadContract } from "./descriptor-contracts.js";
import { canonicalJson, sha256 } from "./canonical-json.js";
import { artifactModules, type ArtifactModule } from "./modules.js";
import type { Diagnostic, Span } from "../diagnostic/diagnostic.js";
import type { LanguageSession, SessionSourceSummary } from "../session/session.js";
import type { SourceOrigin } from "../source/source.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface DeclarationSummary {
  readonly kind: string;
  readonly name?: string | undefined;
  readonly resultType: string;
}

/** Maps a location inside a declaration payload back to authored source. */
export interface SourceMapEntry {
  /** RFC 6901 JSON pointer into the payload; `""` is the whole payload. */
  readonly path: string;
  readonly span: Span;
}

/** Whether a declaration was written directly or produced by macro expansion. */
export type DeclarationOrigin =
  | { readonly kind: "authored" }
  | {
      readonly kind: "expanded";
      /** Macro calls that produced the form, outermost first, at their call sites. */
      readonly macros: readonly { readonly macroName: string; readonly span: Span }[];
    };

export interface PackageableDeclaration {
  readonly summary: DeclarationSummary;
  readonly summaryRequired?: boolean;
  readonly summaryExpectation?: Partial<DeclarationSummary>;
  readonly payload: JsonValue;
  readonly sourceId: string;
  readonly formIndex: number;
  readonly span?: Span | undefined;
  readonly payloadContract?: string | undefined;
  readonly payloadConstraints?: DescriptorPayloadContract | undefined;
  readonly validators?: readonly string[] | undefined;
  readonly origin?: DeclarationOrigin | undefined;
  readonly sourceMap?: readonly SourceMapEntry[] | undefined;
}

export interface ArtifactSourceSummary extends SessionSourceSummary {
  readonly origin?: SourceOrigin | undefined;
}

export interface PackagedDeclaration extends PackageableDeclaration {
  readonly declarationId: string;
  readonly sourceHash: string;
}

export interface ArtifactPackage {
  readonly irVersion: "language-ts-artifact/v1";
  readonly kind: "CanonicalIr";
  readonly hashAlgorithm: "sha256";
  readonly declarationsHash: string;
  readonly declarationCount: number;
  readonly modules: readonly ArtifactModule[];
  readonly declarationTypeSummaries: readonly DeclarationSummary[];
  readonly declarationProvenance: readonly { readonly declarationIndex: number; readonly sourceId: string; readonly formIndex: number; readonly span?: Span | undefined }[];
  readonly derivedArtifacts: readonly { readonly kind: "DerivedManifest"; readonly target: "manifest"; readonly sourceKind: "CanonicalIr"; readonly sourceIrVersion: "language-ts-artifact/v1"; readonly declarationCount: number; readonly declarations: readonly DeclarationSummary[] }[];
  readonly typeSummary: { readonly declarationCount: number; readonly resultTypes: Readonly<Record<string, number>> };
  readonly engine: {
    readonly name: string;
    readonly version: string;
  };
  readonly session: {
    readonly id: string;
    readonly preludeFingerprint: string;
  };
  readonly preludes: readonly ArtifactSourceSummary[];
  readonly sources: readonly ArtifactSourceSummary[];
  readonly declarations: readonly PackagedDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
}

export type ArtifactResult =
  | { readonly ok: true; readonly artifact: ArtifactPackage }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export interface PackageArtifactOptions {
  readonly engineName: string;
  readonly engineVersion: string;
  readonly session: LanguageSession;
  readonly declarations: readonly ValidatedDeclaration[];
  readonly sourceIds?: readonly string[] | undefined;
}

export function packageArtifact(options: PackageArtifactOptions): ArtifactResult {
  const diagnostics = options.declarations.flatMap((declaration, index) => {
    const validation = validatedDeclarations.get(declaration);
    if (!validation) return [declarationDiagnostic("artifact/unvalidated-declaration", index, declaration)];
    if (validation.session !== options.session) return [declarationDiagnostic("artifact/session-mismatch", index, declaration)];
    if (validation.sourceHash !== options.session.source(declaration.sourceId)?.hash || validation.preludeFingerprint !== options.session.preludeFingerprint()) return [declarationDiagnostic("artifact/stale-declaration", index, declaration)];
    if (options.sourceIds && !options.sourceIds.includes(declaration.sourceId)) return [declarationDiagnostic("artifact/source-not-selected", index, declaration)];
    return [];
  });
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  const info = options.session.info();
  const sourceIdSet = new Set(
    options.sourceIds ?? options.session.orderedSources("source").map((s) => s.id),
  );
  const sources = artifactSourceSummaries(options.session, "source").filter((source) =>
    sourceIdSet.has(source.sourceId),
  );
  const declarations = options.declarations.map((declaration) =>
    packageDeclaration(options.session, declaration),
  );

  return {
    ok: true,
    artifact: {
      irVersion: "language-ts-artifact/v1",
      kind: "CanonicalIr",
      hashAlgorithm: "sha256",
      declarationsHash: sha256(canonicalJson(declarations.map(d => canonicalPayload(d.payload)))),
      declarationCount: declarations.length,
      modules: artifactModules(options.session, declarations, sources.map(s => s.sourceId)),
      declarationTypeSummaries: declarations.map(d => d.summary),
      declarationProvenance: declarations.map((d, declarationIndex) => ({ declarationIndex, sourceId: d.sourceId, formIndex: d.formIndex, ...(d.span ? { span: d.span } : {}) })),
      derivedArtifacts: [{ kind: "DerivedManifest", target: "manifest", sourceKind: "CanonicalIr", sourceIrVersion: "language-ts-artifact/v1", declarationCount: declarations.length, declarations: declarations.map(d => d.summary) }],
      typeSummary: declarationTypeSummary(declarations),
      engine: {
        name: options.engineName,
        version: options.engineVersion,
      },
      session: {
        id: options.session.id,
        preludeFingerprint: info.preludeFingerprint,
      },
      preludes: artifactSourceSummaries(options.session, "prelude"),
      sources,
      declarations,
      diagnostics: [],
    },
  };
}

export function packageArtifactJson(options: PackageArtifactOptions): string {
  const result = packageArtifact(options);
  return JSON.stringify(result.ok ? result.artifact : { diagnostics: result.diagnostics });
}

export function validatePackageableDeclarations(
  session: LanguageSession,
  declarations: readonly PackageableDeclaration[],
  registry: ArtifactValidatorRegistry = makeArtifactValidatorRegistry(),
): readonly Diagnostic[] {
  const diagnostics = declarations.flatMap((declaration, index) => validatePackageableDeclaration(session, declaration, index));
  if (diagnostics.some(d => d.code === "artifact/payload-not-json")) return diagnostics;
  return [...registry.validate(declarations), ...diagnostics];
}

function validatePackageableDeclaration(
  session: LanguageSession,
  declaration: PackageableDeclaration,
  index: number,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!declaration.summary.kind) {
    diagnostics.push(declarationDiagnostic("artifact/summary-kind-missing", index, declaration));
  }
  if (!declaration.summary.resultType) {
    diagnostics.push(declarationDiagnostic("artifact/result-type-missing", index, declaration));
  }
  if (!declaration.sourceId) {
    diagnostics.push(declarationDiagnostic("artifact/source-id-missing", index, declaration));
  } else if (!session.source(declaration.sourceId)) {
    diagnostics.push(declarationDiagnostic("artifact/source-not-loaded", index, declaration));
  }
  if (!Number.isInteger(declaration.formIndex) || declaration.formIndex < 0) {
    diagnostics.push(declarationDiagnostic("artifact/form-index-invalid", index, declaration));
  }
  if (!isJsonValue(declaration.payload)) {
    diagnostics.push(declarationDiagnostic("artifact/payload-not-json", index, declaration));
  } else {
    diagnostics.push(...validatePayloadSummary(declaration, index));
    if (declaration.payloadConstraints) {
      const payload = jsonRecord(declaration.payload);
      if (payload) {
        for (const field of declaration.payloadConstraints.requiredFields) if (!(field in payload)) diagnostics.push(declarationDiagnostic("artifact/summary-mismatch", index, declaration, { field, reason: "required field" }));
        for (const c of declaration.payloadConstraints.fieldConstraints) if (c.field in payload && (c.kind && jsonKind(payload[c.field]!) !== c.kind || c.literal !== undefined && payload[c.field] !== c.literal)) diagnostics.push(declarationDiagnostic("artifact/summary-mismatch", index, declaration, { field: c.field, expected: c.literal ?? c.kind, got: payload[c.field] }));
      }
    }
  }

  return diagnostics;
}

function validatePayloadSummary(
  declaration: PackageableDeclaration,
  index: number,
): readonly Diagnostic[] {
  const payload = jsonRecord(declaration.payload);
  if (!payload) {
    return [declarationDiagnostic("artifact/payload-not-object", index, declaration)];
  }

  const diagnostics: Diagnostic[] = [];
  const explicit = jsonRecord(payload["$summary"]);
  if ((declaration.summaryRequired || payload["$summary"] !== undefined) && (!explicit || typeof explicit["kind"] !== "string" || typeof explicit["resultType"] !== "string" || explicit["name"] !== undefined && explicit["name"] !== null && typeof explicit["name"] !== "string")) diagnostics.push(declarationDiagnostic("artifact/missing-type-summary", index, declaration));
  if (explicit) for (const field of ["kind", "name", "resultType"] as const) {
    const value = explicit[field] ?? undefined;
    if (value !== declaration.summary[field]) diagnostics.push(declarationDiagnostic("artifact/summary-mismatch", index, declaration, { field, expected: declaration.summary[field], got: value }));
  }
  for (const field of ["kind", "name", "resultType"] as const) {
    const expected = declaration.summaryExpectation?.[field];
    if (expected !== undefined && declaration.summary[field] !== expected) diagnostics.push(declarationDiagnostic("artifact/summary-mismatch", index, declaration, { field, expected, got: declaration.summary[field] }));
  }
  const kind = payload["kind"];
  if (typeof kind !== "string") {
    diagnostics.push(declarationDiagnostic("artifact/payload-kind-missing", index, declaration));
  } else if (kind !== declaration.summary.kind) {
    diagnostics.push(
      declarationDiagnostic("artifact/summary-mismatch", index, declaration, {
        expected: declaration.summary.kind,
        got: kind,
      }),
    );
  }

  const name = payload["name"];
  if (declaration.summary.name !== undefined) {
    if (typeof name === "string" && name !== declaration.summary.name) {
      diagnostics.push(
        declarationDiagnostic("artifact/summary-mismatch", index, declaration, {
          expected: declaration.summary.name,
          got: name,
        }),
      );
    }
  }

  return diagnostics;
}

function declarationDiagnostic(
  code: string,
  index: number,
  declaration: PackageableDeclaration,
  details?: Record<string, unknown>,
): Diagnostic {
  return {
    code,
    severity: "error",
    phase: "emit",
    message: `Declaration ${index} cannot be packaged: ${code.replace("artifact/", "")}`,
    ...(declaration.span ? { span: declaration.span } : {}),
    ...(details ? { details } : {}),
  };
}

function packageDeclaration(
  session: LanguageSession,
  declaration: PackageableDeclaration,
): PackagedDeclaration {
  const source = session.source(declaration.sourceId);
  return {
    ...declaration,
    declarationId: declaration.summary.name
      ? `${declaration.summary.kind}:${declaration.summary.name}`
      : `${declaration.summary.kind}:${declaration.sourceId}:${declaration.formIndex}`,
    sourceHash: source?.hash ?? "",
  };
}

function artifactSourceSummaries(
  session: LanguageSession,
  kind: "prelude" | "source",
): readonly ArtifactSourceSummary[] {
  return session.orderedSources(kind).map((source, index) => ({
    sourceId: source.id,
    hash: source.hash,
    order: index,
    textLength: source.text.length,
    ...(source.origin ? { origin: source.origin } : {}),
  }));
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
  seen.add(value);
  const valid = Object.values(value).every(child => isJsonValue(child, seen));
  seen.delete(value);
  return valid;
}

function jsonRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, JsonValue>;
}

function jsonKind(
  value: JsonValue | undefined,
): "array" | "object" | "string" | "boolean" | "null" | "number" | "undefined" {
  if (Array.isArray(value)) return "array";
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
}


const validatedDeclarationBrand: unique symbol = Symbol("ValidatedDeclaration");
export interface ValidatedDeclaration extends PackageableDeclaration {
  readonly [validatedDeclarationBrand]: true;
}
const validatedDeclarations = new WeakMap<object, { readonly session: LanguageSession; readonly sourceHash: string | undefined; readonly preludeFingerprint: string }>();
export type DeclarationValidationResult =
  | { readonly ok: true; readonly declarations: readonly ValidatedDeclaration[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** The only constructor: validate the whole batch, snapshot, then freeze it. */
export function validateDeclarations(session: LanguageSession, declarations: readonly PackageableDeclaration[], registry?: ArtifactValidatorRegistry): DeclarationValidationResult {
  const diagnostics = validatePackageableDeclarations(session, declarations, registry);
  if (diagnostics.some(d => d.severity === "error")) return { ok: false, diagnostics };
  const validated = declarations.map(declaration => {
    const snapshot = structuredClone(declaration) as PackageableDeclaration;
    const value: ValidatedDeclaration = { ...snapshot, [validatedDeclarationBrand]: true };
    deepFreeze(value);
    validatedDeclarations.set(value, { session, sourceHash: session.source(value.sourceId)?.hash, preludeFingerprint: session.preludeFingerprint() });
    return value;
  });
  return { ok: true, declarations: Object.freeze(validated) };
}
function deepFreeze(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
}
export function canonicalPayload(payload: JsonValue): JsonValue {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  return Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "$summary"));
}
export function declarationTypeSummary(declarations: readonly PackageableDeclaration[]): ArtifactPackage["typeSummary"] {
  const counts = new Map<string, number>();
  for (const d of declarations) counts.set(d.summary.resultType, (counts.get(d.summary.resultType) ?? 0) + 1);
  return { declarationCount: declarations.length, resultTypes: Object.fromEntries([...counts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) };
}
