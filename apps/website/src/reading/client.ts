import type { Analysis, Inspection, ReadingRequest, ReadingResponse } from "./protocol";

type Pending = { resolve: (response: ReadingResponse) => void };

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

  private send(request: Omit<ReadingRequest, "id"> & { kind: ReadingRequest["kind"] }): Promise<ReadingResponse> {
    const id = this.nextId++;
    return new Promise(resolve => {
      this.pending.set(id, { resolve });
      this.worker.postMessage({ ...request, id } as ReadingRequest);
    });
  }

  async analyze(source: string): Promise<Analysis> {
    const response = await this.send({ kind: "analyze", source });
    if (response.kind !== "analyze") throw new Error(response.kind === "error" ? response.message : "Unexpected response");
    return response.analysis;
  }

  async inspect(source: string, from: number, to: number): Promise<Inspection> {
    const response = await this.send({ kind: "inspect", source, from, to } as ReadingRequest);
    if (response.kind !== "inspect") return {};
    return response.inspection;
  }

  dispose(): void {
    this.worker.terminate();
  }
}
