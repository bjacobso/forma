/** Host-call journal format (`forma-journal/v1`), lossless value projection, and replay matching. */
import type { Diagnostic, HostCallResumeResult, Span, ValueProjection } from "./types.js";

export const JOURNAL_FORMAT = "forma-journal/v1" as const;

export type JournalValue =
  | { readonly kind: "nil" }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "float"; readonly value: number | "NaN" | "Infinity" | "-Infinity" | "-0" }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "keyword"; readonly value: string }
  | { readonly kind: "symbol"; readonly value: string }
  | { readonly kind: "list"; readonly items: readonly JournalValue[] }
  | { readonly kind: "vector"; readonly items: readonly JournalValue[] }
  | {
      readonly kind: "map";
      readonly entries: readonly {
        readonly key: JournalValue;
        readonly value: JournalValue;
      }[];
    }
  | { readonly kind: "function"; readonly ordinal: number }
  | { readonly kind: "redacted" };

export const REDACTED_JOURNAL_VALUE: JournalValue = { kind: "redacted" };

export interface JournalProgramDigest {
  readonly id: string;
  readonly sha256: string;
}

export interface JournalHeader {
  readonly format: typeof JOURNAL_FORMAT;
  readonly engine: string;
  readonly program: {
    readonly sources: readonly JournalProgramDigest[];
    readonly preludes: readonly JournalProgramDigest[];
    readonly entry: string;
    readonly revision?: number | undefined;
  };
  readonly builtins: readonly { readonly name: string; readonly effect: string }[];
}

export type JournalOutcome =
  | { readonly ok: true; readonly value: JournalValue }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export interface JournalEntry {
  readonly seq: number;
  readonly evaluation: readonly number[];
  readonly effect: string;
  readonly name: string;
  readonly args: readonly JournalValue[];
  readonly outcome: JournalOutcome;
}

export interface HostCallJournal {
  readonly header: JournalHeader;
  readonly entries: readonly JournalEntry[];
}

export type JournalRedactFn = (entry: JournalEntry) => JournalEntry;
export type OnJournalEntryCallback = (entry: JournalEntry) => void;

export type JournalRequest =
  | {
      readonly mode: "record";
      readonly redact?: JournalRedactFn | undefined;
    }
  | {
      readonly mode: "replay";
      readonly journal: HostCallJournal;
      readonly onExhausted?: "fail" | "pause" | undefined;
      readonly allowProgramMismatch?: boolean | undefined;
      /** Also record replayed entries (and any live entries under `onExhausted: "pause"`) into a terminal journal. */
      readonly record?: boolean | undefined;
      readonly redact?: JournalRedactFn | undefined;
    };

/** Convert host-call argument projections to `JournalValue[]` with ordinal function matching. */
export function journalArgsFromProjections(args: readonly ValueProjection[]): readonly JournalValue[] {
  const counter = { next: 0 };
  return args.map((arg) => journalValueFromProjection(arg, counter));
}

/** Convert a value projection to a `JournalValue`. Functions/opaques become `{kind: "function", ordinal: n}` when `fnCounter` is given. */
export function journalValueFromProjection(
  value: ValueProjection,
  fnCounter?: { next: number },
): JournalValue {
  switch (value.kind) {
    case "nil":
      return { kind: "nil" };
    case "bool":
      return { kind: "bool", value: value.value };
    case "int":
      return { kind: "int", value: value.value };
    case "float":
      return { kind: "float", value: value.value };
    case "string":
      return { kind: "string", value: value.value };
    case "keyword":
      return { kind: "keyword", value: value.value };
    case "symbol":
      return { kind: "symbol", value: value.value };
    case "list":
      return { kind: "list", items: value.items.map((item) => journalValueFromProjection(item, fnCounter)) };
    case "vector":
      return { kind: "vector", items: value.items.map((item) => journalValueFromProjection(item, fnCounter)) };
    case "map":
      return {
        kind: "map",
        entries: value.entries.map((entry) => ({
          key: journalValueFromProjection(entry.key, fnCounter),
          value: journalValueFromProjection(entry.value, fnCounter),
        })),
      };
    case "function":
    case "opaque":
      if (!fnCounter) {
        throw new Error(`Journal outcomes cannot contain ${value.kind} values.`);
      }
      return { kind: "function", ordinal: fnCounter.next++ };
  }
}

