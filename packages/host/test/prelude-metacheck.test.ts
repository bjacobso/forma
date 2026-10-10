import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TsLanguageHost } from "../src/ts-host.js";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const descriptorCases: { name: string; source: string; code: string; text: string; ontology?: boolean }[] = JSON.parse(read("conformance/descriptor-metacheck/cases.json"));
const artifactCases: { label: string; source: string; sourceId: string; code: string }[] = JSON.parse(read("conformance/artifacts/descriptor-cases.json")).cases;

describe("prelude metacheck", () => {
  for (const fixture of [...descriptorCases.filter(f => !f.ontology).map(f => ({ ...f, sourceId: f.name })),
    ...artifactCases.map(f => ({ ...f, name: f.label, text: undefined })),
    { name: "unknown descriptor field", sourceId: "unknown-field", code: "descriptor/unknown-slot", text: undefined,
      source: "(__form-descriptor item (:slots (slot value expr (:type-from missing))))" },
    { name: "hook kind mismatch", sourceId: "wrong-kind", code: "descriptor/reference", text: undefined,
      source: "(__form-hook item/validate (:kind validate) (:body [])) (__form-descriptor item (:construct-fn item/validate))" },
  ]) {
    it(`rolls back ${fixture.name} with author locations`, async () => {
      const host = new TsLanguageHost();
      const { sessionId } = await host.openSession();
      const sourceId = fixture.sourceId;
      await host.loadSource({ sessionId, sourceId, kind: "prelude", source: "(define answer 42)" });
      const before = await host.sessionInfo({ sessionId });
      const result = await host.loadSource({ sessionId, sourceId, kind: "prelude", source: fixture.source + "\n(define leaked 1)", timings: true });
      const diagnostic = result.diagnostics.find(d => d.code === fixture.code);
      expect(diagnostic, JSON.stringify(result)).toMatchObject({ severity: "error", span: { sourceId } });
      expect(diagnostic!.span!.endOffset).toBeGreaterThan(diagnostic!.span!.startOffset);
      if (fixture.text) expect(fixture.source.slice(diagnostic!.span!.startOffset, diagnostic!.span!.endOffset)).toBe(fixture.text);
      expect(new Set(result.diagnostics.map(d => JSON.stringify(d))).size).toBe(result.diagnostics.length);
      expect(result.timings).not.toHaveProperty("storeMs");
      if (fixture.code.startsWith("artifact/") || fixture.sourceId === "unknown-field" || fixture.sourceId === "wrong-kind") expect(result.timings!.metacheckMs).toBeGreaterThan(0);
      expect(await host.sessionInfo({ sessionId })).toEqual(before);
      expect(await host.replSubmit({ sessionId, source: "answer" })).toMatchObject({ status: "completed", result: { value: { value: 42 }, type: { display: "Int" } } });
      expect(await host.evaluateInSession({ sessionId, source: "leaked" })).toMatchObject({ status: "failed" });
      // Failed descriptor registration must not leak into later analyses.
      expect((await host.loadSource({ sessionId, sourceId, kind: "prelude", source: "(define answer 43)" })).diagnostics).toEqual([]);
    });
  }

  it("resolves hooks in the evaluated configuration environment", async () => {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    await host.configureSession({ sessionId, variables: [{ name: "external-hook", value: { kind: "bool", value: true } }] });
    const result = await host.loadSource({ sessionId, sourceId: "external", kind: "prelude", source: "(__form-descriptor external (:infer-fn external-hook))", timings: true });
    expect(result.diagnostics).toEqual([]);
    expect(result.timings!.metacheckMs).toBeGreaterThan(0);
  });

  it("checks a referenced payload contract across prelude layers", async () => {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    const load = (sourceId: string, source: string) => host.loadSource({ sessionId, sourceId, source, kind: "prelude" });
    expect((await load("contract", "(__payload-contract ItemPayload (:required-fields [id]))")).diagnostics).toEqual([]);
    const descriptor = `(__form-hook item/construct (:kind construct) (:body nil))
(__form-descriptor item (:construct-fn item/construct) (:result-type (constant Item))
  (:extensions (:artifact (:validators [payload-contract]) (:payload (:contract ItemPayload)))))`;
    expect((await load("descriptor", descriptor)).diagnostics).toEqual([]);
    const before = await host.sessionInfo({ sessionId });
    const failed = await load("contract", "(__payload-contract ItemPayload (:contract Missing))");
    expect(failed.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "artifact/descriptor-payload", span: expect.objectContaining({ sourceId: "contract" }) })]));
    expect(await host.sessionInfo({ sessionId })).toEqual(before);
  });

  it("loads every bundled prelude in its domain stack and the thesis prelude", async () => {
    const names = readdirSync(resolve(root, "preludes")).filter(n => n.endsWith(".lisp"));
    const core = ["kernel.lisp", "compiler.lisp", "ontology.lisp", "viewspec-protocol.lisp", "ui.lisp", "viewspec.lisp"];
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    for (const name of core) {
      const result = await host.loadSource({ sessionId, sourceId: `preludes/${name}`, source: read(`preludes/${name}`), kind: "prelude", timings: true });
      expect(result.diagnostics, name).toEqual([]);
      expect(result.timings!.metacheckMs).toBeGreaterThan(0);
    }
    // Protocol modules each export `protocol`; they are independent stacks.
    for (const name of names.filter(n => !core.includes(n) && n !== "http-api.lisp")) {
      const { sessionId: protocolSession } = await host.openSession();
      for (const dependency of ["kernel.lisp", "compiler.lisp", "ontology.lisp"]) expect((await host.loadSource({ sessionId: protocolSession, sourceId: dependency, source: read(`preludes/${dependency}`), kind: "prelude" })).diagnostics).toEqual([]);
      expect((await host.loadSource({ sessionId: protocolSession, sourceId: name, source: read(`preludes/${name}`), kind: "prelude" })).diagnostics, name).toEqual([]);
    }
    const { sessionId: httpSession } = await host.openSession();
    for (const name of ["compiler.lisp", "http-api.lisp"]) expect((await host.loadSource({ sessionId: httpSession, sourceId: name, source: read(`preludes/${name}`), kind: "prelude" })).diagnostics, name).toEqual([]);
    const { sessionId: thesisSession } = await host.openSession();
    expect((await host.loadSource({ sessionId: thesisSession, sourceId: "thesis", source: read("conformance/thesis-gate/prelude.lisp"), kind: "prelude" })).diagnostics).toEqual([]);
    expect((await host.typecheck({ sessionId: thesisSession, source: read("conformance/thesis-gate/typed.lisp") })).diagnostics).toEqual([]);
  }, 30_000);
});
