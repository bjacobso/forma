/**
 * Node-only persistent snapshot and branch store under `.forma/store/`
 * (RFC 0029 Stage 2).
 *
 * Browser entry points MUST NOT import this module.
 *
 * Layout:
 *   <storeDir>/snapshots/v1/<hashHex[0..2]>/<hashHex>.json
 *   <storeDir>/definitions/v1/<hashHex[0..2]>/<hashHex>.json
 *   <storeDir>/branches/v1/<encodedBranchName>.json
 *
 * All writes use atomic write-to-temp + rename with SHA-256 payload checksums
 * so concurrent processes or interrupted writes never expose corrupt state.
 */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { JsonValue } from "../artifact/artifact.js";
import { canonicalJson, sha256 } from "../artifact/canonical-json.js";
import {
  deserializeSnapshot,
  serializeSnapshot,
  TransactionalStore,
  type BranchRef,
  type SerializedSnapshot,
  type Snapshot,
  type SnapshotBackend,
  type SnapshotHash,
  type TransactionalStoreOptions,
} from "../store/transactions.js";
import type { DefHash, DefinitionRecord } from "../store/types.js";

export const DEFAULT_SNAPSHOT_STORE_RELATIVE_DIR = join(".forma", "store");

const SNAPSHOT_ENVELOPE_FORMAT = "forma-snapshot-object/v1" as const;
const DEF_RECORD_ENVELOPE_FORMAT = "forma-def-record-object/v1" as const;
const BRANCH_ENVELOPE_FORMAT = "forma-branch-ref/v1" as const;

interface StoredSnapshotEnvelope {
  readonly formatVersion: typeof SNAPSHOT_ENVELOPE_FORMAT;
  readonly snapshotHash: SnapshotHash;
  readonly checksum: string;
  readonly snapshot: SerializedSnapshot;
}

interface StoredDefRecordEnvelope {
  readonly formatVersion: typeof DEF_RECORD_ENVELOPE_FORMAT;
  readonly defHash: DefHash;
  readonly checksum: string;
  readonly record: DefinitionRecord;
}

interface StoredBranchEnvelope {
  readonly formatVersion: typeof BRANCH_ENVELOPE_FORMAT;
  readonly checksum: string;
  readonly branch: BranchRef;
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, JSON.stringify(payload), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    renameSync(tempPath, filePath);
  } finally {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Temp file already renamed or never created.
    }
  }
}

function payloadChecksum(value: unknown): string {
  const normalized = JSON.parse(JSON.stringify(value)) as JsonValue;
  return sha256(canonicalJson(normalized));
}

