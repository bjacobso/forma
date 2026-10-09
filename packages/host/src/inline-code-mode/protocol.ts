export interface Executable {
  readonly responseId: string;
  readonly segmentId: string;
  readonly invocationId: string;
  readonly source: string;
}

export class ProtocolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

// A deliberately narrow line protocol, not a Markdown renderer or Lisp scanner.
export class SegmentParser {
  #buffer = "";
  #source = "";
  #prose = "";
  #id: string | undefined;
  #fence: { char: string; length: number } | undefined;
  #comment = false;
  #html: string | undefined;
  #complete: Executable | undefined;
  #size = 0;

  readonly responseId: string;
  readonly maxInput: number;
  constructor(responseId: string, maxInput = 16_384) {
    this.responseId = responseId;
    this.maxInput = maxInput;
    if (!/^[\w-]+$/.test(responseId)) throw new ProtocolError("protocol/identity", "Invalid response ID");
  }

  get prose(): string { return this.#prose; }
  get complete(): Executable | undefined { return this.#complete; }

  push(chunk: string): Executable | undefined {
    this.#size += chunk.length;
    if (this.#size > this.maxInput) throw new ProtocolError("limit/input", "Response exceeds input budget");
    if (this.#complete) {
      if (chunk.trim()) throw new ProtocolError("protocol/dependent-tail", "Generate continuation only after the result");
      return this.#complete;
    }
    this.#buffer += chunk;
    let newline: number;
    while ((newline = this.#buffer.indexOf("\n")) !== -1) {
      const line = this.#buffer.slice(0, newline + 1);
      this.#buffer = this.#buffer.slice(newline + 1);
      this.#line(line);
      if (this.#complete) {
        if (this.#buffer.trim()) throw new ProtocolError("protocol/dependent-tail", "Dependent text arrived before a result");
        this.#buffer = "";
        break;
      }
    }
    return this.#complete;
  }

  finish(): Executable | undefined {
    if (this.#buffer) { this.#line(this.#buffer); this.#buffer = ""; }
    if (this.#id) throw new ProtocolError("protocol/incomplete", "Unclosed forma-run segment; nothing executed");
    return this.#complete;
  }

  #line(raw: string): void {
    const line = raw.replace(/\r?\n$/, "");
    if (this.#id) {
      if (line === "```") {
        this.#complete = {
          responseId: this.responseId, segmentId: this.#id,
          invocationId: `${this.responseId}/${this.#id}`, source: this.#source,
        };
        this.#id = undefined;
      } else this.#source += raw;
      return;
    }
    // Block quotes and indented code cannot match the column-zero marker.
    if (this.#html) {
      if (line.toLowerCase().includes(`</${this.#html}>`)) this.#html = undefined;
    } else if (this.#fence) {
      const close = /^( {0,3})(`{3,}|~{3,})\s*$/.exec(line)?.[2];
      if (close && close[0] === this.#fence.char && close.length >= this.#fence.length) this.#fence = undefined;
    } else if (this.#comment || line.includes("<!--")) {
      this.#comment = !line.includes("-->");
    } else {
      const html = /^<(pre|code|script|style)(?:\s|>)/i.exec(line)?.[1]?.toLowerCase();
      if (html) {
        if (!line.toLowerCase().includes(`</${html}>`)) this.#html = html;
        this.#prose += raw;
        return;
      }
      const marker = /^```forma-run ([\w-]+)$/.exec(line);
      if (marker) { this.#id = marker[1]; return; }
      const open = /^( {0,3})(`{3,}|~{3,})/.exec(line)?.[2];
      if (open) this.#fence = { char: open[0]!, length: open.length };
    }
    this.#prose += raw;
  }
}
