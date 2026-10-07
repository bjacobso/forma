import { describe, expect, it } from "vitest";
import { compileEffectDemo } from "./effectCompiler";
import { ordersSource, ordersUndeclaredSource } from "../effectPageSources";
import { contractSource, undeclaredCapabilitySource } from "../pipelines/sources";

const compile = (source: string) => compileEffectDemo({ id: 1, sourceId: "demo.forma", source, passes: ["parse", "typecheck"], dialect: "effect" });

describe("live Effect workbench compiler", () => {
  it("keeps inferred body requirements when the declaration omits one", () => {
    const result = compile(undeclaredCapabilitySource);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "mechanics/undeclared-requirement", span: expect.any(Object) }));
    expect(result.generatedCode).toBeUndefined();
    expect(result.contracts?.[0]?.declared).toContain("[])");
    expect(result.contracts?.[0]?.inferred).toContain("Console.print");
    const diagnostic = result.diagnostics[0]!;
    expect(undeclaredCapabilitySource.slice(diagnostic.span!.startOffset, diagnostic.span!.endOffset)).toContain("Console.print");
    expect(result.passResults.find(pass => pass.pass === "typecheck")).toMatchObject({ expressionTypes: expect.arrayContaining([expect.objectContaining({ display: expect.stringContaining("Console.print"), span: expect.any(Object) })]) });
    expect(() => structuredClone(result)).not.toThrow();
  });
  it("regenerates from edited source and clears the diagnostic after repair", () => {
    expect(compile(contractSource).diagnostics).toEqual([]);
    expect(compile(ordersUndeclaredSource).generatedCode).toBeUndefined();
    const repaired = compile(ordersSource);
    expect(repaired.diagnostics).toEqual([]);
    expect(repaired.generatedCode).toContain("PaymentDeclined");
    const edited = compile(ordersSource.replace(":times 2", ":times 3"));
    expect(edited.diagnostics).toEqual([]);
    expect(edited.generatedCode).not.toBe(repaired.generatedCode);
  });
  it("reports malformed source as located reader diagnostics", () => {
    const malformed = compile(ordersSource.slice(0, -1));
    expect(malformed.stoppedAt).toBe("parse");
    expect(malformed.diagnostics[0]).toMatchObject({ phase: "parse", span: expect.any(Object) });
    expect(malformed.generatedCode).toBeUndefined();
  });
});
