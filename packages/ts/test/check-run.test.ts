import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { evaluate, typecheck } from "../src/Engine.js";
import { isKFloat, type KValue } from "../src/Evaluator.js";

type Category = "agree" | "accepted-but-fails" | "type-disagrees" | "rejected-but-runs";
interface Entry {
  id: string;
  seed?: string;
  program?: string;
  category: Exclude<Category, "agree">;
  note: string;
}
const root = new URL("../../../conformance/check-run/", import.meta.url);
const ledger: Entry[] = JSON.parse(readFileSync(new URL("known-divergences.json", root), "utf8"));
const normalize = (source: string) => source.trim();
const sourceOf = (entry: Entry) => normalize(entry.seed
  ? readFileSync(new URL(entry.seed, root), "utf8") : entry.program!);
const errors = (result: { diagnostics: readonly { severity: string }[] }) =>
  result.diagnostics.some(diagnostic => diagnostic.severity === "error");

// Floats are boxed even when integral; JavaScript numbers represent Ints.
function matches(display: string, value: KValue): boolean {
  switch (display) {
    case "Int": return typeof value === "number";
    case "Float": return isKFloat(value);
    case "String": return typeof value === "string";
    case "Bool": return typeof value === "boolean";
    default: {
      const list = /^List<(Int|Float|String|Bool)>$/.exec(display);
      return !list || (Array.isArray(value) && value.every(item => matches(list[1]!, item)));
    }
  }
}
async function classify(source: string) {
  const checked = await typecheck({ source });
  // Deliberately evaluate independently, including rejected programs.
  const evaluated = await evaluate({ source, stepLimit: 10_000 });
  const category: Category = errors(checked)
    ? errors(evaluated) ? "agree" : "rejected-but-runs"
    : errors(evaluated) ? "accepted-but-fails"
      : matches(checked.display ?? "", evaluated.value) ? "agree" : "type-disagrees";
  return { category, display: checked.display, printed: evaluated.printed,
    codes: evaluated.diagnostics.map(diagnostic => diagnostic.code) };
}

// Typed, bounded expressions keep exploration well scoped and terminating.
// Each recursive layer includes the previous layer, so fast-check can shrink
// both the syntax and its literals. No division by zero or integer overflow.
const integer = fc.integer({ min: -3, max: 3 }).map(String);
const bool = fc.boolean().map(String);
let expression: fc.Arbitrary<string> = integer;
for (let depth = 0; depth < 2; depth++) {
  const child = expression;
  expression = fc.oneof(child,
    fc.tuple(fc.constantFrom("+", "-", "*"), child, child).map(([op, a, b]) => `(${op} ${a} ${b})`),
    fc.tuple(bool, child, child).map(([p, a, b]) => `(if ${p} ${a} ${b})`),
    child.map(a => `(let [x ${a}] (+ x 1))`),
    child.map(a => `((fn [x] x) ${a})`),
    child.map(a => `(cond false 0 true ${a} :else 0)`),
    child.map(a => `(get {:value ${a}} :value)`));
}
const programs = fc.oneof(
  expression,
  fc.constantFrom('"hello"', 'true', '1.5', '[true false]', '["a" "b"]', '[1.0 2.0]'),
  expression.map(a => `(define value ${a}) value`),
  fc.tuple(fc.constantFrom("<", "<=", ">", ">=", "="), expression, expression)
    .map(([op, a, b]) => `(${op} ${a} ${b})`),
  expression.map(a => `(/ ${a} 2)`),
  expression.map(a => `[${a} 1]`),
  expression.map(a => `(map (fn [x] x) [${a} 1])`),
  bool.map(a => `(filter (fn [x] x) [${a} true false])`),
  expression.map(a => `(reduce (fn [a b] b) 0 [${a} 1])`),
  expression.map(a => `(type Choice (Tagged (Picked Int) Empty)) (match (Picked ${a}) (Picked n) n Empty 0)`),
  fc.constantFrom(
    '(define add (fn [a b] (+ a b))) (add 1)',
    '(define square [x] (* x x)) (map square [1 2 3])',
    '(reduce + 0 [1 2 3])',
    '(filter (fn [x] (> x 0)) [0 1])',
    '((fn [x] (+ x 1)) 0)',
    '(if true 0 1.0)',
    '(if false 0.0 1)',
    '(map (fn [x] (+ x 1)) [0])',
    '(reduce (fn [a b] (+ a b)) 0 [1])',
    '(type Point {:x Int}) (define p (Point {:x 1})) p.x',
  ));

const runs = Number(process.env.FORMA_CHECK_RUN_RUNS ?? 150);
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("FORMA_CHECK_RUN_RUNS must be a positive integer");

describe("checker against evaluator", () => {
  it("compares runtime tags, including every list element", () => {
    expect(matches("Float", 1)).toBe(false);
    expect(matches("Int", 1)).toBe(true);
    expect(matches("List<Float>", [1])).toBe(false);
    expect(matches("List<Int>", [1, "bad"])).toBe(false);
    expect(matches("List<Int>", [])).toBe(true);
  });

  it("keeps every ledger entry live and uniquely identified", async () => {
    expect(new Set(ledger.map(entry => entry.id)).size).toBe(ledger.length);
    expect(new Set(ledger.map(sourceOf)).size).toBe(ledger.length);
    for (const entry of ledger) {
      expect(Boolean(entry.seed) !== Boolean(entry.program), entry.id).toBe(true);
      expect(entry.note.trim(), entry.id).not.toBe("");
      expect((await classify(sourceOf(entry))).category,
        `${entry.id} is fixed or changed; prune/update its ledger entry`).toBe(entry.category);
    }
  });

  it("accounts for every seed divergence", async () => {
    const files = readdirSync(new URL("seeds/", root)).filter(file => file.endsWith(".lisp")).sort();
    let agreeing = 0;
    for (const file of files) {
      const source = normalize(readFileSync(new URL(`seeds/${file}`, root), "utf8"));
      const result = await classify(source);
      if (result.category === "agree") agreeing++;
      else expect(ledger.find(entry => sourceOf(entry) === source)?.category,
        `${file}: ${JSON.stringify(result)}`).toBe(result.category);
    }
    expect(agreeing).toBeGreaterThanOrEqual(15);
  });

  it("explores bounded kernel programs with reproducible shrinking", async () => {
    const rejected = new Set<string>();
    const result = await fc.check(fc.asyncProperty(programs, async source => {
      const outcome = await classify(source);
      if (outcome.category === "rejected-but-runs") {
        rejected.add(source);
        return true; // Only seed false rejections are blocking.
      }
      return outcome.category === "agree"
        || ledger.some(entry => sourceOf(entry) === source && entry.category === outcome.category);
    }), { seed: 20261111, numRuns: runs });
    if (process.env.FORMA_CHECK_RUN_RUNS) {
      console.info(`check-run: ${runs} runs; ${rejected.size} distinct nonblocking rejected-but-runs programs`);
      for (const source of [...rejected].slice(0, 10)) console.info(`rejected-but-runs: ${source}`);
    }
    const source = result.counterexample?.[0];
    expect(result.failed, source === undefined ? undefined
      : `Minimized counterexample: ${JSON.stringify(source)}\n${JSON.stringify(await classify(source))}\nReplay: seed=${result.seed}, path=${result.counterexamplePath}\nLedger: ${fileURLToPath(new URL("known-divergences.json", root))}`)
      .toBe(false);
  }, 120_000);
});
