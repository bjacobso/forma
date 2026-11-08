// An intentionally closed semantic operation, not a general target AST API.
// Input: the payload of one successfully elaborated Forma wrap-record form.
export function generate(record) {
  if (record.kind !== "WrapRecord" || record.name !== "Query" || !Array.isArray(record.fields) || record.fields.length === 0) {
    throw new Error("portable-record/schema: expected a nonempty Query record");
  }
  const names = new Set();
  for (const field of record.fields) {
    if (field.type !== "string" || Object.keys(field).some(key => !["name", "type"].includes(key))) {
      throw new Error("portable-record/type: only string fields are supported");
    }
    // TS property names accept keywords; Go's prefix avoids keyword collisions.
    if (typeof field.name !== "string" || !/^[a-z][a-z0-9_]*$/.test(field.name)) {
      throw new Error(`portable-record/name: unsupported field ${field.name}`);
    }
    if (names.has(field.name)) throw new Error(`portable-record/duplicate: ${field.name}`);
    names.add(field.name);
  }
  const fields = [...names];
  const ts = [
    "export type Query = {",
    ...fields.map(name => `  ${name}: string;`),
    "};",
    "export type UserFields = {",
    ...fields.map(name => `  ${name}: { raw: string };`),
    "};",
    "export function wrap(q: Query): UserFields {",
    "  return {",
    ...fields.map(name => `    ${name}: { raw: q.${name} },`),
    "  };",
    "}",
    "",
  ].join("\n");
  const go = [
    "package main",
    "",
    "type Query struct {",
    ...fields.map(name => `  F_${name} string \`json:"${name}"\``),
    "}",
    "type Raw struct { Raw string `json:\"raw\"` }",
    "type UserFields struct {",
    ...fields.map(name => `  F_${name} Raw \`json:"${name}"\``),
    "}",
    "func Wrap(q Query) UserFields {",
    "  return UserFields{",
    ...fields.map(name => `    F_${name}: Raw{Raw: q.F_${name}},`),
    "  }",
    "}",
    "",
  ].join("\n");
  return { ts, go };
}
