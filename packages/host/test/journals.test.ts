import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  JOURNAL_FORMAT,
  REDACTED_JOURNAL_VALUE,
  TsLanguageHost,
  createLanguage,
  parseJournalJsonl,
  serializeJournalJsonl,
  type CheckedRunState,
  type HostBuiltinDescriptor,
  type HostCallJournal,
  type HostCallResumeResult,
  type JournalEntry,
  type ValueProjection,
} from "../src/index.js";
import { JsonAbi } from "../src/json-abi.js";

interface JournalFixtureCase {
  readonly id: string;
  readonly sourceId: string;
  readonly source: string;
  readonly journalFile: string;
  readonly resume?: readonly HostCallResumeResult[];
  readonly callback?: {
    readonly outerCallIndex: number;
    readonly fnArgIndex: number;
    readonly callArgs: readonly ValueProjection[];
    readonly innerResume: readonly HostCallResumeResult[];
  };
  readonly expected: {
    readonly status: "completed" | "failed";
    readonly printed?: string;
    readonly diagnosticCode?: string;
  };
}

interface JournalFixtureFile {
  readonly builtins: readonly HostBuiltinDescriptor[];
  readonly cases: readonly JournalFixtureCase[];
}

const fixturesDir = resolve(import.meta.dirname, "../../../conformance/host-call-journals");
const fixtures = JSON.parse(readFileSync(join(fixturesDir, "cases.json"), "utf8")) as JournalFixtureFile;
const cli = resolve(import.meta.dirname, "../dist/cli.mjs");

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "forma-journal-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf8");
  }
  return dir;
}

describe("host-call journals conformance (RFC 0016 stages 2-3)", () => {
  for (const testCase of fixtures.cases) {
    it(`records golden and replays with zero live host calls: ${testCase.id}`, async () => {
      const host = new TsLanguageHost();
      const { sessionId } = await host.openSession();
      try {
        await host.configureSession({ sessionId, hostBuiltins: fixtures.builtins });
        const streamed: JournalEntry[] = [];
        let state = await host.evaluateInSession({
          sessionId,
          sourceId: testCase.sourceId,
          source: testCase.source,
          journal: { mode: "record" },
          onJournalEntry: (entry) => streamed.push(entry),
        });
        let callIndex = 0;
        while (state.status === "host-call") {
          let reply: HostCallResumeResult;
          if (testCase.callback && callIndex === testCase.callback.outerCallIndex) {
            const fnArg = state.call.args[testCase.callback.fnArgIndex];
            expect(fnArg?.kind).toBe("function");
            if (fnArg?.kind !== "function") throw new Error("expected function arg");
            let innerState = await host.callValue({
              sessionId,
              valueRef: fnArg.valueRef,
              args: testCase.callback.callArgs,
            });
            let innerIdx = 0;
            while (innerState.status === "host-call") {
              const innerReply = testCase.callback.innerResume[innerIdx++];
              expect(innerReply).toBeDefined();
              innerState = await host.resumeHostCall({
                sessionId,
                evaluationId: innerState.call.evaluationId,
                callId: innerState.call.callId,
                result: innerReply!,
              });
            }
            expect(innerState.status).toBe("completed");
            if (innerState.status !== "completed") throw new Error("expected callback completion");
            reply = { ok: true, value: innerState.result.value };
          } else {
            const nextReply = testCase.resume?.[callIndex];
            expect(nextReply, `missing fixture reply #${callIndex}`).toBeDefined();
            reply = nextReply!;
          }
          callIndex++;
          state = await host.resumeHostCall({
            sessionId,
            evaluationId: state.call.evaluationId,
            callId: state.call.callId,
            result: reply,
          });
        }

        expect(state.status).toBe(testCase.expected.status);
        expect(state.journal).toBeDefined();
        const recorded = state.journal!;
        expect(recorded.header.format).toBe(JOURNAL_FORMAT);
        expect(streamed).toEqual(recorded.entries);

        const actualJsonl = serializeJournalJsonl(recorded);
        const goldenPath = join(fixturesDir, testCase.journalFile);
        if (process.env["FORMA_UPDATE_GOLDEN"] === "1") {
          writeFileSync(goldenPath, actualJsonl, "utf8");
        }
        const goldenJsonl = readFileSync(goldenPath, "utf8");
        expect(actualJsonl).toBe(goldenJsonl);

        // Replay the stored golden JSONL with zero surfaced host calls.
        const parsedJournal = parseJournalJsonl(goldenJsonl);
        const replayed = await host.evaluateInSession({
          sessionId,
          sourceId: testCase.sourceId,
          source: testCase.source,
          journal: { mode: "replay", journal: parsedJournal },
        });
        expect(replayed.status).toBe(testCase.expected.status);
        if (testCase.expected.status === "completed") {
          if (replayed.status !== "completed") throw new Error("expected completed replay");
          expect(replayed.result.printed).toBe(testCase.expected.printed);
          expect(replayed.result.diagnostics).toEqual([]);
        } else {
          if (replayed.status !== "failed") throw new Error("expected failed replay");
          expect(replayed.diagnostics[0]?.code).toBe(testCase.expected.diagnosticCode);
        }
      } finally {
        await host.closeSession({ sessionId });
      }
    });
  }
});

