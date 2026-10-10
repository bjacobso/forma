import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { bootstrapOntologyPreludes, preludeSource } from "../src/Preludes.js";
import { parsePrelude } from "../src/descriptor/meta-fn-decl.js";
import { openSession } from "../src/Session.js";
import { elaborateSources } from "../src/descriptor/elaborate.js";
import { ArtifactValidatorRegistry, makeArtifactValidatorRegistry, checkArtifactDescriptor, payloadContractsFromSources, resolvePayloadContract, validateDeclarations, packageArtifact, emit, emitMany, artifactSummary, canonicalJson, sha256, canonicalIrProjection, type JsonValue, type PackageableDeclaration } from "../src/Artifact.js";

const root = resolve(import.meta.dirname, "../../..");
const fixture = (name: string) => JSON.parse(readFileSync(resolve(root, "conformance/artifacts", name), "utf8"));
const preludes = ["kernel.lisp", "compiler.lisp", "ontology.lisp", "viewspec-protocol.lisp", "ui.lisp", "viewspec.lisp"] as const;
const sessionWithPreludes = (id = "artifacts") => {
  const session = openSession({ id });
  for (const name of preludes) session.rememberSource({ kind: "prelude", id: `preludes/${name}`, text: preludeSource(name) });
  return session;
};

