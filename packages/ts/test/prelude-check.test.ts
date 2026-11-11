import { describe, expect, test } from "vitest";
import { checkPrelude } from "../src/Preludes.js";
import { DiagnosticCatalog } from "../src/Diagnostic.js";

const source = `(type Greeting {:kind "Greeting" :name Symbol})
(form (greet name) "Declare a greeting."
  :types {:name (Declares Greeting)}
  :check (fn [holes] [{:code "greeting/notice" :severity :warning :message "A greeting"}])
  :examples ["(greet world)"]
  :ir Greeting {:kind "Greeting" :name name})`;
const catalog = new DiagnosticCatalog();
catalog.register({code:"greeting/notice",summary:"A greeting",explanation:"Greetings are welcome.",stability:"unstable"});
const inputs = (text = source) => [{sourceId:"consumer/greeting.forma",source:text}];

describe("consumer prelude checks", () => {
  test("checks examples and emits reference Markdown with a consumer catalog", () => {
    const result = checkPrelude(inputs(), {catalog});
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    expect(result.forms).toBe(1);
    expect(result.examples).toBe(1);
    expect(result.reference).toContain("Declare a greeting.");
    expect(result.reference).toContain("(greet world)");
    expect(result.diagnostics.map(d => d.code)).toEqual(["greeting/notice"]);
  });

  test.each([
    [source.replace('"Declare a greeting."', '" "'), "prelude/docstring"],
    [source.replace(':examples ["(greet world)"]', ''), "prelude/examples"],
    [source.replace('(greet world)', '(greet)'), "elaborate/malformed-form"],
    [source.replace(':name (Declares Greeting)', ':missing Int'), "descriptor/form"],
  ])("rejects invalid consumer content", (text, code) => {
    const result = checkPrelude(inputs(text), {catalog});
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === code), JSON.stringify(result.diagnostics)).toBe(true);
  });

  test("requires coverage for literal codes even in an unexecuted branch", () => {
    const result = checkPrelude(inputs(source.replace('(fn [holes] [', '(fn [holes] (if false [').replace('"A greeting"}])', '"A greeting"}] []))')));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code:"prelude/diagnostic-coverage",span:expect.objectContaining({sourceId:"consumer/greeting.forma"})}));
  });

  test("runs artifact metachecks even for unused standalone contracts", () => {
    const result = checkPrelude(inputs('(__payload-contract Broken not-a-payload-clause)'));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({code:"artifact/descriptor-payload",span:expect.objectContaining({sourceId:"consumer/greeting.forma"})}));
  });
});
