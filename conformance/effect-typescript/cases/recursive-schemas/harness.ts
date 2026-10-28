import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { both, InvalidProperty, Link, parseProperty, Rule, Section, total } from "./expected.js";

export default async function check(): Promise<void> {
  assert.equal(total({ _tag: "Branch", children: [{ _tag: "Leaf", value: 2 }, { _tag: "Branch", children: [{ _tag: "Leaf", value: 3 }] }] }), 5);

  const rule = both({ kind: "present", attribute: "email" }, { kind: "not", rule: { kind: "equals", attribute: "plan", value: "free" } });
  assert.deepEqual(Schema.decodeUnknownSync(Rule)(rule), rule);
  assert.ok(!Schema.is(Rule)({ kind: "all", rules: [{ kind: "not", rule: { kind: "present", attribute: "Email" } }] }));

  const section = { title: "Intro", next: { weight: 3, target: { title: "Body" } } };
  assert.deepEqual(Schema.decodeUnknownSync(Section)(section), section);
  assert.ok(!Schema.is(Section)({ title: "" }));
  assert.ok(!Schema.is(Link)({ weight: 11, target: { title: "Body" } }));

  const property = { name: "work-email", label: "Work email", tags: ["contact"], "visible-when": rule };
  assert.deepEqual(await Effect.runPromise(parseProperty(property)), property);
  for (const invalid of [
    { ...property, name: "Work Email" },
    { ...property, label: "" },
    { ...property, label: "x".repeat(41) },
    { ...property, tags: ["a", "b", "c", "d"] },
    { ...property, "visible-when": { kind: "all", rules: [{ kind: "maybe" }] } },
  ]) {
    const failure = await Effect.runPromise(Effect.flip(parseProperty(invalid)));
    assert.ok(failure instanceof InvalidProperty);
  }
}
