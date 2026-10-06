import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sources = [
  "ids.forma",
  "log.forma",
  "identity.forma",
  "state.forma",
  "main.forma",
].map((name) => ({
  kind: "source" as const,
  sourceId: name,
  source: readFileSync(
    resolve(import.meta.dirname, "../../../conformance/modules", name),
    "utf8",
  ),
}));

test("the universal browser host resolves isolated modules and links Effect files", async ({
  page,
}) => {
  await page.goto("/playground/", { waitUntil: "networkidle" });
  const result = await page.evaluate(
    async (sources) => {
      const url = "/playground/@fs" + sources.hostPath;
      const { TsLanguageHost } = await import(/* @vite-ignore */ url);
      const host = new TsLanguageHost();
      const { sessionId } = await host.openSession();
      try {
        const loaded = await host.loadSourceBundle({
          sessionId,
          sources: sources.files,
        });
        const graph = await host.moduleGraph({
          sessionId,
          sourceId: "main.forma",
        });
        const linked = await host.linkEffectModules({
          sessionId,
          sourceId: "main.forma",
        });
        const value = await host.evaluateInSession({
          sessionId,
          sourceId: "pure.forma",
          source: '(import "./identity.forma" [identity]) (identity 42)',
        });
        const privateName = await host.evaluateInSession({
          sessionId,
          sourceId: "pure.forma",
          source: "identity",
        });
        return {
          loaded: loaded.diagnostics,
          graph: graph.diagnostics,
          linked: linked.diagnostics,
          files: linked.modules.length,
          hasImports: linked.modules.some((m: { code: string }) =>
            m.code.includes("import {"),
          ),
          value,
          privateName,
        };
      } finally {
        await host.closeSession({ sessionId });
      }
    },
    {
      files: [...sources].reverse(),
      hostPath: resolve(
        import.meta.dirname,
        "../../../packages/host/src/ts-host.ts",
      ),
    },
  );
  expect(result).toMatchObject({
    loaded: [],
    graph: [],
    linked: [],
    files: 5,
    hasImports: true,
    value: {
      status: "completed",
      result: { value: { kind: "int", value: 42 } },
    },
    privateName: { status: "failed" },
  });
});
