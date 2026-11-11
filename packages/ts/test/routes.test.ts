import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { checkModuleGraph, resolveModuleGraph, sourceModuleResolver, ModuleRuntime } from "../src/Modules.js";

const root = resolve(import.meta.dirname, "../../..");
const read = (id: string) => ({ id, source: readFileSync(resolve(root, id), "utf8") });
const library = read("preludes/modules/routes.lisp");
const valid = read("conformance/routes/valid.lisp");
const graph = (entry: { id: string; source: string }) =>
  resolveModuleGraph(entry, sourceModuleResolver([library, valid, entry]));

test("route templates derive checked parameter records and executable URL builders", async () => {
  const g = graph(valid);
  const result = checkModuleGraph(g);
  expect(result.diagnostics).toEqual([]);
  const exports = result.interfaces.at(-1)!.exports;
  expect(exports.find((e) => e.name === "post-url")?.scheme?.type).toEqual([
    "->", { fields: [[":id", "String"], [":post", "String"]] }, "String",
  ]);
  expect(exports.find((e) => e.name === "team-url")?.scheme?.type).toEqual([
    "->", { fields: [[":member", "String"], [":team", "String"]] }, "String",
  ]);
  expect(exports.find((e) => e.name === "root-url")?.scheme?.type).toEqual([
    "->", { fields: [] }, "String",
  ]);
  expect(exports.find((e) => e.name === "example")?.data?.value).toBe("/users/alice/posts/intro");
  const instance = await new ModuleRuntime().initialize(g);
  for (const [name, expected] of [
    ["example", "/users/alice/posts/intro"],
    ["team", "/teams/eng/members/bob%20smith"],
    ["root", "/"],
    ["mirror", "/mirror/blue/blue"],
  ]) {
    expect(instance.result.env.lookup(exports.find((e) => e.name === name)!.symbol)).toBe(expected);
  }
});

test.each([
  ["missing", "typecheck/type-mismatch", "Missing field(s) in record", '{:id "alice"}'],
  ["wrong-type", "typecheck/type-mismatch", "Expected String, found Int", "42"],
  ["typo", "typecheck/missing-field", "did you mean post?", "(get params :poost)"],
  ["wrong-segment", "typecheck/type-mismatch", "Expected String, found Int", '(route broken-url ["users" 42 [:id]])'],
])("%s is rejected at the author's source", (name, code, message, text) => {
  const entry = read(`conformance/routes/${name}.lisp`);
  const result = checkModuleGraph(graph(entry));
  expect(result.diagnostics).toHaveLength(1);
  const diagnostic = result.diagnostics[0]!;
  expect(diagnostic.code).toBe(code);
  expect(diagnostic.message).toContain(message);
  expect(diagnostic.span).toMatchObject({
    sourceId: entry.id,
    startOffset: entry.source.indexOf(text),
    endOffset: entry.source.indexOf(text) + text.length,
  });
  if (name === "missing") expect(diagnostic.details).toMatchObject({ fields: [":post"] });
});

test.each([
  ['"/users/:id"', "route requires a vector of segments"],
  ['["users" ["id"]]', "route capture must contain one keyword"],
  ['["users" [:id :post]]', "route capture must contain one keyword"],
])("malformed template %s is rejected during expansion", (template, message) => {
  const entry = {
    id: "conformance/routes/malformed.lisp",
    source: `(import "../../preludes/modules/routes.lisp" [route]) (route bad ${template})`,
  };
  expect(() => graph(entry)).toThrow(message);
});