/** Convert a `HostCallResumeResult` to a `JournalOutcome` (rejects function/opaque outcome values). */
export function journalOutcomeFromResumeResult(result: HostCallResumeResult): JournalOutcome {
  if (!result.ok) {
    return { ok: false, diagnostics: result.diagnostics };
  }
  return { ok: true, value: journalValueFromProjection(result.value) };
}

/** Convert a non-redacted, non-function `JournalValue` back to a `ValueProjection` for replay resume. */
export function valueProjectionFromJournal(value: JournalValue): ValueProjection {
  switch (value.kind) {
    case "nil":
      return { kind: "nil" };
    case "bool":
      return { kind: "bool", value: value.value };
    case "int":
      return { kind: "int", value: value.value };
    case "float":
      return { kind: "float", value: value.value };
    case "string":
      return { kind: "string", value: value.value };
    case "keyword":
      return { kind: "keyword", value: value.value };
    case "symbol":
      return { kind: "symbol", value: value.value };
    case "list":
      return { kind: "list", items: value.items.map(valueProjectionFromJournal) };
    case "vector":
      return { kind: "vector", items: value.items.map(valueProjectionFromJournal) };
    case "map":
      return {
        kind: "map",
        entries: value.entries.map((entry) => ({
          key: valueProjectionFromJournal(entry.key),
          value: valueProjectionFromJournal(entry.value),
        })),
      };
    case "function":
      throw new Error("Journal outcomes cannot contain function values.");
    case "redacted":
      throw new Error("Cannot decode a redacted journal value.");
  }
}

export function containsRedacted(value: JournalValue | readonly JournalValue[]): boolean {
  if (Array.isArray(value)) return value.some((item) => containsRedacted(item));
  const v = value as JournalValue;
  switch (v.kind) {
    case "redacted":
      return true;
    case "list":
    case "vector":
      return v.items.some((item) => containsRedacted(item));
    case "map":
      return v.entries.some((entry) => containsRedacted(entry.key) || containsRedacted(entry.value));
    default:
      return false;
  }
}

export function journalValuesEqual(a: JournalValue, b: JournalValue): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "nil":
      return true;
    case "bool":
      return a.value === (b as Extract<JournalValue, { kind: "bool" }>).value;
    case "int":
      return a.value === (b as Extract<JournalValue, { kind: "int" }>).value;
    case "float":
      return Object.is(a.value, (b as Extract<JournalValue, { kind: "float" }>).value);
    case "string":
      return a.value === (b as Extract<JournalValue, { kind: "string" }>).value;
    case "keyword":
      return a.value === (b as Extract<JournalValue, { kind: "keyword" }>).value;
    case "symbol":
      return a.value === (b as Extract<JournalValue, { kind: "symbol" }>).value;
    case "function":
      return a.ordinal === (b as Extract<JournalValue, { kind: "function" }>).ordinal;
    case "redacted":
      return false;
    case "list": {
      const other = b as Extract<JournalValue, { kind: "list" }>;
      return a.items.length === other.items.length && a.items.every((item, i) => journalValuesEqual(item, other.items[i]!));
    }
    case "vector": {
      const other = b as Extract<JournalValue, { kind: "vector" }>;
      return a.items.length === other.items.length && a.items.every((item, i) => journalValuesEqual(item, other.items[i]!));
    }
    case "map": {
      const other = b as Extract<JournalValue, { kind: "map" }>;
      return (
        a.entries.length === other.entries.length &&
        a.entries.every(
          (entry, i) =>
            journalValuesEqual(entry.key, other.entries[i]!.key) &&
            journalValuesEqual(entry.value, other.entries[i]!.value),
        )
      );
    }
  }
}

export function journalArgsEqual(a: readonly JournalValue[], b: readonly JournalValue[]): boolean {
  return a.length === b.length && a.every((item, i) => journalValuesEqual(item, b[i]!));
}

export function serializeJournalHeader(header: JournalHeader): string {
  return JSON.stringify(header);
}

