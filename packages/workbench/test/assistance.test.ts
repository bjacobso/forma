import { Outliner } from "@foldworks/outliner";
import { init } from "../src/init.js";
import { fromRows, toRows } from "../src/document.js";
import { outlineToSource, sourceToOutline } from "@formalang/ts/syntax";
import { Message } from "../src/message.js";
import { update } from "../src/update.js";
import { expect, it } from "vitest";
import { completeAt, hoverFact } from "../src/adapter.js";
import { analyzeSource, onboarding } from "./support/program.js";

it("shares typed hover facts and scoped completions", async () => {
  const analysis = await analyzeSource(onboarding);
  const offset = onboarding.indexOf("amount tax-rate");
  expect(hoverFact(analysis, offset)).toMatchObject({
    title: "amount",
    kind: "local",
    type: "Float",
  });
  expect(completeAt(analysis, "am", 2, offset).items.map((item) => item.label)).toContain("amount");
  expect(
    completeAt(analysis, "am", 2, onboarding.indexOf("(map with-tax")).items.map(
      (item) => item.label,
    ),
  ).not.toContain("amount");
});

it("obtains missing slots and their templates from descriptors", async () => {
  const analysis = await analyzeSource(onboarding.replace(' :system "Okta"', ""));
  const activate = analysis.rows.find((row) => row.text.startsWith("step activate "))!;
  expect(analysis.slots[activate.id]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "system", text: expect.stringContaining(":system") }),
    ]),
  );
});

it("fills keyword options in the form header and undoes with exact source", async () => {
  const analysis = await analyzeSource(onboarding);
  const parent = analysis.rows.find((row) => row.text.startsWith("step activate "))!;
  const rows = sourceToOutline(onboarding, { identity: analysis.document.identity }).items;
  const initialized = init({ id: "test", source: onboarding, title: "program.forma" }).model;
  const model = {
    ...initialized,
    analysis,
    document: analysis.document,
    outline: { ...Outliner.init({ id: "outline", items: fromRows(rows) }), revision: 1 },
    documents: [{ rows, document: analysis.document }],
  };
  const filled = update(
    model,
    Message.GotOutlinerMessage({
      message: Outliner.Message.FilledPlaceholder({
        parentId: parent.id,
        index: 0,
        key: "doc",
        text: ':doc "Ready"',
        offset: 12,
      }),
    }),
  ).model;
  const printed = outlineToSource(toRows(filled.outline.items), { base: analysis.document });
  expect(printed.source).toContain(
    '(step activate :system "Okta" :reads [:check :i9 :payroll] :doc "Ready")',
  );
  const checked = await analyzeSource(printed.source);
  expect(checked.diagnostics).toEqual([]);
  expect(filled.outline.focus?.id).toBe(parent.id);
  const undone = update(
    filled,
    Message.GotOutlinerMessage({ message: Outliner.Message.ClickedUndo() }),
  ).model;
  expect(undone.document?.source).toBe(onboarding);
});
