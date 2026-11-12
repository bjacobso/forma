import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parse, toSExprMany } from "../src/Reader.js";
import { lowerProgram } from "../src/type/lower.js";
import { normalizeCoreProgram } from "../src/surface/core.js";
import { protocolType } from "../src/surface/contract.js";
import { resolveModuleGraph, sourceModuleResolver } from "../src/Modules.js";

const fixture = (name: string) => readFileSync(new URL(`../../../conformance/invalid-source/${name}.lisp`, import.meta.url), "utf8");
const expressions = (source: string) => toSExprMany(parse(source).redTree);

for (const [name, offset] of [["action-definition", 0], ["action-duplicate-signature", 25]] as const) {
  test(`${name} retains the authored signature span before action lowering`, () => {
    expect(() => lowerProgram(expressions(fixture(name)))).toThrowError(expect.objectContaining({
      _tag: "InferenceError", details: { code: "typecheck/lower" },
      origin: expect.objectContaining({ span: { start: offset, end: offset + 24 } }),
    }));
  });
}

test("constructor traversal rejects a match without its final body", () => {
  const source = fixture("action-match");
  expect(() => normalizeCoreProgram(expressions(source))).toThrowError(expect.objectContaining({
    _tag: "InferenceError", details: { code: "surface/invalid-form" },
    origin: expect.objectContaining({ span: { start: source.indexOf("(match"), end: source.indexOf("(match") + 11 } }),
  }));
});

test("protocol projection rejects a List type without an item type", () => {
  const type = expressions(fixture("core-type-body"))[0]!;
  if (type._tag !== "List") throw new Error("expected declaration");
  expect(() => protocolType(type.items[2]!)).toThrowError(expect.objectContaining({
    _tag: "InferenceError", details: { code: "surface/invalid-form" },
    origin: expect.objectContaining({ span: { start: 12, end: 18 } }),
  }));
});

test("module declaration collisions describe authored names without internal markers", () => {
  expect(() => resolveModuleGraph({ id: "bad.lisp", source: fixture("ontology-collision") }, sourceModuleResolver([]))).toThrowError(expect.objectContaining({
    diagnostic: expect.objectContaining({ code: "module/declaration-name",
      message: "Module declaration E.Id must be an unqualified name.",
      span: expect.objectContaining({ sourceId: "bad.lisp", startOffset: 68, endOffset: 72 }),
    }),
  }));
});

test("reserved module names do not leak the internal marker in diagnostics", () => {
  expect(() => resolveModuleGraph({ id: "reserved.lisp", source: "(define x__forma_1234 1)" }, sourceModuleResolver([]))).toThrowError(expect.objectContaining({
    diagnostic: expect.objectContaining({ code: "module/declaration-name",
      message: "Module declaration uses a reserved internal name.",
      span: expect.objectContaining({ sourceId: "reserved.lisp", startOffset: 8, endOffset: 21 }),
    }),
  }));
});
