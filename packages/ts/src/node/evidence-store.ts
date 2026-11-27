/**
 * Node-only persistent content-addressed evidence store under `.forma/store/`.
 *
 * Browser entry points MUST NOT import this module.
 *
 * Layout:
 *   <storeDir>/evidence/v1/<keyHash[0..2]>/<keyHash>.json
 *   <storeDir>/objects/v1/<defHashHex[0..2]>/<defHashHex>.json
 *
 * Writes use atomic write-to-temp + rename with SHA-256 payload checksums so
 * concurrent processes or interrupted writes never expose corrupt records.
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
  compareEvidenceRecords,
  EvidenceCache,
  type DefHash,
  type EvidenceRecord,
  type EvidenceStoreBackend,
} from "../store/evidence-cache.js";

export const DEFAULT_STORE_RELATIVE_DIR = join(".forma", "store");
const EVIDENCE_OBJECT_FORMAT = "forma-evidence-object/v1" as const;
const DEFINITION_OBJECT_FORMAT = "forma-definition-object/v1" as const;

interface StoredEvidenceEnvelope {
  readonly formatVersion: typeof EVIDENCE_OBJECT_FORMAT;
  readonly keyHash: string;
  readonly checksum: string;
  readonly record: EvidenceRecord;
}

interface StoredDefinitionEnvelope {
  readonly formatVersion: typeof DEFINITION_OBJECT_FORMAT;
  readonly defHash: DefHash;
  readonly checksum: string;
  readonly object: JsonValue;
}

function atomicWriteJson(filePath: string, payload: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(tempPath, filePath);
  } finally {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Temp file already renamed or never created.
    }
  }
}

function recordChecksum(record: EvidenceRecord): string {
  return sha256(canonicalJson(record as unknown as JsonValue));
}

function isValidKeyHash(keyHash: string): boolean {
  return /^[0-9a-f]{64}$/.test(keyHash);
}

/**
 * Node filesystem-backed content-addressed evidence store rooted at `storeDir`
 * (typically `<projectRoot>/.forma/store`).
 */
export class FileEvidenceBackend implements EvidenceStoreBackend {
  readonly storeDir: string;
  readonly #evidenceRoot: string;
  readonly #objectsRoot: string;

  constructor(storeDir: string) {
    this.storeDir = storeDir;
    this.#evidenceRoot = join(storeDir, "evidence", "v1");
    this.#objectsRoot = join(storeDir, "objects", "v1");
  }

  #evidencePath(keyHash: string): string {
    const safeHash = isValidKeyHash(keyHash) ? keyHash : sha256(keyHash);
    return join(this.#evidenceRoot, safeHash.slice(0, 2), `${safeHash}.json`);
  }

  #definitionPath(defHash: DefHash): string {
    const safeHash = sha256(defHash);
    return join(this.#objectsRoot, safeHash.slice(0, 2), `${safeHash}.json`);
  }

  #readEvidenceFile(filePath: string, expectedKeyHash?: string): EvidenceRecord | undefined {
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredEvidenceEnvelope>;
      if (
        parsed.formatVersion !== EVIDENCE_OBJECT_FORMAT ||
        typeof parsed.keyHash !== "string" ||
        typeof parsed.checksum !== "string" ||
        parsed.record === undefined
      ) {
        return undefined;
      }
      if (expectedKeyHash !== undefined && parsed.keyHash !== expectedKeyHash) {
        return undefined;
      }
      if (recordChecksum(parsed.record) !== parsed.checksum) {
        return undefined;
      }
      return parsed.record;
    } catch {
      return undefined;
    }
  }

  get(keyHash: string): EvidenceRecord | undefined {
    return this.#readEvidenceFile(this.#evidencePath(keyHash), keyHash);
  }

  set(keyHash: string, record: EvidenceRecord): void {
    const envelope: StoredEvidenceEnvelope = {
      formatVersion: EVIDENCE_OBJECT_FORMAT,
      keyHash,
      checksum: recordChecksum(record),
      record,
    };
    atomicWriteJson(this.#evidencePath(keyHash), envelope);
  }

  has(keyHash: string): boolean {
    return this.get(keyHash) !== undefined;
  }

  delete(keyHash: string): boolean {
    const filePath = this.#evidencePath(keyHash);
    if (!existsSync(filePath)) return false;
    try {
      rmSync(filePath, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  listByDefHash(defHash: DefHash): readonly EvidenceRecord[] {
    if (!existsSync(this.#evidenceRoot)) return [];
    const matches: EvidenceRecord[] = [];
    for (const bucket of readdirSync(this.#evidenceRoot, { withFileTypes: true })) {
      if (!bucket.isDirectory()) continue;
      const bucketDir = join(this.#evidenceRoot, bucket.name);
      for (const entry of readdirSync(bucketDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const record = this.#readEvidenceFile(join(bucketDir, entry.name));
        if (record && record.key.defHash === defHash) {
          matches.push(record);
        }
      }
    }
    return matches.sort(compareEvidenceRecords);
  }

  clear(): void {
    try {
      rmSync(this.#evidenceRoot, { recursive: true, force: true });
    } catch {
      // Ignore missing directory.
    }
  }

  size(): number {
    if (!existsSync(this.#evidenceRoot)) return 0;
    let count = 0;
    for (const bucket of readdirSync(this.#evidenceRoot, { withFileTypes: true })) {
      if (!bucket.isDirectory()) continue;
      const bucketDir = join(this.#evidenceRoot, bucket.name);
      for (const entry of readdirSync(bucketDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".json")) count++;
      }
    }
    return count;
  }

  /** Persist a content-addressed `DefHash` object alongside evidence records (RFC 0029 Stage 1). */
  putDefinitionObject(defHash: DefHash, object: JsonValue): void {
    const envelope: StoredDefinitionEnvelope = {
      formatVersion: DEFINITION_OBJECT_FORMAT,
      defHash,
      checksum: sha256(canonicalJson(object)),
      object,
    };
    atomicWriteJson(this.#definitionPath(defHash), envelope);
  }

  /** Read a persisted `DefHash` object, verifying its SHA-256 integrity checksum. */
  getDefinitionObject(defHash: DefHash): JsonValue | undefined {
    try {
      const raw = readFileSync(this.#definitionPath(defHash), "utf8");
      const parsed = JSON.parse(raw) as Partial<StoredDefinitionEnvelope>;
      if (
        parsed.formatVersion !== DEFINITION_OBJECT_FORMAT ||
        parsed.defHash !== defHash ||
        typeof parsed.checksum !== "string" ||
        parsed.object === undefined
      ) {
        return undefined;
      }
      if (sha256(canonicalJson(parsed.object)) !== parsed.checksum) {
        return undefined;
      }
      return parsed.object;
    } catch {
      return undefined;
    }
  }
}

export interface NodeEvidenceCacheOptions {
  /** Project root under which `.forma/store` is created (defaults to `process.cwd()`). */
  readonly rootDir?: string | undefined;
  /** Explicit store directory overriding `<rootDir>/.forma/store`. */
  readonly storeDir?: string | undefined;
}

/**
 * Open a persistent Node-backed `EvidenceCache` stored under `.forma/store/`
 * (or an explicit `storeDir`).
 */
export function openNodeEvidenceCache(options: NodeEvidenceCacheOptions = {}): {
  readonly cache: EvidenceCache;
  readonly backend: FileEvidenceBackend;
} {
  const storeDir = options.storeDir ?? join(options.rootDir ?? process.cwd(), DEFAULT_STORE_RELATIVE_DIR);
  const backend = new FileEvidenceBackend(storeDir);
  return { cache: new EvidenceCache(backend), backend };
}
