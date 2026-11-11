import { managePackages, verifyPackages } from "@formalang/ts/node";
import type { JsonResponse } from "../json-abi.js";

export async function packages(command: string, args: readonly string[]): Promise<JsonResponse | undefined> {
  if (command === "verify" && args.length === 0) {
    const packages = verifyPackages();
    return { ok: true, value: { packages: packages.table.packages.map(pkg => pkg.name) }, diagnostics: [] };
  }
  if (command === "add" && args.length === 2)
    return { ok: true, value: await managePackages({ command: "add", name: args[0]!, source: args[1]! }), diagnostics: [] };
  if (command === "update" && args.length <= 1)
    return { ok: true, value: await managePackages({ command: "update", ...(args[0] ? { name: args[0] } : {}) }), diagnostics: [] };
  if (command === "vendor" && args.length === 0)
    return { ok: true, value: await managePackages({ command: "vendor" }), diagnostics: [] };
  return undefined;
}
