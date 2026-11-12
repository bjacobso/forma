import { expect, test } from "vitest";
import { DiagnosticCatalog, DiagnosticCatalogError } from "../src/Diagnostic.js";
import { ArtifactValidatorRegistry, ArtifactValidatorRegistrationError } from "../src/Artifact.js";

function caught(run: () => void): unknown {
  try { run(); } catch (error) { return error; }
  expect.fail("Expected invalid host input to fail");
}

test("catalog registration and assertions expose stable codes and field paths", () => {
  const entry = { code: "example/test", summary: "Example", explanation: "Example explanation", stability: "stable" as const };
  const catalog = new DiagnosticCatalog([entry]);
  for (const [run, path] of [
    [() => catalog.register(entry), "entry.code"],
    [() => catalog.register({ ...entry, code: "" }), "entry.code"],
    [() => catalog.register({ ...entry, code: "other/test", summary: " " }), "entry.summary"],
    [() => catalog.register({ ...entry, code: "other/test", explanation: " " }), "entry.explanation"],
    [() => catalog.assertKnown({code: "unknown/code"}), "diagnostic.code"],
  ] as const) {
    const error = caught(run);
    expect(error).toBeInstanceOf(DiagnosticCatalogError);
    expect(error).toMatchObject({ name: "DiagnosticCatalogError", code: "diagnostic/invalid-catalog", path });
    expect(error).not.toHaveProperty("span");
  }
  expect(catalog.list()).toEqual([entry]);
});

test("duplicate validator registration is catchable without source coordinates", () => {
  const registry = new ArtifactValidatorRegistry();
  const validator = {name: "example", validate: () => []};
  const payload = {kind: "Example", validate: () => []};
  registry.register(validator).registerPayload(payload);
  for (const [run, path] of [
    [() => registry.register(validator), "validator.name"],
    [() => registry.registerPayload(payload), "validator.kind"],
  ] as const) {
    const error = caught(run);
    expect(error).toBeInstanceOf(ArtifactValidatorRegistrationError);
    expect(error).toMatchObject({ name: "ArtifactValidatorRegistrationError", code: "artifact/duplicate-validator", path });
    expect(error).not.toHaveProperty("span");
  }
});
