import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import type { AbiRequest, AbiResponse } from "./protocol.js";

const packagesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const defaultLanguageOcamlDir = resolve(packagesDir, "ocaml");
const bundledArtifact = fileURLToPath(new URL("./runtime/jsoo_entry.cjs", import.meta.url));
const defaultOcamlJsArtifact = existsSync(bundledArtifact)
  ? bundledArtifact
  : resolve(defaultLanguageOcamlDir, "dist/js/jsoo_entry.cjs");

export interface ArtifactInspection {
  readonly status: "ready" | "unavailable";
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
}

export class OcamlAbiClient {
  static async create(options: { readonly artifactPath?: string } = {}): Promise<OcamlAbiClient> {
    const artifactPath =
      options.artifactPath ??
      process.env["FORMA_LANGUAGE_SERVER_ARTIFACT"] ??
      defaultOcamlJsArtifact;
    const inspection = await inspectArtifact(artifactPath);
    if (inspection.status !== "ready") {
      throw new Error(inspection.reason ?? `OCaml JS artifact is unavailable: ${artifactPath}`);
    }
    return new OcamlAbiClient(await BridgeClient.start(artifactPath), artifactPath);
  }

  static inspectArtifact(artifactPath = defaultOcamlJsArtifact): Promise<ArtifactInspection> {
    return inspectArtifact(artifactPath);
  }

  private constructor(
    private readonly bridge: BridgeClient,
    readonly artifactPath: string,
  ) {}

  async request(payload: AbiRequest): Promise<AbiResponse> {
    return await this.bridge.request(payload);
  }

  async close(): Promise<void> {
    await this.bridge.close();
  }
}

async function inspectArtifact(artifactPath: string): Promise<ArtifactInspection> {
  if (!existsSync(artifactPath)) {
    return {
      status: "unavailable",
      reason:
        "Missing packages/ocaml/dist/js/jsoo_entry.cjs. Build it with `pnpm --filter @formalang/ocaml build` before starting the Forma language server.",
      metadata: { artifactPath },
    };
  }

  if (artifactPath === bundledArtifact) return { status: "ready" };

  const languageOcamlDir = resolve(dirname(artifactPath), "../..");
  const artifactStat = await stat(artifactPath);
  const sourceRoots = ["bin", "js", "lib"].map((segment) => resolve(languageOcamlDir, segment));
  const newestSource = await newestMtime(sourceRoots);
  if (newestSource !== null && newestSource > artifactStat.mtimeMs) {
    return {
      status: "unavailable",
      reason:
        "The Forma OCaml JS artifact looks stale. Rebuild with `pnpm --filter @formalang/ocaml build` before starting the Forma language server.",
      metadata: {
        artifactPath,
        artifactMtimeMs: artifactStat.mtimeMs,
        newestSourceMtimeMs: newestSource,
      },
    };
  }

  return { status: "ready" };
}

async function newestMtime(paths: readonly string[]): Promise<number | null> {
  let newest: number | null = null;
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const stats = await stat(path);
    newest = newest === null ? stats.mtimeMs : Math.max(newest, stats.mtimeMs);
    if (stats.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true });
      const nested = await newestMtime(entries.map((entry) => join(path, entry.name)));
      if (nested !== null) {
        newest = newest === null ? nested : Math.max(newest, nested);
      }
    }
  }
  return newest;
}

class BridgeClient {
  static async start(artifactPath: string): Promise<BridgeClient> {
    const tsBridgePath = fileURLToPath(new URL("./jsoo-bridge.ts", import.meta.url));
    const jsBridgePath = fileURLToPath(new URL("./jsoo-bridge.js", import.meta.url));
    const bridgePath = existsSync(jsBridgePath) ? jsBridgePath : tsBridgePath;
    const args = bridgePath.endsWith(".ts")
      ? ["--import", "tsx", bridgePath, artifactPath]
      : [bridgePath, artifactPath];
    const child = spawn(process.execPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const client = new BridgeClient(child);
    await client.awaitReady();
    return client;
  }

  readonly #lines: string[] = [];
  readonly #waiters: Array<(line: string) => void> = [];
  readonly #readyWaiters: Array<(value: void) => void> = [];
  #ready = false;
  #stderr = "";

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.child.stderr.on("data", (chunk) => {
      this.#stderr += chunk.toString();
    });

    const lineReader = createInterface({ input: child.stdout });
    lineReader.on("line", (line) => {
      if (!this.#ready) {
        const parsed = safeJsonParse(line);
        if (isRecord(parsed) && parsed["bridge"] === "ready") {
          this.#ready = true;
          this.#readyWaiters.splice(0).forEach((waiter) => waiter());
        }
        return;
      }

      const waiter = this.#waiters.shift();
      if (waiter) {
        waiter(line);
        return;
      }
      this.#lines.push(line);
    });
  }

  async request(payload: AbiRequest): Promise<AbiResponse> {
    await this.awaitReady();
    const line = await new Promise<string>((resolveLine, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(`Timed out waiting for OCaml JS bridge response. stderr:\n${this.#stderr}`),
        );
      }, 10_000);

      const waiter = (value: string) => {
        clearTimeout(timeout);
        resolveLine(value);
      };

      if (this.#lines.length > 0) {
        waiter(this.#lines.shift()!);
        return;
      }

      this.#waiters.push(waiter);
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    });

    const parsed = safeJsonParse(line);
    if (!isRecord(parsed)) {
      throw new Error(`Bridge returned non-JSON response: ${JSON.stringify(line)}`);
    }
    return parsed as AbiResponse;
  }

  async close(): Promise<void> {
    if (!this.child.killed) {
      this.child.stdin.end();
      this.child.kill();
    }
  }

  private async awaitReady(): Promise<void> {
    if (this.#ready) return;

    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(`Timed out waiting for OCaml JS bridge startup. stderr:\n${this.#stderr}`),
        );
      }, 10_000);

      this.#readyWaiters.push(() => {
        clearTimeout(timeout);
        resolveReady();
      });
    });
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
