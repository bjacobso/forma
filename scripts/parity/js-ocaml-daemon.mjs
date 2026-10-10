import { fork } from "node:child_process";

// The JS artifact exports the same ABI callback used by browser consumers. Keep
// it in a worker so sessions persist without changing its one-shot CLI entry.
export class JsOcamlDaemon {
  #worker;
  #pending = [];
  #failure;
  #exit;
  #stderr = "";

  constructor(jsPath) {
    this.#worker = fork(new URL("./js-ocaml-worker.mjs", import.meta.url), [jsPath], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    this.#worker.stderr.on("data", chunk => { this.#stderr += chunk; });
    this.#exit = new Promise(resolve => this.#worker.once("close", resolve));
    this.#worker.on("message", response => {
      const pending = this.#pending.shift();
      if (response.error) pending?.reject(new Error(response.error));
      else pending?.resolve(response.value);
    });
    const fail = error => {
      this.#failure = error;
      for (const pending of this.#pending.splice(0)) pending.reject(error);
    };
    this.#worker.on("error", fail);
    this.#worker.on("close", code => fail(new Error(`OCaml JS worker exited with ${code}: ${this.#stderr}`)));
  }

  async request(payload) {
    if (this.#failure) throw this.#failure;
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`OCaml JS worker timed out on ${payload.op}`));
        this.#worker.kill();
      }, 30_000);
      this.#pending.push({
        resolve: value => { clearTimeout(timeout); resolve(value); },
        reject: error => { clearTimeout(timeout); reject(error); },
      });
      this.#worker.send(payload);
    });
  }

  async close() {
    this.#worker.kill();
    await this.#exit;
  }
}
