import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { AnalysisWorkspace } from "../src/analysis/workspace.js";
import * as Engine from "../src/Engine.js";
import { generateEffectSystem } from "../src/EffectSystem.js";
import { elaborateEffectProgram, generateEffectProgram } from "../src/mechanics/elaborate.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(packageDir, "src");

function allTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...allTsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

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

describe("single HM checker cutover and mechanics/check retirement (U6/U7)", () => {
  test("retired mechanics/check.ts and mechanics/builtins.ts no longer exist", () => {
    expect(existsSync(resolve(srcDir, "mechanics/check.ts"))).toBe(false);
    expect(existsSync(resolve(srcDir, "mechanics/builtins.ts"))).toBe(false);
  });

  test("no source file in packages/ts/src imports mechanics/check or mechanics/builtins", () => {
    for (const fullPath of allTsFiles(srcDir)) {
      const file = relative(srcDir, fullPath);
      const source = readFileSync(fullPath, "utf8");
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

  test("elaborateEffectProgram checks via the unified HM checker", () => {
    const ok = elaborateEffectProgram(sampleProgram, { sourceId: "ok.lisp" });
    expect(ok.ok).toBe(true);
    expect(ok.diagnostics).toEqual([]);

    const bad = elaborateEffectProgram(invalidProgram, { sourceId: "bad.lisp" });
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.length).toBeGreaterThan(0);
  });

  test("generateEffectProgram generates Effect TypeScript via the unified HM checker", () => {
    const generated = generateEffectProgram(sampleProgram, { sourceId: "gen.lisp" });
    expect(generated.ok).toBe(true);
    expect(generated.code).toContain("export const greet");
  });

  test("generateEffectSystem links Effect systems via the unified HM checker", () => {
    const generated = generateEffectSystem(sampleProgram, { sourceId: "users.lisp" });
    expect(generated.diagnostics).toEqual([]);
    expect(generated.ok).toBe(true);
    expect(generated.code).toContain("export const greet");
  });

  test("AnalysisWorkspace analyzes Effect programs via the unified HM checker", () => {
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
  });

  test("Engine.typecheck checks Effect programs via the unified HM checker", () => {
    const okResult = Engine.typecheck({ source: sampleProgram, sourceId: "ok.lisp" });
    expect(okResult.diagnostics).toEqual([]);

    const badResult = Engine.typecheck({ source: invalidProgram, sourceId: "bad.lisp" });
    expect(badResult.diagnostics.length).toBeGreaterThan(0);
  });
});