function encodeBranchFilename(name: string): string {
  return `${Buffer.from(name, "utf8").toString("base64url")}.json`;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Node filesystem-backed `SnapshotBackend` rooted at `storeDir`
 * (typically `<projectRoot>/.forma/store`).
 */
export class FileSnapshotBackend implements SnapshotBackend {
  readonly storeDir: string;
  readonly #snapshotsRoot: string;
  readonly #definitionsRoot: string;
  readonly #branchesRoot: string;

  constructor(storeDir: string) {
    this.storeDir = storeDir;
    this.#snapshotsRoot = join(storeDir, "snapshots", "v1");
    this.#definitionsRoot = join(storeDir, "definitions", "v1");
    this.#branchesRoot = join(storeDir, "branches", "v1");
  }

  #snapshotPath(hash: SnapshotHash): string {
    const safe = sha256(hash);
    return join(this.#snapshotsRoot, safe.slice(0, 2), `${safe}.json`);
  }

  #definitionPath(hash: DefHash): string {
    const safe = sha256(hash);
    return join(this.#definitionsRoot, safe.slice(0, 2), `${safe}.json`);
  }

  #branchPath(name: string): string {
    return join(this.#branchesRoot, encodeBranchFilename(name));
  }

  getSnapshot(hash: SnapshotHash): Snapshot | undefined {
    try {
      const raw = readFileSync(this.#snapshotPath(hash), "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredSnapshotEnvelope>;
      if (
        parsed.formatVersion !== SNAPSHOT_ENVELOPE_FORMAT ||
        parsed.snapshotHash !== hash ||
        typeof parsed.checksum !== "string" ||
        parsed.snapshot === undefined
      ) {
        return undefined;
      }
      if (payloadChecksum(parsed.snapshot) !== parsed.checksum) {
        return undefined;
      }
      return deserializeSnapshot(parsed.snapshot);
    } catch {
      return undefined;
    }
  }

  putSnapshot(snapshot: Snapshot): void {
    const serialized = serializeSnapshot(snapshot);
    const envelope: StoredSnapshotEnvelope = {
      formatVersion: SNAPSHOT_ENVELOPE_FORMAT,
      snapshotHash: snapshot.hash,
      checksum: payloadChecksum(serialized),
      snapshot: serialized,
    };
    atomicWriteJson(this.#snapshotPath(snapshot.hash), envelope);
  }

  getDefinition(hash: DefHash): DefinitionRecord | undefined {
    try {
      const raw = readFileSync(this.#definitionPath(hash), "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredDefRecordEnvelope>;
      if (
        parsed.formatVersion !== DEF_RECORD_ENVELOPE_FORMAT ||
        parsed.defHash !== hash ||
        typeof parsed.checksum !== "string" ||
        parsed.record === undefined
      ) {
        return undefined;
      }
      if (payloadChecksum(parsed.record) !== parsed.checksum) {
        return undefined;
      }
      return parsed.record;
    } catch {
      return undefined;
    }
  }

  putDefinition(record: DefinitionRecord): void {
    const filePath = this.#definitionPath(record.hash);
    if (existsSync(filePath)) return;
    const envelope: StoredDefRecordEnvelope = {
      formatVersion: DEF_RECORD_ENVELOPE_FORMAT,
      defHash: record.hash,
      checksum: payloadChecksum(record),
      record,
    };
    atomicWriteJson(filePath, envelope);
  }

  #readBranchFile(filePath: string): BranchRef | undefined {
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredBranchEnvelope>;
      if (
        parsed.formatVersion !== BRANCH_ENVELOPE_FORMAT ||
        typeof parsed.checksum !== "string" ||
        parsed.branch === undefined
      ) {
        return undefined;
      }
      if (payloadChecksum(parsed.branch) !== parsed.checksum) {
        return undefined;
      }
      return parsed.branch;
    } catch {
      return undefined;
    }
  }

  getBranch(name: string): BranchRef | undefined {
    return this.#readBranchFile(this.#branchPath(name));
  }

  listBranches(): readonly BranchRef[] {
    if (!existsSync(this.#branchesRoot)) return [];
    const branches: BranchRef[] = [];
    for (const entry of readdirSync(this.#branchesRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const ref = this.#readBranchFile(join(this.#branchesRoot, entry.name));
      if (ref) branches.push(ref);
    }
    return branches.sort((a, b) => compareStrings(a.name, b.name));
  }

  compareAndSwapBranch(
    name: string,
    expectedHead: SnapshotHash | null,
    nextHead: SnapshotHash,
  ): boolean {
    const existing = this.getBranch(name);
    const currentHead = existing ? existing.head : null;
    if (currentHead !== expectedHead) {
      return false;
    }
    const nextRef: BranchRef = {
      name,
      head: nextHead,
      updatedAt: new Date().toISOString(),
    };
    const envelope: StoredBranchEnvelope = {
      formatVersion: BRANCH_ENVELOPE_FORMAT,
      checksum: payloadChecksum(nextRef),
      branch: nextRef,
    };
    atomicWriteJson(this.#branchPath(name), envelope);
    return true;
  }
}

export interface NodeTransactionalStoreOptions
  extends Omit<TransactionalStoreOptions, "backend"> {
  /** Project root under which `.forma/store` is created (defaults to `process.cwd()`). */
  readonly rootDir?: string | undefined;
  /** Explicit store directory overriding `<rootDir>/.forma/store`. */
  readonly storeDir?: string | undefined;
}

/**
 * Open a persistent Node-backed `TransactionalStore` stored under `.forma/store/`
 * (or an explicit `storeDir`).
 */
export function openNodeTransactionalStore(options: NodeTransactionalStoreOptions = {}): {
  readonly store: TransactionalStore;
  readonly backend: FileSnapshotBackend;
} {
  const { rootDir, storeDir: explicitStoreDir, ...storeOptions } = options;
  const storeDir =
    explicitStoreDir ?? join(rootDir ?? process.cwd(), DEFAULT_SNAPSHOT_STORE_RELATIVE_DIR);
  const backend = new FileSnapshotBackend(storeDir);
  return {
    store: new TransactionalStore({ ...storeOptions, backend }),
    backend,
  };
}