export function serializeJournalEntry(entry: JournalEntry): string {
  return JSON.stringify(entry);
}

export function serializeJournalJsonl(journal: HostCallJournal): string {
  const lines = [serializeJournalHeader(journal.header), ...journal.entries.map(serializeJournalEntry)];
  return `${lines.join("\n")}\n`;
}

/**
 * Parse a `forma-journal/v1` JSON Lines document.
 * Accepts files truncated after any complete line.
 */
export function parseJournalJsonl(text: string): HostCallJournal {
  const rawLines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (rawLines.length === 0) {
    throw new Error("Journal is empty: missing forma-journal/v1 header.");
  }
  let headerUnknown: unknown;
  try {
    headerUnknown = JSON.parse(rawLines[0]!);
  } catch (error) {
    throw new Error(`Invalid journal header JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isValidJournalHeader(headerUnknown)) {
    throw new Error(`Invalid journal header: expected format "${JOURNAL_FORMAT}".`);
  }
  const entries: JournalEntry[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLines[i]!);
    } catch (error) {
      throw new Error(`Invalid journal entry JSON at line ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isValidJournalEntry(parsed)) {
      throw new Error(`Malformed journal entry at line ${i + 1}.`);
    }
    entries.push(parsed);
  }
  return { header: headerUnknown, entries };
}

function isValidJournalHeader(value: unknown): value is JournalHeader {
  if (!value || typeof value !== "object") return false;
  const h = value as Record<string, unknown>;
  if (h.format !== JOURNAL_FORMAT || typeof h.engine !== "string") return false;
  if (!h.program || typeof h.program !== "object") return false;
  const p = h.program as Record<string, unknown>;
  if (!Array.isArray(p.sources) || !Array.isArray(p.preludes) || typeof p.entry !== "string") return false;
  if (!Array.isArray(h.builtins)) return false;
  return true;
}

function isValidJournalEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  if (typeof e.seq !== "number" || !Array.isArray(e.evaluation)) return false;
  if (typeof e.effect !== "string" || typeof e.name !== "string" || !Array.isArray(e.args)) return false;
  if (!e.outcome || typeof e.outcome !== "object") return false;
  const outcome = e.outcome as Record<string, unknown>;
  if (outcome.ok === true) return outcome.value !== undefined && typeof outcome.value === "object";
  if (outcome.ok === false) return Array.isArray(outcome.diagnostics);
  return false;
}

export function programDigestsEqual(
  a: readonly JournalProgramDigest[],
  b: readonly JournalProgramDigest[],
): boolean {
  return a.length === b.length && a.every((item, i) => item.id === b[i]!.id && item.sha256 === b[i]!.sha256);
}

/** Validate a replay journal header against the current program header and configured builtins. */
export function validateReplayHeader(
  recorded: JournalHeader,
  current: JournalHeader,
  knownBuiltinNames: ReadonlySet<string>,
  allowProgramMismatch: boolean,
): { readonly ok: boolean; readonly diagnostics: readonly Diagnostic[] } {
  if (recorded.format !== JOURNAL_FORMAT) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "journal/invalid",
          severity: "error",
          message: `Unsupported journal format "${String(recorded.format)}"; expected "${JOURNAL_FORMAT}".`,
          phase: "evaluate",
        },
      ],
    };
  }
  const unknownBuiltins = recorded.builtins.filter((b) => !knownBuiltinNames.has(b.name));
  if (unknownBuiltins.length > 0) {
    return {
      ok: false,
      diagnostics: unknownBuiltins.map((b) => ({
        code: "journal/unknown-builtin",
        severity: "error" as const,
        message: `Journal references unknown host builtin "${b.name}" (effect "${b.effect}").`,
        phase: "evaluate" as const,
        details: { name: b.name, effect: b.effect },
      })),
    };
  }
  const sourcesMatch = programDigestsEqual(recorded.program.sources, current.program.sources);
  const preludesMatch = programDigestsEqual(recorded.program.preludes, current.program.preludes);
  if (!sourcesMatch || !preludesMatch) {
    const diagnostic: Diagnostic = {
      code: "journal/program-mismatch",
      severity: allowProgramMismatch ? "warning" : "error",
      message: "Journal program or prelude digests do not match the current program.",
      phase: "evaluate",
      details: {
        expected: { sources: recorded.program.sources, preludes: recorded.program.preludes },
        actual: { sources: current.program.sources, preludes: current.program.preludes },
      },
    };
    return { ok: allowProgramMismatch, diagnostics: [diagnostic] };
  }
  return { ok: true, diagnostics: [] };
}

