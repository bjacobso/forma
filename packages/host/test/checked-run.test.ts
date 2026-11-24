import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonAbi } from "../src/json-abi.js";
import { TsLanguageHost } from "../src/ts-host.js";
import type { CheckedRunState, HostBuiltinDescriptor, HostCallResumeResult } from "../src/types.js";

interface CheckedRunFixtureCase {
  readonly id: string;
  readonly sourceId: string;
  readonly source: string;
  readonly grants: readonly { readonly name: string; readonly mode?: "ask" | "allow"; readonly maxCalls?: number }[];
  readonly expectedType?: string;
  readonly limits?: { readonly steps?: number; readonly hostCalls?: number };
  readonly resume?: readonly HostCallResumeResult[];
  readonly expected: Record<string, unknown>;
}

interface CheckedRunFixtureFile {
  readonly builtins: readonly HostBuiltinDescriptor[];
  readonly cases: readonly CheckedRunFixtureCase[];
}

const fixturePath = resolve(import.meta.dirname, "../../../conformance/checked-run/cases.json");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")) as CheckedRunFixtureFile;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("checkedRun conformance (RFC 0012 stage 1)", () => {
  for (const testCase of fixtures.cases) {
    it(`conformance: ${testCase.id}`, async () => {
      const host = new TsLanguageHost();
      const { sessionId } = await host.openSession();
      try {
        await host.configureSession({ sessionId, hostBuiltins: fixtures.builtins });
        let state = await host.checkedRun({
          sessionId,
          sourceId: testCase.sourceId,
          source: testCase.source,
          grants: testCase.grants,
          ...(testCase.expectedType ? { expectedType: testCase.expectedType } : {}),
          ...(testCase.limits ? { limits: testCase.limits } : {}),
        });
        let pauses = 0;
        let firstCall: Extract<CheckedRunState, { status: "host-call" }>["call"] | undefined;
        while (state.status === "host-call") {
          firstCall ??= state.call;
          const reply = testCase.resume?.[pauses];
          expect(reply, `unexpected host call #${pauses + 1}: ${state.call.name}`).toBeDefined();
          pauses++;
          state = (await host.resumeHostCall({
            sessionId,
            evaluationId: state.call.evaluationId,
            callId: state.call.callId,
            result: reply!,
          })) as CheckedRunState;
        }
        expect(state.status).toBe(testCase.expected.status);
        if (testCase.expected.hostCalls !== undefined) {
          expect(pauses).toBe(testCase.expected.hostCalls);
        }
        if (state.status === "rejected") {
          expect(state.stage).toBe(testCase.expected.stage);
          expect(state.diagnostics[0]?.code).toBe(testCase.expected.diagnosticCode);
          if (testCase.expected.requires) expect(state.requires).toEqual(testCase.expected.requires);
          if (testCase.expected.spanLine !== undefined) {
            expect(state.diagnostics[0]?.span?.startLine).toBe(testCase.expected.spanLine);
            expect(state.diagnostics[0]?.span?.startColumn).toBe(testCase.expected.spanColumn);
          }
          expect(state.manifest.sources).toEqual([
            { sourceId: testCase.sourceId, sha256: sha256(testCase.source) },
          ]);
        } else if (state.status === "completed") {
          expect(state.type).toBe(testCase.expected.type);
          expect(state.hostCalls).toBe(testCase.expected.hostCalls);
          expect(state.result.value).toEqual(testCase.expected.value);
          expect(firstCall?.name).toBe(testCase.expected.callName);
          expect(firstCall?.mode).toBe(testCase.expected.callMode);
          expect(firstCall?.span).toBeDefined();
          expect(firstCall?.span?.sourceId).toBe(testCase.sourceId);
          expect(firstCall?.span?.startLine).toBe(testCase.expected.callSpanLine);
          expect(firstCall?.span?.startColumn).toBe(testCase.expected.callSpanColumn);
          expect(testCase.source.slice(firstCall!.span!.startOffset, firstCall!.span!.endOffset)).toBe(
            testCase.expected.callSpanText,
          );
        } else if (state.status === "failed") {
          expect(state.stage).toBe(testCase.expected.stage);
          expect(state.diagnostics[0]?.code).toBe(testCase.expected.diagnosticCode);
          if (testCase.expected.spanLine !== undefined) {
            expect(state.diagnostics[0]?.span?.startLine).toBe(testCase.expected.spanLine);
            expect(state.diagnostics[0]?.span?.startColumn).toBe(testCase.expected.spanColumn);
          }
        }
      } finally {
        await host.closeSession({ sessionId });
      }
    });
  }

  it("rejects ungranted capabilities reachable indirectly through a prelude helper", async () => {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    try {
      await host.configureSession({ sessionId, hostBuiltins: fixtures.builtins });
      const preludeSource = '(define wipe [p] (delete-file p))';
      await host.loadSource({ sessionId, sourceId: "prelude.lisp", source: preludeSource, kind: "prelude" });
      const state = await host.checkedRun({
        sessionId,
        sourceId: "main.lisp",
        source: '(wipe "important.db")',
        grants: [{ name: "read-file", mode: "ask" }],
      });
      expect(state.status).toBe("rejected");
      if (state.status === "rejected") {
        expect(state.stage).toBe("grant");
        expect(state.requires).toEqual(["delete-file"]);
        expect(state.diagnostics[0]).toMatchObject({
          code: "capability/ungranted",
          span: { sourceId: "main.lisp", startLine: 1, startColumn: 2 },
        });
        expect(state.manifest.preludes).toEqual([
          { sourceId: "prelude.lisp", sha256: sha256(preludeSource) },
        ]);
      }
    } finally {
      await host.closeSession({ sessionId });
    }
  });

  it("rejects expectedType mismatches before running any host calls", async () => {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    try {
      await host.configureSession({ sessionId, hostBuiltins: fixtures.builtins });
      const state = await host.checkedRun({
        sessionId,
        sourceId: "mismatch.lisp",
        source: '(read-file "a.txt")',
        grants: [{ name: "read-file", mode: "allow" }],
        expectedType: "Int",
      });
      expect(state.status).toBe("rejected");
      if (state.status === "rejected") {
        expect(state.stage).toBe("typecheck");
        expect(state.diagnostics[0]).toMatchObject({
          code: "typecheck/type-mismatch",
          details: { expected: "Int", actual: "String" },
        });
      }
    } finally {
      await host.closeSession({ sessionId });
    }
  });

  it("enforces limits.hostCalls and per-grant maxCalls at the overflowing call span", async () => {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    try {
      await host.configureSession({ sessionId, hostBuiltins: fixtures.builtins });
      const source = '(let [a (read-file "1.txt")]\n  (read-file "2.txt"))';
      let state = await host.checkedRun({
        sessionId,
        sourceId: "calls.lisp",
        source,
        grants: [{ name: "read-file", mode: "allow", maxCalls: 1 }],
      });
      expect(state.status).toBe("host-call");
      if (state.status === "host-call") {
        expect(state.call.mode).toBe("allow");
        state = (await host.resumeHostCall({
          sessionId,
          evaluationId: state.call.evaluationId,
          callId: state.call.callId,
          result: { ok: true, value: { kind: "string", value: "first" } },
        })) as CheckedRunState;
      }
      expect(state.status).toBe("failed");
      if (state.status === "failed") {
        expect(state.stage).toBe("limit");
        expect(state.diagnostics[0]).toMatchObject({
          code: "limit/host-calls",
          span: { sourceId: "calls.lisp", startLine: 2, startColumn: 3 },
        });
      }
    } finally {
      await host.closeSession({ sessionId });
    }
  });

  it("works end-to-end over JsonAbi with checkedRun and resumeHostCall", async () => {
    const abi = new JsonAbi();
    const send = (input: unknown) => abi.handleJson(JSON.stringify(input));
    const { sessionId } = (await send({ op: "openSession" })).value as { sessionId: string };
    await send({ op: "configureSession", sessionId, hostBuiltins: fixtures.builtins });
    const paused = await send({
      op: "checkedRun",
      sessionId,
      sourceId: "abi.lisp",
      source: '(read-file "hello.txt")',
      grants: [{ name: "read-file", mode: "ask" }],
      expectedType: "String",
    });
    expect(paused.ok).toBe(true);
    const pausedValue = paused.value as Extract<CheckedRunState, { status: "host-call" }>;
    expect(pausedValue.status).toBe("host-call");
    expect(pausedValue.call.span).toMatchObject({ sourceId: "abi.lisp", startLine: 1, startColumn: 1 });
    const completed = await send({
      op: "resumeHostCall",
      sessionId,
      evaluationId: pausedValue.call.evaluationId,
      callId: pausedValue.call.callId,
      result: { ok: true, value: { kind: "string", value: "hi" } },
    });
    expect(completed.ok).toBe(true);
    expect(completed.type).toBe("String");
    expect(completed.value).toMatchObject({
      status: "completed",
      hostCalls: 1,
      result: { value: { kind: "string", value: "hi" } },
    });
  });
});
