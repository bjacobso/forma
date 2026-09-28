import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { Mechanics, Reader } from "../src/index.js";
import type { JsonValue } from "../src/artifact/artifact.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = resolve(packageDir, "../../conformance/operational-effects");
const source = readFileSync(resolve(fixtureDir, "program.lisp"), "utf8");

function generatedCode(): string {
  const forms = Effect.runSync(Reader.parseManyToSExpr(source));
  const declarations = Mechanics.mechanicsPackageableDeclarations(forms, "effects/conformance");
  if (!declarations.ok) throw new Error(JSON.stringify(declarations.diagnostics));
  return Mechanics.generateMechanicsEffectTypeScriptModule(declarations.declarations).code;
}

function checkGeneratedTypes(code: string): void {
  const configPath = resolve(packageDir, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageDir);
  const virtualPath = resolve(packageDir, "test/__generated_effect__.ts");
  const host = ts.createCompilerHost(parsed.options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    fileName === virtualPath
      ? ts.createSourceFile(fileName, code, languageVersion, true)
      : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([virtualPath], { ...parsed.options, noEmit: true }, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
}

describe("Effect TypeScript projection", () => {
  test("compiles and runs the shared operational effect fixture", async () => {
    const code = generatedCode();
    checkGeneratedTypes(code);
    expect(code).not.toContain("undefined as never");

    const js = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports: Record<string, unknown> = {};
    const require = createRequire(import.meta.url);
    new Function("require", "exports", js)(require, exports);
    const alwaysFail = exports["always_fail"] as (message: string) => Effect.Effect<never, { _tag: "ConsoleUnavailable"; message: string }>;
    const recover = exports["recover"] as (message: string) => Effect.Effect<unknown>;
    const log = exports["log"] as (message: string) => Effect.Effect<unknown, unknown, unknown>;
    const Console = exports["Console"] as never;
    expect(await Effect.runPromise(Effect.catchTag(alwaysFail("offline"), "ConsoleUnavailable", (error) => Effect.succeed(error.message)))).toBe("offline");
    expect(await Effect.runPromise(recover("offline"))).toBeNull();
    const messages: string[] = [];
    expect(await Effect.runPromise(Effect.provideService(log("hello"), Console, {
      print: (message: string) => Effect.sync(() => { messages.push(message); return null; }),
    }))).toBeNull();
    expect(messages).toEqual(["hello"]);
  });

  test("lowers nested sequencing and branches from the shared body IR", async () => {
    const forms = Effect.runSync(Reader.parseManyToSExpr(source));
    const declarations = Mechanics.mechanicsPackageableDeclarations(forms, "effects/conformance");
    if (!declarations.ok) throw new Error(JSON.stringify(declarations.diagnostics));
    const effect = declarations.declarations.find((declaration) => declaration.summary.name === "recover");
    if (!effect) throw new Error("missing recover operation");
    const literal = (value: JsonValue): JsonValue => ({ kind: "Literal", value });
    const succeed = (value: JsonValue): JsonValue => ({ kind: "Succeed", value });
    const payload: JsonValue = {
      kind: "EffectDef",
      name: "choose",
      params: [{ name: "enabled", type: { kind: "Primitive", name: "Bool" } }],
      effect: { kind: "Effect", success: { kind: "Union", variants: [
        { kind: "Primitive", name: "String" },
        { kind: "Literal", values: [null] },
      ] }, errors: [], requirements: [] },
      body: {
        kind: "Do",
        bindings: [
          { name: "_", value: succeed(literal("first")) },
          { name: "_", value: succeed(literal("second")) },
        ],
        forms: [succeed(literal("ignored")), {
          kind: "Let",
          bindings: [{ name: "answer", value: {
            kind: "If",
            condition: { kind: "Var", name: "enabled" },
            then: { kind: "Cond", clauses: [
              { condition: literal(""), body: succeed(literal("empty string is truthy")) },
              { condition: literal(true), body: succeed(literal("wrong")) },
            ] },
            else: succeed(literal("no")),
          } }],
          body: succeed({ kind: "Var", name: "answer" }),
        }],
      },
    };
    const code = Mechanics.generateMechanicsEffectTypeScriptModule([
      { ...effect, payload },
    ]).code;
    checkGeneratedTypes(code);
    const js = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports: Record<string, unknown> = {};
    new Function("require", "exports", js)(createRequire(import.meta.url), exports);
    const choose = exports["choose"] as (enabled: boolean) => Effect.Effect<string>;
    expect(await Effect.runPromise(choose(true))).toBe("empty string is truthy");
    expect(await Effect.runPromise(choose(false))).toBe("no");
  });

  test("rejects a body node without a translation", () => {
    const forms = Effect.runSync(Reader.parseManyToSExpr(source));
    const declarations = Mechanics.mechanicsPackageableDeclarations(forms, "effects/conformance");
    if (!declarations.ok) throw new Error(JSON.stringify(declarations.diagnostics));
    const effect = declarations.declarations.find((declaration) => declaration.summary.name === "recover");
    if (!effect) throw new Error("missing recover operation");
    expect(() => Mechanics.generateMechanicsEffectTypeScriptModule([
      { ...effect, payload: { ...effect.payload as Record<string, unknown>, body: { kind: "Match" } } },
    ])).toThrow("unsupported effect body kind Match");
  });
});
