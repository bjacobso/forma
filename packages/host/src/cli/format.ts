import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import { formatLispSource } from "@formalang/ts/formatter";
import { diagnosticFromUnknown } from "@formalang/ts/diagnostic";
import type { Diagnostic } from "../types.js";
import type { JsonResponse } from "../json-abi.js";

export async function formatFiles(paths: readonly string[], check: boolean): Promise<JsonResponse> {
  const files: string[] = [], diagnostics: Diagnostic[] = [];
  for (const path of paths) {
    const sourceId = resolve(path);
    try {
      const source = readFileSync(sourceId, "utf8");
      const result = await Effect.runPromise(Effect.result(formatLispSource(source)));
      if (result._tag === "Failure") {
        diagnostics.push(diagnosticFromUnknown(result.failure, "parse", sourceId));
        continue;
      }
      if (result.success !== source) {
        files.push(path);
        if (!check) writeFileSync(sourceId, result.success);
      }
    } catch (error) {
      diagnostics.push({ code: "io/error", severity: "error", message: String(error) });
    }
  }
  return { ok: !diagnostics.length && (!check || !files.length), value: { files }, diagnostics };
}
