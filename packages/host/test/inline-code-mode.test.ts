import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { chat } from "../examples/inline-code-mode/chat.ts";
import { chunks, initial, mockBindings, source, write } from "../examples/inline-code-mode/fixture.ts";
import { SegmentParser } from "../examples/inline-code-mode/protocol.ts";
import { defaults, effectEvidence, ExecutionSession } from "../examples/inline-code-mode/runtime.ts";

const executable = (source: string, invocationId = "test/run") => ({ responseId: "test", segmentId: "run", invocationId, source });

describe("inline Forma text protocol", () => {
  test("every network split preserves the complete source and identity", () => {
    for (let split = 0; split < initial.length; split++) {
      const parser = new SegmentParser("response");
      parser.push(initial.slice(0, split));
      parser.push(initial.slice(split));
      expect(parser.finish()).toEqual({ responseId: "response", segmentId: "counts",
        invocationId: "response/counts", source: source + "\n" });
    }
  });

  test("streams one character at a time and never exposes a partial executable", () => {
    const parser = new SegmentParser("response");
    const body = "```forma-run run\n(+ 1 2)\n";
    for (const char of body) expect(parser.push(char)).toBeUndefined();
    expect(() => parser.finish()).toThrow("Unclosed");
    for (const char of "```") expect(parser.push(char)).toBeUndefined();
    expect(parser.finish()?.source).toBe("(+ 1 2)\n");
  });

  test.each([
    "```forma\n(Issues.close \"x\")\n```\n",
    "````markdown\n```forma-run quoted\n(Issues.close \"x\")\n```\n````\n",
    "~~~markdown\n```forma-run quoted\n(Issues.close \"x\")\n```\n~~~\n",
    "> ```forma-run quoted\n> (Issues.close \"x\")\n> ```\n",
    "    ```forma-run indented\n    (Issues.close \"x\")\n    ```\n",
    "Here is ` ```forma-run inline ` and (+ 1 2).\n",
    "<!--\n```forma-run commented\n(Issues.close \"x\")\n```\n-->\n",
    "<pre>\n```forma-run quoted\n(Issues.close \"x\")\n```\n</pre>\n",
  ])("keeps examples and quoted content inert: %s", (text) => {
    const parser = new SegmentParser("response");
    for (const char of text) expect(parser.push(char)).toBeUndefined();
    expect(parser.finish()).toBeUndefined();
    expect(parser.prose).toBe(text);
  });

  test("rejects a prerecorded dependent tail before executing", async () => {
    const binding = vi.fn(() => ({ ok: true, value: ["ada/I-1"] }));
    const executor = new ExecutionSession({ ...mockBindings(), "Issues.list-open": binding });
    await expect(chat({ generate: () => chunks(initial + "The answer is two.", 100_000) }, executor))
      .rejects.toThrow("Dependent text");
    expect(binding).not.toHaveBeenCalled();
    const parser = new SegmentParser("response");
    parser.push(initial);
    expect(() => parser.push("A later chunk cannot know the result")).toThrow("continuation");
  });

  test("cancels generation at the boundary and passes the real result to a fresh generation", async () => {
    let cancelled = false;
    let generations = 0;
    const transcript = await chat({
      async *generate(history) {
        generations++;
        if (history.length === 0) {
          try { yield* chunks(initial); yield "stale dependent tail"; }
          finally { cancelled = true; }
        } else {
          expect(cancelled).toBe(true);
          expect(history.at(-1)).toMatchObject({ kind: "result", result: { ok: true,
            value: [{ ":account": "ada", ":open": 2 }, { ":account": "lin", ":open": 1 }] } });
          yield "Ada has two open issues; Lin has one.\n";
        }
      },
    }, new ExecutionSession(mockBindings()));
    expect(generations).toBe(2);
    expect(transcript.map((item) => item.kind)).toEqual(["prose", "code", "result", "continuation"]);
    expect(transcript.at(-1)).toMatchObject({ text: "Ada has two open issues; Lin has one.\n" });
  });

  test("bounds protocol input and continuation rounds", async () => {
    expect(() => new SegmentParser("response", 8).push("123456789")).toThrow("input budget");
    await expect(chat({ generate: () => chunks("```forma-run repeat\n(+ 1 2)\n```\n") },
      new ExecutionSession(mockBindings()), "bounded", 2)).rejects.toThrow("Continuation budget");
  });
});

