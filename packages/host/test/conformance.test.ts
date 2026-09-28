import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { JsOcamlLanguageHost, NodeOcamlLanguageHost, TsLanguageHost } from "../src/index.js";
import type { Diagnostic, LanguageHost } from "../src/index.js";

describe("language-host shared ABI", () => {
  const tsHost = new TsLanguageHost();

  async function readyOneShotHosts(): Promise<LanguageHost[]> {
    const hosts: LanguageHost[] = [tsHost];
    const ocamlHost = new NodeOcamlLanguageHost();
    if (await ocamlHost.available()) {
      hosts.push(ocamlHost);
    }
    const jsOcamlHost = new JsOcamlLanguageHost();
    if (await jsOcamlHost.available()) {
      hosts.push(jsOcamlHost);
    }
    return hosts;
  }

  async function readySessionHosts(): Promise<LanguageHost[]> {
    const hosts: LanguageHost[] = [tsHost];
    const ocamlHost = new NodeOcamlLanguageHost();
    if (await ocamlHost.available()) {
      hosts.push(ocamlHost);
    }
    return hosts;
  }

  function expectDiagnosticPhaseAndSource(
    diagnostics: readonly Diagnostic[],
    phase: NonNullable<Diagnostic["phase"]>,
    sourceId: string,
    label: string,
  ): void {
    expect(diagnostics.length, `${label} should report diagnostics`).toBeGreaterThan(0);
    expect(diagnostics[0]).toMatchObject({
      phase,
      severity: "error",
    });
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.span?.sourceId === sourceId || diagnostic.message.includes(sourceId),
      ),
      `${label} should carry source provenance`,
    ).toBe(true);
  }

  function expectNoEngineObjectGraph(value: unknown): void {
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain('"_tag"');
    expect(serialized).not.toContain('"KValue"');
    expect(serialized).not.toContain('"Env"');
    expect(serialized).not.toContain('"SExpr"');
    expect(serialized).not.toContain('"typeString"');
  }

  it("reports unavailable OCaml native artifacts without starting a request", async () => {
    const ocamlHost = new NodeOcamlLanguageHost({
      cliPath: `/tmp/forma-missing-ocaml-${process.pid}/forma_cli.exe`,
    });

    await expect(ocamlHost.available()).resolves.toBe(false);
  });

  it("reports unavailable OCaml JS artifacts without starting a request", async () => {
    const jsOcamlHost = new JsOcamlLanguageHost({
      jsPath: `/tmp/forma-missing-ocaml-js-${process.pid}/jsoo_entry.cjs`,
    });

    await expect(jsOcamlHost.available()).resolves.toBe(false);
  });

  it("fails OCaml JS one-shot requests clearly when the JS artifact is missing", async () => {
    const missingPath = `/tmp/forma-missing-ocaml-js-${process.pid}/jsoo_entry.cjs`;
    const jsOcamlHost = new JsOcamlLanguageHost({ jsPath: missingPath });

    await expect(jsOcamlHost.version()).rejects.toThrow(
      `Missing OCaml JS language artifact at ${missingPath}`,
    );
  });

  it("fails OCaml one-shot requests clearly when the native artifact is missing", async () => {
    const missingPath = `/tmp/forma-missing-ocaml-${process.pid}/forma_cli.exe`;
    const ocamlHost = new NodeOcamlLanguageHost({ cliPath: missingPath });

    await expect(ocamlHost.version()).rejects.toThrow(
      `Missing OCaml language CLI at ${missingPath}`,
    );
  });

  it("fails OCaml daemon session startup clearly when the native artifact is missing", async () => {
    const missingPath = `/tmp/forma-missing-ocaml-${process.pid}/forma_cli.exe`;
    const ocamlHost = new NodeOcamlLanguageHost({ cliPath: missingPath });

    await expect(ocamlHost.openSession()).rejects.toThrow(
      `Missing OCaml language CLI at ${missingPath}`,
    );
  });

  it("preserves OCaml daemon startup diagnostics when the daemon exits before responding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forma-ocaml-daemon-exit-"));
    const cliPath = join(dir, "forma_cli.exe");
    await writeFile(
      cliPath,
      '#!/usr/bin/env sh\nif [ "$1" = "daemon" ]; then\n  echo \'daemon exploded\' >&2\n  exit 42\nfi\nprintf \'{"ok":true,"value":{}}\\n\'\n',
    );
    await chmod(cliPath, 0o755);

    const ocamlHost = new NodeOcamlLanguageHost({ cliPath });

    await expect(ocamlHost.openSession()).rejects.toThrow(
      "OCaml openSession failed: OCaml language daemon exited with code 42: daemon exploded",
    );
  });

  it("restarts the OCaml daemon after a startup crash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forma-ocaml-daemon-restart-"));
    const cliPath = join(dir, "forma_cli.exe");
    const markerPath = join(dir, "already-failed");
    await writeFile(
      cliPath,
      `#!/usr/bin/env sh
if [ "$1" = "daemon" ]; then
  if [ ! -f "${markerPath}" ]; then
    touch "${markerPath}"
    echo 'daemon exploded once' >&2
    exit 42
  fi
  IFS= read -r _line
  printf '{"ok":true,"value":{"sessionId":"recovered-session"}}\\n'
  exit 0
fi
printf '{"ok":true,"value":{}}\\n'
`,
    );
    await chmod(cliPath, 0o755);

    const ocamlHost = new NodeOcamlLanguageHost({ cliPath });

    await expect(ocamlHost.openSession()).rejects.toThrow("daemon exploded once");
    await expect(ocamlHost.openSession()).resolves.toEqual({ sessionId: "recovered-session" });
  });

  it("restarts the OCaml daemon after a timed-out request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forma-ocaml-daemon-timeout-"));
    const cliPath = join(dir, "forma_cli.exe");
    const markerPath = join(dir, "already-timed-out");
    await writeFile(
      cliPath,
      `#!/usr/bin/env sh
if [ "$1" = "daemon" ]; then
  if [ ! -f "${markerPath}" ]; then
    touch "${markerPath}"
    IFS= read -r _line
    sleep 10
    exit 0
  fi
  IFS= read -r _line
  printf '{"ok":true,"value":{"sessionId":"recovered-after-timeout"}}\\n'
  exit 0
fi
printf '{"ok":true,"value":{}}\\n'
`,
    );
    await chmod(cliPath, 0o755);

    const ocamlHost = new NodeOcamlLanguageHost({
      cliPath,
      daemonRequestTimeoutMs: 500,
    });

    await expect(ocamlHost.openSession()).rejects.toThrow(
      "Timed out waiting for OCaml daemon response",
    );
    await expect(ocamlHost.openSession()).resolves.toEqual({
      sessionId: "recovered-after-timeout",
    });
  });

  it("destructively aborts an active OCaml daemon evaluation by evaluation id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forma-ocaml-active-abort-"));
    const cliPath = join(dir, "forma_cli.exe");
    await writeFile(
      cliPath,
      `#!/usr/bin/env sh
if [ "$1" = "daemon" ]; then
  while IFS= read -r line; do
    case "$line" in
      *'"op":"openSession"'*)
        printf '{"ok":true,"value":{"sessionId":"abort-session"}}\\n'
        ;;
      *'"op":"replSubmit"'*)
        sleep 10
        printf '{"ok":true,"value":{"value":{"kind":"int","value":3},"formCount":1}}\\n'
        ;;
      *)
        printf '{"ok":true,"value":null}\\n'
        ;;
    esac
  done
  exit 0
fi
printf '{"ok":true,"value":{}}\\n'
`,
    );
    await chmod(cliPath, 0o755);

    const ocamlHost = new NodeOcamlLanguageHost({
      cliPath,
      daemonRequestTimeoutMs: 5_000,
    });

    const { sessionId } = await ocamlHost.openSession();
    const evaluation = ocamlHost.evaluateInSession({
      sessionId,
      evaluationId: "active-eval",
      source: "(+ 1 2)",
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    await expect(
      ocamlHost.abortEvaluation({
        sessionId,
        evaluationId: "active-eval",
        reason: "test active abort",
      }),
    ).resolves.toEqual({
      evaluationId: "active-eval",
      aborted: true,
    });

    await expect(evaluation).resolves.toMatchObject({
      status: "failed",
      diagnostics: [{ code: "daemon/exit" }],
    });

    await expect(
      ocamlHost.evaluateInSession({
        sessionId,
        source: "(+ 2 3)",
      }),
    ).rejects.toThrow(`Unknown language session: ${sessionId}`);
    await expect(ocamlHost.openSession()).resolves.toEqual({ sessionId: "abort-session" });
  });

  it("declares OCaml abortEvaluation as partial cancellation capability metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "forma-ocaml-version-"));
    const cliPath = join(dir, "forma_cli.exe");
    await writeFile(
      cliPath,
      `#!/usr/bin/env sh
if [ "$1" = "request" ]; then
  printf '{"ok":true,"value":{"engine":"fake-ocaml","version":"test"}}\\n'
  exit 0
fi
exit 1
`,
    );
    await chmod(cliPath, 0o755);

    const ocamlHost = new NodeOcamlLanguageHost({ cliPath });

    await expect(ocamlHost.version()).resolves.toMatchObject({
      capabilities: expect.arrayContaining(["abortEvaluation"]),
      capabilityNotes: [
        {
          capability: "abortEvaluation",
          status: "partial",
          detail: expect.stringContaining("destructively kill active daemon requests"),
        },
      ],
    });
  });

  it("normalizes TS parse output to keyword AST nodes", async () => {
    const result = await tsHost.parse({
      sourceId: "keyword",
      source: "(:required name)",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.ast[0]).toMatchObject({
      kind: "list",
      items: [
        { kind: "keyword", value: ":required" },
        { kind: "symbol", value: "name" },
      ],
    });
  });

  it("normalizes ready-backend diagnostic phases and source provenance", async () => {
    const hosts = await readyOneShotHosts();

    for (const host of hosts) {
      const parseSourceId = `${host.name}-parse-diagnostic`;
      const parsed = await host.parse({
        sourceId: parseSourceId,
        source: "(",
      });
      expectDiagnosticPhaseAndSource(
        parsed.diagnostics,
        "parse",
        parseSourceId,
        `${host.name} parse`,
      );

      const expandSourceId = `${host.name}-expand-diagnostic`;
      const expanded = await host.expand({
        sourceId: expandSourceId,
        source: "(",
      });
      expectDiagnosticPhaseAndSource(
        expanded.diagnostics,
        "expand",
        expandSourceId,
        `${host.name} expand`,
      );

      const typecheckSourceId = `${host.name}-typecheck-diagnostic`;
      const checked = await host.typecheck({
        sourceId: typecheckSourceId,
        source: "(+ 1 2)",
        typePolicy: { defaultBuiltinScheme: "none" },
      });
      expectDiagnosticPhaseAndSource(
        checked.diagnostics,
        "typecheck",
        typecheckSourceId,
        `${host.name} typecheck`,
      );

      const evaluateSourceId = `${host.name}-evaluate-diagnostic`;
      const evaluated = await host.evaluate({
        sourceId: evaluateSourceId,
        source: "(",
      });
      expectDiagnosticPhaseAndSource(
        evaluated.diagnostics,
        "evaluate",
        evaluateSourceId,
        `${host.name} evaluate`,
      );
    }
  });

  it("typechecks through the shared TS-backed contract", async () => {
    const result = await tsHost.typecheck({
      sourceId: "typecheck",
      source: "(+ 1 2)",
      result: "per-expression",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.display).toBe("Number");
    expect(result.expressionTypes).toEqual([
      {
        expressionId: "typecheck:0",
        formIndex: 0,
        display: "Number",
        type: { kind: "display", display: "Number" },
      },
    ]);
  });

  it("applies TS-backed ABI type policy data", async () => {
    const result = await tsHost.typecheck({
      sourceId: "policy",
      source: "?candidate",
      typePolicy: {
        unboundSymbols: [
          {
            match: { kind: "prefix", value: "?" },
            type: { kind: "type", name: "String" },
            reason: "query variables",
          },
        ],
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.display).toBe("String");
  });

  it("applies ready-backend unbound symbol type policies", async () => {
    const hosts = await readyOneShotHosts();

    for (const host of hosts) {
      const result = await host.typecheck({
        sourceId: `${host.name}-policy`,
        source: "?candidate\n$actor",
        result: "per-expression",
        typePolicy: {
          unboundSymbols: [
            {
              match: { kind: "prefix", value: "?" },
              type: { kind: "type", name: "String" },
              reason: "query variables",
            },
            {
              match: { kind: "exact", value: "$actor" },
              type: { kind: "type", name: "String" },
              reason: "runtime actor binding",
            },
          ],
        },
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.expressionTypes).toHaveLength(2);
      expect(result.expressionTypes?.map((item) => item.display)).toEqual([
        expect.any(String),
        expect.any(String),
      ]);
    }
  });

  it("applies TS-backed host builtin type schemes", async () => {
    const result = await tsHost.typecheck({
      sourceId: "host-builtin",
      source: "runtime-value",
      hostBuiltins: [
        {
          name: "runtime-value",
          arity: 0,
          typeScheme: { kind: "type", name: "String" },
          handler: { kind: "host-effect", effect: "runtime/value" },
        },
      ],
      typePolicy: { defaultBuiltinScheme: "none" },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.display).toBe("String");
  });

  it("applies ready-backend host builtin type schemes", async () => {
    const hosts = await readyOneShotHosts();

    for (const host of hosts) {
      await expect(
        host.typecheck({
          sourceId: `${host.name}-host-builtin`,
          source: "(runtime-add 1 2)",
          hostBuiltins: [
            {
              name: "runtime-add",
              arity: 2,
              typeScheme: {
                kind: "function",
                params: [
                  { kind: "type", name: "Int" },
                  { kind: "type", name: "Int" },
                ],
                result: { kind: "type", name: "Int" },
              },
              handler: { kind: "host-effect", effect: "runtime/add" },
            },
          ],
          typePolicy: { defaultBuiltinScheme: "none" },
        }),
      ).resolves.toMatchObject({
        diagnostics: [],
        display: expect.any(String),
      });
    }
  });

  it("applies ready-backend variadic host builtin type schemes", async () => {
    const hosts = await readyOneShotHosts();

    for (const host of hosts) {
      await expect(
        host.typecheck({
          sourceId: `${host.name}-variadic-host-builtin`,
          source: '(runtime-path {:name "Ada"} "name" "first")',
          hostBuiltins: [
            {
              name: "runtime-path",
              arity: { min: 1 },
              typeScheme: {
                kind: "variadic-function",
                params: [{ kind: "any" }],
                rest: { kind: "any" },
                result: { kind: "any" },
              },
              handler: { kind: "host-effect", effect: "runtime/path" },
            },
          ],
          typePolicy: { defaultBuiltinScheme: "none" },
        }),
      ).resolves.toMatchObject({
        diagnostics: [],
        display: expect.any(String),
      });
    }
  });

  it("honors ready-backend default builtin policy", async () => {
    const hosts = await readyOneShotHosts();

    for (const host of hosts) {
      const disabled = await host.typecheck({
        sourceId: `${host.name}-disabled-builtins`,
        source: "(+ 1 2)",
        typePolicy: { defaultBuiltinScheme: "none" },
      });
      expect(disabled.diagnostics.length).toBeGreaterThan(0);

      await expect(
        host.typecheck({
          sourceId: `${host.name}-host-builtin-overrides-disabled`,
          source: "(+ 1 2)",
          hostBuiltins: [
            {
              name: "+",
              arity: 2,
              typeScheme: {
                kind: "function",
                params: [
                  { kind: "type", name: "Int" },
                  { kind: "type", name: "Int" },
                ],
                result: { kind: "type", name: "Int" },
              },
              handler: { kind: "host-effect", effect: "runtime/add" },
            },
          ],
          typePolicy: { defaultBuiltinScheme: "none" },
        }),
      ).resolves.toMatchObject({
        diagnostics: [],
        display: expect.any(String),
      });
    }
  });

  it("returns ready-backend per-expression type projections", async () => {
    const hosts = await readyOneShotHosts();

    for (const host of hosts) {
      const result = await host.typecheck({
        sourceId: `${host.name}-per-expression`,
        source: "(+ 1 2)\n(+ 3 4)",
        result: "per-expression",
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.expressionTypes).toHaveLength(2);
      expect(result.expressionTypes?.map((item) => item.formIndex)).toEqual([0, 1]);
      expect(result.expressionTypes?.map((item) => item.display)).toEqual([
        expect.any(String),
        expect.any(String),
      ]);
    }
  });

  it("evaluates through the shared TS-backed contract", async () => {
    const result = await tsHost.evaluate({
      sourceId: "evaluate",
      source: "(+ 1 2)",
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.value).toEqual({ kind: "int", value: 3 });
    expect(result.printed).toBe("3");
  });

  it("evaluates loaded source through a TS-backed session", async () => {
    const { sessionId } = await tsHost.openSession({ defaultStepLimit: 500 });

    await expect(
      tsHost.configureSession({
        sessionId,
        variables: [{ name: "x", value: { kind: "int", value: 4 } }],
      }),
    ).resolves.toMatchObject({
      sessionId,
      bindingCount: 1,
    });
    await expect(
      tsHost.loadSource({
        sessionId,
        sourceId: "session-source",
        source: "(+ x 3)",
      }),
    ).resolves.toMatchObject({
      sourceId: "session-source",
      formCount: 1,
      diagnostics: [],
    });

    const state = await tsHost.evaluateInSession({
      sessionId,
      sourceId: "session-source",
    });
    expect(state).toMatchObject({
      status: "completed",
      result: {
        value: { kind: "int", value: 7 },
        diagnostics: [],
      },
    });

    await expect(tsHost.closeSession({ sessionId })).resolves.toEqual({
      sessionId,
      closed: true,
    });
  });

  it("typechecks TS-backed session bindings introduced by prior evaluation", async () => {
    const { sessionId } = await tsHost.openSession({ defaultStepLimit: 500 });

    const defineState = await tsHost.evaluateInSession({
      sessionId,
      source: '(define gatewaySessionValue "persisted") gatewaySessionValue',
    });
    expect(defineState).toMatchObject({
      status: "completed",
      result: {
        value: { kind: "string", value: "persisted" },
        diagnostics: [],
      },
    });

    const typecheck = await tsHost.typecheck({
      sessionId,
      source: "gatewaySessionValue",
    });
    expect(typecheck.diagnostics).toEqual([]);

    const reuseState = await tsHost.evaluateInSession({
      sessionId,
      source: "gatewaySessionValue",
    });
    expect(reuseState).toMatchObject({
      status: "completed",
      result: {
        value: { kind: "string", value: "persisted" },
        diagnostics: [],
      },
    });

    await tsHost.closeSession({ sessionId });
  });

  it("pauses and resumes TS-backed session evaluation for declarative host builtins", async () => {
    const { sessionId } = await tsHost.openSession({ defaultStepLimit: 500 });
    try {
      await tsHost.configureSession({
        sessionId,
        hostBuiltins: [
          {
            name: "host-add",
            arity: 2,
            handler: { kind: "host-effect", effect: "test/add" },
          },
          {
            name: "host-label",
            arity: 1,
            handler: { kind: "host-effect", effect: "test/label" },
          },
        ],
      });

      const first = await tsHost.evaluateInSession({
        sessionId,
        source: "(host-label (host-add 2 3))",
      });

      expect(first).toEqual({
        status: "host-call",
        call: {
          evaluationId: expect.any(String),
          callId: expect.any(String),
          effect: "test/add",
          name: "host-add",
          args: [
            { kind: "int", value: 2 },
            { kind: "int", value: 3 },
          ],
        },
      });
      if (first.status !== "host-call") throw new Error("expected first host call");

      const second = await tsHost.resumeHostCall({
        sessionId,
        evaluationId: first.call.evaluationId,
        callId: first.call.callId,
        result: { ok: true, value: { kind: "int", value: 5 } },
      });

      expect(second).toEqual({
        status: "host-call",
        call: {
          evaluationId: first.call.evaluationId,
          callId: expect.any(String),
          effect: "test/label",
          name: "host-label",
          args: [{ kind: "int", value: 5 }],
        },
      });
      if (second.status !== "host-call") throw new Error("expected second host call");

      const completed = await tsHost.resumeHostCall({
        sessionId,
        evaluationId: second.call.evaluationId,
        callId: second.call.callId,
        result: { ok: true, value: { kind: "string", value: "sum=5" } },
      });

      expect(completed).toMatchObject({
        status: "completed",
        result: {
          value: { kind: "string", value: "sum=5" },
          printed: '"sum=5"',
          diagnostics: [],
        },
      });
    } finally {
      await tsHost.closeSession({ sessionId });
    }
  });

  it("pauses and resumes OCaml session evaluation for first-order declarative host builtins", async () => {
    const ocamlHost = new NodeOcamlLanguageHost();
    if (!(await ocamlHost.available())) return;

    const { sessionId } = await ocamlHost.openSession({ defaultStepLimit: 500 });
    try {
      await ocamlHost.configureSession({
        sessionId,
        hostBuiltins: [
          {
            name: "host-add",
            arity: 2,
            handler: { kind: "host-effect", effect: "test/add" },
          },
          {
            name: "host-label",
            arity: 1,
            handler: { kind: "host-effect", effect: "test/label" },
          },
        ],
      });

      const first = await ocamlHost.evaluateInSession({
        sessionId,
        source: "(host-label (host-add 2 3))",
      });

      expect(first).toEqual({
        status: "host-call",
        call: {
          evaluationId: expect.any(String),
          callId: expect.any(String),
          effect: "test/add",
          name: "host-add",
          args: [
            { kind: "int", value: 2 },
            { kind: "int", value: 3 },
          ],
        },
      });
      if (first.status !== "host-call") throw new Error("expected first host call");

      const second = await ocamlHost.resumeHostCall({
        sessionId,
        evaluationId: first.call.evaluationId,
        callId: first.call.callId,
        result: { ok: true, value: { kind: "int", value: 5 } },
      });

      expect(second).toEqual({
        status: "host-call",
        call: {
          evaluationId: first.call.evaluationId,
          callId: expect.any(String),
          effect: "test/label",
          name: "host-label",
          args: [{ kind: "int", value: 5 }],
        },
      });
      if (second.status !== "host-call") throw new Error("expected second host call");

      const completed = await ocamlHost.resumeHostCall({
        sessionId,
        evaluationId: second.call.evaluationId,
        callId: second.call.callId,
        result: { ok: true, value: { kind: "string", value: "sum=5" } },
      });

      expect(completed).toMatchObject({
        status: "completed",
        result: {
          value: { kind: "string", value: "sum=5" },
          diagnostics: [],
        },
      });
    } finally {
      await ocamlHost.closeSession({ sessionId });
    }
  });

  it("aborts and releases a retained OCaml host-call evaluation", async () => {
    const ocamlHost = new NodeOcamlLanguageHost();
    if (!(await ocamlHost.available())) return;

    const { sessionId } = await ocamlHost.openSession({ defaultStepLimit: 500 });
    try {
      await ocamlHost.configureSession({
        sessionId,
        hostBuiltins: [
          {
            name: "host-block",
            arity: 0,
            handler: { kind: "host-effect", effect: "test/block" },
          },
        ],
      });

      const paused = await ocamlHost.evaluateInSession({
        sessionId,
        source: "(host-block)",
      });
      expect(paused).toMatchObject({
        status: "host-call",
        call: { effect: "test/block", name: "host-block" },
      });
      if (paused.status !== "host-call") throw new Error("expected host call");

      await expect(
        ocamlHost.abortEvaluation({
          sessionId,
          evaluationId: paused.call.evaluationId,
          reason: "test abort",
        }),
      ).resolves.toEqual({
        evaluationId: paused.call.evaluationId,
        aborted: true,
      });

      await expect(
        ocamlHost.resumeHostCall({
          sessionId,
          evaluationId: paused.call.evaluationId,
          callId: paused.call.callId,
          result: { ok: true, value: { kind: "nil" } },
        }),
      ).resolves.toMatchObject({
        status: "failed",
        diagnostics: [{ code: "evaluation/not-found" }],
      });
    } finally {
      await ocamlHost.closeSession({ sessionId });
    }
  });

  it("fails a retained TS-backed evaluation when a host-call resume fails", async () => {
    const { sessionId } = await tsHost.openSession({ defaultStepLimit: 500 });
    try {
      await tsHost.configureSession({
        sessionId,
        hostBuiltins: [
          {
            name: "host-fail",
            arity: 0,
            handler: { kind: "host-effect", effect: "test/fail" },
          },
        ],
      });

      const paused = await tsHost.evaluateInSession({
        sessionId,
        source: "(host-fail)",
      });
      expect(paused).toMatchObject({
        status: "host-call",
        call: { effect: "test/fail", name: "host-fail" },
      });
      if (paused.status !== "host-call") throw new Error("expected host call");

      const failed = await tsHost.resumeHostCall({
        sessionId,
        evaluationId: paused.call.evaluationId,
        callId: paused.call.callId,
        result: {
          ok: false,
          diagnostics: [
            {
              code: "test/failed",
              severity: "error",
              message: "host failure",
              phase: "host-effect",
            },
          ],
        },
      });

      expect(failed).toMatchObject({
        status: "failed",
        diagnostics: [{ code: "KernelTypeError", message: "host failure" }],
      });
    } finally {
      await tsHost.closeSession({ sessionId });
    }
  });

  it("fails a retained OCaml evaluation with host-provided diagnostics when a host-call resume fails", async () => {
    const ocamlHost = new NodeOcamlLanguageHost();
    if (!(await ocamlHost.available())) return;

    const { sessionId } = await ocamlHost.openSession({ defaultStepLimit: 500 });
    try {
      await ocamlHost.configureSession({
        sessionId,
        hostBuiltins: [
          {
            name: "host-fail",
            arity: 0,
            handler: { kind: "host-effect", effect: "test/fail" },
          },
        ],
      });

      const paused = await ocamlHost.evaluateInSession({
        sessionId,
        source: "(host-fail)",
      });
      expect(paused).toMatchObject({
        status: "host-call",
        call: { effect: "test/fail", name: "host-fail" },
      });
      if (paused.status !== "host-call") throw new Error("expected host call");

      const failed = await ocamlHost.resumeHostCall({
        sessionId,
        evaluationId: paused.call.evaluationId,
        callId: paused.call.callId,
        result: {
          ok: false,
          diagnostics: [
            {
              code: "test/failed",
              severity: "error",
              message: "host failure",
              phase: "host-effect",
            },
          ],
        },
      });

      expect(failed).toMatchObject({
        status: "failed",
        diagnostics: [{ code: "test/failed", message: "host failure" }],
      });
    } finally {
      await ocamlHost.closeSession({ sessionId });
    }
  });

  it("aborts and releases a retained TS-backed host-call evaluation", async () => {
    const { sessionId } = await tsHost.openSession({ defaultStepLimit: 500 });
    try {
      await tsHost.configureSession({
        sessionId,
        hostBuiltins: [
          {
            name: "host-block",
            arity: 0,
            handler: { kind: "host-effect", effect: "test/block" },
          },
        ],
      });

      const paused = await tsHost.evaluateInSession({
        sessionId,
        source: "(host-block)",
      });
      expect(paused).toMatchObject({
        status: "host-call",
        call: { effect: "test/block", name: "host-block" },
      });
      if (paused.status !== "host-call") throw new Error("expected host call");

      await expect(
        tsHost.abortEvaluation({
          sessionId,
          evaluationId: paused.call.evaluationId,
          reason: "test abort",
        }),
      ).resolves.toEqual({
        evaluationId: paused.call.evaluationId,
        aborted: true,
      });

      await expect(
        tsHost.resumeHostCall({
          sessionId,
          evaluationId: paused.call.evaluationId,
          callId: paused.call.callId,
          result: { ok: true, value: { kind: "nil" } },
        }),
      ).resolves.toMatchObject({
        status: "failed",
        diagnostics: [{ code: "evaluation/not-found" }],
      });
    } finally {
      await tsHost.closeSession({ sessionId });
    }
  });

  it("retains callable TS values passed to host calls and invokes them through callValue", async () => {
    const { sessionId } = await tsHost.openSession({ defaultStepLimit: 500 });
    try {
      await tsHost.configureSession({
        sessionId,
        hostBuiltins: [
          {
            name: "host-use-fn",
            arity: 1,
            handler: { kind: "host-effect", effect: "test/use-fn" },
          },
        ],
      });

      const paused = await tsHost.evaluateInSession({
        sessionId,
        source: "(host-use-fn (fn [x] (+ x 1)))",
      });
      expect(paused).toMatchObject({
        status: "host-call",
        call: {
          effect: "test/use-fn",
          args: [{ kind: "function", valueRef: expect.any(String) }],
        },
      });
      if (paused.status !== "host-call") throw new Error("expected host call");
      const fnArg = paused.call.args[0];
      if (fnArg?.kind !== "function") throw new Error("expected function ref");

      const called = await tsHost.callValue({
        sessionId,
        valueRef: fnArg.valueRef,
        args: [{ kind: "int", value: 4 }],
      });
      expect(called).toMatchObject({
        status: "completed",
        result: {
          value: { kind: "int", value: 5 },
          printed: "5",
          diagnostics: [],
        },
      });
      if (called.status !== "completed") throw new Error("expected callable result");

      await expect(
        tsHost.releaseValue({
          sessionId,
          valueRefs: [fnArg.valueRef],
        }),
      ).resolves.toEqual({ released: [fnArg.valueRef] });

      await expect(
        tsHost.callValue({
          sessionId,
          valueRef: fnArg.valueRef,
          args: [{ kind: "int", value: 4 }],
        }),
      ).resolves.toMatchObject({
        status: "failed",
        diagnostics: [{ code: "value-ref/not-found" }],
      });

      const completed = await tsHost.resumeHostCall({
        sessionId,
        evaluationId: paused.call.evaluationId,
        callId: paused.call.callId,
        result: { ok: true, value: called.result.value },
      });
      expect(completed).toMatchObject({
        status: "completed",
        result: { value: { kind: "int", value: 5 }, diagnostics: [] },
      });
    } finally {
      await tsHost.closeSession({ sessionId });
    }
  });

  it("retains callable OCaml values passed to host calls and invokes pure callbacks through callValue", async () => {
    const ocamlHost = new NodeOcamlLanguageHost();
    if (!(await ocamlHost.available())) return;

    const { sessionId } = await ocamlHost.openSession({ defaultStepLimit: 500 });
    try {
      await ocamlHost.configureSession({
        sessionId,
        hostBuiltins: [
          {
            name: "host-use-fn",
            arity: 1,
            handler: { kind: "host-effect", effect: "test/use-fn" },
          },
        ],
      });

      const paused = await ocamlHost.evaluateInSession({
        sessionId,
        source: "(host-use-fn (fn [x] (+ x 1)))",
      });
      expect(paused).toMatchObject({
        status: "host-call",
        call: {
          effect: "test/use-fn",
          args: [{ kind: "function", valueRef: expect.any(String) }],
        },
      });
      if (paused.status !== "host-call") throw new Error("expected host call");
      const fnArg = paused.call.args[0];
      if (fnArg?.kind !== "function") throw new Error("expected function ref");

      const called = await ocamlHost.callValue({
        sessionId,
        valueRef: fnArg.valueRef,
        args: [{ kind: "int", value: 4 }],
      });
      expect(called).toMatchObject({
        status: "completed",
        result: {
          value: { kind: "int", value: 5 },
          diagnostics: [],
        },
      });
      if (called.status !== "completed") throw new Error("expected callable result");

      await expect(
        ocamlHost.releaseValue({
          sessionId,
          valueRefs: [fnArg.valueRef],
        }),
      ).resolves.toEqual({ released: [fnArg.valueRef] });

      await expect(
        ocamlHost.callValue({
          sessionId,
          valueRef: fnArg.valueRef,
          args: [{ kind: "int", value: 4 }],
        }),
      ).resolves.toMatchObject({
        status: "failed",
        diagnostics: [{ code: "value-ref/not-found" }],
      });

      const completed = await ocamlHost.resumeHostCall({
        sessionId,
        evaluationId: paused.call.evaluationId,
        callId: paused.call.callId,
        result: { ok: true, value: called.result.value },
      });
      expect(completed).toMatchObject({
        status: "completed",
        result: { value: { kind: "int", value: 5 }, diagnostics: [] },
      });
    } finally {
      await ocamlHost.closeSession({ sessionId });
    }
  });

  it("re-enters OCaml host calls from retained callback arguments", async () => {
    const ocamlHost = new NodeOcamlLanguageHost();
    if (!(await ocamlHost.available())) return;

    const { sessionId } = await ocamlHost.openSession({ defaultStepLimit: 500 });
    try {
      await ocamlHost.configureSession({
        sessionId,
        hostBuiltins: [
          {
            name: "host-use-fn",
            arity: 1,
            handler: { kind: "host-effect", effect: "test/use-fn" },
          },
          {
            name: "host-label",
            arity: 1,
            handler: { kind: "host-effect", effect: "test/label" },
          },
        ],
      });

      const outer = await ocamlHost.evaluateInSession({
        sessionId,
        source: "(host-use-fn (fn [x] (host-label (+ x 1))))",
      });
      expect(outer).toMatchObject({
        status: "host-call",
        call: {
          effect: "test/use-fn",
          args: [{ kind: "function", valueRef: expect.any(String) }],
        },
      });
      if (outer.status !== "host-call") throw new Error("expected outer host call");
      const fnArg = outer.call.args[0];
      if (fnArg?.kind !== "function") throw new Error("expected function ref");

      const nested = await ocamlHost.callValue({
        sessionId,
        valueRef: fnArg.valueRef,
        args: [{ kind: "int", value: 4 }],
      });
      expect(nested).toMatchObject({
        status: "host-call",
        call: {
          effect: "test/label",
          name: "host-label",
          args: [{ kind: "int", value: 5 }],
        },
      });
      if (nested.status !== "host-call") throw new Error("expected nested host call");

      const nestedCompleted = await ocamlHost.resumeHostCall({
        sessionId,
        evaluationId: nested.call.evaluationId,
        callId: nested.call.callId,
        result: { ok: true, value: { kind: "int", value: 9 } },
      });
      expect(nestedCompleted).toMatchObject({
        status: "completed",
        result: { value: { kind: "int", value: 9 }, diagnostics: [] },
      });
      if (nestedCompleted.status !== "completed") {
        throw new Error("expected nested callback completion");
      }

      const outerCompleted = await ocamlHost.resumeHostCall({
        sessionId,
        evaluationId: outer.call.evaluationId,
        callId: outer.call.callId,
        result: { ok: true, value: nestedCompleted.result.value },
      });
      expect(outerCompleted).toMatchObject({
        status: "completed",
        result: { value: { kind: "int", value: 9 }, diagnostics: [] },
      });
    } finally {
      await ocamlHost.closeSession({ sessionId });
    }
  });

  it("retains top-level TS function results and invokes them through callValue", async () => {
    const { sessionId } = await tsHost.openSession({ defaultStepLimit: 500 });
    try {
      const evaluated = await tsHost.evaluateInSession({
        sessionId,
        source: "(fn [x] (+ x 5))",
        retainValues: "functions",
      });
      expect(evaluated).toMatchObject({
        status: "completed",
        result: {
          value: { kind: "function", valueRef: expect.any(String) },
          diagnostics: [],
        },
      });
      if (evaluated.status !== "completed") throw new Error("expected completed result");
      const retained = evaluated.result.value;
      if (retained.kind !== "function") throw new Error("expected function ref");

      await expect(
        tsHost.callValue({
          sessionId,
          valueRef: retained.valueRef,
          args: [{ kind: "int", value: 7 }],
        }),
      ).resolves.toMatchObject({
        status: "completed",
        result: {
          value: { kind: "int", value: 12 },
          printed: "12",
          diagnostics: [],
        },
      });

      await expect(
        tsHost.releaseValue({
          sessionId,
          valueRefs: [retained.valueRef],
        }),
      ).resolves.toEqual({ released: [retained.valueRef] });

      await expect(
        tsHost.callValue({
          sessionId,
          valueRef: retained.valueRef,
          args: [{ kind: "int", value: 7 }],
        }),
      ).resolves.toMatchObject({
        status: "failed",
        diagnostics: [{ code: "value-ref/not-found" }],
      });
    } finally {
      await tsHost.closeSession({ sessionId });
    }
  });

  it("retains evaluator-only TS closures and invokes them through callValue", async () => {
    const { sessionId } = await tsHost.openSession({ defaultStepLimit: 500 });
    try {
      const evaluated = await tsHost.evaluateInSession({
        sessionId,
        source: "(if false (unquote missing) (fn [x] (+ x 2)))",
        retainValues: "functions",
      });
      expect(evaluated).toMatchObject({
        status: "completed",
        result: {
          value: { kind: "function", valueRef: expect.any(String) },
          diagnostics: [],
        },
      });
      if (evaluated.status !== "completed") throw new Error("expected completed result");
      const retained = evaluated.result.value;
      if (retained.kind !== "function") throw new Error("expected function ref");

      await expect(
        tsHost.callValue({
          sessionId,
          valueRef: retained.valueRef,
          args: [{ kind: "int", value: 8 }],
        }),
      ).resolves.toMatchObject({
        status: "completed",
        result: {
          value: { kind: "int", value: 10 },
          printed: "10",
          diagnostics: [],
        },
      });
    } finally {
      await tsHost.closeSession({ sessionId });
    }
  });

  it("retains opaque TS values and projects them by valueRef", async () => {
    const { sessionId } = await tsHost.openSession({ defaultStepLimit: 500 });
    try {
      const evaluated = await tsHost.evaluateInSession({
        sessionId,
        source: "`(+ 1 2)",
        retainValues: "all",
      });
      expect(evaluated).toMatchObject({
        status: "completed",
        result: {
          value: {
            kind: "opaque",
            tag: "sexpr",
            valueRef: expect.any(String),
            display: "(+ 1 2)",
          },
          diagnostics: [],
        },
      });
      if (evaluated.status !== "completed") throw new Error("expected completed result");
      const retained = evaluated.result.value;
      if (retained.kind !== "opaque" || !retained.valueRef) {
        throw new Error("expected opaque value ref");
      }

      await expect(
        tsHost.projectValue({
          sessionId,
          valueRef: retained.valueRef,
          projections: ["printed", "plain-json", "truthy", "summary"],
        }),
      ).resolves.toMatchObject({
        value: {
          kind: "opaque",
          tag: "sexpr",
          valueRef: retained.valueRef,
          display: "(+ 1 2)",
        },
        printed: "(+ 1 2)",
        plainJson: {
          kind: "opaque",
          tag: "sexpr",
          valueRef: retained.valueRef,
          display: "(+ 1 2)",
        },
        truthy: true,
        summary: { kind: "opaque" },
        diagnostics: [],
      });

      await expect(
        tsHost.releaseValue({
          sessionId,
          valueRefs: [retained.valueRef],
        }),
      ).resolves.toEqual({ released: [retained.valueRef] });
    } finally {
      await tsHost.closeSession({ sessionId });
    }
  });

  it("surfaces nested TS host calls from retained callable refs", async () => {
    const { sessionId } = await tsHost.openSession({ defaultStepLimit: 500 });
    try {
      await tsHost.configureSession({
        sessionId,
        hostBuiltins: [
          {
            name: "host-use-fn",
            arity: 1,
            handler: { kind: "host-effect", effect: "test/use-fn" },
          },
          {
            name: "host-label",
            arity: 1,
            handler: { kind: "host-effect", effect: "test/label" },
          },
        ],
      });

      const outer = await tsHost.evaluateInSession({
        sessionId,
        source: "(host-use-fn (fn [x] (host-label x)))",
      });
      expect(outer).toMatchObject({
        status: "host-call",
        call: {
          effect: "test/use-fn",
          args: [{ kind: "function", valueRef: expect.any(String) }],
        },
      });
      if (outer.status !== "host-call") throw new Error("expected outer host call");
      const fnArg = outer.call.args[0];
      if (fnArg?.kind !== "function") throw new Error("expected function ref");

      const nested = await tsHost.callValue({
        sessionId,
        valueRef: fnArg.valueRef,
        args: [{ kind: "int", value: 9 }],
      });
      expect(nested).toMatchObject({
        status: "host-call",
        call: {
          evaluationId: expect.any(String),
          effect: "test/label",
          name: "host-label",
          args: [{ kind: "int", value: 9 }],
        },
      });
      if (nested.status !== "host-call") throw new Error("expected nested host call");
      expect(nested.call.evaluationId).not.toBe(outer.call.evaluationId);

      const nestedCompleted = await tsHost.resumeHostCall({
        sessionId,
        evaluationId: nested.call.evaluationId,
        callId: nested.call.callId,
        result: { ok: true, value: { kind: "string", value: "labeled-9" } },
      });
      expect(nestedCompleted).toMatchObject({
        status: "completed",
        result: {
          value: { kind: "string", value: "labeled-9" },
          diagnostics: [],
        },
      });
      if (nestedCompleted.status !== "completed") throw new Error("expected nested completion");

      const outerCompleted = await tsHost.resumeHostCall({
        sessionId,
        evaluationId: outer.call.evaluationId,
        callId: outer.call.callId,
        result: { ok: true, value: nestedCompleted.result.value },
      });
      expect(outerCompleted).toMatchObject({
        status: "completed",
        result: {
          value: { kind: "string", value: "labeled-9" },
          diagnostics: [],
        },
      });
    } finally {
      await tsHost.closeSession({ sessionId });
    }
  });

  it("projects inline values through ready backends without exposing engine helpers", async () => {
    const hosts = await readyOneShotHosts();

    for (const host of hosts) {
      const version = await host.version();
      const result = await host.projectValue({
        value: {
          kind: "map",
          entries: [{ key: { kind: "string", value: "count" }, value: { kind: "int", value: 2 } }],
        },
        projections: ["plain-json", "printed", "truthy", "summary"],
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.plainJson).toEqual({ count: 2 });
      expect(result.printed).toBe('{"count" 2}');
      expect(result.truthy).toBe(true);
      expect(result.summary).toEqual({ kind: "map", size: 1 });
      expectNoEngineObjectGraph(result);

      await expect(
        host.projectValue({
          valueRef: "missing",
          projections: ["summary"],
        }),
      ).resolves.toMatchObject({
        diagnostics: [
          {
            code: version.capabilities.includes("openSession")
              ? "session/required"
              : "value-ref/unsupported",
          },
        ],
      });

      if (!version.capabilities.includes("openSession")) continue;
      const { sessionId } = await host.openSession();
      try {
        await expect(
          host.releaseValue({
            sessionId,
            valueRefs: ["missing"],
          }),
        ).resolves.toEqual({ released: [] });
      } finally {
        await host.closeSession({ sessionId });
      }
    }
  });

  it("retains completed values by ref through ready backends", async () => {
    const hosts = await readySessionHosts();

    for (const host of hosts) {
      const { sessionId } = await host.openSession({ defaultStepLimit: 500 });
      try {
        const evaluated = await host.evaluateInSession({
          sessionId,
          source: "(+ 1 2)",
          retainValues: "all",
        });
        expectNoEngineObjectGraph(evaluated);
        expect(evaluated).toMatchObject({
          status: "completed",
          result: {
            value: { kind: "int", value: 3, valueRef: expect.any(String) },
            diagnostics: [],
          },
        });
        if (evaluated.status !== "completed") throw new Error("expected completed result");
        const retained = evaluated.result.value;
        if (!retained.valueRef) throw new Error("expected retained value ref");

        await expect(
          host.projectValue({
            sessionId,
            valueRef: retained.valueRef,
            projections: ["printed", "plain-json", "truthy", "summary"],
          }),
        ).resolves.toMatchObject({
          value: { kind: "int", value: 3, valueRef: retained.valueRef },
          printed: "3",
          plainJson: 3,
          truthy: true,
          summary: { kind: "int" },
          diagnostics: [],
        });

        await expect(
          host.releaseValue({
            sessionId,
            valueRefs: [retained.valueRef],
          }),
        ).resolves.toEqual({ released: [retained.valueRef] });

        await expect(
          host.projectValue({
            sessionId,
            valueRef: retained.valueRef,
            projections: ["summary"],
          }),
        ).resolves.toMatchObject({
          diagnostics: [{ code: "value-ref/not-found" }],
        });
      } finally {
        await host.closeSession({ sessionId });
      }
    }
  });

  it("retains pure top-level function results through ready backends", async () => {
    const hosts = await readySessionHosts();

    for (const host of hosts) {
      const { sessionId } = await host.openSession({ defaultStepLimit: 500 });
      try {
        const evaluated = await host.evaluateInSession({
          sessionId,
          source: "(fn [x] (+ x 6))",
          retainValues: "functions",
        });
        expect(evaluated).toMatchObject({
          status: "completed",
          result: {
            value: { kind: "function", valueRef: expect.any(String) },
            diagnostics: [],
          },
        });
        if (evaluated.status !== "completed") throw new Error("expected completed result");
        const retained = evaluated.result.value;
        if (retained.kind !== "function") throw new Error("expected function ref");

        await expect(
          host.callValue({
            sessionId,
            valueRef: retained.valueRef,
            args: [{ kind: "int", value: 4 }],
          }),
        ).resolves.toMatchObject({
          status: "completed",
          result: {
            value: { kind: "int", value: 10 },
            diagnostics: [],
          },
        });

        await expect(
          host.releaseValue({
            sessionId,
            valueRefs: [retained.valueRef],
          }),
        ).resolves.toEqual({ released: [retained.valueRef] });

        await expect(
          host.callValue({
            sessionId,
            valueRef: retained.valueRef,
            args: [{ kind: "int", value: 4 }],
          }),
        ).resolves.toMatchObject({
          status: "failed",
          diagnostics: [{ code: "value-ref/not-found" }],
        });
      } finally {
        await host.closeSession({ sessionId });
      }
    }
  });

  it("exposes resumable evaluation entry points with explicit ready-backend diagnostics", async () => {
    const hosts = await readySessionHosts();

    for (const host of hosts) {
      const { sessionId } = await host.openSession();
      try {
        await expect(
          host.callValue({
            sessionId,
            valueRef: "missing",
            args: [],
          }),
        ).resolves.toMatchObject({
          status: "failed",
          diagnostics: [{ code: "value-ref/not-found" }],
        });

        const missingResume = await host.resumeHostCall({
          sessionId,
          evaluationId: "eval-1",
          callId: "call-1",
          result: { ok: true, value: { kind: "nil" } },
        });
        expect(missingResume).toMatchObject({
          status: "failed",
          diagnostics: [{ code: "evaluation/not-found" }],
        });

        await expect(
          host.abortEvaluation({
            sessionId,
            evaluationId: "eval-1",
          }),
        ).resolves.toEqual({
          evaluationId: "eval-1",
          aborted: true,
        });
      } finally {
        await host.closeSession({ sessionId });
      }
    }
  });

  it("projects editor analysis or explicit unsupported diagnostics without exposing TS LSP objects", async () => {
    const result = await tsHost.analyzeEditor({
      sourceId: "editor",
      source: "(+ 1 2)",
    });

    expect(result.success).toBe(true);
    expect(result.resultTypeDisplay).toBe("Number");
    expect(result.errors).toEqual([]);
    expect(result.parse.redTree).toMatchObject({
      kind: "Root",
      span: { sourceId: "editor" },
    });
    expect(result.typedSpans.length).toBeGreaterThan(0);
    expect(result.typedSpans[0]).toMatchObject({
      display: expect.any(String),
      type: { kind: expect.any(String), display: expect.any(String) },
      span: { sourceId: "editor" },
    });
    expect(result.typedSpans[0]).not.toHaveProperty("typeString");

    for (const host of [new NodeOcamlLanguageHost(), new JsOcamlLanguageHost()]) {
      await expect(
        host.analyzeEditor({
          sourceId: `${host.name}-editor`,
          source: "(+ 1 2)",
        }),
      ).resolves.toMatchObject({
        sourceId: `${host.name}-editor`,
        success: false,
        typedSpans: [],
        diagnostics: [
          {
            code: "editor/unsupported",
            phase: "typecheck",
            severity: "error",
          },
        ],
        parse: {
          greenTree: null,
          redTree: null,
        },
      });
    }
  });

  it("can run one-shot conformance for current TS, native OCaml, and JS OCaml operations", async () => {
    const hosts = await readyOneShotHosts();

    for (const host of hosts) {
      const version = await host.version();
      expect(version).toMatchObject({
        hostAbiVersion: "0.1.0",
        capabilities: expect.arrayContaining(["parse", "expand", "typecheck", "projectValue"]),
        sourceLoadSemantics: host.name === "ts" ? "parse-and-store" : host.name === "ocaml-native" ? "apply-declarations" : "unsupported",
      });
      for (const note of version.capabilityNotes ?? []) {
        if (host.name === "ocaml-js" && note.capability === "openSession") {
          expect(note.status).toBe("unsupported");
          continue;
        }
        expect(
          version.capabilities,
          `${host.name} note must reference an advertised capability`,
        ).toContain(note.capability);
      }

      await expect(
        host.parse({
          sourceId: `${host.name}-parse`,
          source: "(+ 1 2)",
        }),
      ).resolves.toMatchObject({
        diagnostics: [],
        ast: [{ kind: "list" }],
      });
      await expect(
        host.typecheck({
          sourceId: `${host.name}-typecheck`,
          source: "(+ 1 2)",
        }),
      ).resolves.toMatchObject({
        diagnostics: [],
      });
      await expect(
        host.expand({
          sourceId: `${host.name}-expand`,
          source: "(+ 1 2)",
        }),
      ).resolves.toMatchObject({
        diagnostics: [],
        ast: [{ kind: "list" }],
      });
      await expect(
        host.evaluate({
          sourceId: `${host.name}-evaluate`,
          source: "(+ 1 2)",
        }),
      ).resolves.toMatchObject({
        diagnostics: [],
        value: { kind: "int", value: 3 },
      });
    }
  });

  it("can run common ready-backend conformance for current operations", async () => {
    const hosts = await readySessionHosts();

    for (const host of hosts) {
      const version = await host.version();
      expect(version).toMatchObject({
        hostAbiVersion: "0.1.0",
        capabilities: expect.arrayContaining(["parse", "expand", "typecheck", "projectValue"]),
        sourceLoadSemantics: host.name === "ts" ? "parse-and-store" : "apply-declarations",
      });
      for (const note of version.capabilityNotes ?? []) {
        expect(
          version.capabilities,
          `${host.name} note must reference an advertised capability`,
        ).toContain(note.capability);
      }
      if (host.name === "ocaml-native") {
        expect(version.capabilityNotes).toEqual([
          {
            capability: "abortEvaluation",
            status: "partial",
            detail: expect.stringContaining("destructively kill active daemon requests"),
          },
        ]);
      } else {
        expect(version.capabilityNotes).toBeUndefined();
      }
      await expect(
        host.parse({
          sourceId: `${host.name}-parse`,
          source: "(+ 1 2)",
        }),
      ).resolves.toMatchObject({
        diagnostics: [],
        ast: [{ kind: "list" }],
      });
      await expect(
        host.typecheck({
          sourceId: `${host.name}-typecheck`,
          source: "(+ 1 2)",
        }),
      ).resolves.toMatchObject({
        diagnostics: [],
      });
      await expect(
        host.expand({
          sourceId: `${host.name}-expand`,
          source: "(+ 1 2)",
        }),
      ).resolves.toMatchObject({
        diagnostics: [],
        ast: [{ kind: "list" }],
      });

      const { sessionId } = await host.openSession();
      try {
        await expect(
          host.evaluateInSession({
            sessionId,
            sourceId: `${host.name}-session-eval`,
            source: "(+ 1 2)",
          }),
        ).resolves.toMatchObject({
          status: "completed",
          result: {
            diagnostics: [],
            value: { kind: "int", value: 3 },
          },
        });
      } finally {
        await host.closeSession({ sessionId });
      }
    }
  });

  it("loads source bundles through ready backends", async () => {
    const hosts = await readySessionHosts();

    for (const host of hosts) {
      const { sessionId } = await host.openSession();
      try {
        await expect(
          host.loadSourceBundle({
            sessionId,
            sources: [
              {
                sourceId: `${host.name}-bundle-a`,
                source: "(+ 1 2)",
              },
              {
                sourceId: `${host.name}-bundle-b`,
                source: "(+ 3 4)",
              },
            ],
          }),
        ).resolves.toMatchObject({
          diagnostics: [],
          sources: [
            {
              sourceId: `${host.name}-bundle-a`,
              formCount: 1,
              diagnostics: [],
            },
            {
              sourceId: `${host.name}-bundle-b`,
              formCount: 1,
              diagnostics: [],
            },
          ],
        });
        await expect(
          host.typecheck({
            sessionId,
            sourceId: `${host.name}-bundle-a`,
          }),
        ).resolves.toMatchObject({
          diagnostics: [],
          display: expect.any(String),
        });
      } finally {
        await host.closeSession({ sessionId });
      }
    }
  });

  it("expands and typechecks loaded session sources through ready backends", async () => {
    const hosts = await readySessionHosts();

    for (const host of hosts) {
      const sourceId = `${host.name}-loaded-source`;
      const { sessionId } = await host.openSession();
      try {
        await expect(
          host.loadSource({
            sessionId,
            sourceId,
            source: "(+ 1 2)",
          }),
        ).resolves.toMatchObject({
          sourceId,
          formCount: 1,
          diagnostics: [],
        });

        await expect(host.expand({ sessionId, sourceId })).resolves.toMatchObject({
          sourceId,
          diagnostics: [],
          ast: [{ kind: "list" }],
        });

        await expect(host.typecheck({ sessionId, sourceId })).resolves.toMatchObject({
          diagnostics: [],
          display: expect.any(String),
        });
      } finally {
        await host.closeSession({ sessionId });
      }
    }
  });

  it("uses replaced session source text for ready-backend expand and typecheck", async () => {
    const hosts = await readySessionHosts();

    for (const host of hosts) {
      const sourceId = `${host.name}-replacement-source`;
      const { sessionId } = await host.openSession();
      try {
        await host.loadSource({
          sessionId,
          sourceId,
          source: "(+ 1 2)",
        });

        await expect(host.expand({ sessionId, sourceId })).resolves.toMatchObject({
          diagnostics: [],
          ast: [{ kind: "list" }],
        });
        await expect(host.typecheck({ sessionId, sourceId })).resolves.toMatchObject({
          diagnostics: [],
          display: expect.stringMatching(/Int|Number/),
        });

        await host.loadSource({
          sessionId,
          sourceId,
          source: "true",
        });

        await expect(host.expand({ sessionId, sourceId })).resolves.toMatchObject({
          diagnostics: [],
          ast: [{ kind: "bool", value: true }],
        });
        await expect(host.typecheck({ sessionId, sourceId })).resolves.toMatchObject({
          diagnostics: [],
          display: expect.stringMatching(/Bool/),
        });
      } finally {
        await host.closeSession({ sessionId });
      }
    }
  });

  it("returns structured ready-backend diagnostics for missing session expand and typecheck sources", async () => {
    const hosts = await readySessionHosts();

    for (const host of hosts) {
      const sourceId = `${host.name}-missing-source`;
      const { sessionId } = await host.openSession();
      try {
        const expanded = await host.expand({ sessionId, sourceId });
        expect(expanded.ast).toEqual([]);
        expect(expanded.diagnostics.length).toBeGreaterThan(0);
        expect(expanded.diagnostics[0]).toMatchObject({
          code: expect.stringContaining("source"),
          phase: "expand",
          severity: "error",
        });
        expect(
          expanded.diagnostics.some(
            (diagnostic) =>
              diagnostic.span?.sourceId === sourceId || diagnostic.message.includes(sourceId),
          ),
          `${host.name} expand diagnostic should carry source provenance`,
        ).toBe(true);

        const checked = await host.typecheck({ sessionId, sourceId });
        expect(checked.diagnostics.length).toBeGreaterThan(0);
        expect(checked.diagnostics[0]).toMatchObject({
          code: expect.stringContaining("source"),
          phase: "typecheck",
          severity: "error",
        });
        expect(
          checked.diagnostics.some(
            (diagnostic) =>
              diagnostic.span?.sourceId === sourceId || diagnostic.message.includes(sourceId),
          ),
          `${host.name} typecheck diagnostic should carry source provenance`,
        ).toBe(true);
      } finally {
        await host.closeSession({ sessionId });
      }
    }
  });

  it("reports JS OCaml session-backed expand and typecheck as explicitly unsupported", async () => {
    const jsOcamlHost = new JsOcamlLanguageHost();

    await expect(
      jsOcamlHost.expand({
        sessionId: "js-unsupported-session",
        sourceId: "js-loaded-source",
      }),
    ).resolves.toMatchObject({
      sourceId: "js-loaded-source",
      ast: [],
      diagnostics: [
        {
          code: "session/unsupported",
          phase: "expand",
          severity: "error",
          message: expect.stringContaining("persistent source sessions are not supported"),
        },
      ],
    });

    await expect(
      jsOcamlHost.typecheck({
        sessionId: "js-unsupported-session",
        sourceId: "js-loaded-source",
      }),
    ).resolves.toMatchObject({
      diagnostics: [
        {
          code: "session/unsupported",
          phase: "typecheck",
          severity: "error",
          message: expect.stringContaining("persistent source sessions are not supported"),
        },
      ],
    });
  });

  it("reports session metadata and reset semantics through ready backends", async () => {
    const hosts = await readySessionHosts();

    for (const host of hosts) {
      const preludeId = `${host.name}-session-info-prelude`;
      const sourceId = `${host.name}-session-info-source`;
      const { sessionId } = await host.openSession();
      try {
        await host.loadSource({
          sessionId,
          sourceId: preludeId,
          source: "(define session-info-prelude 1)",
          kind: "prelude",
        });
        await host.loadSource({
          sessionId,
          sourceId,
          source: "(+ 1 2)",
        });

        const first = await host.sessionInfo({ sessionId });
        expect(first).toMatchObject({
          sessionId,
          sourceCount: 1,
          preludeCount: 1,
          diagnostics: [],
        });
        expect(first.sources).toEqual([
          expect.objectContaining({
            sourceId,
            hash: expect.any(String),
          }),
        ]);
        expect(first.preludes).toEqual([
          expect.objectContaining({
            sourceId: preludeId,
            hash: expect.any(String),
          }),
        ]);
        const firstHash = first.sources[0]?.hash;

        await host.loadSource({
          sessionId,
          sourceId,
          source: "true",
        });
        const replaced = await host.sessionInfo({ sessionId });
        expect(replaced).toMatchObject({
          sourceCount: 1,
          preludeCount: 1,
          diagnostics: [],
        });
        expect(replaced.sources[0]).toEqual(
          expect.objectContaining({
            sourceId,
            hash: expect.any(String),
          }),
        );
        expect(replaced.sources[0]?.hash).not.toBe(firstHash);

        const evaluated = await host.evaluateInSession({
          sessionId,
          source: "(fn [x] x)",
          retainValues: "functions",
        });
        expect(evaluated).toMatchObject({
          status: "completed",
          result: {
            value: { kind: "function", valueRef: expect.any(String) },
            diagnostics: [],
          },
        });
        if (evaluated.status !== "completed" || evaluated.result.value.kind !== "function") {
          throw new Error("expected retained function result");
        }
        const valueRef = evaluated.result.value.valueRef;

        await expect(host.resetSession({ sessionId })).resolves.toEqual({
          sessionId,
          reset: true,
          diagnostics: [],
        });
        await expect(host.sessionInfo({ sessionId })).resolves.toMatchObject({
          sessionId,
          sourceCount: 0,
          preludeCount: 0,
          sources: [],
          preludes: [],
          diagnostics: [],
        });
        await expect(
          host.projectValue({
            sessionId,
            valueRef,
            projections: ["summary"],
          }),
        ).resolves.toMatchObject({
          diagnostics: [{ code: "value-ref/not-found" }],
        });
      } finally {
        await host.closeSession({ sessionId });
      }
    }
  });

  it("reports JS OCaml session metadata and reset as explicitly unsupported", async () => {
    const jsOcamlHost = new JsOcamlLanguageHost();

    await expect(
      jsOcamlHost.sessionInfo({ sessionId: "js-unsupported-session" }),
    ).resolves.toMatchObject({
      sessionId: "js-unsupported-session",
      sourceCount: 0,
      preludeCount: 0,
      sources: [],
      preludes: [],
      diagnostics: [
        {
          code: "session/unsupported",
          phase: "evaluate",
          severity: "error",
        },
      ],
    });

    await expect(
      jsOcamlHost.resetSession({ sessionId: "js-unsupported-session" }),
    ).resolves.toMatchObject({
      sessionId: "js-unsupported-session",
      reset: false,
      diagnostics: [
        {
          code: "session/unsupported",
          phase: "evaluate",
          severity: "error",
        },
      ],
    });
  });

  it("configures TS-backed sessions with variables and type policy", async () => {
    const { sessionId } = await tsHost.openSession();
    try {
      await expect(
        tsHost.configureSession({
          sessionId,
          variables: [{ name: "sessionValue", value: { kind: "int", value: 4 } }],
          typePolicy: {
            defaultBuiltinScheme: "none",
            unboundSymbols: [
              {
                match: { kind: "exact", value: "externalSessionValue" },
                type: { kind: "any" },
                reason: "session policy",
              },
            ],
          },
        }),
      ).resolves.toMatchObject({
        sessionId,
        bindingCount: 1,
      });

      await expect(
        tsHost.evaluateInSession({
          sessionId,
          source: "(+ sessionValue 3)",
        }),
      ).resolves.toMatchObject({
        status: "completed",
        result: {
          value: { kind: "int", value: 7 },
          diagnostics: [],
        },
      });

      await expect(
        tsHost.typecheck({
          sessionId,
          source: "externalSessionValue",
        }),
      ).resolves.toMatchObject({
        diagnostics: [],
      });
    } finally {
      await tsHost.closeSession({ sessionId });
    }
  });

  it("configures ready-backend sessions with variables and type policy", async () => {
    const hosts = await readySessionHosts();

    for (const host of hosts) {
      const { sessionId } = await host.openSession();
      try {
        await expect(
          host.configureSession({
            sessionId,
            variables: [{ name: "sessionValue", value: { kind: "int", value: 4 } }],
            typePolicy: {
              unboundSymbols: [
                {
                  match: { kind: "exact", value: "externalSessionValue" },
                  type: { kind: "type", name: "String" },
                  reason: "session policy",
                },
              ],
            },
          }),
        ).resolves.toMatchObject({
          sessionId,
          bindingCount: 1,
        });

        await expect(
          host.evaluateInSession({
            sessionId,
            source: "(+ sessionValue 3)",
          }),
        ).resolves.toMatchObject({
          status: "completed",
          result: {
            value: { kind: "int", value: 7 },
            diagnostics: [],
          },
        });

        await expect(
          host.typecheck({
            sessionId,
            source: "(+ sessionValue 3)",
          }),
        ).resolves.toMatchObject({
          diagnostics: [],
        });

        await expect(
          host.typecheck({
            sessionId,
            source: "externalSessionValue",
          }),
        ).resolves.toMatchObject({
          diagnostics: [],
        });
      } finally {
        await host.closeSession({ sessionId });
      }
    }
  });
});
