import { expect, test } from "vitest";
import { preludeSource } from "@formalang/ts/preludes";
import { TsLanguageHost } from "../src/ts-host.js";

test("session emit, emitMany, backend discovery and summaries", async () => {
  const host = new TsLanguageHost();
  const { sessionId } = await host.openSession();
  for (const name of ["compiler.lisp", "ontology.lisp"] as const) await host.loadSource({ sessionId, sourceId: name, source: preludeSource(name), kind: "prelude" });
  await host.loadSource({ sessionId, sourceId: "people.forma", source: "(entity Person {:name String})" });
  const emitted = await host.emit({ sessionId });
  expect(emitted).toMatchObject({ ok: true, backend: "canonical-ir", artifactCount: 1, artifacts: [{ name: "ir.json", mediaType: "application/vnd.forma.ir+json", content: { irVersion: "language-ts-artifact/v1", declarationCount: 1, hashAlgorithm: "sha256" } }] });
  expect(await host.emitMany({ sessionId })).toMatchObject({ ok: true, sourceCount: 1, succeededCount: 1 });
  expect(await host.artifactSummary({ sessionId })).toMatchObject({ ok: true, declarationCount: 1, kindCounts: { Entity: 1 } });
  expect(await host.emitBackends()).toMatchObject({ defaultBackend: "canonical-ir" });
  expect(await host.emit({ sessionId, backend: "missing" })).toMatchObject({ ok: false, diagnostics: [{ code: "abi/unsupported-backend" }] });
  expect(await host.emit({ sessionId, sourceId: "missing" })).toMatchObject({ ok: false, diagnostics: [{ code: "abi/unknown-source" }] });
  expect((await host.version()).capabilities).toEqual(expect.arrayContaining(["emit", "emitMany", "emitBackends", "artifactSummary"]));
});
