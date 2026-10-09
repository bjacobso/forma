import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { expand, parse, typecheck } from "@formalang/ts/engine";
import { getPipeline } from ".";
import { schemaDeclarations } from "./canonicalIr";
import { marketDeskSource, marketDeskMissingModelSource } from "./marketDesk";
import { compileEffectDemo } from "../engine/effectCompiler";
import {
  contractSource,
  contractType,
  defineEntityDescriptor,
  entitySchemaSource,
  undeclaredCapabilitySource,
  undeclaredFailureSource,
} from "./sources";

const repoFile = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../../../..", path), "utf8");

describe("market desk example", () => {
  const compile = (source: string) => compileEffectDemo({
    id: 1, sourceId: "market-desk.forma", source, passes: ["parse", "typecheck"], dialect: "effect",
  });

  test("uses the executable conformance source", () => {
    expect(marketDeskSource).toBe(repoFile("conformance/effect-typescript/cases/market-desk/program.lisp"));
    expect(getPipeline("market-desk").source).toBe(marketDeskSource);
  });

  test("checks layer requirements and regenerates after an edit", () => {
    const valid = compile(marketDeskSource);
    expect(valid.diagnostics).toEqual([]);
    expect(valid.generatedCode).toBe(getPipeline("market-desk").preview?.output);
    const broken = compile(marketDeskMissingModelSource);
    expect(broken.generatedCode).toBeUndefined();
    expect(broken.diagnostics).toContainEqual(expect.objectContaining({
      code: "mechanics/undeclared-requirement", span: expect.any(Object),
    }));
    const edited = compile(marketDeskSource.replace('get payload :question)', 'str "Market: " (get payload :question))'));
    expect(edited.diagnostics).toEqual([]);
    expect(edited.generatedCode).not.toBe(valid.generatedCode);
  });
});

describe("entities pipeline", () => {
  test("uses the canonical IR conformance fixture source verbatim", () => {
    expect(entitySchemaSource).toBe(repoFile("conformance/fixtures/canonical-ir/schema.lisp"));
  });

  test("shows a verbatim descriptor from the ontology prelude", () => {
    expect(repoFile("preludes/ontology.lisp")).toContain(defineEntityDescriptor);
  });

  test("targets the declarations emitted for schema.lisp", () => {
    expect(schemaDeclarations().map(({ kind, name }) => `${kind} ${String(name)}`)).toEqual([
      "Entity Department",
      "Entity Employee",
      "Query employee-directory",
    ]);
    expect(getPipeline("entities").preview?.output).toContain('"from": "Employee"');
  });

  test("reads and expands without rewriting descriptor forms", () => {
    const parsed = parse({ sourceId: "entities", source: entitySchemaSource });
    const expanded = expand({ sourceId: "entities", source: entitySchemaSource });

    expect(parsed.diagnostics).toEqual([]);
    expect(expanded.diagnostics).toEqual([]);
    expect(expanded.ast).toEqual(parsed.ast);
  });
});

describe("contracts pipeline", () => {
  const check = (source: string) =>
    typecheck({ sourceId: "contracts", source, result: "per-expression" });

  test("infers the success value, failures, and requirements", () => {
    const result = check(contractSource);

    expect(result.diagnostics).toEqual([]);
    expect(result.display).toBe(contractType);
  });

  test.each([
    ["capability", undeclaredCapabilitySource],
    ["failure", undeclaredFailureSource],
  ])("rejects an undeclared %s at the operation", (_, source) => {
    const [diagnostic, ...rest] = check(source).diagnostics;
    const operationStart = source.indexOf("(do!");

    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({ severity: "error", phase: "typecheck" });
    expect(diagnostic?.span?.startOffset).toBe(operationStart);
  });

  test("offers every contract source as a variant", () => {
    expect(getPipeline("contracts").variants?.map((variant) => variant.source)).toEqual([
      contractSource,
      undeclaredCapabilitySource,
      undeclaredFailureSource,
    ]);
  });
});
