import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Type, Reader, Evaluator, Builtins } from "../src/index.js";
import { normalizeCoreProgram } from "../src/surface/core.js";

interface Case {
  id: string;
  stage: number;
  source: string;
  type: string;
  printed?: string;
  runtimeError?: boolean;
}
const cases: Case[] = JSON.parse(readFileSync(new URL("../../../conformance/numeric/expected.json", import.meta.url), "utf8"));
// Explicit proposal contract. Opt in with FORMA_NUMERIC_SPEC=2 (or 3).
const stage = Number(process.env.FORMA_NUMERIC_SPEC ?? 0);
describe("numeric semantics proposal contract", () => {
  for (const entry of cases) it.skipIf(entry.stage > stage)(entry.id, async () => {
    expect(await Effect.runPromise(Type.inferSourceStr(entry.source))).toBe(entry.type);
    const forms = Reader.toSExprMany(Reader.parse(entry.source).redTree);
    for (const interpreter of [false, true]) {
      const run = () => Effect.runSync((interpreter ? Evaluator.evaluateCompileTimeExprs : Evaluator.evaluateExprs)(
        interpreter ? normalizeCoreProgram(forms) : forms,
        {builtins: Builtins.defaultBuiltins, stepLimit: 100_000},
      ));
      if (entry.runtimeError) expect(run).toThrow();
      else expect(Evaluator.printKValue(run().value)).toBe(entry.printed);
    }
  });
});
