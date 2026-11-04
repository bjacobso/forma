import { describe, expect, test } from "vitest";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";

const source = (examples: string) => `(type GreetingIR {:message String})
(form (greet message) "A greeting." :types {:message String} :ir GreetingIR
  :examples ${examples} {:message message})`;

describe("form documentation examples", () => {
  test("stores syntax programs and source strings as descriptor documentation", () => {
    const prelude = bootstrapFromSources("", source(String.raw`[[(greet "Ada") (greet "Grace")] "(greet \"Lin\")"]`));
    const examples = prelude.descriptions.getExamples("greet");
    expect(examples).toEqual(['(greet "Ada")\n(greet "Grace")', '(greet "Lin")']);
  });

  test("does not evaluate examples or pull their referenced helpers into hooks", () => {
    const prelude = bootstrapFromSources("", '(define unused [x] (fail "not executable"))\n' + source('[[(unused "example")]]'));
    expect(prelude.descriptions.get("greet")?.surface?.helpers).toEqual([]);
  });

  test.each(["42", "[42]", '[""]', "[[]]"])("rejects malformed example data: %s", examples => {
    expect(() => bootstrapFromSources("", source(examples))).toThrow(/:examples/);
  });
});
