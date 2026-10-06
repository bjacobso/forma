import { describe, expect, test } from "vitest";

import { Editor, Syntax } from "../src/index.js";
import { bootstrapOntologyPreludes } from "../src/Preludes.js";

const descriptors = bootstrapOntologyPreludes().descriptions;

const slotsAt = (source: string, text: string, options: Partial<Editor.FormSlotsRequest> = {}) =>
  Editor.formSlots({ source, offset: source.indexOf(text), descriptors, ...options });

describe("formSlots", () => {
  const query = `(query directory
  :from Employee
  :frobnicate 1)`;

  test("reports present, empty, and missing slots of a descriptor form", () => {
    const slots = slotsAt(query, "Employee")!;
    expect(slots.form).toMatchObject({ name: "query", phase: "domain" });
    expect(slots.activeSlot).toBe("from");
    expect(slots.identifiers).toEqual([
      expect.objectContaining({ name: "name", declaration: true, span: { start: 7, end: 16 } }),
    ]);
    expect(slots.slots.filter(slot => ["from","where","select"].includes(slot.name)).map(slot => [slot.name,slot.required,slot.empty,slot.missing,slot.placeholder])).toEqual([
      ["from",true,false,false,"+ from"],
      ["where",false,true,false,"+ where"],
      ["select",false,true,false,"+ select"],
    ]);
    const from = slots.slots.find(slot => slot.name === "from")!;
    expect(from.occurrences[0]!.values.map((value) => query.slice(value.span.start, value.span.end))).toEqual([
      "Employee",
    ]);
    expect(from.available).toBe(false);
    expect(slots.unknownSlots.map((slot) => slot.name)).toEqual(["frobnicate"]);
  });

  test("gives insertions that an edit script can apply", () => {
    const identity = Syntax.identifySyntax(query);
    const where = slotsAt(query, "directory", { identity })!.slots.find((slot) => slot.name === "where")!;
    expect(where.insertion).toEqual({
      at: { parent: identity.nodes[0]!.id },
      text: ":where ",
      cursor: 7,
    });
    const result = Editor.applyEditScript({
      source: query,
      identity,
      script: { version: 1, ops: [{ op: "insert", at: where.insertion.at, text: where.insertion.text }] },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.source).toBe(`${query.slice(0, -1)} :where)`);
    const after = slotsAt(result.source, "directory")!;
    expect(after.slots.find((slot) => slot.name === "where")).toMatchObject({
      empty: true,
      occurrences: [expect.objectContaining({ values: [] })],
    });
  });

  test("reports missing identifiers and required slots", () => {
    const source = "(query)";
    const identity = Syntax.identifySyntax(source);
    const slots = Editor.formSlots({ source, identity, offset: 1, descriptors })!;
    expect(slots.identifiers[0]).toMatchObject({
      name: "name",
      insertion: { at: { parent: identity.nodes[0]!.id }, text: "name" },
    });
    expect(slots.slots.filter((slot) => slot.missing).map((slot) => slot.name)).toEqual(["from"]);
  });

  test("keeps several missing identifiers in order", () => {
    const prelude = `(type LinkIR {:label (Option String)})
(form (link from to {:keys [label]}) :types {:from Symbol :to Symbol :label (Option String)} :ir LinkIR {:label label})`;
    const source = "(link :label x)";
    const identity = Syntax.identifySyntax(source);
    const slots = Editor.formSlots({ source, identity, offset: 1, descriptorSources: [prelude] })!;
    const result = Editor.applyEditScript({
      source,
      identity,
      script: {
        version: 1,
        ops: slots.identifiers.map((identifier) => ({
          op: "insert",
          at: identifier.insertion!.at,
          text: identifier.insertion!.text,
        })),
      },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.source).toBe("(link from to :label x)");
  });

  test("finds the enclosing form from a nested position", () => {
    const source = "(entity Employee\n  {:name (String :indexed true)})";
    const slots = slotsAt(source, "indexed")!;
    expect(slots.form.name).toBe("entity");
    expect(slots.activeSlot).toBe("fields");
    expect(slots.slots.find(slot => slot.name === "fields")).toMatchObject({many:false,available:false});
  });

  test("derives forms from types and patterns in the document and given sources", () => {
    const prelude = `(type WorkflowIR {:trigger String :steps (Option (List String))})
(form (workflow name {:keys [trigger steps]})
  :types {:name (Declares Workflow) :trigger String :steps (Option (List String))}
  :ir WorkflowIR {:trigger trigger :steps steps})`;
    const source = "(workflow onboarding)";
    const slots = Editor.formSlots({source,offset:2,descriptorSources:[prelude]})!;
    expect(slots.slots.map(slot => [slot.name,slot.missing,slot.placeholder])).toEqual([
      ["trigger",true,"+ trigger"],["steps",false,"+ steps"],
    ]);
    expect(Editor.formSlots({source:`${prelude}\n${source}`,offset:prelude.length+3})?.form.name).toBe("workflow");
  });

  test("returns nothing outside descriptor forms", () => {
    expect(Editor.formSlots({ source: "(+ 1 2)", offset: 1, descriptors })).toBeUndefined();
    expect(Editor.formSlots({ source: "", offset: 0, descriptors })).toBeUndefined();
  });
});
