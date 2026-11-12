import { describe, expect, it } from "vitest";
import { bootstrapFromSources, elaborateSources } from "../src/Descriptor.js";
import { preludeSource } from "../src/Preludes.js";

// Contract: a name returned by a form's `:type` hook resolves through the same
// prelude alias map as hole types (ask 0004, a 0.5.0 regression).
const preludeWith = (producerType: string) => bootstrapFromSources(preludeSource("compiler.lisp"), `
(type Truth (Brand Bool))
(type Output {:kind String})
(form (producer name) :types {:name (Declares Value)}
  :type (fn [holes] (quote ${producerType})) :ir Output {:kind "Producer"})
(form (consumer value) :types {:value (Expr Truth)}
  :ir Output {:kind "Consumer"})`);

const messages = (producerType: string) =>
  elaborateSources([{ sourceId: "repro.forma", source: "(producer ready)\n(consumer ready)" }], { prelude: preludeWith(producerType) })
    .diagnostics.map(d => d.message);

describe(":type hook results and prelude aliases", () => {
  it("accepts a hook-returned alias where a hole expects the same alias", () => {
    expect(messages("Truth")).toEqual([]);
  });

  it("keeps the brand nominal: a plain Bool does not satisfy Truth", () => {
    expect(messages("Bool")).toEqual([expect.stringContaining("value expects Brand<Truth, Bool>")]);
  });
});
