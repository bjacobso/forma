import { diagnosticCatalog } from "@formalang/ts/diagnostic";
import { printJson, report } from "./output.js";

export function explain(code: string, json: boolean) {
  const entry = diagnosticCatalog.get(code);
  if (!entry) {
    report({ ok: false, diagnostics: [{ code: "abi/unknown-code", severity: "error", message: `Unknown diagnostic code ${code}`, details: { name: code } }] }, json);
  } else if (json) printJson({ ok: true, value: entry, diagnostics: [] });
  else process.stdout.write(`${entry.code}: ${entry.summary}\n\n${entry.explanation}\n`);
}
