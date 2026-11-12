import { spawnSync } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { cli } from "./harness.mjs";

export function forma(dir, mode, file) {
  const result = spawnSync(process.execPath, [cli, "file", mode, join(dir, file)], { encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  try {
    const response = JSON.parse(result.stdout);
    return { ...response, ok: result.status === 0 && response.ok };
  } catch { return { ok: false, diagnostics: [], failure: result.error?.message ?? result.stderr ?? "No JSON response" }; }
}
export async function probe(dir, source, mode = "evaluate") {
  const file = `.accept-${randomUUID()}.lisp`;
  await writeFile(join(dir, file), source);
  try { return forma(dir, mode, file); }
  finally { await rm(join(dir, file), { force: true }); }
}
export function detail(response) {
  return response.failure ?? JSON.stringify(response.diagnostics ?? []);
}
export async function acceptProgram(dir, source, rejected = []) {
  const reasons = [];
  const checked = forma(dir, "typecheck", "main.lisp");
  if (!checked.ok) reasons.push(`main.lisp must typecheck: ${detail(checked)}`);
  const result = await probe(dir, source);
  if (!result.ok || result.value?.result?.printed !== "true") reasons.push(`behavior probes failed: ${result.value?.result?.printed ?? detail(result)}`);
  for (const { source, code } of rejected) {
    const result = await probe(dir, source, "typecheck");
    if (result.ok || !result.diagnostics.some(d => d.code === code)) reasons.push(`must reject with ${code}: ${detail(result)}`);
  }
  return { pass: reasons.length === 0, reasons };
}
export async function acceptForm(dir, { valid, payloads, invalid, code }) {
  const reasons = [];
  for (const [label, source] of [["main", null], ["hidden valid", valid]]) {
    const result = source ? await probe(dir, source, "declarations") : forma(dir, "declarations", "main.lisp");
    if (!result.ok) { reasons.push(`${label} declarations: ${detail(result)}`); continue; }
    if (!source && !result.value.some(d => d.summary?.kind === "FormApplication")) reasons.push("main.lisp must apply the form");
    if (source) {
      const actual = result.value.filter(d => d.summary?.kind === "FormApplication").map(d => d.payload);
      if (!isDeepStrictEqual(actual, payloads)) reasons.push(`wrong projected IR: ${JSON.stringify(actual)}`);
    }
  }
  for (const source of invalid) {
    const result = await probe(dir, source, "declarations");
    if (result.ok || !result.diagnostics?.some(d => d.code === code && d.severity === "error")) reasons.push(`must reject with ${code}: ${detail(result)}`);
  }
  return { pass: reasons.length === 0, reasons };
}
