import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export class OcamlDaemon {
  #child;
  #lines;
  #pending = [];
  #queued = [];
  #stderr = "";
  #closed = false;
  #exit;

  constructor(cliPath, cwd) {
    this.#child = spawn(cliPath, ["daemon"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.#child.stderr.on("data", (chunk) => { this.#stderr += chunk; });
    this.#child.stdin.on("error", (error) => {
      for (const pending of this.#pending.splice(0)) pending.reject(error);
    });
    this.#lines = createInterface({ input: this.#child.stdout });
    this.#lines.on("line", (line) => {
      const pending = this.#pending.shift();
      if (pending) pending.resolve(line);
      else this.#queued.push(line);
    });
    this.#exit = new Promise((resolve) => {
      this.#child.on("close", (code) => {
        this.#closed = true;
        const error = new Error(`OCaml daemon exited with ${code}: ${this.#stderr}`);
        for (const pending of this.#pending.splice(0)) pending.reject(error);
        resolve({ code, stderr: this.#stderr });
      });
      this.#child.on("error", (error) => {
        this.#closed = true;
        for (const pending of this.#pending.splice(0)) pending.reject(error);
        resolve({ code: -1, stderr: String(error) });
      });
    });
  }

  async request(payload) {
    if (this.#closed) throw new Error(`OCaml daemon is closed: ${this.#stderr}`);
    if (this.#queued.length > 0) throw new Error(`Unexpected OCaml daemon response: ${this.#queued[0]}`);
    const line = await new Promise((resolve, reject) => {
      const pending = { resolve, reject };
      const timeout = setTimeout(() => {
        const index = this.#pending.indexOf(pending);
        if (index >= 0) this.#pending.splice(index, 1);
        reject(new Error(`OCaml daemon timed out on ${payload.op}: ${this.#stderr}`));
      }, 30_000);
      pending.resolve = (value) => { clearTimeout(timeout); resolve(value); };
      pending.reject = (error) => { clearTimeout(timeout); reject(error); };
      this.#pending.push(pending);
      this.#child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid OCaml daemon response: ${line}`);
    }
  }

  async close() {
    if (!this.#closed) this.#child.stdin.end();
    const result = await this.#exit;
    if (result.code !== 0) throw new Error(`OCaml daemon exited with ${result.code}: ${result.stderr}`);
  }
}
