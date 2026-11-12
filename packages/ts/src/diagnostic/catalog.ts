import { builtinDiagnosticCatalog } from "./catalog-data.js";

export interface DiagnosticCatalogEntry {
  readonly code: string;
  readonly summary: string;
  /** Plain text or Markdown, available offline. */
  readonly explanation: string;
  readonly stability: "stable" | "experimental" | "unstable" | "internal";
}

/** Invalid host-owned catalog input; no authored source location is implied. */
export class DiagnosticCatalogError extends Error {
  override readonly name = "DiagnosticCatalogError";
  readonly code = "diagnostic/invalid-catalog" as const;

  constructor(message: string, readonly path: string) {
    super(message);
  }
}

/** A consumer's catalog includes the engine and its own prelude codes.
 * Use a separate instance per language/project to avoid process-global state.
 */
export class DiagnosticCatalog {
  readonly #entries = new Map<string, DiagnosticCatalogEntry>();

  constructor(entries: readonly DiagnosticCatalogEntry[] = builtinDiagnosticCatalog) {
    for (const entry of entries) this.register(entry);
  }

  register(entry: DiagnosticCatalogEntry): void {
    if (this.#entries.has(entry.code)) throw new DiagnosticCatalogError(`Diagnostic ${entry.code} is already registered`, "entry.code");
    for (const field of ["code", "summary", "explanation"] as const) {
      if (!entry[field].trim()) throw new DiagnosticCatalogError("Diagnostic entries require a code, summary and explanation", `entry.${field}`);
    }
    this.#entries.set(entry.code, Object.freeze({...entry}));
  }

  get(code: string): DiagnosticCatalogEntry | undefined {
    // A mechanics failure's final component is a consumer-declared error type.
    return this.#entries.get(code) ?? (code.startsWith("mechanics/fail/") ? this.#entries.get("mechanics/fail") : undefined);
  }

  list(): readonly DiagnosticCatalogEntry[] {
    return [...this.#entries.values()].sort((a,b) => a.code.localeCompare(b.code));
  }

  /** Useful at a consumer's diagnostic boundary and in conformance tests. */
  assertKnown(diagnostic: { readonly code: string }): void {
    if (!this.get(diagnostic.code)) throw new DiagnosticCatalogError(`Unregistered diagnostic code: ${diagnostic.code}`, "diagnostic.code");
  }
}

export const diagnosticCatalog = new DiagnosticCatalog();
export { builtinDiagnosticCatalog };
