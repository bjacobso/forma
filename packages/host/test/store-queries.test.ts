import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JsonAbi } from "../src/json-abi.js";

const cli = resolve(import.meta.dirname, "../dist/cli.mjs");

const domainSource = `(export User NotFound ValidationError Users Audit)
(type User {:id String :name String})
(error NotFound {:id String})
(error ValidationError {:message String})
(service Users
  (: find (-> String (Effect (Option User))))
  (: save (-> User (Effect User))))
(service Audit
  (: log (-> String (Effect Unit))))`;

const appSource = `(import "./domain.lisp" [User NotFound ValidationError Users Audit])
(export find-user save-user handle-request)
(: find-user (-> String (Effect User [NotFound] [Users.find])))
(define find-user [id]
  (do! [found (Users.find id)]
       (match found (Some u) (succeed u) None (fail (NotFound {:id id})))))
(: save-user (-> User (Effect User [ValidationError] [Users.save Audit.log])))
(define save-user [u]
  (do! [_ (Audit.log "saving")]
       (Users.save u)))
(: handle-request (-> String (Effect User [NotFound ValidationError] [Users.find Users.save Audit.log])))
(define handle-request [id]
  (do! [u (find-user id)]
       (save-user u)))`;

describe("host ABI read-only store queries", () => {
  it("queries definitions, dependents, dependencies, capabilities, and errors over JsonAbi", async () => {
    const abi = new JsonAbi();
    const send = (payload: unknown) => abi.handleJson(JSON.stringify(payload));
    const opened = await send({ op: "openSession" });
    const sessionId = (opened.value as { sessionId: string }).sessionId;

    try {
      await send({ op: "loadSource", sessionId, sourceId: "domain.lisp", source: domainSource });
      await send({ op: "loadSource", sessionId, sourceId: "app.lisp", source: appSource });

      const defResp = await send({ op: "getDefinition", sessionId, target: "find-user" });
      expect(defResp.ok).toBe(true);
      const findUser = (defResp.value as { definition: Record<string, any> }).definition;
      expect(findUser).toMatchObject({
        name: "find-user",
        qualifiedName: "app.lisp::find-user",
        kind: "define",
        requirements: ["Users.find"],
        errors: ["NotFound"],
        authoredSource: expect.stringContaining("(define find-user"),
      });
      expect(findUser.hash).toMatch(/^def:v1:[0-9a-f]{64}$/u);

      // Lookup by DefHash returns the identical definition.
      const byHash = await send({ op: "getDefinition", sessionId, target: findUser.hash });
      expect(byHash).toMatchObject({
        ok: true,
        value: { definition: { hash: findUser.hash, name: "find-user" } },
      });

      // Direct vs transitive dependents of User.
      const directDeps = await send({ op: "findDependents", sessionId, target: "User" });
      const directNames = (directDeps.value as { definitions: { name: string }[] }).definitions.map(
        (d) => d.name,
      );
      expect(directNames).toEqual(expect.arrayContaining(["find-user", "save-user", "Users"]));

      const transitiveDeps = await send({
        op: "findDependents",
        sessionId,
        target: "User",
        transitive: true,
      });
      const transitiveNames = (
        transitiveDeps.value as { definitions: { name: string }[] }
      ).definitions.map((d) => d.name);
      expect(transitiveNames).toEqual(
        expect.arrayContaining(["find-user", "save-user", "Users", "handle-request"]),
      );

      // Direct and transitive dependencies of handle-request.
      const directOfHandle = await send({
        op: "findDependencies",
        sessionId,
        target: "handle-request",
      });
      const directOfHandleNames = (
        directOfHandle.value as { definitions: { name: string }[] }
      ).definitions.map((d) => d.name);
      expect(directOfHandleNames).toEqual(
        expect.arrayContaining(["find-user", "save-user", "User", "NotFound", "ValidationError"]),
      );

      // Capability queries: exact op and service-level prefix.
      const byOp = await send({ op: "queryByCapability", sessionId, capability: "Users.find" });
      expect(
        (byOp.value as { definitions: { name: string }[] }).definitions.map((d) => d.name),
      ).toEqual(["find-user", "handle-request"]);

      const byService = await send({ op: "queryByCapability", sessionId, capability: "Users" });
      expect(
        (byService.value as { definitions: { name: string }[] }).definitions.map((d) => d.name),
      ).toEqual(["find-user", "handle-request", "save-user"]);

      // Error queries.
      const byErr = await send({ op: "queryByError", sessionId, error: "NotFound" });
      expect(
        (byErr.value as { definitions: { name: string }[] }).definitions.map((d) => d.name),
      ).toEqual(["find-user", "handle-request"]);
    } finally {
      await send({ op: "closeSession", sessionId });
    }
  });

  it("returns canonical alpha-equivalent DefHashes across parameter renames", async () => {
    const abi = new JsonAbi();
    const send = (payload: unknown) => abi.handleJson(JSON.stringify(payload));
    const a = await send({
      op: "getDefinition",
      source: "(define inc [x] (+ x 1))",
      target: "inc",
    });
    const b = await send({
      op: "getDefinition",
      source: "(define inc [y] (+ y 1))",
      target: "inc",
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect((a.value as { definition: { hash: string } }).definition.hash).toBe(
      (b.value as { definition: { hash: string } }).definition.hash,
    );
  });
});

describe("forma mcp read-only store query tools", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "forma-mcp-queries-")));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "forma-mcp-queries-outside-")));
  const client = new Client({ name: "forma-queries-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp"],
    cwd: dir,
    stderr: "pipe",
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.content).toEqual([
      expect.objectContaining({ type: "text", text: expect.any(String) }),
    ]);
    return result.structuredContent as Record<string, any>;
  };

  beforeAll(async () => {
    writeFileSync(join(dir, "domain.lisp"), domainSource);
    writeFileSync(join(dir, "app.lisp"), appSource);
    writeFileSync(join(outside, "secret.lisp"), "(define secret 42)");
    symlinkSync(join(outside, "secret.lisp"), join(dir, "escape.lisp"));
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("advertises all 5 semantic query tools alongside existing MCP tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "check",
        "run",
        "format",
        "explain",
        "describe_nodes",
        "edit",
        "repl",
        "describe",
        "get_definition",
        "find_dependents",
        "find_dependencies",
        "query_by_capability",
        "query_by_error",
      ]),
    );
  });

  it("serves read-only graph queries over file module graphs and inline source", async () => {
    const def = await call("get_definition", { path: "app.lisp", target: "find-user" });
    expect(def).toMatchObject({
      ok: true,
      definition: {
        name: "find-user",
        kind: "define",
        requirements: ["Users.find"],
        errors: ["NotFound"],
      },
      diagnostics: [],
    });

    const byHash = await call("get_definition", {
      path: "app.lisp",
      target: def.definition.hash,
    });
    expect(byHash).toMatchObject({
      ok: true,
      definition: { hash: def.definition.hash, name: "find-user" },
    });

    const dependents = await call("find_dependents", {
      path: "app.lisp",
      target: "NotFound",
      transitive: true,
    });
    expect(dependents.ok).toBe(true);
    expect(dependents.definitions.map((d: { name: string }) => d.name)).toEqual([
      "find-user",
      "handle-request",
    ]);

    const dependencies = await call("find_dependencies", {
      path: "app.lisp",
      target: "handle-request",
      transitive: true,
    });
    expect(dependencies.ok).toBe(true);
    expect(dependencies.definitions.map((d: { name: string }) => d.name)).toEqual(
      expect.arrayContaining(["find-user", "save-user", "User", "NotFound", "ValidationError", "Users", "Audit"]),
    );

    const byCapability = await call("query_by_capability", {
      path: "app.lisp",
      capability: "Audit",
    });
    expect(byCapability.ok).toBe(true);
    expect(byCapability.definitions.map((d: { name: string }) => d.name)).toEqual([
      "handle-request",
      "save-user",
    ]);

    const byError = await call("query_by_error", {
      path: "app.lisp",
      error: "ValidationError",
    });
    expect(byError.ok).toBe(true);
    expect(byError.definitions.map((d: { name: string }) => d.name)).toEqual([
      "handle-request",
      "save-user",
    ]);

    // Inline source works without a file path.
    const inline = await call("get_definition", {
      source: "(define inc [x] (+ x 1))",
      target: "inc",
    });
    expect(inline).toMatchObject({
      ok: true,
      definition: { name: "inc", kind: "define", authoredSource: "(define inc [x] (+ x 1))" },
    });
  });

  it("enforces cwd path confinement and rejects malformed arguments", async () => {
    for (const tool of [
      { name: "get_definition", args: { path: join(outside, "secret.lisp"), target: "secret" } },
      { name: "find_dependents", args: { path: "escape.lisp", target: "secret" } },
      { name: "find_dependencies", args: { path: "escape.lisp", target: "secret" } },
      { name: "query_by_capability", args: { path: "escape.lisp", capability: "Users" } },
      { name: "query_by_error", args: { path: "escape.lisp", error: "NotFound" } },
    ]) {
      expect(await call(tool.name, tool.args)).toMatchObject({
        ok: false,
        diagnostics: [expect.any(Object)],
      });
    }
    expect(await call("get_definition", { path: "app.lisp", source: "1", target: "x" })).toMatchObject({
      ok: false,
    });
    expect(await call("get_definition", { source: "(define x 1)" })).toMatchObject({ ok: false });
  });
});
