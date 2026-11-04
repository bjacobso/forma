import { emptyScope, type Scope } from "../analysis/scope.js";
import type { SExpr } from "../reader/types.js";
import { Env } from "../Env.js";
import {
  hashSourceText,
  makeSource,
  type Source,
  type SourceInput,
} from "../source/source.js";

export type SessionSourceKind = "source" | "prelude";

export interface SessionSourceInput extends SourceInput {
  readonly kind?: SessionSourceKind | undefined;
}

export interface SessionSourceRecord {
  readonly source: Source;
  readonly order: number;
}

export interface SessionSourceSummary {
  readonly sourceId: string;
  readonly hash: string;
  readonly order: number;
  readonly textLength: number;
}

export interface SessionInfo {
  readonly sessionId: string;
  readonly preludeCount: number;
  readonly sourceCount: number;
  readonly preludeFingerprint: string;
  readonly preludes: readonly SessionSourceSummary[];
  readonly sources: readonly SessionSourceSummary[];
}

export interface LanguageSessionOptions {
  readonly id: string;
  readonly env?: Env | undefined;
  readonly projects?: import("../modules/graph.js").ModuleCoreOptions["projects"];
  readonly packages?: import("../modules/packages.js").PackageTable | undefined;
}

export class LanguageSession {
  readonly id: string;
  env: Env;
  configurationEnv: Env;
  scope: Scope = emptyScope;
  projects: NonNullable<
    import("../modules/graph.js").ModuleCoreOptions["projects"]
  >;
  /** Installed packages that bare imports resolve through (RFC 0020). */
  packages: import("../modules/packages.js").PackageTable | undefined;

  readonly preludes = new Map<string, SessionSourceRecord>();
  readonly sources = new Map<string, SessionSourceRecord>();
  readonly parsedPreludes = new Map<string, readonly SExpr[]>();
  readonly parsedSources = new Map<string, readonly SExpr[]>();

  #nextSourceOrder = 0;

  constructor(options: LanguageSessionOptions) {
    this.id = options.id;
    this.env = options.env ?? Env.empty();
    this.configurationEnv = this.env;
    this.projects = options.projects ?? [];
    this.packages = options.packages;
  }

  rememberSource(input: SessionSourceInput): SessionSourceRecord {
    const kind = input.kind ?? "source";
    const source = makeSource(input);
    const target = kind === "prelude" ? this.preludes : this.sources;
    const parsed =
      kind === "prelude" ? this.parsedPreludes : this.parsedSources;
    const existing = target.get(source.id);
    const record: SessionSourceRecord = {
      source,
      order: existing?.order ?? this.#nextSourceOrder++,
    };
    target.set(source.id, record);
    parsed.delete(source.id);
    return record;
  }

  rememberParsedSource(
    kind: SessionSourceKind,
    sourceId: string,
    parsed: readonly SExpr[],
  ): void {
    const target =
      kind === "prelude" ? this.parsedPreludes : this.parsedSources;
    target.set(sourceId, parsed);
  }

  source(sourceId: string): Source | undefined {
    return (
      this.sources.get(sourceId)?.source ?? this.preludes.get(sourceId)?.source
    );
  }

  sourceText(sourceId: string): string | undefined {
    return this.source(sourceId)?.text;
  }

  sourceCount(): number {
    return this.sources.size + this.preludes.size;
  }

  preludeFingerprint(): string {
    // Code-unit order and JSON encoding keep the digest independent of locale
    // and of separator characters in source ids.
    const items = [...this.preludes.values()]
      .map((record) => [record.source.id, record.source.hash] as const)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return items.length === 0 ? "empty" : hashSourceText(JSON.stringify(items));
  }

  coreExpressions(): readonly SExpr[] {
    return this.orderedSources("prelude")
      .flatMap((source) => this.parsedPreludes.get(source.id) ?? [])
      .filter(
        (expression) =>
          expression._tag === "List" &&
          expression.items[0]?._tag === "Sym" &&
          ["define", ":", "type", "class", "error", "macro", "typeclass", "instance"].includes(
            expression.items[0].name,
          ),
      );
  }

  info(): SessionInfo {
    return {
      sessionId: this.id,
      preludeCount: this.preludes.size,
      sourceCount: this.sources.size,
      preludeFingerprint: this.preludeFingerprint(),
      preludes: summarizeRecords(this.preludes),
      sources: summarizeRecords(this.sources),
    };
  }

  orderedSources(kind?: SessionSourceKind | undefined): readonly Source[] {
    const records =
      kind === "prelude"
        ? [...this.preludes.values()]
        : kind === "source"
          ? [...this.sources.values()]
          : [...this.preludes.values(), ...this.sources.values()];
    return records
      .sort((left, right) => left.order - right.order)
      .map((record) => record.source);
  }

  joinedSourceText(kind?: SessionSourceKind | undefined): string {
    return this.orderedSources(kind)
      .map((source) => source.text)
      .join("\n");
  }

  reset(): void {
    this.preludes.clear();
    this.sources.clear();
    this.parsedPreludes.clear();
    this.parsedSources.clear();
    this.env = Env.empty();
    this.configurationEnv = this.env;
    this.projects = [];
    this.packages = undefined;
    this.scope = emptyScope;
    this.#nextSourceOrder = 0;
  }
}

export function openSession(options: LanguageSessionOptions): LanguageSession {
  return new LanguageSession(options);
}

export function sessionInfo(session: LanguageSession): SessionInfo {
  return session.info();
}

function summarizeRecords(
  records: ReadonlyMap<string, SessionSourceRecord>,
): SessionSourceSummary[] {
  return [...records.values()]
    .sort((left, right) => left.order - right.order)
    .map((record) => ({
      sourceId: record.source.id,
      hash: record.source.hash,
      order: record.order,
      textLength: record.source.text.length,
    }));
}
