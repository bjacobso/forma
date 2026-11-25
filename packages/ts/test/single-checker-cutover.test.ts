import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { legacyCheckSpy } = vi.hoisted(() => ({
  legacyCheckSpy: vi.fn(() => {
    throw new Error("Legacy mechanics/check.ts must not be called after single-checker cutover");
  }),
}));

vi.mock("../src/mechanics/check.js", () => ({
  checkMechanicsDeclarations: legacyCheckSpy,
}));

import { AnalysisWorkspace } from "../src/analysis/workspace.js";
import * as Engine from "../src/Engine.js";
import { generateEffectSystem } from "../src/EffectSystem.js";
import { elaborateEffectProgram, generateEffectProgram } from "../src/mechanics/elaborate.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(packageDir, "src");

function importSpecifiers(source: string): readonly string[] {
  const specs: string[] = [];
  for (const match of source.matchAll(/\b(?:import|export)\b[^"'`]*?\bfrom\s*["']([^"']+)["']/g)) {
    specs.push(match[1]!);
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    specs.push(match[1]!);
  }
  return specs;
}

const sampleProgram = `
  (type User {:id String :name String})
  (error NotFound {:id String})
  (service Users
    (: find (-> String (Effect User [NotFound] []))))
  (layer UsersLive
    :provides Users
    (define find [id] (fail (NotFound {:id id}))))
  (: greet (-> String (Effect String [NotFound] [Users])))
  (define greet (fn [id]
    (do! [user (Users.find id)]
      (succeed (str "Hello, " (get user :name))))))
`;

const invalidProgram = `
  (error NotFound {:id String})
  (service Users
    (: find (-> String (Effect String [NotFound] []))))
  (: bad (-> String (Effect Int [] [])))
  (define bad (fn [id]
    (Users.find id)))
`;

describe("single HM checker cutover (U6)", () => {
  beforeEach(() => {
    legacyCheckSpy.mockClear();
  });

  test("cutover source files never import mechanics/check.ts or mechanics/builtins.ts", () => {
    const cutoverFiles = [
      "mechanics/elaborate.ts",
      "mechanics/analysis.ts",
      "mechanics/checked.ts",
      "mechanics/checked-contract.ts",
      "analysis/workspace.ts",
      "engine/operations.ts",
    ];
    for (const file of cutoverFiles) {
      const source = readFileSync(resolve(srcDir, file), "utf8");
      const specs = importSpecifiers(source);
      const forbidden = specs.filter(
        (spec) =>
          /(?:^|\/)mechanics\/check(?:\.js|\.ts)?$/.test(spec) ||
          /(?:^|\/)mechanics\/builtins(?:\.js|\.ts)?$/.test(spec) ||
          (file.startsWith("mechanics/") &&
            (/(?:^|\/)check(?:\.js|\.ts)?$/.test(spec) ||
              /(?:^|\/)builtins(?:\.js|\.ts)?$/.test(spec))),
      );
      expect(forbidden, `${file} must not import mechanics/check or mechanics/builtins`).toEqual([]);
    }
  });

  test("elaborateEffectProgram makes zero calls into mechanics/check.ts", () => {
    const ok = elaborateEffectProgram(sampleProgram, { sourceId: "ok.lisp" });
    expect(ok.ok).toBe(true);
    expect(ok.diagnostics).toEqual([]);

    const bad = elaborateEffectProgram(invalidProgram, { sourceId: "bad.lisp" });
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.length).toBeGreaterThan(0);

    expect(legacyCheckSpy).not.toHaveBeenCalled();
  });

  test("generateEffectProgram makes zero calls into mechanics/check.ts", () => {
    const generated = generateEffectProgram(sampleProgram, { sourceId: "gen.lisp" });
    expect(generated.ok).toBe(true);
    expect(generated.code).toContain("export const greet");
    expect(legacyCheckSpy).not.toHaveBeenCalled();
  });

  test("generateEffectSystem makes zero calls into mechanics/check.ts", () => {
    const generated = generateEffectSystem(sampleProgram, { sourceId: "users.lisp" });
    expect(generated.diagnostics).toEqual([]);
    expect(generated.ok).toBe(true);
    expect(generated.code).toContain("export const greet");
    expect(legacyCheckSpy).not.toHaveBeenCalled();
  });

  test("AnalysisWorkspace makes zero calls into mechanics/check.ts", () => {
    const workspace = new AnalysisWorkspace();
    workspace.setDocument("ok.lisp", sampleProgram);
    workspace.setDocument("bad.lisp", invalidProgram);

    const okAnalysis = workspace.analysis("ok.lisp");
    expect(okAnalysis.diagnostics).toEqual([]);
    expect(okAnalysis.bindingDisplay("greet")).toBeDefined();

    const greetOffset = sampleProgram.indexOf("greet");
    expect(workspace.hover("ok.lisp", greetOffset)).toBeDefined();

    const badDiagnostics = workspace.diagnostics("bad.lisp");
    expect(badDiagnostics.length).toBeGreaterThan(0);

    expect(legacyCheckSpy).not.toHaveBeenCalled();
  });

  test("Engine.typecheck makes zero calls into mechanics/check.ts", () => {
    const okResult = Engine.typecheck({ source: sampleProgram, sourceId: "ok.lisp" });
    expect(okResult.diagnostics).toEqual([]);

    const badResult = Engine.typecheck({ source: invalidProgram, sourceId: "bad.lisp" });
    expect(badResult.diagnostics.length).toBeGreaterThan(0);

    expect(legacyCheckSpy).not.toHaveBeenCalled();
  });
});
