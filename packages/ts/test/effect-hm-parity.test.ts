/**
 * HM Effect conformance parity suite (Wave U2 / U4).
 *
 * Runs every positive and negative core Effect fixture under
 * `conformance/effect-typescript/cases/` through `checkEffectProgram`
 * (the unified HM checker after `expandEffectLibrary` / `expandEffectDeclarations`).
 */
import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEffectProgram } from "../src/type/index.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const casesDir = resolve(packageDir, "../../conformance/effect-typescript/cases");

interface ConformanceCase {
  readonly name: string;
  readonly dir: string;
  readonly source: string;
}

const isDomainCase = (dir: string): boolean =>
  ["elm.json", "email.json", "http-api.json", "cluster.json", "effect-system.json"].some((f) =>
    existsSync(resolve(dir, f)),
  );

const cases: readonly ConformanceCase[] = readdirSync(casesDir, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(resolve(casesDir, entry.name, "program.lisp")) &&
      !isDomainCase(resolve(casesDir, entry.name)),
  )
  .map((entry) => ({
    name: entry.name,
    dir: resolve(casesDir, entry.name),
    source: readFileSync(resolve(casesDir, entry.name, "program.lisp"), "utf8"),
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

const positive = cases.filter((item) => existsSync(resolve(item.dir, "harness.ts")));
const negative = cases.filter((item) => existsSync(resolve(item.dir, "expected-diagnostics.json")));

/**
 * Negative conformance fixtures whose rejection rules belong to IR projection /
 * Effect TypeScript codegen (`artifact.ts` / schema emission) rather than HM
 * type checking. Each entry documents the exact non-typecheck rule it tests.
 */
const IR_PROJECTION_ONLY_NEGATIVES: Readonly<Record<string, string>> = {
  "reject-load-order":
    "Tests JavaScript module-initialization load-order cycle (a constant referencing itself through a function at module load time) and redundant wildcard arm; belongs to IR projection / artifact validation rather than HM typing (HM permits mutually recursive top-level definitions).",
  "reject-recursive-schema":
    "Tests Effect TypeScript Schema.Codec<T> codegen restriction prohibiting recursive schemas through Brand or class (where decoded and encoded JS representations diverge); belongs to portable schema IR projection rather than HM typing.",
};

describe("HM Effect conformance parity", () => {
  test("covers all core Effect conformance fixtures", () => {
    expect(positive.length).toBe(20);
    expect(negative.length).toBe(32);
    for (const name of Object.keys(IR_PROJECTION_ONLY_NEGATIVES)) {
      expect(negative.some((item) => item.name === name), `Unknown exception ${name}`).toBe(true);
    }
  });

  describe.each(positive)("positive: $name", (item) => {
    test("accepts under HM", () => {
      const result = checkEffectProgram(item.source, { sourceId: `cases/${item.name}/program.lisp` });
      const errors = result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
      expect(errors, `${item.name} (${result.phase ?? "ok"})`).toEqual([]);
      expect(result.ok).toBe(true);
    });
  });

  describe.each(negative)("negative: $name", (item) => {
    const irReason = IR_PROJECTION_ONLY_NEGATIVES[item.name];
    if (irReason) {
      test(`documented IR-projection-only rule (${item.name})`, () => {
        expect(irReason.length).toBeGreaterThan(0);
      });
      return;
    }

    test("rejects under HM", () => {
      const result = checkEffectProgram(item.source, { sourceId: `cases/${item.name}/program.lisp` });
      expect(result.ok, `${item.name} unexpectedly accepted by HM`).toBe(false);
    });
  });

  describe("checkEffectProgram summary for Wave U3 (U6) cutover", () => {
    test("returns checked bindings, operational effect sets, services, errors, and layer sets", () => {
      const result = checkEffectProgram(`
        (error NotFound {:id String})
        (service Users (: find (-> String (Effect String [NotFound]))))
        (layer UsersLive :provides Users (define find [id] (succeed id)))
        (: lookup (-> String (Effect String [NotFound] [Users.find])))
        (define lookup [id] (Users.find id))
        (: run (-> String (Effect String [NotFound])))
        (define run [id] (provide (lookup id) UsersLive))
      `);

      expect(result.ok).toBe(true);
      expect(result.errors.has("NotFound")).toBe(true);
      expect(result.services.has("Users")).toBe(true);
      expect(result.services.get("Users")?.has("find")).toBe(true);

      const lookup = result.bindings.get("lookup");
      expect(lookup).toBeDefined();
      expect([...(lookup?.effect?.errors.keys() ?? [])]).toEqual(["NotFound"]);
      expect([...(lookup?.effect?.requirements.keys() ?? [])]).toEqual(["Users.find"]);

      const run = result.bindings.get("run");
      expect(run).toBeDefined();
      expect([...(run?.effect?.errors.keys() ?? [])]).toEqual(["NotFound"]);
      expect([...(run?.effect?.requirements.keys() ?? [])]).toEqual([]);

      const usersLive = result.bindings.get("UsersLive");
      expect(usersLive?.layer).toBeDefined();
      expect([...(usersLive?.layer?.provides.keys() ?? [])]).toEqual(["Users"]);
      expect([...(usersLive?.layer?.errors.keys() ?? [])]).toEqual([]);
      expect([...(usersLive?.layer?.requirements.keys() ?? [])]).toEqual([]);
    });
  });
});
