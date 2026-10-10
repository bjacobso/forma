import { expect, it } from "vitest";
import { parseOcamlJson } from "../src/ocaml-json.js";

it("decodes frozen OCaml numeric JSON tokens without changing quoted strings or kinds", () => {
  expect(parseOcamlJson('{"kind":"float","values":[2.,-0.,2.e+4,-nan,inf,-inf],"text":"2. nan inf \\\"2.\\\""}')).toEqual({kind: "float", values: [2, -0, 20000, "NaN", "Infinity", "-Infinity"], text: '2. nan inf "2."'});
  expect(() => parseOcamlJson('{"broken":}')).toThrow();
});
