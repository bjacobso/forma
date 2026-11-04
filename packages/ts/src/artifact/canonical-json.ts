import type { JsonValue } from "./artifact.js";

/** Object insertion order is not part of the artifact hash contract. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, JsonValue>)[key]!)}`).join(",")}}`;
  return JSON.stringify(value);
}

export { sha256 } from "../source/sha256.js";
