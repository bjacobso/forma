import { diffValues } from "./compare.mjs";

// Object order is ignored by diffValues; array order and all retained offsets matter.
export function stableJson(value) {
  const sort = value => Array.isArray(value) ? value.map(sort)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]))
      : value;
  return `${JSON.stringify(sort(value), (_key, value) => Object.is(value, -0) ? JSON.rawJSON("-0") : value, 2)}\n`;
}

export function validateGolden(golden, id, passes) {
  if (golden.version !== 1 || golden.id !== id ||
      golden.outputs === null || typeof golden.outputs !== "object" || Array.isArray(golden.outputs) ||
      diffValues(Object.keys(golden.outputs).sort(), [...passes].sort()).length) {
    throw new Error(`Invalid golden coverage for ${id}`);
  }
}
