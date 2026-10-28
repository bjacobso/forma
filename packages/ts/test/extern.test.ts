import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { Mechanics } from "../src/index.js";
import { referencedIdentifiers } from "../src/mechanics/effect-typescript.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const caseDir = resolve(packageDir, "../../conformance/effect-typescript/cases/extern-interop");
const interop = readFileSync(resolve(caseDir, "program.lisp"), "utf8");

/** Typechecks generated code as a sibling of the hand-written payments module. */
function typescriptErrors(code: string): readonly string[] {
  const suiteDir = resolve(caseDir, "../..");
  const config = ts.readConfigFile(resolve(suiteDir, "tsconfig.json"), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, suiteDir).options;
  const file = resolve(caseDir, "__extern_test__.ts");
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (name, version, onError, create) =>
    name === file ? ts.createSourceFile(name, code, version, true) : getSourceFile(name, version, onError, create);
  host.fileExists = (name) => name === file || fileExists(name);
  const program = ts.createProgram([file], options, host);
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(file)).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
}

describe("extern", () => {
  test("projects imported declarations with their module and export and no implementation", () => {
    const result = Mechanics.elaborateEffectProgram(interop, { sourceId: "interop.lisp" });
    expect(result.diagnostics).toEqual([]);
    const imported = result.declarations
      .filter((declaration) => declaration.payloadContract === "mechanics/extern-def/v0")
      .map((declaration) => {
        const payload = declaration.payload as Record<string, unknown>;
        return [payload["kind"], payload["name"], payload["extern"], "body" in payload || "implementation" in payload && (payload["implementation"] as Record<string, unknown>)["kind"] !== "Extern"];
      });
    expect(imported).toEqual([
      ["SchemaDef", "OrderId", { module: "./payments.js", export: "OrderId" }, false],
      ["SchemaDef", "Receipt", { module: "./payments.js", export: "Receipt" }, false],
      ["ErrorDef", "PaymentDeclined", { module: "./payments.js", export: "PaymentDeclined" }, false],
      ["ServiceDef", "Payments", { module: "./payments.js", export: "Payments" }, false],
      ["LayerDef", "PaymentsLive", { module: "./payments.js", export: "PaymentsLive" }, false],
      ["FunctionDef", "format-cents", { module: "./payments.js", export: "formatCents" }, false],
      ["FunctionDef", "slug", { module: "./payments.js", export: "toSlug" }, false],
      ["ValueDef", "currency", { module: "./payments.js", export: "currency" }, false],
      ["EffectDef", "audit", { module: "./payments.js", export: "audit" }, false],
    ]);
    expect(result.check?.layers.get("PaymentsLive")?.type.provides).toEqual(["Payments"]);
  });

  test("projects extern directly from unnormalized forms", () => {
    const result = Mechanics.generateEffectProgram(`
      (extern "node:crypto" (: random-uuid (Effect String) :export "randomUUID"))
      (: fresh (Effect String))
      (define fresh (do! [id random-uuid] id))`);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain('import { randomUUID as randomUuid } from "node:crypto";');
    expect(result.code).toContain("yield* randomUuid");
  });

  test("imports only the declarations the generated module uses", () => {
    const result = Mechanics.generateEffectProgram(`
      (extern "./host.js"
        (: used (-> Int Int))
        (: unused (-> Int Int))
        (error Lost {:id String}))
      (: twice (-> Int Int))
      (define twice (fn [n] (used (used n))))`);
    expect(result.diagnostics).toEqual([]);
    expect(result.code?.split("\n").filter((line) => line.startsWith("import"))).toEqual(['import { used } from "./host.js";']);
  });

  test("a call with the wrong argument type is reported at the call", () => {
    const result = Mechanics.elaborateEffectProgram(`(extern "./host.js" (: label (-> Int String)))
(: shown String)
(define shown (label "seven"))`);
    expect(result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.span?.startLine, diagnostic.span?.startColumn])).toEqual([
      ["mechanics/type-mismatch", 3, 22],
    ]);
  });

  test("a local definition cannot reuse an imported name", () => {
    const result = Mechanics.elaborateEffectProgram(`(extern "./host.js" (: label (-> Int String)))
(: label (-> Int String))
(define label (fn [n] (to-string n)))`);
    // The local signature stays local, so the conflict is reported once, at the local define.
    expect(result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.span?.startLine])).toEqual([["mechanics/duplicate-name", 3]]);
  });

  test("the hosted runtime refuses imported operations", async () => {
    const result = Mechanics.elaborateEffectProgram(`(extern "./host.js" (: ping (Effect Unit)))`);
    const runtime = Mechanics.makeMechanicsRuntime({ declarations: result.declarations, services: {} });
    await expect(runtime.invoke("ping")).rejects.toMatchObject({ code: "mechanics/extern-operation" });
  });

  test("TypeScript rejects a declaration that disagrees with the real export", () => {
    const honest = Mechanics.generateEffectProgram(interop);
    expect(typescriptErrors(honest.code!)).toEqual([]);
    // Payments.charge really succeeds with a Receipt, not a String.
    const wrong = Mechanics.generateEffectProgram(`(extern "./payments.js"
  (type OrderId (Brand String))
  (error PaymentDeclined {:reason String})
  (service Payments (: charge (-> OrderId Int (Effect String [PaymentDeclined])))))
(: pay (-> OrderId (Effect String [PaymentDeclined] [Payments.charge])))
(define pay [id] (Payments.charge id 100))`);
    expect(wrong.diagnostics).toEqual([]);
    expect(typescriptErrors(wrong.code!).join("\n")).toMatch(/not assignable to type 'string'/);
  });
});

describe("referencedIdentifiers", () => {
  test("skips strings, template text, property names, and binding positions", () => {
    const code = [
      'const a: Alpha = f("Beta", `gamma ${delta} epsilon`);',
      "x.zeta; y?.eta;",
      "const o = { theta: iota, kappa };",
      "const t = ok ? lambda : mu;",
      "(nu: Xi) => nu;",
    ].join("\n");
    const found = referencedIdentifiers(code);
    for (const name of ["Alpha", "f", "delta", "iota", "kappa", "lambda", "mu", "Xi", "x", "y", "ok"]) expect(found.has(name), name).toBe(true);
    for (const name of ["Beta", "gamma", "epsilon", "zeta", "eta", "theta"]) expect(found.has(name), name).toBe(false);
  });

  test("resumes code after nested template interpolations", () => {
    const found = referencedIdentifiers("`a ${`b ${inner} c`} d ${{ key: outer }.key}` + after");
    expect([...found].sort()).toEqual(["after", "inner", "outer"]);
  });
});
