import { diffValues } from "./compare.mjs";

// Object order is ignored by diffValues; array order and all retained offsets matter.
export function stableJson(value) {
  const sort = value => Array.isArray(value) ? value.map(sort)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]))
      : value;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export function checkDivergence(differences, divergence) {
  if (!divergence) return differences.length === 0;
  return differences.length > 0 && stableJson(differences) === stableJson(divergence.differences);
}

export function validateDivergences(manifest, expectedKeys, matrix) {
  if (manifest.version !== 1 || !Array.isArray(manifest.cases)) throw new Error("Invalid divergence manifest");
  const seen = new Set();
  for (const entry of manifest.cases) {
    const key = `${entry.id}/${entry.pass}`;
    const surface = matrix.surfaces.find(surface => surface.id === entry.surface);
    if (!expectedKeys.includes(key) || seen.has(key) || !entry.reason?.trim() ||
        !["gap", "intentional-difference"].includes(surface?.status) ||
        !Array.isArray(entry.differences) || entry.differences.length === 0) {
      throw new Error(`Invalid, duplicate, or stale divergence: ${key}`);
    }
    seen.add(key);
  }
}

export function validateGolden(golden, id, passes) {
  if (golden.version !== 1 || golden.id !== id || golden.capturedFrom !== "ocaml-native" ||
      golden.outputs === null || typeof golden.outputs !== "object" || Array.isArray(golden.outputs) ||
      diffValues(Object.keys(golden.outputs).sort(), [...passes].sort()).length) {
    throw new Error(`Invalid golden coverage for ${id}`);
  }
}
