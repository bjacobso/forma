import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Builtins, Evaluator } from "../src/index.js";

// Shared conformance suite — the same fixtures run against @formalang/ocaml via
// packages/ocaml/scripts/forma-zero.mjs. See
// conformance/README.md and docs/language.md.
const __dirname = dirname(fileURLToPath(import.meta.url));
const suiteDir = resolve(__dirname, "../../../conformance/forma-zero");
const casesDir = join(suiteDir, "cases");

const prelude = readFileSync(join(suiteDir, "prelude.lisp"), "utf8");
const expected: Record<string, { kind: "string" | "int" | "bool"; value: unknown }> = JSON.parse(
  readFileSync(join(suiteDir, "expected.json"), "utf8"),
);

const PreludeLive = Evaluator.makePreludeLayer(Builtins.defaultBuiltins);
const opts: Evaluator.KernelOptions = {
  stepLimit: 500_000,
  builtins: Builtins.defaultBuiltins,
};

const run = (source: string) =>
  Effect.runPromise(Effect.provide(Evaluator.evaluate(source, opts), PreludeLive)).then(
    (r) => r.value,
  );

const caseNames = readdirSync(casesDir)
  .filter((f) => f.endsWith(".lisp"))
  .map((f) => f.replace(/\.lisp$/, ""))
  .sort();

describe("forma-zero conformance (shared suite)", () => {
  test("every case file has an expectation, and vice versa", () => {
    expect(caseNames).toEqual(Object.keys(expected).sort());
  });

  for (const name of caseNames) {
    test(name, async () => {
      const source = readFileSync(join(casesDir, `${name}.lisp`), "utf8");
      const result = await run(`${prelude}\n${source}`);
      const want = expected[name]!;
      switch (want.kind) {
        case "int":
          expect(result).toBe(want.value);
          break;
        case "bool":
          expect(result).toBe(want.value);
          break;
        case "string":
          expect(result).toBe(want.value);
          break;
      }
    });
  }
});
