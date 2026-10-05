/**
 * Maps Forma names to TypeScript names for the Effect targets.
 *
 * Types, schemas, services, errors, and layers become PascalCase
 * (`user-repo` → `UserRepo`). Operations, functions, and locals become
 * camelCase (`get-user` → `getUser`, `valid?` → `isValid`). Record fields
 * keep their exact names because they are wire data (`cart-id` stays
 * `"cart-id"`).
 *
 * @module
 */

const reservedWords = new Set([
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

export function typeName(name: string): string {
  const normalized = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return /^[A-Za-z]/.test(normalized) ? normalized : `Generated${normalized}`;
}

export function camelIdentifier(name: string): string {
  let base = name;
  let predicate = false;
  if (base.endsWith("?")) {
    base = base.slice(0, -1);
    predicate = true;
  }
  base = base.replace(/!+$/, "");
  const parts = base.split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  if (predicate && parts[0] !== "is" && parts[0] !== "has") parts.unshift("is");
  const joined = parts
    .map((part, index) => (index === 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join("");
  const identifier = /^[A-Za-z_$]/.test(joined) ? joined : `_${joined}`;
  return reservedWords.has(identifier) ? `${identifier}_` : identifier || "_";
}

export function isIdentifierName(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name);
}

export function propertyName(name: string): string {
  return isIdentifierName(name) ? name : JSON.stringify(name);
}

export function propertyAccess(target: string, name: string): string {
  return isIdentifierName(name) ? `${target}.${name}` : `${target}[${JSON.stringify(name)}]`;
}

/** Effect modules the generated module may import; declarations cannot take these names. */
export const effectModules: readonly string[] = [
  "Cause",
  "Config",
  "Context",
  "Duration",
  "Effect",
  "Fiber",
  "Layer",
  "Option",
  "Record",
  "Ref",
  "Result",
  "Schedule",
  "Schema",
  "Scope",
  "Stream",
];

/** Globals generated code relies on or that readers expect to mean the global. */
export const generatedGlobals: readonly string[] = [
  "Array",
  "Boolean",
  "Date",
  "Error",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "Set",
  "String",
  "Symbol",
  "console",
  "globalThis",
];
