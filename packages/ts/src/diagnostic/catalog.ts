import { builtinDiagnosticCatalog } from "./catalog-data.js";

export interface DiagnosticCatalogEntry {
  readonly code: string;
  readonly summary: string;
  /** Plain text or Markdown, available offline. */
  readonly explanation: string;
  readonly stability: "stable" | "unstable" | "internal";
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
    if (this.#entries.has(entry.code)) throw new Error(`Diagnostic ${entry.code} is already registered`);
    if (!entry.code.trim() || !entry.summary.trim() || !entry.explanation.trim()) throw new Error("Diagnostic entries require a code, summary and explanation");
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
    if (!this.get(diagnostic.code)) throw new Error(`Unregistered diagnostic code: ${diagnostic.code}`);
  }
}

export const diagnosticCatalog = new DiagnosticCatalog();
export { builtinDiagnosticCatalog };
