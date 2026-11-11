import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Schema, type JsonSchema } from "effect";
import { describe, expect, it } from "vitest";
import { HOST_ABI_VERSION, HOST_CAPABILITIES, HOST_OPERATIONS, hostAbiSchema, JsonAbi, JsonRequest } from "../src/json-abi.js";
import { TsLanguageHost } from "../src/ts-host.js";
import type { SyntaxIdentity } from "../src/types.js";

const send = (abi: JsonAbi, input: unknown) => abi.handleJson(JSON.stringify(input));

// Compare the actual schema trees after resolving local references. Remember
// pairs so recursive value/type schemas are compared without infinite expansion.
function expectEquivalent(left: JsonSchema.Document<"draft-2020-12">, right: JsonSchema.Document<"draft-2020-12">) {
  const seen = new WeakMap<object, WeakSet<object>>();
  const dereference = (value: unknown, document: typeof left): unknown => {
    if (value && typeof value === "object" && "$ref" in value) {
      expect(Object.keys(value)).toEqual(["$ref"]);
      const ref = String(value.$ref);
      expect(ref.startsWith("#/$defs/")).toBe(true);
      const definition = document.definitions[ref.slice("#/$defs/".length)];
      expect(definition, ref).toBeDefined();
      return definition;
    }
    return value;
  };
  const compare = (a: unknown, b: unknown): void => {
    a = dereference(a, left);
    b = dereference(b, right);
    if (!a || !b || typeof a !== "object" || typeof b !== "object") {
      expect(a).toEqual(b);
      return;
    }
    if (seen.get(a)?.has(b)) return;
    if (!seen.has(a)) seen.set(a, new WeakSet());
    seen.get(a)!.add(b);
    expect(Array.isArray(a)).toBe(Array.isArray(b));
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    for (const key of Object.keys(a)) compare((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]);
  };
  compare(left.schema, right.schema);
}

