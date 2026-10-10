import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A minimal LSP client over the server's stdio. */
class Client {
  readonly #process: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, (message: Record<string, unknown>) => void>();
  readonly #notifications: Record<string, unknown>[] = [];
  readonly #waiters: { method: string; resolve: (params: unknown) => void }[] = [];
  #buffer = Buffer.alloc(0);
  #nextId = 1;

  constructor() {
    this.#process = spawn(process.execPath, ["--import", "tsx", "src/server.ts", "--stdio"], {
      cwd: packageRoot,
      env: { ...process.env, FORMA_LANGUAGE_SERVER_PRELUDES: "none" },
    });
    this.#process.stdout.on("data", (chunk: Buffer) => this.#receive(chunk));
  }

  request(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = this.#nextId++;
    this.#send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve) => this.#pending.set(id, resolve));
  }

  notify(method: string, params: unknown): void {
    this.#send({ jsonrpc: "2.0", method, params });
  }

  /** The next notification with this method, including one already received. */
  notification(method: string): Promise<unknown> {
    const index = this.#notifications.findIndex((message) => message["method"] === method);
    if (index >= 0) return Promise.resolve(this.#notifications.splice(index, 1)[0]!["params"]);
    return new Promise((resolve) => this.#waiters.push({ method, resolve }));
  }

  async close(): Promise<void> {
    await this.request("shutdown", null);
    this.notify("exit", null);
    await new Promise((resolve) => this.#process.once("exit", resolve));
  }

  #send(message: unknown): void {
    const body = JSON.stringify(message);
    this.#process.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  #receive(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const headerEnd = this.#buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const length = Number(/Content-Length: (\d+)/.exec(this.#buffer.subarray(0, headerEnd).toString())![1]);
      if (this.#buffer.length < headerEnd + 4 + length) return;
      const message = JSON.parse(
        this.#buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString(),
      ) as Record<string, unknown>;
      this.#buffer = this.#buffer.subarray(headerEnd + 4 + length);
      if (typeof message["id"] === "number" && !("method" in message)) {
        this.#pending.get(message["id"])?.(message);
        this.#pending.delete(message["id"]);
      } else if (typeof message["method"] === "string") {
        const waiter = this.#waiters.findIndex((item) => item.method === message["method"]);
        if (waiter >= 0) this.#waiters.splice(waiter, 1)[0]!.resolve(message["params"]);
        else this.#notifications.push(message);
      }
    }
  }
}

describe("forma-language-server over stdio", () => {
  const uri = "file:///workspace/main.lisp";
  let client: Client;

  beforeAll(async () => {
    client = new Client();
    const initialized = await client.request("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
    });
    expect(initialized["result"]).toMatchObject({
      capabilities: {
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        documentSymbolProvider: true,
        semanticTokensProvider: { full: true },
      },
    });
    client.notify("initialized", {});
  }, 30_000);

  afterAll(async () => {
    await client.close();
  });

  test("publishes diagnostics and answers requests for an open document", async () => {
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: "forma",
        version: 1,
        text: '(define (double n) (* n 2))\n(double 4)\n(+ 1 "nope")',
      },
    });
    const published = (await client.notification("textDocument/publishDiagnostics")) as {
      uri: string;
      diagnostics: { range: { start: { line: number } }; source: string }[];
    };
    expect(published.uri).toBe(uri);
    expect(published.diagnostics.map((diagnostic) => diagnostic.range.start.line)).toEqual([2]);

    const hover = await client.request("textDocument/hover", {
      textDocument: { uri },
      position: { line: 1, character: 2 },
    });
    expect(JSON.stringify(hover["result"])).toContain("double : Float -> Float");

    const definition = await client.request("textDocument/definition", {
      textDocument: { uri },
      position: { line: 1, character: 2 },
    });
    expect(definition["result"]).toEqual({
      uri,
      range: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } },
    });

    const tokens = await client.request("textDocument/semanticTokens/full", {
      textDocument: { uri },
    });
    expect((tokens["result"] as { data: number[] }).data.length % 5).toBe(0);
  }, 30_000);

  test("re-publishes diagnostics after an edit", async () => {
    client.notify("textDocument/didChange", {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: "(define (double n) (* n 2))\n(double 4)" }],
    });
    const published = (await client.notification("textDocument/publishDiagnostics")) as {
      diagnostics: unknown[];
    };
    expect(published.diagnostics).toEqual([]);
  }, 30_000);
});
