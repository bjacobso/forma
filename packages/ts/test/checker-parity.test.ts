import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import { describe, expect, test } from "vitest";
import { AnalysisWorkspace } from "../src/Analysis.js";
import { typecheck } from "../src/Engine.js";
import { elaborateEffectProgram } from "../src/Mechanics.js";
import { checkModuleGraph, resolveModuleGraph, sourceModuleResolver } from "../src/Modules.js";
import * as Type from "../src/Type.js";

interface ParityCase {
  readonly id: string;
  readonly category: string;
  readonly file: string;
  readonly expected: "accept" | "reject";
  readonly checkers: readonly ("hm" | "mechanics" | "engine" | "workspace")[];
  readonly description: string;
}

interface ParityManifest {
  readonly version: number;
  readonly cases: readonly ParityCase[];
}

const suiteDir = resolve(import.meta.dirname, "../../../conformance/checker-parity");
const manifest = JSON.parse(readFileSync(resolve(suiteDir, "manifest.json"), "utf8")) as ParityManifest;

function hmVerdict(source: string): { ok: boolean; errors: readonly string[] } {
  try {
    const inferred = Effect.runSync(Type.inferSource(source));
    const errors = inferred.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code ?? "hm"}: ${d.message}`);
    return { ok: errors.length === 0, errors };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function mechanicsVerdict(source: string, sourceId: string): { ok: boolean; declarations: number; errors: readonly string[] } {
  const result = elaborateEffectProgram(source, { sourceId });
  const errors = result.diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => `${d.code}: ${d.message}`);
  // Mechanics acceptance requires at least one projected declaration so empty
  // projections cannot silently count as success (one-checker.md stage 2).
  return {
    ok: result.ok && result.declarations.length > 0 && errors.length === 0,
    declarations: result.declarations.length,
    errors,
  };
}

describe("checker parity contracts (conformance/checker-parity)", () => {
  test("manifest covers all seven required contract categories with positive and negative cases", () => {
    const categories = new Set(manifest.cases.map((c) => c.category));
    expect([...categories].sort()).toEqual([
      "brands",
      "constructors",
      "literal-constraints",
      "numeric",
      "option-fields",
      "refinements",
      "shadowed-effect",
    ]);
    for (const category of categories) {
      const inCategory = manifest.cases.filter((c) => c.category === category);
      expect(inCategory.some((c) => c.expected === "accept"), `${category} needs positive case`).toBe(true);
      expect(inCategory.some((c) => c.expected === "reject"), `${category} needs negative case`).toBe(true);
    }
  });

  test.each(manifest.cases)("$id ($category, expect $expected) agrees across checkers", (entry) => {
    const source = readFileSync(resolve(suiteDir, entry.file), "utf8");
    const sourceId = `checker-parity/${entry.file}`;
    const expectOk = entry.expected === "accept";

    if (entry.checkers.includes("hm")) {
      const hm = hmVerdict(source);
      expect(hm.ok, `HM verdict for ${entry.id}: ${JSON.stringify(hm.errors)}`).toBe(expectOk);
    }

    if (entry.checkers.includes("mechanics")) {
      const mech = mechanicsVerdict(source, sourceId);
      expect(
        mech.ok,
        `Mechanics verdict for ${entry.id} (declarations=${mech.declarations}): ${JSON.stringify(mech.errors)}`,
      ).toBe(expectOk);
    }

    if (entry.checkers.includes("engine")) {
      const checked = typecheck({ source, sourceId });
      const errors = checked.diagnostics.filter((d) => d.severity === "error");
      expect(errors.length === 0, `Engine.typecheck for ${entry.id}: ${JSON.stringify(errors)}`).toBe(expectOk);
    }

    if (entry.checkers.includes("workspace")) {
      const ws = new AnalysisWorkspace();
      ws.setDocument(sourceId, source);
      const errors = ws.diagnostics(sourceId).filter((d) => d.severity === "error");
      expect(errors.length === 0, `AnalysisWorkspace for ${entry.id}: ${JSON.stringify(errors)}`).toBe(expectOk);
    }
  });
});

describe("checker parity across named callbacks, Effect shadowing, and imported-file errors", () => {
  test("named numeric callbacks agree across HM, mechanics, Engine.typecheck, and AnalysisWorkspace", () => {
    const source = [
      "(: square (-> Int Int))",
      "(define square [x] (* x x))",
      "(: squares (-> (List Int) (List Int)))",
      "(define squares [xs] (map square xs))",
    ].join("\n");

    expect(hmVerdict(source).ok).toBe(true);
    expect(mechanicsVerdict(source, "callbacks.lisp").ok).toBe(true);
    expect(typecheck({ source, sourceId: "callbacks.lisp" }).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const ws = new AnalysisWorkspace();
    ws.setDocument("callbacks.lisp", source);
    expect(ws.diagnostics("callbacks.lisp").filter((d) => d.severity === "error")).toEqual([]);
  });

  test("shadowed Effect names inside Effect programs agree across mechanics, Engine.typecheck, and AnalysisWorkspace", () => {
    const valid = [
      "(service Clock (: now (Effect Int)))",
      "(: helper (-> String String))",
      "(define helper [succeed] succeed)",
      "(: main (Effect String [] [Clock.now]))",
      '(define main (do! [_ Clock.now] (succeed (helper "ok"))))',
    ].join("\n");

    expect(mechanicsVerdict(valid, "shadow-effect.lisp").ok).toBe(true);
    expect(typecheck({ source: valid, sourceId: "shadow-effect.lisp" }).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const ws = new AnalysisWorkspace();
    ws.setDocument("shadow-effect.lisp", valid);
    expect(ws.diagnostics("shadow-effect.lisp").filter((d) => d.severity === "error")).toEqual([]);

    const invalid = valid.replace('(helper "ok")', "(helper 42)");
    expect(mechanicsVerdict(invalid, "shadow-effect-bad.lisp").ok).toBe(false);
    expect(typecheck({ source: invalid, sourceId: "shadow-effect-bad.lisp" }).diagnostics.some((d) => d.severity === "error")).toBe(true);
    ws.setDocument("shadow-effect-bad.lisp", invalid);
    expect(ws.diagnostics("shadow-effect-bad.lisp").some((d) => d.severity === "error")).toBe(true);
  });

  test("imported-file errors report the imported module span across checkModuleGraph", () => {
    const dep = [
      "(export UserId read-user)",
      "(type UserId (Brand String))",
      "(: read-user (-> UserId Int))",
      '(define read-user [id] "not-an-int")',
    ].join("\n");
    const main = [
      '(import "./dep.lisp" [UserId read-user])',
      "(export main)",
      "(: main (Effect Int))",
      '(define main (succeed (read-user (UserId "u1"))))',
    ].join("\n");

    const graph = resolveModuleGraph(
      { id: "main.lisp", source: main },
      sourceModuleResolver([{ id: "dep.lisp", source: dep }]),
    );
    const checked = checkModuleGraph(graph);
    const errors = checked.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((d) => d.span?.sourceId === "dep.lisp")).toBe(true);
  });

  test("HM refinement diagnostics locate exact author literal spans and agree with mechanics", () => {
    const header = [
      "(type Cents (Int :min 0))",
      "(type Bags (Brand (Int :min 1 :max 200)))",
      '(type Sku (String :pattern "^[A-Z]+-[0-9]+$"))',
      "(type Code (String :min-length 2 :max-length 3))",
      "(type Line {:sku Sku :bags Bags})",
    ].join("\n");

    const cases = [
      {
        body: "(: refund Cents)\n(define refund -5)",
        text: "-5",
        message: "-5 must be at least 0, as (Int :min 0) requires.",
      },
      {
        body: "(: nothing (-> Int (Effect Bags [] [])))\n(define nothing [n] (succeed (Bags 0)))",
        text: "0",
        message: "0 must be at least 1, as (Int :min 1 :max 200) requires.",
      },
      {
        body: '(: bad-line (-> Int (Effect Line [] [])))\n(define bad-line [n] (succeed {:sku "bean-1" :bags (Bags 7)}))',
        text: '"bean-1"',
        message: '"bean-1" must match the pattern ^[A-Z]+-[0-9]+$, as (String :pattern "^[A-Z]+-[0-9]+$") requires.',
      },
      {
        body: '(: use-code (-> Code String))\n(define use-code [c] c)\n(: bad-code String)\n(define bad-code (use-code "abcd"))',
        text: '"abcd"',
        message: '"abcd" must have at most 3 characters, as (String :min-length 2 :max-length 3) requires.',
      },
      {
        body: '(: maybe-code (Option Code))\n(define maybe-code (Some "x"))',
        text: '"x"',
        message: '"x" must have at least 2 characters, as (String :min-length 2 :max-length 3) requires.',
      },
    ];

    for (const entry of cases) {
      const source = `${header}\n\n${entry.body}`;
      const result = Effect.runSync(Effect.result(Type.inferSource(source)));
      expect(result._tag, `Expected HM failure for ${entry.text}`).toBe("Failure");
      if (result._tag === "Failure") {
        const failure = result.failure as Type.InferenceError;
        expect(failure.details["code"]).toBe("typecheck/refinement");
        expect(failure.message).toBe(entry.message);
        const span = failure.origin?.span;
        expect(span ? source.slice(span.start, span.end) : undefined).toBe(entry.text);
      }
    }
  });
});
