import { expect, test } from "vitest";
import { TsLanguageHost } from "../src/ts-host.js";

test("runtime projections keep both interfaces and refresh dependent session instances", async () => {
  const host = new TsLanguageHost();
  const { sessionId } = await host.openSession();
  const library = `
    (export value)
    (type ValueId Symbol)
    (type ValueIR {:name Symbol :value Int})
    (form (value name value)
      :types {:name (Declares ValueId) :value Int}
      :ir ValueIR
      :lower (fn [ir] \`[(define ~(get ir :name) ~(get ir :value))])
      {:name name :value value})`;
  try {
    const loaded = await host.loadSourceBundle({
      sessionId,
      sources: [
        { kind: "source", sourceId: "child.forma", source: '(import "./library.forma" [value]) (export answer) (value answer 42)' },
        { kind: "source", sourceId: "library.forma", source: library },
      ],
    });
    expect(loaded.diagnostics).toEqual([]);
    const graph = await host.moduleGraph({ sessionId, sourceId: "child.forma" });
    expect(graph.diagnostics).toEqual([]);
    const binding = graph.interfaces.at(-1)!.exports[0]!;
    expect(binding.scheme?.type).toBe("Int");
    expect(binding.data?.scheme?.type).toHaveProperty("fields");
    const linked = await host.linkEffectModules({ sessionId, sourceId: "child.forma" });
    expect(linked.diagnostics).toEqual([]);
    expect(linked.ok).toBe(true);
    const evaluate = () => host.evaluateInSession({
      sessionId, sourceId: "main.forma", source: '(import "./child.forma" [answer]) answer',
    });
    expect(await evaluate()).toMatchObject({ status: "completed", result: { value: { kind: "int", value: 42 } } });
    expect((await host.loadSource({
      sessionId, sourceId: "library.forma", kind: "source",
      source: library.replace('~(get ir :value)', '(+ ~(get ir :value) 1)'),
    })).diagnostics).toEqual([]);
    expect(await evaluate()).toMatchObject({ status: "completed", result: { value: { kind: "int", value: 43 } } });
  } finally {
    await host.closeSession({ sessionId });
  }
});
