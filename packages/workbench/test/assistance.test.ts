import { expect, it } from "vitest";
import { completeAt, hoverFact } from "../src/adapter.js";
import { analyzeSource, onboarding } from "./support/program.js";

it("shares typed hover facts and scoped completions", async () => {
  const analysis = await analyzeSource(onboarding);
  const offset = onboarding.indexOf("amount tax-rate");
  expect(hoverFact(analysis, offset)).toMatchObject({ title: "amount", kind: "local", type: "Number" });
  expect(completeAt(analysis, "am", 2, offset).items.map((item) => item.label)).toContain("amount");
  expect(completeAt(analysis, "am", 2, onboarding.indexOf("(map with-tax")).items.map((item) => item.label)).not.toContain("amount");
});

it("obtains missing slots and their templates from descriptors", async () => {
  const analysis = await analyzeSource(onboarding.replace(' :system "Okta"', ""));
  const activate = analysis.rows.find((row) => row.text.startsWith("step activate "))!;
  expect(analysis.slots[activate.id]).toEqual(expect.arrayContaining([expect.objectContaining({ key: "system", text: expect.stringContaining(":system") })]));
});