describe("validated artifact boundary", () => {
  test.each([...fixture("payload-cases.json").cases, ...fixture("summary-cases.json").cases] as { sourceId: string; source: string; expected: { ok: boolean; code?: string; form?: string } }[])("shared OCaml payload case $sourceId", ({ sourceId, source, expected }) => {
    const session = sessionWithPreludes();
    session.rememberSource({ id: sourceId, text: source });
    const result = emit({ session, sourceId });
    expect(result.ok, JSON.stringify(result)).toBe(expected.ok);
    if (!expected.ok && !result.ok) {
      expect(result.diagnostics.map(d => d.code)).toContain(expected.code);
      const diagnostic = result.diagnostics.find(d => d.code === expected.code)!;
      expect(diagnostic.span?.sourceId).toBe(sourceId);
      if (expected.form) expect(diagnostic.span?.startOffset).toBe(source.indexOf(expected.form));
    }
  });

  test.each(fixture("descriptor-cases.json").cases as { sourceId: string; source: string; code: string }[])("shared descriptor metacheck $sourceId", ({ sourceId, source, code }) => {
    const contracts = payloadContractsFromSources([source]);
    const descriptors = parsePrelude(source).forms;
    const diagnostics = descriptors.flatMap(form => checkArtifactDescriptor(form, { registry: makeArtifactValidatorRegistry(), contracts }));
    if (!descriptors.length) for (const [name, contract] of contracts) {
      expect(() => resolvePayloadContract(contract, contracts, [name])).toThrow();
      return;
    }
    expect(diagnostics.map(d => d.code)).toContain(code);
  });

  test.each(fixture("http-cases.json").cases as { name: string; declarations: Record<string, JsonValue>[]; expectedCodes: string[] }[])("shared HTTP validator $name", ({ declarations, expectedCodes }) => {
    const session = openSession({ id: "http-validator" });
    session.rememberSource({ id: "http.forma", text: "" });
    const inputs: PackageableDeclaration[] = declarations.map((payload, formIndex) => ({ summary: { kind: String(payload["kind"]), name: String(payload["name"]), resultType: String(payload["kind"]) }, payload, sourceId: "http.forma", formIndex, validators: ["http"], span: { sourceId: "http.forma", startOffset: formIndex, endOffset: formIndex + 1 } }));
    const result = validateDeclarations(session, inputs);
    expect(result.ok).toBe(expectedCodes.length === 0);
    if (!result.ok) expect(result.diagnostics.map(d => d.code)).toEqual(expectedCodes);
  });

  test("HTTP handler typing also runs during artifact emission", () => {
    const source = readFileSync(resolve(root, "conformance/effect-typescript/cases/http-api/program.lisp"), "utf8");
    const session = openSession({ id: "http-emit" });
    for (const name of ["compiler.lisp", "http-api.lisp"] as const) session.rememberSource({ kind: "prelude", id: name, text: preludeSource(name) });
    session.rememberSource({ id: "http.forma", text: source });
    const emitted = emit({ session });
    expect(emitted.ok, JSON.stringify(emitted)).toBe(true);
    session.rememberSource({ id: "http.forma", text: source.replace(":errors [UserNotFound]", "") });
    const invalid = emit({ session });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.diagnostics.map(d => d.code)).toContain("http-api/undeclared-error");
  });

  test("validated snapshots cannot be mutated or forged at the package boundary", () => {
    const session = openSession({ id: "snapshot" });
    session.rememberSource({ id: "source", text: "" });
    const payload = { kind: "Extension", name: "item", metadata: { count: 1 } };
    const declaration: PackageableDeclaration = { summary: { kind: "Extension", name: "item", resultType: "Extension" }, payload, sourceId: "source", formIndex: 0 };
    const validated = validateDeclarations(session, [declaration]);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    payload.metadata.count = 2;
    const options = { engineName: "test", engineVersion: "0", session, declarations: validated.declarations };
    const packaged = packageArtifact(options);
    expect(packaged.ok && packaged.artifact.declarations[0]!.payload).toMatchObject({ metadata: { count: 1 } });
    expect(Object.isFrozen(validated.declarations[0]!.payload)).toBe(true);
    session.rememberSource({ id: "source", text: "changed" });
    expect(packageArtifact(options)).toMatchObject({ ok: false, diagnostics: [{ code: "artifact/stale-declaration" }] });
    // @ts-expect-error Packaging requires a privately constructed declaration.
    expect(packageArtifact({ ...options, declarations: [declaration] }).ok).toBe(false);
  });

  test("emitMany reports source failures independently", () => {
    const session = sessionWithPreludes("mixed-emission");
    session.rememberSource({ id: "valid", text: "(entity Person {:name String})" });
    session.rememberSource({ id: "invalid", text: "(entity Broken 42)" });
    const result = emitMany({ session });
    expect(result).toMatchObject({ ok: false, sourceCount: 2, emittedCount: 1, declarationCount: 1 });
    expect(result.results.find(r => r.sourceId === "valid")?.ok).toBe(true);
    expect(result.results.find(r => r.sourceId === "invalid")?.ok).toBe(false);
  });

  test("explicit type summaries must agree with the packaged summary", () => {
    const session = openSession({ id: "summary-mismatch" });
    session.rememberSource({ id: "source", text: "" });
    const declaration: PackageableDeclaration = {
      summary: { kind: "Plugin", name: "item", resultType: "Plugin" },
      payload: { kind: "Plugin", name: "item", $summary: { kind: "Plugin", name: "item", resultType: "Other" } },
      sourceId: "source", formIndex: 0,
    };
    expect(validateDeclarations(session, [declaration])).toMatchObject({ ok: false, diagnostics: [{ code: "artifact/summary-mismatch" }] });
  });

  test("registered extension validators run in batches and unknown names are diagnosed", () => {
    const session = openSession({ id: "registry" });
    session.rememberSource({ id: "source", text: "" });
    const d: PackageableDeclaration = { summary: { kind: "Plugin", resultType: "Plugin" }, payload: { kind: "Plugin" }, sourceId: "source", formIndex: 0, validators: ["plugin"] };
    const registry = new ArtifactValidatorRegistry();
    let count = 0;
    registry.register({ name: "plugin", validate: inputs => { count = inputs.length; return []; } });
    expect(validateDeclarations(session, [d, d], registry).ok).toBe(true);
    expect(count).toBe(2);
    expect(validateDeclarations(session, [d]).ok).toBe(false);
  });

  test("descriptors select host-registered validators during session emission", () => {
    const source = fixture("payload-cases.json").cases.find((c: { sourceId: string }) => c.sourceId === "emit/unknown-validator").source;
    const session = sessionWithPreludes("custom-validator");
    session.rememberSource({ id: "plugin", text: source });
    const registry = makeArtifactValidatorRegistry();
    let names: (string | undefined)[] = [];
    registry.register({ name: "missing-validator", validate: inputs => { names = inputs.map(i => i.declaration.summary.name); return []; } });
    expect(emit({ session, validatorRegistry: registry }).ok).toBe(true);
    expect(names).toEqual(["unknown-validator"]);
  });

  test("stable canonical SHA-256 covers Unicode, long inputs and key order", () => {
    for (const text of ["", "abc", "é 🧩", "a".repeat(1000)]) expect(sha256(text)).toBe(createHash("sha256").update(text).digest("hex"));
    expect(canonicalJson({ b: 1, a: { d: true, c: [1, null] } })).toBe(canonicalJson({ a: { c: [1, null], d: true }, b: 1 }));
  });

  test("checks the website's canonical IR golden using shared payload/provenance projections", () => {
    const session = openSession({ id: "golden" });
    for (const name of ["kernel.lisp", "compiler.lisp", "ontology.lisp"] as const) session.rememberSource({ kind: "prelude", id: `preludes/${name}`, text: preludeSource(name) });
    const directory = resolve(root, "conformance/fixtures/canonical-ir");
    const sourceIds = ["emit/canonical-schema", "emit/canonical-data"];
    for (const [i, name] of ["schema.lisp", "data.lisp"].entries()) session.rememberSource({ id: sourceIds[i]!, text: readFileSync(resolve(directory, name), "utf8") });
    const emitted = emit({ session, sourceIds });
    expect(emitted.ok, JSON.stringify(emitted)).toBe(true);
    if (!emitted.ok) return;
    const structure = fixture("envelope.json");
    const artifact = emitted.artifacts[0]!;
    expect(artifact).toMatchObject({ name: structure.artifactName, mediaType: structure.mediaType, content: { kind: structure.kind } });
    expect(emitted.backend).toBe(structure.backend);
    for (const collection of structure.requiredCollections) expect(Array.isArray((artifact.content as unknown as Record<string, unknown>)[collection])).toBe(true);
    for (const d of artifact.content.declarationProvenance) {
      for (const key of structure.spanFields) expect(typeof (d.span as unknown as Record<string, unknown>)[key]).toBe("number");
      expect(d.span!.endOffset).toBeGreaterThan(d.span!.startOffset);
    }
    const expected = JSON.parse(readFileSync(resolve(directory, "expected.json"), "utf8")).normalized.artifacts[0].content;
    const projected = canonicalIrProjection(emitted.artifacts[0]!.content);
    expect(projected).toEqual({ declarationCount: expected.declarationCount, declarations: expected.declarations, declarationTypeSummaries: expected.declarationTypeSummaries, declarationProvenance: expected.declarationProvenance, modules: expected.modules.map(({ sourceHash: _, ...m }: { sourceHash: string }) => m), typeSummary: expected.typeSummary });
    const summary = artifactSummary({ session, sourceIds });
    expect(summary).toMatchObject({ ok: true, declarationCount: 5, kindCounts: { Entity: 2, Query: 1, Record: 2 } });
    expect(emitMany({ session, sourceIds })).toMatchObject({ emittedCount: 2, succeededCount: 2, declarationCount: 5 });
  });

  test("module exports, imports, re-exports and hashes match the OCaml fixture", () => {
    const golden = fixture("module-cases.json");
    const session = sessionWithPreludes();
    for (const source of golden.sources) session.rememberSource({ id: source.sourceId, text: source.source });
    const result = emit({ session });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.artifacts[0]!.content.modules.map(({ sourceHash: _, ...m }) => m)).toEqual(golden.modules);
  });

  test("corpus kind and module counts match the shared OCaml oracle", () => {
    const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? entry.name === "shared" ? [] : walk(resolve(directory, entry.name)) : entry.name.endsWith(".md") ? [resolve(directory, entry.name)] : []);
    const groups = new Map<string, { sourceId: string; source: string }[]>();
    for (const file of walk(resolve(root, "examples")).sort()) {
      const sourceId = relative(root, file) + "#lisp-blocks";
      if (sourceId.includes("compiler-debug/invalid-query")) continue;
      const blocks = [...readFileSync(file, "utf8").matchAll(/```(?:lisp|clojure|clj)\n([\s\S]*?)```/g)].map(m => m[1]!).filter(b => !/^\s*\(ontology(?:\s|[\r\n)])/.test(b));
      if (!blocks.length) continue;
      const group = sourceId.split("/")[1]!;
      groups.set(group, [...groups.get(group) ?? [], { sourceId, source: blocks.join("\n") }]);
    }
    const golden = fixture("corpus-golden.json");
    const kindCounts: Record<string, number> = {}, moduleCounts: Record<string, { sourceCount: number; declarationCount: number }> = {};
    let sourceCount = 0, declarationCount = 0;
    for (const [group, sources] of groups) {
      const session = sessionWithPreludes(group);
      session.rememberSource({ id: "preludes/system.lisp", text: preludeSource("system.lisp") });
      for (const s of sources) session.rememberSource({ id: s.sourceId, text: s.source });
      const emitted = emit({ session, sourceIds: sources.map(s => s.sourceId) });
      expect(emitted.ok, `${group}: ${JSON.stringify(emitted)}`).toBe(true);
      if (!emitted.ok) continue;
      const declarations = emitted.artifacts[0]!.content.declarations;
      moduleCounts[group] = { sourceCount: sources.length, declarationCount: declarations.length };
      sourceCount += sources.length; declarationCount += declarations.length;
      for (const d of declarations) kindCounts[d.summary.kind] = (kindCounts[d.summary.kind] ?? 0) + 1;
    }
    expect({ sourceCount, declarationCount, kindCounts, moduleCounts }).toEqual({ sourceCount: golden.sourceCount, declarationCount: golden.declarationCount, kindCounts: golden.kindCounts, moduleCounts: golden.moduleCounts });
  }, 120_000);
});
