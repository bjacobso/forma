import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { expand, parse, typecheck } from "@formalang/ts/engine";
import { getPipeline } from ".";
import { schemaDeclarations } from "./canonicalIr";
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
    const operationStart = source.indexOf("(define-operation log");

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
