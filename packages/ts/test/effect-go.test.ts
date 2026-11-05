import { describe, expect, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { generateEffectGoProgram, generateHttpApiGoProgram } from "../src/EffectGo.js";
import { bootstrapElmPreludes } from "../src/Elm.js";
import { emitFormExpression, emitHook, renderGo } from "../src/descriptor/form-emitter.js";

// The Go packages under prototypes/effect-go/conformance are goldens: the
// generator's exact output, which the Go harnesses there build and run
// against the effect-go runtime. This test needs no Go toolchain.
const cases = [
  ["crud-users", "crudusers"],
  ["operational-effects", "operationaleffects"],
  ["concurrent-workflow", "concurrentworkflow"],
  ["resource-scope", "resourcescope"],
] as const;
const update = process.env["FORMA_UPDATE_GOLDEN"] === "1";
const program = (name: string) => readFileSync(new URL(`../../../conformance/effect-typescript/cases/${name}/program.lisp`, import.meta.url), "utf8");

describe("Effect Go prototype", () => {
  test.each(cases)("generates the %s golden", (name, packageName) => {
    const result = generateEffectGoProgram(program(name), { packageName });
    expect(result.diagnostics).toEqual([]);
    const golden = new URL(`../../../prototypes/effect-go/conformance/${name}/program.go`, import.meta.url);
    if (update) writeFileSync(golden, result.code!);
    expect(result.code).toBe(readFileSync(golden, "utf8"));
  });

  test("keeps the checked error and requirement sets that Go types drop", () => {
    const code = generateEffectGoProgram(program("crud-users"), { packageName: "crudusers" }).code!;
    expect(code).toContain("// GetUser is the operation get-user : (-> UserId (Effect User [UserNotFound] [UserRepo.find])).");
    expect(code).toContain("func GetUser(id UserId) effect.Effect[User] {");
  });

  test("reports constructs the prototype does not translate", () => {
    const result = generateEffectGoProgram(program("stream-pipeline"), { packageName: "streams" });
    expect(result.ok).toBe(false);
    expect(result.code).toBeUndefined();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["effect-go/unsupported"]);
  });

  test("never generates a program the checker rejects", () => {
    const result = generateEffectGoProgram(program("reject-undeclared-error"), { packageName: "rejected" });
    expect(result.ok).toBe(false);
    expect(result.code).toBeUndefined();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("mechanics/undeclared-error");
  });

  test("generates the http-api golden through the prelude's :go emit hooks", () => {
    const result = generateHttpApiGoProgram(program("http-api"), { packageName: "shop" });
    expect(result.diagnostics).toEqual([]);
    const golden = new URL("../../../prototypes/effect-go/conformance/http-api/program.go", import.meta.url);
    if (update) writeFileSync(golden, result.code!);
    expect(result.code).toBe(readFileSync(golden, "utf8"));
    expect(result.code).toContain('httpapi.Endpoint("get", "get-user", "/users/:id", httpapi.Error(UserNotFound{}, 404))');
  });

  test("keeps a function :emit as the TypeScript hook only", () => {
    const command = bootstrapElmPreludes().descriptions.get("command")!;
    expect(emitHook(command, "ts")).toBeDefined();
    expect(emitHook(command, "go")).toBeUndefined();
    expect(() => emitFormExpression(command, new Map(), [], new Map(), { host: "go" })).toThrow("Form command has no :go emitter");
  });

  test("renders Go calls and rejects untyped literals", () => {
    const loc = { start: 0, end: 0, line: 1, col: 1 };
    expect(renderGo({ _tag: "List", loc, items: [{ _tag: "Sym", name: "httpapi.New", loc }, { _tag: "Str", value: "Shop", loc }] })).toBe('httpapi.New("Shop")');
    expect(() => renderGo({ _tag: "Vector", loc, items: [] })).toThrow("Go templates build values with calls, not vectors");
  });
});
