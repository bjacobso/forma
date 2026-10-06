import { describe, expect, it } from "vitest";

import { TsLanguageHost } from "../src/index.js";
import type { EditScript } from "../src/index.js";

describe("structural editor services on the TypeScript host", () => {
  const host = new TsLanguageHost();

  it("advertises the services it implements", async () => {
    const version = await host.version();
    expect(version.capabilities).toEqual(expect.arrayContaining([
        "identifySyntax",
        "observe",
        "symbolIndex",
        "findReferences",
        "applyEditScript",
        "describeNodes",
        "editScriptSchema",
        "sourceToOutline",
        "outlineToSource",
        "formSlots",
      ]));
  });

  it("types host builtins in editor analysis and keeps types around an error", async () => {
    const lookup = {
      name: "Directory.lookup",
      arity: 1,
      typeScheme: {
        kind: "function" as const,
        params: [{ kind: "type" as const, name: "String" }],
        result: { kind: "type" as const, name: "Number" },
      },
      handler: { kind: "host-effect" as const, effect: "Directory.lookup" },
    };
    const source = '(define badge [who] (Directory.lookup who))\n(define broken (+ 1 "x"))\n(badge "ada")';
    const typeOf = (result: { readonly typedSpans: readonly { readonly span: { readonly startOffset: number; readonly endOffset: number }; readonly display: string }[] }, text: string) =>
      result.typedSpans.find(
        (span) => source.slice(span.span.startOffset, span.span.endOffset) === text,
      )?.display;

    const untyped = await host.analyzeEditor({ source });
    expect(untyped.errors.map((error) => error.message)).toEqual(
      expect.arrayContaining([expect.stringContaining("Directory.lookup")]),
    );

    const typed = await host.analyzeEditor({ sourceId: "doc", source, hostBuiltins: [lookup] });
    expect(typed.success).toBe(false);
    // Only the broken definition fails; the forms around it are typed.
    expect(typed.errors).toHaveLength(1);
    expect(source.slice(typed.errors[0]!.span!.startOffset, typed.errors[0]!.span!.endOffset)).toBe(
      '(+ 1 "x")',
    );
    expect(typeOf(typed, "(Directory.lookup who)")).toBe("Number");
    expect(typeOf(typed, '(badge "ada")')).toBe("Number");

    const { sessionId } = await host.openSession();
    await host.configureSession({ sessionId, hostBuiltins: [lookup] });
    const inSession = await host.analyzeEditor({ source, sessionId });
    expect(typeOf(inSession, '(badge "ada")')).toBe("Number");
    await host.closeSession({ sessionId });
  });

  it("identifies syntax and carries ids across an edit", async () => {
    const source = "(define total 1)\n(+ total 2)";
    const first = await host.identifySyntax({ sourceId: "doc", source });
    expect(first.sourceId).toBe("doc");
    expect(first.diagnostics).toEqual([]);
    expect(first.identity.nodes.map((node) => node.kind)).toEqual([
      "List",
      "Symbol",
      "Symbol",
      "Number",
      "List",
      "Symbol",
      "Symbol",
      "Number",
    ]);
    // The identity is plain JSON and survives a round trip through the wire.
    const wire = JSON.parse(JSON.stringify(first.identity));

    const next = "(define total 10)\n(+ total 2)";
    const second = await host.identifySyntax({
      sourceId: "doc",
      source: next,
      previous: { source, identity: wire },
    });
    expect(second.identity.nodes.map((node) => node.id)).toEqual(
      first.identity.nodes.map((node) => node.id),
    );
  });

  it("reports parse errors as diagnostics without failing", async () => {
    const result = await host.identifySyntax({ sourceId: "broken", source: '(f "abc' });
    expect(result.identity.nodes.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]).toMatchObject({
      phase: "parse",
      severity: "error",
      span: { sourceId: "broken" },
    });
  });

  it("observes one-shot evaluations within limits", async () => {
    const numbers = `[${Array.from({ length: 30 }, (_, index) => index).join(" ")}]`;
    const source = `(define xs ${numbers})\n(map (fn [x] (* x 2)) xs)`;
    const result = await host.evaluate({
      sourceId: "doc",
      source,
      observe: { maxItems: 3, maxStringLength: 10 },
    });
    expect(result.diagnostics).toEqual([]);
    const observations = result.observations!;
    expect(observations.limits).toEqual({
      maxRecords: 5000,
      maxItems: 3,
      maxDepth: 4,
      maxStringLength: 10,
    });
    const body = observations.records.find(
      (record) => source.slice(record.span.startOffset, record.span.endOffset) === "(* x 2)",
    )!;
    expect(body).toMatchObject({ count: 30, value: { kind: "int", value: 58 }, span: { sourceId: "doc" } });
    const xs = observations.records.find(
      (record) => source.slice(record.span.startOffset, record.span.endOffset) === numbers,
    )!;
    expect(xs.value).toEqual({
      kind: "list",
      items: [
        { kind: "int", value: 0 },
        { kind: "int", value: 1 },
        { kind: "int", value: 2 },
        { kind: "opaque", tag: "truncated", display: "… 27 more" },
      ],
    });
    expect(JSON.parse(JSON.stringify(observations))).toEqual(observations);
  });

  it("returns observations with a failed evaluation", async () => {
    const result = await host.evaluate({
      sourceId: "doc",
      source: '(define n 1)\n(+ n "x")',
      observe: {},
    });
    expect(result.diagnostics).toHaveLength(1);
    const failed = result.observations!.records.find((record) => record.failure);
    expect(failed).toMatchObject({ count: 0, failure: { phase: "evaluate" } });
    expect(result.observations!.records.some((record) => record.value?.kind === "int")).toBe(true);
  });

  it("retains observed values in a session", async () => {
    const { sessionId } = await host.openSession();
    const state = await host.evaluateInSession({
      sessionId,
      source: "(define m {:a [1 2]})\n(get m :a)",
      observe: {},
      retainValues: "all",
    });
    expect(state.status).toBe("completed");
    if (state.status !== "completed") return;
    const record = state.result.observations!.records.find(
      (candidate) => candidate.value?.kind === "map",
    )!;
    expect(record.value?.valueRef).toMatch(/^ts-value-/);
    const projected = await host.projectValue({
      sessionId,
      valueRef: record.value!.valueRef!,
      projections: ["plain-json"],
    });
    expect(projected.plainJson).toEqual({ ":a": [1, 2] });
    await host.closeSession({ sessionId });
  });

  it("observes session evaluations that call host builtins", async () => {
    const { sessionId } = await host.openSession();
    await host.configureSession({
      sessionId,
      hostBuiltins: [
        { name: "fetch-score", arity: 1, handler: { kind: "host-effect", effect: "score" } },
      ],
    });
    const first = await host.evaluateInSession({
      sessionId,
      source: "(+ 1 (fetch-score :alice))",
      observe: {},
    });
    expect(first.status).toBe("host-call");
    if (first.status !== "host-call") return;
    const done = await host.resumeHostCall({
      sessionId,
      evaluationId: first.call.evaluationId,
      callId: first.call.callId,
      result: { ok: true, value: { kind: "int", value: 41 } },
    });
    expect(done.status).toBe("completed");
    if (done.status !== "completed") return;
    expect(done.result.value).toEqual({ kind: "int", value: 42 });
    expect(done.result.observations!.records.map((record) => record.value)).toContainEqual({
      kind: "int",
      value: 41,
    });
    await host.closeSession({ sessionId });
  });

  it("indexes symbols across session sources and finds references", async () => {
    const { sessionId } = await host.openSession();
    await host.loadSource({
      sessionId,
      sourceId: "lib.lisp",
      source: "(define greet [name] name)",
      kind: "prelude",
    });
    const source = "(greet 1)\n(greet 2)";
    const index = await host.symbolIndex({ sessionId, sourceId: "main.lisp", source });
    expect(index.definitions).toContainEqual(
      expect.objectContaining({
        name: "greet",
        kind: "function",
        span: expect.objectContaining({ sourceId: "lib.lisp" }),
      }),
    );
    const references = await host.findReferences({
      sessionId,
      sourceId: "main.lisp",
      source,
      offset: source.lastIndexOf("greet") + 1,
    });
    expect(references.definition).toMatchObject({ name: "greet", key: expect.stringMatching(/^lib\.lisp#/) });
    expect(references.references.map((reference) => reference.span)).toEqual([
      { sourceId: "main.lisp", startOffset: 1, endOffset: 6 },
      { sourceId: "main.lisp", startOffset: 11, endOffset: 16 },
    ]);
    await host.closeSession({ sessionId });
  });

  it("applies edit scripts addressed by node ids", async () => {
    const source = "(workflow onboarding\n  (step a)\n  (step b))";
    const { identity } = await host.identifySyntax({ source });
    const idOf = (text: string) =>
      identity.nodes.find((node) => source.slice(node.span.start, node.span.end) === text)!.id;
    const described = await host.describeNodes({ source, identity, ids: [idOf("(step b)")] });
    expect(described.nodes[0]).toMatchObject({ kind: "List", head: "step", text: "(step b)" });

    const script: EditScript = {
      version: 1,
      description: "Run the steps in parallel",
      ops: [{ op: "wrap", targets: [idOf("(step a)"), idOf("(step b)")], head: "parallel" }],
    };
    const result = await host.applyEditScript({ sourceId: "doc", source, identity, script });
    expect(result).toMatchObject({
      ok: true,
      sourceId: "doc",
      source: "(workflow onboarding\n  (parallel\n    (step a)\n    (step b)))",
      changes: { moved: [idOf("(step a)"), idOf("(step b)")] },
    });

    const rejected = await host.applyEditScript({
      source,
      identity,
      script: { version: 1, ops: [{ op: "delete", target: "missing" }] },
    });
    expect(rejected).toMatchObject({ ok: false, errors: [{ op: 0, code: "edit/unknown-node" }] });

    const schema = (await host.editScriptSchema()) as { definitions: Record<string, unknown> };
    expect(Object.keys(schema.definitions)).toEqual(expect.arrayContaining(["EditScript", "EditOp"]));
  });

  it("reads source as an outline and prints it back", async () => {
    const source = "(defn total [x]\n  ; doubles\n  (* x 2))\n(total 21)\n";
    const read = await host.sourceToOutline({ sourceId: "doc", source });
    expect(read.items.map((item) => [item.text, item.children.map((child) => child.text)])).toEqual([
      ["defn total [x]", ["; doubles", "* x 2"]],
      ["total 21", []],
    ]);
    const unchanged = await host.outlineToSource({
      items: read.items,
      base: { source, identity: read.identity },
    });
    expect(unchanged.source).toBe(source);

    const [definition, call] = read.items;
    const edited = await host.outlineToSource({
      items: [definition!, { ...call!, text: "total 2" }, { id: "new-row", text: "(now)", children: [] }],
      base: { source, identity: read.identity },
    });
    expect(edited.source).toBe("(defn total [x]\n  ; doubles\n  (* x 2))\n(total 2)\n(now)\n");
    expect(edited.rows.map((row) => row.id)).toContain("new-row");
    expect(edited.identity.nodes.some((node) => node.id === call!.id)).toBe(true);
  });

  it("offers slot placeholders for descriptor forms loaded in a session", async () => {
    const { sessionId } = await host.openSession();
    await host.loadSource({
      sessionId,
      sourceId: "workflow.lisp",
      kind: "prelude",
      source: `(type WorkflowIR {:kind "Workflow" :name Symbol :trigger Syntax :steps (Option Syntax)})
(form (workflow name {:keys [trigger steps]})
  :types {:name (Declares Workflow) :trigger Syntax :steps (Option Syntax)}
  :ir WorkflowIR {:kind "Workflow" :name name :trigger trigger :steps steps})`
    });
    const source = "(workflow onboarding\n  :steps verify)";
    const result = await host.formSlots({ sessionId, sourceId: "main", source, offset: source.indexOf("verify") });
    expect(result.form).toMatchObject({ name: "workflow", span: { sourceId: "main", startOffset: 0 } });
    expect(result.activeSlot).toBe("steps");
    expect(result.slots.map((slot) => [slot.placeholder, slot.missing, slot.available])).toEqual([
      ["+ trigger", true, true],
      ["+ steps", false, false],
    ]);
    expect(result.slots[1]!.occurrences[0]!.values[0]!.span).toMatchObject({ sourceId: "main" });
    const none = await host.formSlots({ source: "(+ 1 2)", offset: 1 });
    expect(none.form).toBeUndefined();
    await host.closeSession({ sessionId });
  });
  it("typechecks authored expression holes through the session's form definitions", async () => {
    const {sessionId}=await host.openSession();
    try {
      await host.loadSource({sessionId,sourceId:"predicate-prelude",kind:"prelude",source:`(type PredicateIR {:kind "Predicate" :value RuntimeExpr})
(form (predicate value) :types {:value (Expr Bool)} :ir PredicateIR {:kind "Predicate" :value value})`});
      const result=await host.typecheck({sessionId,sourceId:"bad-predicate",source:'(predicate "wrong")'});
      expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({severity:"error",message:expect.stringContaining("Bool"),span:expect.objectContaining({sourceId:"bad-predicate",startOffset:11,endOffset:18})})]));
    } finally {await host.closeSession({sessionId});}
  });

});
