import { Effect } from "effect";
import { expect, test } from "vitest";
import { parseManyToSExpr } from "../src/Reader.js";
import { SurfaceInputError } from "../src/Diagnostic.js";
import { datum } from "../src/surface/datum.js";
import { normalizeForm } from "../src/Descriptor.js";
import { parseUnifiedForm } from "../src/surface/form.js";

// Neither tag is emitted by the successful source reader. Embedders can pass
// recovered Error nodes or legacy Set nodes through the SExpr APIs.
for (const _tag of ["Set", "Error"] as const) {
  test(`unsupported host datum nodes carry a code and field path: ${_tag}`, () => {
    const loc = {start:0,end:0,line:1,col:1};
    const expression = _tag === "Set" ? {_tag, items:[], loc} : {_tag, message:"recovered", loc};
    let caught: unknown;
    try { datum(expression); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(SurfaceInputError);
    expect(caught).toMatchObject({code:"surface/invalid-input",path:"expression._tag"});
    expect(caught).not.toHaveProperty("loc");
  });
}

test("host form matching rejects non-application syntax without a fake span", () => {
  const expressions = Effect.runSync(parseManyToSExpr('(type IR {}) (form (sample) :types {} :ir IR {}) 42'));
  const type = expressions[0]!;
  const descriptor = parseUnifiedForm(expressions[1]!, new Map([["IR", type._tag === "List" ? type.items[2]! : type]]))!;
  let caught: unknown;
  try { normalizeForm({formName: descriptor.name, descriptor, expr: expressions[2]!}); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(SurfaceInputError);
  expect(caught).toMatchObject({code:"surface/invalid-input",path:"expression._tag"});
  expect(caught).not.toHaveProperty("loc");
});