export type ReplayStepResult =
  | { readonly action: "resume"; readonly entry: JournalEntry }
  | { readonly action: "pause" }
  | { readonly action: "fail"; readonly diagnostic: Diagnostic };

/** Runtime state shared across a root evaluation and its `callValue` callback children. */
export class JournalRuntime {
  readonly #recordHeader: JournalHeader | undefined;
  readonly #recordedEntries: JournalEntry[] = [];
  readonly #redact: JournalRedactFn | undefined;
  readonly #onJournalEntry: OnJournalEntryCallback | undefined;
  readonly #replayMode: boolean;
  readonly #onExhausted: "fail" | "pause";
  readonly #entriesByPath = new Map<string, JournalEntry[]>();
  readonly #cursorByPath = new Map<string, number>();
  readonly #enteredPaths = new Set<string>(["[]"]);
  readonly #warnings: Diagnostic[] = [];
  #nextSeq = 0;

  constructor(options: {
    readonly recordHeader?: JournalHeader | undefined;
    readonly redact?: JournalRedactFn | undefined;
    readonly onJournalEntry?: OnJournalEntryCallback | undefined;
    readonly replay?: {
      readonly entries: readonly JournalEntry[];
      readonly onExhausted: "fail" | "pause";
      readonly warnings?: readonly Diagnostic[] | undefined;
    } | undefined;
  }) {
    this.#recordHeader = options.recordHeader;
    this.#redact = options.redact;
    this.#onJournalEntry = options.onJournalEntry;
    this.#replayMode = options.replay !== undefined;
    this.#onExhausted = options.replay?.onExhausted ?? "fail";
    if (options.replay) {
      if (options.replay.warnings) this.#warnings.push(...options.replay.warnings);
      for (const entry of options.replay.entries) {
        const key = JSON.stringify(entry.evaluation);
        let list = this.#entriesByPath.get(key);
        if (!list) {
          list = [];
          this.#entriesByPath.set(key, list);
        }
        list.push(entry);
      }
    }
  }

  get isRecording(): boolean {
    return this.#recordHeader !== undefined;
  }

  get isReplaying(): boolean {
    return this.#replayMode;
  }

  get warnings(): readonly Diagnostic[] {
    return this.#warnings;
  }

  markPathEntered(path: readonly number[]): void {
    this.#enteredPaths.add(JSON.stringify(path));
  }