describe("checked runtime bindings", () => {
  test("records a deterministic end-to-end transcript", async () => {
    const transcript = await chat({ generate(history) {
      const result = history.findLast((item) => item.kind === "result");
      return chunks(result?.kind === "result"
        ? `The checked host result is ${JSON.stringify(result.result.value)}.\n` : initial);
    } }, new ExecutionSession(mockBindings()));
    const expected = JSON.parse(readFileSync(new URL("../examples/inline-code-mode/transcript.json", import.meta.url), "utf8"));
    expect({ effectEvidence: effectEvidence(), transcript }).toEqual(expected);
  });

  test("infers Effect errors and operation requirements from the checked body", () => {
    expect(effectEvidence()).toEqual({
      type: "(Effect (Array {:account String :open Int}) [Unavailable] [Issues.list-open Accounts.list-active])",
      errors: ["Unavailable"], requirements: ["Issues.list-open", "Accounts.list-active"],
    });
  });

  test("swaps implementations without changing source", async () => {
    const primary = await new ExecutionSession(mockBindings()).execute(executable(source));
    const alternate = await new ExecutionSession(mockBindings("alternate")).execute(executable(source));
    expect(primary).toMatchObject({ ok: true, value: [{ ":account": "ada", ":open": 2 }, { ":account": "lin", ":open": 1 }] });
    expect(alternate).toMatchObject({ ok: true, value: [{ ":account": "ada", ":open": 0 }, { ":account": "lin", ":open": 1 }] });
  });

  test("deduplicates concurrent and rendered-history replays, including failures", async () => {
    const binding = vi.fn(() => ({ ok: true, value: ["ada/I-1"] }));
    const executor = new ExecutionSession({ "Issues.list-open": binding });
    const segment = executable("(Issues.list-open)");
    const [a, b] = await Promise.all([executor.execute(segment), executor.execute(segment)]);
    expect(a).toBe(b);
    expect(await executor.execute(segment)).toBe(a);
    expect(binding).toHaveBeenCalledTimes(1);
    await expect(executor.execute({ ...segment, source: "(+ 1 2)" })).rejects.toThrow("identity-conflict");
    const missing = executable("(Accounts.list-active)", "test/missing");
    const failure = await executor.execute(missing);
    expect(await executor.execute(missing)).toBe(failure);
  });

  test("missing binding fails at the suspended boundary", async () => {
    const result = await new ExecutionSession({}).execute(executable("(Issues.list-open)"));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "binding/missing" }],
      calls: [{ operation: "Issues.list-open", decision: "missing-binding" }] });
  });

  test.each([
    { ok: true, value: [99] }, { ok: true, value: "wrong" },
    { ok: false, error: { _tag: "Undeclared", message: "wrong" } },
    { ok: false, error: { _tag: "Unavailable", message: 99 } },
  ])("rejects invalid success/failure data before resume: %j", async (value) => {
    const result = await new ExecutionSession({ "Issues.list-open": () => value }).execute(executable("(Issues.list-open)"));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "binding/invalid" }] });
    expect(result.value).toBeUndefined();
  });

  test("retains a validated typed failure and the author source identity", async () => {
    const result = await new ExecutionSession({ "Issues.list-open": () => ({ ok: false,
      error: { _tag: "Unavailable", message: "Mock issues offline" } }) }).execute(executable("(Issues.list-open)"));
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "binding/failure/Unavailable",
      span: { sourceId: "test/run.forma" }, details: { error: { _tag: "Unavailable", message: "Mock issues offline" } } }] });
  });

  test("denies writes despite a declaration and an implementation; explicit host grants allow them", async () => {
    const binding = vi.fn(() => ({ ok: true, value: true }));
    const segment = new SegmentParser("write");
    segment.push(write);
    const request = segment.finish()!;
    const denied = await new ExecutionSession({ "Issues.close": binding }).execute(request);
    expect(denied).toMatchObject({ ok: false, diagnostics: [{ code: "capability/denied" }] });
    expect(binding).not.toHaveBeenCalled();
    expect(await new ExecutionSession({ "Issues.close": binding }, new Set(["Issues.close"])).execute(request))
      .toMatchObject({ ok: true, value: true });
    expect(binding).toHaveBeenCalledTimes(1);
  });

  test("rejects malformed source and wrong arguments before any host call", async () => {
    const binding = vi.fn(() => ({ ok: true, value: true }));
    const executor = new ExecutionSession({ "Issues.close": binding }, new Set(["Issues.close"]));
    for (const [index, text] of ["(Issues.close 42)", "(Issues.close \"x\") (", "(unknown-operation)"].entries()) {
      const result = await executor.execute(executable(text, `test/invalid-${index}`));
      expect(result.ok).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.calls).toEqual([]);
      expect(result.diagnostics[0]?.span?.sourceId).toBe(`test/invalid-${index}.forma`);
    }
    expect(binding).not.toHaveBeenCalled();
  });

  test("bounds evaluation steps, actual host invocations, and host/result output", async () => {
    const steps = await new ExecutionSession(mockBindings(), undefined, { ...defaults, steps: 20 })
      .execute(executable("(define spin [n] (spin (+ n 1))) (spin 0)"));
    expect(steps.ok).toBe(false);
    expect(steps.diagnostics[0]).toMatchObject({ code: "StepLimitExceeded", span: { sourceId: "test/run.forma" } });
    const binding = vi.fn(() => ({ ok: true, value: [] }));
    const calls = await new ExecutionSession({ "Issues.list-open": binding }, undefined, { ...defaults, calls: 1 })
      .execute(executable("(do (Issues.list-open) (Issues.list-open))"));
    expect(calls).toMatchObject({ ok: false, diagnostics: [{ code: "limit/host-calls" }] });
    expect(binding).toHaveBeenCalledTimes(1);
    const output = await new ExecutionSession({ "Issues.list-open": () => ({ ok: true, value: ["x".repeat(100)] }) },
      undefined, { ...defaults, output: 50 }).execute(executable("(Issues.list-open)"));
    expect(output).toMatchObject({ ok: false, diagnostics: [{ code: "limit/output" }] });
    const pure = await new ExecutionSession({}, undefined, { ...defaults, output: 5 }).execute(executable('"long result"'));
    expect(pure).toMatchObject({ ok: false, diagnostics: [{ code: "limit/output" }] });
    const large = await new ExecutionSession({}, undefined, { ...defaults, source: 5 }).execute(executable("(+ 1 2)"));
    expect(large).toMatchObject({ ok: false, diagnostics: [{ code: "limit/source" }] });
  });
});
