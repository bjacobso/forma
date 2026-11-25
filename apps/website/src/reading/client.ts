import type {
  Analysis, Completions, FileSymbol, Generated, Inspection, Location, Problems, ReaderSetup, ReadingRequest, ReadingResponse, References, RenameEdits, SnippetEntry, SourceFile,
} from "./protocol";

type Request = ReadingRequest extends infer R ? R extends ReadingRequest ? Omit<R, "id" | "scope" | "setup"> : never : never;

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

interface PendingRequest {
  readonly resolve: (response: ReadingResponse) => void;
  readonly timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Every reader on a page shares one analysis worker, so a blog post with many
 * snippets loads the checker and preludes once. The worker stops when the last
 * reader closes.
 */
const shared = {
  worker: null as Worker | null,
  pending: new Map<number, PendingRequest>(),
  nextId: 1,
  readers: 0,
};

function requestTimeoutMs(): number {
  const override = typeof window !== "undefined"
    ? (window as unknown as { __formaReadingTimeoutMs?: number }).__formaReadingTimeoutMs
    : undefined;
  return typeof override === "number" && Number.isFinite(override) && override > 0
    ? override
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function failWorker(failed: Worker | null, message: string): void {
  failed?.terminate();
  if (shared.worker === failed) shared.worker = null;
  for (const [id, entry] of shared.pending) {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.resolve({ id, kind: "error", message });
  }
  shared.pending.clear();
}

function worker(): Worker {
  if (!shared.worker) {
    shared.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    shared.worker.onmessage = (event: MessageEvent<ReadingResponse>) => {
      const entry = shared.pending.get(event.data.id);
      if (!entry) return;
      shared.pending.delete(event.data.id);
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.resolve(event.data);
    };
    // A worker that fails to load or crashes answers nothing more: fail what is waiting, and start another for the next request.
    shared.worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      failWorker(shared.worker, `The checker stopped: ${event.message || "its worker failed"}`);
    };
  }
  return shared.worker;
}

let nextScope = 1;

/** One reader's view of the shared worker; requests answer in order. */
export class ReadingClient {
  readonly scope = `reader-${nextScope++}`;
  private disposed = false;

  /** Sent with every request; a reader updates `before` when its earlier code changes. */
  constructor(public setup: ReaderSetup = { preludes: "effect" }) {
    shared.readers++;
    worker();
  }

  private send(request: Request): Promise<ReadingResponse> {
    const id = shared.nextId++;
    const current = worker();
    return new Promise(resolve => {
      const timer = request.kind === "dispose"
        ? null
        : setTimeout(() => {
            if (!shared.pending.has(id)) return;
            failWorker(current, "The checker timed out and was restarted.");
          }, requestTimeoutMs());
      shared.pending.set(id, { resolve, timer });
      current.postMessage({ ...request, id, scope: this.scope, setup: this.setup });
    });
  }

  async analyze(files: readonly SourceFile[], file: string): Promise<Analysis> {
    const response = await this.send({ kind: "analyze", files, file });
    if (response.kind !== "analyze") throw new Error(response.kind === "error" ? response.message : "Unexpected response");
    return response.analysis;
  }

  async inspect(files: readonly SourceFile[], file: string, from: number, to: number): Promise<Inspection> {
    const response = await this.send({ kind: "inspect", files, file, from, to });
    return response.kind === "inspect" ? response.inspection : {};
  }

  async definition(files: readonly SourceFile[], file: string, offset: number): Promise<Location | null> {
    const response = await this.send({ kind: "definition", files, file, offset });
    return response.kind === "definition" ? response.location : null;
  }

  async complete(files: readonly SourceFile[], file: string, offset: number): Promise<Completions | null> {
    const response = await this.send({ kind: "complete", files, file, offset });
    return response.kind === "complete" ? response.completions : null;
  }

  async problems(files: readonly SourceFile[]): Promise<Problems> {
    const response = await this.send({ kind: "problems", files, file: "" });
    return response.kind === "problems" ? response.problems : {};
  }

  async snippets(files: readonly SourceFile[], file: string): Promise<readonly SnippetEntry[]> {
    const response = await this.send({ kind: "snippets", files, file });
    return response.kind === "snippets" ? response.snippets : [];
  }

  async references(files: readonly SourceFile[], file: string, offset: number): Promise<References | null> {
    const response = await this.send({ kind: "references", files, file, offset });
    return response.kind === "references" ? response.references : null;
  }

  async rename(files: readonly SourceFile[], file: string, offset: number, name: string): Promise<RenameEdits> {
    const response = await this.send({ kind: "rename", files, file, offset, name });
    return response.kind === "rename" ? response.rename : { ok: false, message: response.kind === "error" ? response.message : "Rename failed." };
  }

  async symbols(files: readonly SourceFile[]): Promise<readonly FileSymbol[]> {
    const response = await this.send({ kind: "symbols", files, file: "" });
    return response.kind === "symbols" ? response.symbols : [];
  }

  async generated(files: readonly SourceFile[], file: string): Promise<Generated> {
    const response = await this.send({ kind: "generated", files, file });
    return response.kind === "generated" ? response.generated : { ok: false, message: response.kind === "error" ? response.message : "", code: "", chunks: [], declarations: [] };
  }

  async prelude(id: string): Promise<string> {
    const response = await this.send({ kind: "prelude", files: [], file: id });
    return response.kind === "prelude" ? response.source : "";
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.send({ kind: "dispose", files: [], file: "" });
    if (--shared.readers > 0) return;
    // Let the dispose request and any answers in flight finish before stopping.
    const stopping = shared.worker;
    setTimeout(() => {
      if (shared.readers > 0 || shared.worker !== stopping) return;
      stopping?.terminate();
      shared.worker = null;
      for (const entry of shared.pending.values()) {
        if (entry.timer !== null) clearTimeout(entry.timer);
      }
      shared.pending.clear();
    }, 1000);
  }
}