  /** Match a host call during replay. Returns `"pause"` if not replaying or if exhausted with `onExhausted: "pause"`. */
  matchReplayCall(
    evaluationPath: readonly number[],
    effect: string,
    name: string,
    actualArgs: readonly JournalValue[],
    span?: Span,
  ): ReplayStepResult {
    if (!this.#replayMode) return { action: "pause" };
    const key = JSON.stringify(evaluationPath);
    this.#enteredPaths.add(key);
    const list = this.#entriesByPath.get(key) ?? [];
    const index = this.#cursorByPath.get(key) ?? 0;
    if (index >= list.length) {
      if (this.#onExhausted === "pause") return { action: "pause" };
      return {
        action: "fail",
        diagnostic: {
          code: "journal/exhausted",
          severity: "error",
          message: `Journal exhausted at host call "${name}" (effect "${effect}").`,
          phase: "host-effect",
          ...(span ? { span } : {}),
          details: {
            evaluation: [...evaluationPath],
            actual: { effect, name, args: actualArgs },
          },
        },
      };
    }
    const entry = list[index]!;
    this.#cursorByPath.set(key, index + 1);
    if (entry.effect !== effect || entry.name !== name || entry.args.length !== actualArgs.length) {
      return {
        action: "fail",
        diagnostic: {
          code: "journal/diverged",
          severity: "error",
          message: `Host call diverged from journal at seq ${entry.seq}: expected ${entry.name} (${entry.effect}), got ${name} (${effect}).`,
          phase: "host-effect",
          ...(span ? { span } : {}),
          details: {
            seq: entry.seq,
            evaluation: [...evaluationPath],
            recorded: { effect: entry.effect, name: entry.name, args: entry.args },
            actual: { effect, name, args: actualArgs },
          },
        },
      };
    }
    if (containsRedacted(entry.args)) {
      return {
        action: "fail",
        diagnostic: {
          code: "journal/redacted",
          severity: "error",
          message: `Cannot replay redacted journal entry #${entry.seq} for host call "${name}".`,
          phase: "host-effect",
          ...(span ? { span } : {}),
          details: { seq: entry.seq, evaluation: [...evaluationPath], effect, name },
        },
      };
    }
    if (!journalArgsEqual(entry.args, actualArgs)) {
      return {
        action: "fail",
        diagnostic: {
          code: "journal/diverged",
          severity: "error",
          message: `Host call "${name}" arguments diverged from journal at seq ${entry.seq}.`,
          phase: "host-effect",
          ...(span ? { span } : {}),
          details: {
            seq: entry.seq,
            evaluation: [...evaluationPath],
            recorded: { effect: entry.effect, name: entry.name, args: entry.args },
            actual: { effect, name, args: actualArgs },
          },
        },
      };
    }
    if (entry.outcome.ok && containsRedacted(entry.outcome.value)) {
      return {
        action: "fail",
        diagnostic: {
          code: "journal/redacted",
          severity: "error",
          message: `Cannot replay redacted journal entry #${entry.seq} for host call "${name}".`,
          phase: "host-effect",
          ...(span ? { span } : {}),
          details: { seq: entry.seq, evaluation: [...evaluationPath], effect, name },
        },
      };
    }
    if (this.#recordHeader) {
      this.#appendEntry({
        seq: this.#nextSeq++,
        evaluation: [...evaluationPath],
        effect: entry.effect,
        name: entry.name,
        args: entry.args,
        outcome: entry.outcome,
      });
    }
    return { action: "resume", entry };
  }

  /** Record a live host call after the host resumes it. */
  recordCall(
    evaluationPath: readonly number[],
    effect: string,
    name: string,
    args: readonly JournalValue[],
    result: HostCallResumeResult,
  ): void {
    if (!this.#recordHeader) return;
    const outcome = journalOutcomeFromResumeResult(result);
    this.#appendEntry({
      seq: this.#nextSeq++,
      evaluation: [...evaluationPath],
      effect,
      name,
      args,
      outcome,
    });
  }

  #appendEntry(rawEntry: JournalEntry): void {
    const entry = this.#redact ? this.#redact(rawEntry) : rawEntry;
    this.#recordedEntries.push(entry);
    this.#onJournalEntry?.(entry);
  }

  /** Diagnostics to append when the root evaluation finishes (program-mismatch warning + unused-entries warning). */
  completionDiagnostics(includeUnused: boolean): readonly Diagnostic[] {
    const diagnostics: Diagnostic[] = [...this.#warnings];
    if (includeUnused && this.#replayMode) {
      const unused: JournalEntry[] = [];
      for (const pathKey of this.#enteredPaths) {
        const list = this.#entriesByPath.get(pathKey) ?? [];
        const cursor = this.#cursorByPath.get(pathKey) ?? 0;
        for (let i = cursor; i < list.length; i++) {
          unused.push(list[i]!);
        }
      }
      if (unused.length > 0) {
        diagnostics.push({
          code: "journal/unused-entries",
          severity: "warning",
          message: `Replay completed with ${unused.length} unused journal ${unused.length === 1 ? "entry" : "entries"}.`,
          phase: "evaluate",
          details: { count: unused.length, seqs: unused.map((e) => e.seq) },
        });
      }
    }
    return diagnostics;
  }

  /** Return the completed journal when recording was enabled. */
  toJournal(): HostCallJournal | undefined {
    if (!this.#recordHeader) return undefined;
    return {
      header: this.#recordHeader,
      entries: [...this.#recordedEntries],
    };
  }
}