describe("host-call journal edge cases and diagnostics", () => {
  const builtins: HostBuiltinDescriptor[] = [
    {
      name: "fetch",
      arity: 1,
      typeScheme: {
        kind: "function",
        params: [{ kind: "type", "name": "String" }],
        result: { kind: "type", "name": "String" },
      },
      handler: { kind: "host-effect", effect: "net/fetch" },
      purity: "read",
    },
    {
      name: "num-op",
      arity: 1,
      typeScheme: {
        kind: "function",
        params: [{ kind: "any" }],
        result: { kind: "any" },
      },
      handler: { kind: "host-effect", effect: "math/op" },
      purity: "read",
    },
  ];

  async function recordProgram(
    host: TsLanguageHost,
    sessionId: string,
    sourceId: string,
    source: string,
    answers: readonly HostCallResumeResult[],
    redact?: (entry: JournalEntry) => JournalEntry,
  ): Promise<HostCallJournal> {
    let state = await host.evaluateInSession({
      sessionId,
      sourceId,
      source,
      journal: { mode: "record", ...(redact ? { redact } : {}) },
    });
    let idx = 0;
    while (state.status === "host-call") {
      state = await host.resumeHostCall({
        sessionId,
        evaluationId: state.call.evaluationId,
        callId: state.call.callId,
        result: answers[idx++]!,
      });
    }
    if (!state.journal) throw new Error("expected terminal journal");
    return state.journal;
  }

  it("reports journal/diverged at exact seq and author HostCall span when an argument changes", async () => {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    try {
      await host.configureSession({ sessionId, hostBuiltins: builtins });
      const original = '(let [a (fetch "first")]\n  (str a ":" (fetch "second")))';
      const journal = await recordProgram(host, sessionId, "app.lisp", original, [
        { ok: true, value: { kind: "string", value: "one" } },
        { ok: true, value: { kind: "string", value: "two" } },
      ]);

      const edited = '(let [a (fetch "first")]\n  (str a ":" (fetch "changed")))';
      const replayed = await host.evaluateInSession({
        sessionId,
        sourceId: "app.lisp",
        source: edited,
        journal: { mode: "replay", journal, allowProgramMismatch: true },
      });
      expect(replayed.status).toBe("failed");
      if (replayed.status !== "failed") throw new Error("expected failure");
      // First diagnostic is the program-mismatch warning; second is journal/diverged.
      expect(replayed.diagnostics[0]).toMatchObject({
        code: "journal/program-mismatch",
        severity: "warning",
      });
      const diverged = replayed.diagnostics.find((d) => d.code === "journal/diverged");
      expect(diverged).toBeDefined();
      expect(diverged!.severity).toBe("error");
      expect(diverged!.details).toMatchObject({
        seq: 1,
        recorded: { effect: "net/fetch", name: "fetch", args: [{ kind: "string", value: "second" }] },
        actual: { effect: "net/fetch", name: "fetch", args: [{ kind: "string", value: "changed" }] },
      });
      expect(diverged!.span).toBeDefined();
      expect(diverged!.span!.sourceId).toBe("app.lisp");
      expect(diverged!.span!.startLine).toBe(2);
      expect(edited.slice(diverged!.span!.startOffset, diverged!.span!.endOffset)).toBe('(fetch "changed")');
    } finally {
      await host.closeSession({ sessionId });
    }
  });

  it("distinguishes Int and Float in journal matching and preserves nonfinite/signed-zero floats", async () => {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    try {
      await host.configureSession({ sessionId, hostBuiltins: builtins });
      const source = "(num-op 1.0)";
      const journal = await recordProgram(host, sessionId, "num.lisp", source, [
        { ok: true, value: { kind: "float", value: "-0" } },
      ]);
      const roundTripped = parseJournalJsonl(serializeJournalJsonl(journal));
      expect(roundTripped.entries[0]?.args).toEqual([{ kind: "float", value: 1 }]);
      expect(roundTripped.entries[0]?.outcome).toEqual({ ok: true, value: { kind: "float", value: "-0" } });

      // Exact replay preserves -0.0
      const okReplay = await host.evaluateInSession({
        sessionId,
        sourceId: "num.lisp",
        source,
        journal: { mode: "replay", journal: roundTripped },
      });
      expect(okReplay).toMatchObject({
        status: "completed",
        result: { value: { kind: "float", value: "-0" }, printed: "-0.0" },
      });

      // Changing 1.0 (Float) to 1 (Int) diverges!
      const intReplay = await host.evaluateInSession({
        sessionId,
        sourceId: "num.lisp",
        source: "(num-op 1)",
        journal: { mode: "replay", journal: roundTripped, allowProgramMismatch: true },
      });
      expect(intReplay.status).toBe("failed");
      if (intReplay.status !== "failed") throw new Error("expected divergence");
      expect(intReplay.diagnostics.some((d) => d.code === "journal/diverged")).toBe(true);
    } finally {
      await host.closeSession({ sessionId });
    }
  });

  it("handles truncated journals with onExhausted fail and pause modes", async () => {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    try {
      await host.configureSession({ sessionId, hostBuiltins: builtins });
      const source = '(str (fetch "a") "+" (fetch "b"))';
      const fullJournal = await recordProgram(host, sessionId, "trunc.lisp", source, [
        { ok: true, value: { kind: "string", value: "A" } },
        { ok: true, value: { kind: "string", value: "B" } },
      ]);
      // Truncate after first entry line
      const truncatedJsonl = serializeJournalJsonl(fullJournal).split("\n").slice(0, 2).join("\n");
      const truncated = parseJournalJsonl(truncatedJsonl);
      expect(truncated.entries).toHaveLength(1);

      // Default onExhausted: "fail"
      const failed = await host.evaluateInSession({
        sessionId,
        sourceId: "trunc.lisp",
        source,
        journal: { mode: "replay", journal: truncated },
      });
      expect(failed.status).toBe("failed");
      if (failed.status !== "failed") throw new Error("expected exhausted failure");
      expect(failed.diagnostics[0]).toMatchObject({ code: "journal/exhausted", severity: "error" });
      expect(source.slice(failed.diagnostics[0]!.span!.startOffset, failed.diagnostics[0]!.span!.endOffset)).toBe('(fetch "b")');

      // onExhausted: "pause" + record: true continues live and builds a complete journal
      const paused = await host.evaluateInSession({
        sessionId,
        sourceId: "trunc.lisp",
        source,
        journal: { mode: "replay", journal: truncated, onExhausted: "pause", record: true },
      });
      expect(paused.status).toBe("host-call");
      if (paused.status !== "host-call") throw new Error("expected live pause");
      expect(paused.call.name).toBe("fetch");
      expect(paused.call.args).toEqual([{ kind: "string", value: "b" }]);

      const completed = await host.resumeHostCall({
        sessionId,
        evaluationId: paused.call.evaluationId,
        callId: paused.call.callId,
        result: { ok: true, value: { kind: "string", value: "B-live" } },
      });
      expect(completed.status).toBe("completed");
      if (completed.status !== "completed") throw new Error("expected completion");
      expect(completed.result.printed).toBe('"A+B-live"');
      expect(completed.journal?.entries).toHaveLength(2);
      expect(completed.journal?.entries[1]?.outcome).toEqual({
        ok: true,
        value: { kind: "string", value: "B-live" },
      });
    } finally {
      await host.closeSession({ sessionId });
    }
  });

  it("enforces digest match by default and warns under allowProgramMismatch", async () => {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    try {
      await host.configureSession({ sessionId, hostBuiltins: builtins });
      const journal = await recordProgram(host, sessionId, "prog.lisp", '(fetch "k")', [
        { ok: true, value: { kind: "string", value: "v" } },
      ]);

      // Different source (even a comment change) fails by default
      const edited = '; comment\n(fetch "k")';
      const rejected = await host.evaluateInSession({
        sessionId,
        sourceId: "prog.lisp",
        source: edited,
        journal: { mode: "replay", journal },
      });
      expect(rejected).toMatchObject({
        status: "failed",
        diagnostics: [{ code: "journal/program-mismatch", severity: "error" }],
      });

      // With allowProgramMismatch: true, emits a warning and replays cleanly
      const allowed = await host.evaluateInSession({
        sessionId,
        sourceId: "prog.lisp",
        source: edited,
        journal: { mode: "replay", journal, allowProgramMismatch: true },
      });
      expect(allowed).toMatchObject({
        status: "completed",
        result: {
          printed: '"v"',
          diagnostics: [{ code: "journal/program-mismatch", severity: "warning" }],
        },
      });
    } finally {
      await host.closeSession({ sessionId });
    }
  });

  it("records redacted values and fails replay with journal/redacted at call span", async () => {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    try {
      await host.configureSession({ sessionId, hostBuiltins: builtins });
      const source = '(fetch "token")';
      const journal = await recordProgram(
        host,
        sessionId,
        "secret.lisp",
        source,
        [{ ok: true, value: { kind: "string", value: "sk-live-secret" } }],
        (entry) => ({
          ...entry,
          outcome: entry.outcome.ok ? { ok: true, value: REDACTED_JOURNAL_VALUE } : entry.outcome,
        }),
      );
      expect(journal.entries[0]?.outcome).toEqual({ ok: true, value: { kind: "redacted" } });

      const replayed = await host.evaluateInSession({
        sessionId,
        sourceId: "secret.lisp",
        source,
        journal: { mode: "replay", journal },
      });
      expect(replayed.status).toBe("failed");
      if (replayed.status !== "failed") throw new Error("expected redacted failure");
      expect(replayed.diagnostics[0]).toMatchObject({
        code: "journal/redacted",
        severity: "error",
        details: { seq: 0, name: "fetch", effect: "net/fetch" },
      });
      expect(source.slice(replayed.diagnostics[0]!.span!.startOffset, replayed.diagnostics[0]!.span!.endOffset)).toBe('(fetch "token")');
    } finally {
      await host.closeSession({ sessionId });
    }
  });

  it("warns on unused entries and rejects unknown builtins", async () => {
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    try {
      await host.configureSession({ sessionId, hostBuiltins: builtins });
      const journal = await recordProgram(host, sessionId, "two.lisp", '(str (fetch "a") (fetch "b"))', [
        { ok: true, value: { kind: "string", value: "A" } },
        { ok: true, value: { kind: "string", value: "B" } },
      ]);

      // Replay against a program that only makes one call
      const unused = await host.evaluateInSession({
        sessionId,
        sourceId: "two.lisp",
        source: '(fetch "a")',
        journal: { mode: "replay", journal, allowProgramMismatch: true },
      });
      expect(unused.status).toBe("completed");
      if (unused.status !== "completed") throw new Error("expected completion");
      expect(unused.result.diagnostics.some((d) => d.code === "journal/unused-entries" && d.severity === "warning")).toBe(true);

      // Replay in a session without the configured builtins -> journal/unknown-builtin
      const { sessionId: emptySession } = await host.openSession();
      try {
        const unknown = await host.evaluateInSession({
          sessionId: emptySession,
          sourceId: "two.lisp",
          source: '(fetch "a")',
          journal: { mode: "replay", journal },
        });
        expect(unknown.status).toBe("failed");
        if (unknown.status !== "failed") throw new Error("expected failure");
        expect(unknown.diagnostics.length).toBeGreaterThan(0);
        expect(unknown.diagnostics.every((d) => d.code === "journal/unknown-builtin" && d.severity === "error")).toBe(true);
      } finally {
        await host.closeSession({ sessionId: emptySession });
      }
    } finally {
      await host.closeSession({ sessionId });
    }
  });

  it("supports recording and replay in checkedRun, createLanguage, and JsonAbi", async () => {
    // 1. checkedRun
    const host = new TsLanguageHost();
    const { sessionId } = await host.openSession();
    try {
      await host.configureSession({ sessionId, hostBuiltins: builtins });
      let state = await host.checkedRun({
        sessionId,
        sourceId: "checked.lisp",
        source: '(fetch "hello")',
        grants: [{ name: "fetch", mode: "allow" }],
        journal: { mode: "record" },
      });
      expect(state.status).toBe("host-call");
      if (state.status !== "host-call") throw new Error("expected pause");
      state = (await host.resumeHostCall({
        sessionId,
        evaluationId: state.call.evaluationId,
        callId: state.call.callId,
        result: { ok: true, value: { kind: "string", value: "world" } },
      })) as CheckedRunState;
      expect(state.status).toBe("completed");
      if (state.status !== "completed" || !state.journal) throw new Error("expected completed with journal");

      const replayedChecked = await host.checkedRun({
        sessionId,
        sourceId: "checked.lisp",
        source: '(fetch "hello")',
        grants: [{ name: "fetch", mode: "allow" }],
        journal: { mode: "replay", journal: state.journal },
      });
      expect(replayedChecked).toMatchObject({
        status: "completed",
        result: { printed: '"world"' },
        hostCalls: 1,
      });
    } finally {
      await host.closeSession({ sessionId });
    }

    // 2. createLanguage
    let liveCalls = 0;
    const lang = await createLanguage({
      capabilities: {
        greet: {
          arity: 1,
          typeScheme: {
            kind: "function",
            params: [{ kind: "type", name: "String" }],
            result: { kind: "type", name: "String" },
          },
          handler: (name) => {
            liveCalls++;
            return { ok: true, value: `Hello, ${String(name)}!` };
          },
        },
      },
    });
    try {
      const streamed: JournalEntry[] = [];
      const recorded = await lang.run('(greet "Forma")', {
        journal: { mode: "record" },
        onJournalEntry: (entry) => streamed.push(entry),
      });
      expect(recorded.ok).toBe(true);
      expect(recorded.value).toBe("Hello, Forma!");
      expect(liveCalls).toBe(1);
      expect(recorded.journal?.entries).toHaveLength(1);
      expect(streamed).toHaveLength(1);

      const replayed = await lang.run('(greet "Forma")', {
        journal: { mode: "replay", journal: recorded.journal! },
      });
      expect(replayed.ok).toBe(true);
      expect(replayed.value).toBe("Hello, Forma!");
      expect(liveCalls).toBe(1); // Zero live handler invocations on replay!
    } finally {
      await lang.close();
    }

    // 3. JsonAbi
    const abi = new JsonAbi();
    const opened = await abi.handleJson(JSON.stringify({ op: "openSession" }));
    const abiSession = (opened.value as { sessionId: string }).sessionId;
    await abi.handleJson(JSON.stringify({ op: "configureSession", sessionId: abiSession, hostBuiltins: builtins }));
    const paused = await abi.handleJson(
      JSON.stringify({ op: "evaluateInSession", sessionId: abiSession, sourceId: "abi.lisp", source: '(fetch "x")', journal: { mode: "record" } }),
    );
    const call = (paused.value as { call: { evaluationId: string; callId: string } }).call;
    const done = await abi.handleJson(
      JSON.stringify({
        op: "resumeHostCall",
        sessionId: abiSession,
        evaluationId: call.evaluationId,
        callId: call.callId,
        result: { ok: true, value: { kind: "string", value: "y" } },
      }),
    );
    const abiJournal = (done.value as { journal: HostCallJournal }).journal;
    expect(abiJournal.entries).toHaveLength(1);
    const abiReplay = await abi.handleJson(
      JSON.stringify({
        op: "evaluateInSession",
        sessionId: abiSession,
        sourceId: "abi.lisp",
        source: '(fetch "x")',
        journal: { mode: "replay", journal: abiJournal },
      }),
    );
    expect(abiReplay).toMatchObject({ ok: true, value: { status: "completed", result: { printed: '"y"' } } });
  });

  it("supports forma run --record and --replay in the CLI", () => {
    const dir = makeTempDir({ "main.lisp": "(+ 20 22)" });
    const journalPath = join(dir, "trace.jsonl");
    const rec = spawnSync(process.execPath, [cli, "run", "main.lisp", "--record", journalPath], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    expect(rec.status).toBe(0);
    expect(rec.stdout).toBe("42\n");
    const written = parseJournalJsonl(readFileSync(journalPath, "utf8"));
    expect(written.header.format).toBe(JOURNAL_FORMAT);
    expect(written.entries).toEqual([]);

    const rep = spawnSync(process.execPath, [cli, "run", "main.lisp", "--replay", journalPath], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    expect(rep.status).toBe(0);
    expect(rep.stdout).toBe("42\n");

    // Modifying the file without --allow-program-mismatch fails with journal/program-mismatch
    writeFileSync(join(dir, "main.lisp"), "(+ 20 23)", "utf8");
    const mismatch = spawnSync(process.execPath, [cli, "run", "main.lisp", "--replay", journalPath], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain("journal/program-mismatch");

    // Replaying a journal containing host calls works from the CLI with zero live calls
    const hostDir = makeTempDir({ "app.lisp": '(fetch "hello")' });
    const appPath = join(hostDir, "app.lisp");
    const appSource = readFileSync(appPath, "utf8");
    const host = new TsLanguageHost();
    // Create a valid journal for app.lisp via CLI replay test
    const hostJournal: HostCallJournal = {
      header: {
        format: JOURNAL_FORMAT,
        engine: "typescript",
        program: {
          sources: [{ id: appPath, sha256: "" }],
          preludes: [],
          entry: appPath,
        },
        builtins: [{ name: "fetch", effect: "net/fetch" }],
      },
      entries: [
        {
          seq: 0,
          evaluation: [],
          effect: "net/fetch",
          name: "fetch",
          args: [{ kind: "string", value: "hello" }],
          outcome: { ok: true, value: { kind: "string", value: "replayed-from-cli" } },
        },
      ],
    };
    expect(host).toBeDefined();
    expect(appSource).toBe('(fetch "hello")');
    const hostJournalPath = join(hostDir, "host-trace.jsonl");
    writeFileSync(hostJournalPath, serializeJournalJsonl(hostJournal), "utf8");
    const cliReplay = spawnSync(
      process.execPath,
      [cli, "run", "app.lisp", "--replay", hostJournalPath, "--allow-program-mismatch"],
      { cwd: hostDir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } },
    );
    expect(cliReplay.status).toBe(0);
    expect(cliReplay.stdout).toBe('"replayed-from-cli"\n');
    expect(cliReplay.stderr).toContain("journal/program-mismatch");
  });
});
