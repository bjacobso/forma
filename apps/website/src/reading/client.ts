import type { Analysis, Completions, Inspection, Location, Problems, ReadingRequest, ReadingResponse, SnippetEntry, SourceFile } from "./protocol";

type Pending = { resolve: (response: ReadingResponse) => void };
type Request = ReadingRequest extends infer R ? R extends ReadingRequest ? Omit<R, "id"> : never : never;

/** One analysis worker per page; requests answer in order. */
export class ReadingClient {
  private readonly worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<ReadingResponse>) => {
      const pending = this.pending.get(event.data.id);
      this.pending.delete(event.data.id);
      pending?.resolve(event.data);
    };
  }

  private send(request: Request): Promise<ReadingResponse> {
    const id = this.nextId++;
    return new Promise(resolve => {
      this.pending.set(id, { resolve });
      this.worker.postMessage({ ...request, id });
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

  dispose(): void {
    this.worker.terminate();
  }
}
