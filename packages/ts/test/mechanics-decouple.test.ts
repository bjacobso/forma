import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import type { PackageableDeclaration } from "../src/artifact/artifact.js";
import { Mechanics } from "../src/index.js";
import {
  createCheckedEffectInfo,
  toCheckedEffectProgram,
  type CheckedEffectProgram,
} from "../src/mechanics/checked-contract.js";
import { generateCheckedEffectSchemaModule } from "../src/mechanics/effect-schema.js";
import {
  generateCheckedEffectTypeScriptModule,
  generateMechanicsEffectTypeScriptModule as generateEffectTsDirect,
} from "../src/mechanics/effect-typescript.js";
import { effectOf, setOf, tString, tUnit } from "../src/mechanics/types.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mechanicsDir = resolve(packageDir, "src/mechanics");

function checkGeneratedTypes(code: string): void {
  const configPath = resolve(packageDir, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageDir);
  const virtualPath = resolve(packageDir, "test/__generated_decouple__.ts");
  const host = ts.createCompilerHost(parsed.options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    fileName === virtualPath
      ? ts.createSourceFile(fileName, code, languageVersion, true)
      : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([virtualPath], { ...parsed.options, noEmit: true }, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
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

describe("mechanics solver-neutral decoupling (U5)", () => {
  test("checked-contract, artifact, effect-typescript, effect-schema, and schema-build never import mechanics/check or mechanics/builtins", () => {
    const decoupledFiles = [
      "checked-contract.ts",
      "artifact.ts",
      "effect-typescript.ts",
      "effect-schema.ts",
      "schema-build.ts",
    ];
    for (const file of decoupledFiles) {
      const source = readFileSync(resolve(mechanicsDir, file), "utf8");
      const specs = importSpecifiers(source);
      const forbidden = specs.filter(
        (spec) =>
          /(?:^|\/)check(?:\.js|\.ts)?$/.test(spec) ||
          /(?:^|\/)builtins(?:\.js|\.ts)?$/.test(spec),
      );
      expect(forbidden, `${file} must not import mechanics/check or mechanics/builtins`).toEqual([]);
    }
  });

  test("elaborate.ts does not import mechanics/check.ts directly", () => {
    const source = readFileSync(resolve(mechanicsDir, "elaborate.ts"), "utf8");
    const specs = importSpecifiers(source);
    const forbidden = specs.filter((spec) => /(?:^|\/)check(?:\.js|\.ts)?$/.test(spec));
    expect(forbidden).toEqual([]);
  });

  test("direct effect-typescript.ts call requires CheckedEffectInfo instead of silently running check.ts", () => {
    expect(() => generateEffectTsDirect([])).toThrow("checked metadata is required");
  });

  test("hand-built solver-neutral CheckedEffectProgram round-trips through effect-typescript and effect-schema without running check.ts", () => {
    const declarations: PackageableDeclaration[] = [
      {
        summary: { kind: "SchemaDef", name: "UserId", resultType: "SchemaDef" },
        payload: {
          kind: "SchemaDef",
          name: "UserId",
          schema: { kind: "Brand", name: "UserId", schema: { kind: "Primitive", name: "String" } },
        },
        payloadContract: "mechanics/schema-def/v0",
        validators: ["payload-contract"],
        sourceId: "synthetic.lisp",
        formIndex: 0,
      },
      {
        summary: { kind: "ErrorDef", name: "NotFound", resultType: "ErrorDef" },
        payload: {
          kind: "ErrorDef",
          name: "NotFound",
          schema: {
            kind: "Struct",
            fields: [{ name: "id", schema: { kind: "Ref", name: "UserId" } }],
          },
        },
        payloadContract: "mechanics/error-def/v0",
        validators: ["payload-contract"],
        sourceId: "synthetic.lisp",
        formIndex: 1,
      },
      {
        summary: { kind: "ServiceDef", name: "Users", resultType: "ServiceDef" },
        payload: {
          kind: "ServiceDef",
          name: "Users",
          methods: [
            {
              name: "find",
              params: [{ name: "id", type: { kind: "Ref", name: "UserId" } }],
              effect: {
                kind: "Effect",
                success: { kind: "Primitive", name: "String" },
                errors: ["NotFound"],
                requirements: [],
              },
            },
          ],
        },
        payloadContract: "mechanics/service-def/v0",
        validators: ["payload-contract"],
        sourceId: "synthetic.lisp",
        formIndex: 2,
      },
      {
        summary: { kind: "EffectDef", name: "lookup-user", resultType: "EffectDef" },
        payload: {
          kind: "EffectDef",
          name: "lookup-user",
          params: [{ name: "id", type: { kind: "Ref", name: "UserId" } }],
          effect: {
            kind: "Effect",
            success: { kind: "Primitive", name: "String" },
            errors: ["NotFound"],
            requirements: ["Users"],
          },
          authority: { capabilities: ["Users"] },
          body: {
            kind: "ServiceCall",
            service: "Users",
            method: "find",
            args: [{ kind: "Var", name: "id" }],
          },
        },
        payloadContract: "mechanics/effect-def/v0",
        validators: ["payload-contract"],
        sourceId: "synthetic.lisp",
        formIndex: 3,
      },
    ];

    const userIdType = { kind: "brand" as const, name: "UserId", base: tString };
    const findEffect = effectOf(tString, setOf(["NotFound"]), setOf([]));
    const lookupEffect = effectOf(tString, setOf(["NotFound"]), setOf(["Users"]));

    const info = createCheckedEffectInfo({
      env: {
        schemas: new Map([["UserId", userIdType]]),
        errors: new Set(["NotFound"]),
        classes: new Map(),
      },
      errorFields: new Map([["NotFound", [{ name: "id", type: { kind: "named", name: "UserId" }, optional: false }]]]),
      services: new Map([
        [
          "Users",
          new Map([
            [
              "find",
              {
                name: "find",
                params: [{ name: "id", type: { kind: "named", name: "UserId" } }],
                effect: findEffect,
              },
            ],
          ]),
        ],
      ]),
      operations: new Map([
        [
          "lookup-user",
          {
            params: [{ name: "id", type: { kind: "named", name: "UserId" } }],
            result: lookupEffect,
          },
        ],
      ]),
      functions: new Map([
        [
          "noop",
          {
            params: [],
            result: tUnit,
          },
        ],
      ]),
    });

    const program: CheckedEffectProgram = {
      ok: true,
      declarations,
      diagnostics: [],
      info,
    };

    const tsModule = generateCheckedEffectTypeScriptModule(program);
    expect(tsModule.operationNames).toEqual(["lookup-user"]);
    expect(tsModule.code).toContain('export const UserId = Schema.String.pipe(Schema.brand("UserId"));');
    expect(tsModule.code).toContain('export class NotFound extends Schema.TaggedError<NotFound>()("NotFound"');
    expect(tsModule.code).toContain("export class Users extends Context.Service<");
    expect(tsModule.code).toContain("export const lookupUser = (id: UserId): Effect.Effect<string, NotFound, Users> =>");
    checkGeneratedTypes(tsModule.code);

    const schemaModule = generateCheckedEffectSchemaModule(program);
    expect(schemaModule.schemaNames).toEqual(["UserIdSchema"]);
    expect(schemaModule.code).toContain('export const UserIdSchema = Schema.String.pipe(Schema.brand("UserId"));');
  });

  test("toCheckedEffectProgram adapter produces byte-identical output to elaborateEffectProgram / generateEffectProgram", () => {
    const source = `
      (type User {:id String :name String})
      (error Missing {:id String})
      (service Repo
        (: load (-> String (Effect User [Missing] []))))
      (: greet (-> String (Effect String [Missing] [Repo])))
      (define greet (fn [id]
        (do! [user (Repo.load id)]
          (succeed (str "Hello, " (get user :name))))))
    `;
    const elaborated = Mechanics.generateEffectProgram(source, { sourceId: "adapter.lisp" });
    expect(elaborated.ok).toBe(true);
    expect(elaborated.diagnostics).toEqual([]);
    expect(elaborated.program).toBeDefined();

    const checked = Mechanics.checkMechanicsProgram(elaborated.declarations);
    const adapted = toCheckedEffectProgram(checked);
    expect(generateCheckedEffectTypeScriptModule(adapted).code).toBe(elaborated.code);
    expect(generateCheckedEffectSchemaModule(adapted).code).toBe(
      Mechanics.generateMechanicsEffectSchemaModule(elaborated.declarations).code,
    );
  });
});
