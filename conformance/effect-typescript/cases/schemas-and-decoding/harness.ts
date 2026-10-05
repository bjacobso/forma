import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { area, describeDrawing, Drawing, InvalidDrawing, makeCircle, parseDrawing, Shape, warmth } from "./expected.js";

export default async function check(): Promise<void> {
  const circle = makeCircle("c1", 2);
  assert.deepEqual(circle, {
    id: "c1",
    shape: { kind: "circle", radius: 2 },
    color: "red",
    tags: {},
    title: "circle c1",
  });
  // Values built by Forma functions satisfy the generated schemas.
  assert.deepEqual(Schema.decodeUnknownSync(Drawing)(circle), circle);

  assert.equal(await Effect.runPromise(area({ kind: "rectangle", width: 3, height: 4 })), 12);
  assert.equal(await Effect.runPromise(area({ kind: "polygon", points: [[0, 0], [1, 0], [0, 1]] })), 3);
  assert.equal(await Effect.runPromise(area(circle.shape)), 12.56);
  assert.equal(await Effect.runPromise(warmth("red")), "warm");
  assert.equal(await Effect.runPromise(warmth("blue")), "cool");

  const json = {
    id: "d1",
    shape: { kind: "rectangle", width: 2, height: 5 },
    color: "green",
    label: 7,
    tags: { owner: "ada" },
    title: "Box",
  };
  assert.equal(await Effect.runPromise(describeDrawing(json)), "Box: cool rectangle of area 10 [7]");
  const { label: _label, ...unlabelled } = json;
  assert.equal(await Effect.runPromise(describeDrawing(unlabelled)), "Box: cool rectangle of area 10 [unlabelled]");
  const decoded = await Effect.runPromise(parseDrawing({ ...json, label: "front" }));
  assert.equal(decoded.label, "front");

  for (const invalid of [
    { ...json, color: "purple" },
    { ...json, shape: { kind: "triangle" } },
    { ...json, label: 1.5 },
    { ...json, tags: { owner: 1 } },
    "not a drawing",
  ]) {
    const failure = await Effect.runPromise(Effect.flip(parseDrawing(invalid)));
    assert.ok(failure instanceof InvalidDrawing);
    assert.equal(failure.message, "drawing does not match the schema");
  }

  assert.ok(Schema.is(Shape)({ kind: "circle", radius: 1 }));
  assert.ok(!Schema.is(Shape)({ kind: "circle", radius: "1" }));
}