describe("shared host contract", () => {
  it("snapshots the complete request/response schema", () => {
    const path = resolve(import.meta.dirname, "../../../conformance/host-abi/schema.json");
    const actual = JSON.stringify(hostAbiSchema(), null, 2) + "\n";
    if (process.env["FORMA_UPDATE_GOLDEN"] === "1") writeFileSync(path, actual);
    expect(actual).toBe(readFileSync(path, "utf8"));
    expect(HOST_CAPABILITIES).toEqual(HOST_OPERATIONS.map(operation => operation.name));
    expect(new Set(HOST_CAPABILITIES).size).toBe(HOST_CAPABILITIES.length);
    const schema = hostAbiSchema();
    expect(JSON.stringify(schema.requests)).toContain('"$ref":"#/$defs/TypeScheme"');
    expect(JSON.stringify(schema.responses.observe!.schema)).toContain('"$ref":"#/$defs/Diagnostic"');
    expect(Object.keys(schema.responses)).toEqual(HOST_CAPABILITIES);
    expect(JSON.stringify(schema.requests)).toContain('"pattern"');
    expect(HOST_OPERATIONS.find(op => op.name === "loadSource")!.sessionScope).toBe("required");
    expect(HOST_OPERATIONS.find(op => op.name === "symbolIndex")!.sessionScope).toBe("optional");
    expect(HOST_OPERATIONS.find(op => op.name === "version")!.sessionScope).toBe("none");
  });

  const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../conformance/host-abi/cases.json"), "utf8"));
  it("preserves the inline schema semantics, including recursive definitions", () => {
    const inline = { referencePolicy: () => undefined };
    const schema = hostAbiSchema();
    expectEquivalent(schema.requests, Schema.toJsonSchemaDocument(JsonRequest, { ...inline, onExcessProperty: "error" }));
    for (const operation of HOST_OPERATIONS) {
      expectEquivalent(schema.responses[operation.name]!, Schema.toJsonSchemaDocument(operation.response, inline));
    }
  });
  for (const fixture of fixtures.cases) {
    it(`conformance: ${fixture.id}`, async () => {
      const result = await send(new JsonAbi(), fixture.request);
      expect(result).toMatchObject(fixture.expected);
      const operation = HOST_OPERATIONS.find(operation => operation.name === fixture.request.op)!;
      expect(() => Schema.decodeUnknownSync(Schema.toCodecJson(operation.response))(result)).not.toThrow();
    });
  }

  it("makes every advertised capability callable over JSON", async () => {
    for (const op of (await new TsLanguageHost().version()).capabilities) {
      const abi = new JsonAbi();
      const { sessionId } = (await send(abi, { op: "openSession" })).value as { sessionId: string };
      await send(abi, { op: "loadSource", sessionId, sourceId: "main.lisp", source: "(export answer) (define answer 42)" });
      const { identity } = await abi.host.identifySyntax({ source: "42" });
      const fields: Record<string, object> = {
        version: {}, openSession: {}, emitBackends: {}, editScriptSchema: {},
        configureSession: { sessionId }, closeSession: { sessionId }, resetSession: { sessionId }, sessionInfo: { sessionId },
        loadSource: { sessionId, sourceId: "other.lisp", source: "42" },
        loadSourceBundle: { sessionId, sources: [{ sourceId: "other.lisp", source: "42" }] },
        evaluateInSession: { sessionId, source: "42" }, replSubmit: { sessionId, source: "42" },
        emit: { sessionId, sourceId: "main.lisp" }, emitMany: { sessionId, sourceId: "main.lisp" },
        artifactSummary: { sessionId, sourceId: "main.lisp" },
        moduleGraph: { sessionId, sourceId: "main.lisp" }, linkEffectModules: { sessionId, sourceId: "main.lisp" },
        describeNodes: { source: "42", identity, ids: [identity.nodes[0]!.id] },
        applyEditScript: { source: "42", script: { version: 1, ops: [] } },
        outlineToSource: { items: [] }, releaseValue: { sessionId, valueRefs: [] },
        projectValue: { value: { kind: "int", value: 42 }, projections: ["printed"] },
      };
      if (["callValue", "resumeHostCall", "abortEvaluation"].includes(op)) {
        if (op === "callValue") {
          const state = (await send(abi, { op: "evaluateInSession", sessionId, source: "(fn [x] x)", retainValues: "functions" })).value as { result: { value: { valueRef: string } } };
          fields[op] = { sessionId, valueRef: state.result.value.valueRef, args: [{ kind: "int", value: 42 }] };
        } else {
          await send(abi, { op: "configureSession", sessionId, hostBuiltins: [{ name: "ping", arity: 0 }] });
          const state = (await send(abi, { op: "evaluateInSession", sessionId, source: "(ping)" })).value as { evaluationId: string; call: { callId: string; evaluationId: string } };
          fields[op] = { sessionId, evaluationId: state.call.evaluationId, ...(op === "resumeHostCall" ? { callId: state.call.callId, result: { ok: true, value: { kind: "int", value: 42 } } } : {}) };
        }
      }
      const input = { op, abiVersion: HOST_ABI_VERSION, ...(fields[op] ?? { source: "42" }) };
      expect(() => Schema.decodeUnknownSync(JsonRequest)(input, { onExcessProperty: "error" }), op).not.toThrow();
      const result = await send(abi, input);
      expect(result, `${op}: ${JSON.stringify(result)}`).toMatchObject({ ok: true });
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    }
  });

  it("observes with caller identities and the programmatic evaluation options", async () => {
    const abi = new JsonAbi();
    const source = "42";
    const { identity } = await abi.host.identifySyntax({ source, idPrefix: "author" });
    const input = { source, observe: { identity, maxRecords: 1 }, typePolicy: { defaultBuiltinScheme: "none" as const }, resultProjection: ["printed" as const] };
    const expected = await abi.host.observe(input);
    expect(await send(abi, { op: "observe", ...input })).toMatchObject({ ok: true, value: expected });
  });

  it("describes and renames a binding using JSON node ids", async () => {
    const abi = new JsonAbi();
    const source = "(define answer 42)\nanswer";
    const identified = await send(abi, { op: "identifySyntax", source, sourceId: "rename.lisp" });
    expect(identified).toMatchObject({ ok: true, diagnostics: [] });
    const { identity } = identified.value as { identity: SyntaxIdentity };
    const binding = identity.nodes.find(node => source.slice(node.span.start, node.span.end) === "answer")!;
    expect(await send(abi, { op: "describeNodes", source, identity, ids: [binding.id] })).toMatchObject({ ok: true, value: { nodes: [{ id: binding.id, text: "answer" }] } });
    const edited = await send(abi, { op: "applyEditScript", source, sourceId: "rename.lisp", identity, script: { version: 1, ops: [{ op: "rename", target: binding.id, to: "result" }] } });
    expect(edited).toMatchObject({ ok: true, value: { ok: true, source: "(define result 42)\nresult" }, diagnostics: [] });
    expect(await send(abi, { op: "typecheck", source: (edited.value as { source: string }).source })).toMatchObject({ ok: true, diagnostics: [] });
  });

  it("negotiates semver majors and strictly decodes editor inputs", async () => {
    const abi = new JsonAbi();
    for (const abiVersion of [undefined, "0.1.0", "0.99.0", "0.2.0-beta.1+build"]) {
      expect(await send(abi, { op: "version", ...(abiVersion ? { abiVersion } : {}) })).toMatchObject({ ok: true });
    }
    expect((await abi.host.version()).hostAbiVersion).toBe(HOST_ABI_VERSION);
    expect(await send(abi, { op: "version", abiVersion: "1.0.0" })).toMatchObject({ ok: false, diagnostics: [{ code: "abi/version-mismatch" }] });
    for (const abiVersion of [1, "0.2", "01.2.0", "0.2.0-01", "0.2.0\n"]) {
      expect(await send(abi, { op: "version", abiVersion })).toMatchObject({ ok: false, diagnostics: [{ code: "abi/invalid-request" }] });
    }
    for (const input of [
      { op: "identifySyntax", source: "42", previous: { source: "42", identity: {} } },
      { op: "describeNodes", source: "42", identity: {}, ids: [] },
      { op: "outlineToSource", items: [{ id: "x", text: "42", children: [], extra: true }] },
      { op: "symbolIndex", source: "42", extra: true },
    ]) expect(await send(abi, input)).toMatchObject({ ok: false, diagnostics: [{ code: "abi/invalid-request" }] });
    expect(await send(abi, { op: "applyEditScript", source: "42", script: {} })).toMatchObject({ ok: false, value: { ok: false }, diagnostics: [{ code: "edit-script/invalid" }] });
  });
});
