import type {
  Analysis, Completions, FileSymbol, Generated, Inspection, Location, Problems, ReaderSetup, ReadingRequest, ReadingResponse, References, RenameEdits, SnippetEntry, SourceFile,
} from "./protocol";

type Request = ReadingRequest extends infer R ? R extends ReadingRequest ? Omit<R, "id" | "scope" | "setup"> : never : never;

/**
 * Every reader on a page shares one analysis worker, so a blog post with many
 * snippets loads the checker and preludes once. The worker stops when the last
 * reader closes.
 */
const shared = {
  worker: null as Worker | null,
  pending: new Map<number, (response: ReadingResponse) => void>(),
  nextId: 1,
  readers: 0,
};

function worker(): Worker {
  if (!shared.worker) {
    shared.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    shared.worker.onmessage = (event: MessageEvent<ReadingResponse>) => {
      const resolve = shared.pending.get(event.data.id);
      shared.pending.delete(event.data.id);
      resolve?.(event.data);
    };
  }
  return shared.worker;
}

let nextScope = 1;

/** One reader's view of the shared worker; requests answer in order. */
export class ReadingClient {
  readonly scope = `reader-${nextScope++}`;
  private disposed = false;

  constructor(readonly setup: ReaderSetup = { preludes: "effect" }) {
    shared.readers++;
    worker();
  }

  private send(request: Request): Promise<ReadingResponse> {
    const id = shared.nextId++;
    return new Promise(resolve => {
      shared.pending.set(id, resolve);
      worker().postMessage({ ...request, id, scope: this.scope, setup: this.setup });
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
      shared.pending.clear();
    }, 1000);
  }
}
