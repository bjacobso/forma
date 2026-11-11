import { isDeepStrictEqual } from "node:util";
import { forma, probe, detail } from "./accept-support.mjs";

// Locations are computed from hidden author input, never from submission text.
export async function rejectedAt(dir, source, expected, mode = "declarations") {
  const result = await probe(dir, source, mode);
  const errors = result.diagnostics.filter(d => d.severity === "error");
  const reasons = [];
  if (result.ok || errors.length !== expected.length) reasons.push(`expected ${expected.length} errors: ${detail(result)}`);
  for (const { code, token, last } of expected) {
    const offset = last ? source.lastIndexOf(token) : source.indexOf(token);
    if (offset < 0) throw new Error(`Missing hidden probe marker: ${token}`);
    const before = source.slice(0, offset).split("\n");
    const line = before.length;
    const column = before.at(-1).length + 1;
    if (!errors.some(d => d.code === code && d.span?.sourceId?.includes("/.accept-") && d.span?.startLine === line && d.span?.startColumn === column)) {
      reasons.push(`expected ${code} at ${line}:${column}: ${detail(result)}`);
    }
  }
  return reasons;
}
export async function projected(dir, source, payloads) {
  const result = await probe(dir, source, "declarations");
  const actual = result.ok ? result.value.filter(d => d.summary?.kind === "FormApplication").map(d => d.payload) : null;
  return isDeepStrictEqual(actual, payloads) ? [] : [`projected IR: ${actual ? JSON.stringify(actual) : detail(result)}`];
}
export function entryForms(dir, kind, minimum) {
  const result = forma(dir, "declarations", "main.lisp");
  return result.ok && result.value.filter(d => d.summary?.kind === "FormApplication" && d.payload?.kind === kind).length >= minimum
    ? [] : [`main.lisp must declare at least ${minimum} ${kind} entries: ${detail(result)}`];
}
