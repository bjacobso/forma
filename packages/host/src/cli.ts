#!/usr/bin/env node
/** Node transports; compiler and session behavior stays in FormaHost. */
import { ModuleError } from "@formalang/ts/modules";
import { JsonAbi, hostAbiSchema, type JsonResponse } from "./json-abi.js";
import { human } from "./cli/human.js";
import { machine } from "./cli/machine.js";
import { usage } from "./cli/help.js";
import { located, printJson, report } from "./cli/output.js";

const [command = "", ...args] = process.argv.slice(2);
const humanCommand = ["check", "run", "fmt", "repl", "explain"].includes(command);
try {
  const abi = new JsonAbi();
  if (["help", "--help", "-h"].includes(command) || (args.length === 1 && ["--help", "-h"].includes(args[0]!))) process.stdout.write(usage);
  else if (command === "abi-schema" && args.length === 0) process.stdout.write(`${JSON.stringify(hostAbiSchema(), null, 2)}\n`);
  else if (!(humanCommand ? await human(abi, command, args) : await machine(abi, command, args))) {
    process.stderr.write(usage);
    process.exitCode = 64;
  }
} catch (error) {
  const response: JsonResponse = { ok: false, diagnostics: error instanceof ModuleError ? [...error.diagnostics] : [{ code: (error as NodeJS.ErrnoException).code ? "io/error" : "internal/error", severity: "error", message: String(error) }] };
  if (humanCommand) report(response, args.includes("--json"));
  else printJson(command === "file" ? located(response) : response);
  process.exitCode = 1;
}
