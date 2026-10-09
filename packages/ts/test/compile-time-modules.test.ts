import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  checkModuleGraph,
  resolveModuleGraph,
  sourceModuleResolver,
  ModuleError,
  type ModuleSource,
} from "../src/Modules.js";

const fixture = resolve(
  import.meta.dirname,
  "../../../conformance/compile-time-modules",
);
const files = readdirSync(fixture)
  .filter((name) => name.endsWith(".forma"))
  .map((name) => ({
    id: `example/${name}`,
    source: readFileSync(resolve(fixture, name), "utf8"),
  }));
const graph = (
  entry = "main.forma",
  sources: readonly ModuleSource[] = files,
) =>
  resolveModuleGraph(
    sources.find((s) => s.id === `example/${entry}`)!,
    sourceModuleResolver(sources),
  );

describe("ordinary compile-time modules", () => {
  test("Stripe declarations and pure collections drive a Salesforce picklist", () => {
    const g = graph();
    expect(checkModuleGraph(g).diagnostics).toEqual([]);
    const entry = g.modules.at(-1)!;
    expect(entry.interface.exports.map((b) => b.name)).toEqual([
      "BillingPlan",
      "DefaultPrice",
    ]);
    const plan = entry.compileTime!.read(
      entry.interface.exports[0]!.symbol,
    ) as Map<string, unknown>;
    expect((plan.get(":data") as Map<string, unknown>).get(":entries")).toEqual(
      ["Stripe: Monthly", "Stripe: Annual"],
    );
    expect(
      entry.interface.exports[0]!.data?.provenance.some(
        (origin) =>
          origin.identity.moduleId === "example/billing.forma" &&
          origin.identity.declaration === "Monthly",
      ),
    ).toBe(true);
  });
  test("a broken imported reference points to its authored token", () => {
    try {
      graph("broken.forma");
      throw Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleError);
      const diagnostic = (error as ModuleError).diagnostic;
      const source = files.find((s) => s.id === "example/broken.forma")!.source;
      expect(diagnostic.span).toMatchObject({
        sourceId: "example/broken.forma",
        startOffset: source.indexOf("billing/Missing"),
        endOffset: source.indexOf("billing/Missing") + "billing/Missing".length,
      });
    }
  });
  test("private form helpers cannot be imported", () => {
    const entry = {
      id: "example/private.forma",
      source: '(import "./stripe.forma" [display-label])',
    };
    expect(() =>
      resolveModuleGraph(entry, sourceModuleResolver(files)),
    ).toThrow(/does not export/);
  });
});

test("imported macros retain their defining helpers", () => {
  const library = {
    id: "example/macros.forma",
    source:
      "(export increment) (define helper [x] (+ x 1)) (macro (increment x) `(helper ~x))",
  };
  const main = {
    id: "example/macro-main.forma",
    source:
      '(import "./macros.forma" [increment]) (define helper [x] "caller") (define answer (increment 41)) (export answer)',
  };
  const g = graph("macro-main.forma", [library, main]);
  expect(checkModuleGraph(g).diagnostics).toEqual([]);
  expect(g.modules.at(-1)!.interface.exports[0]!.data?.value).toBe(42);
});

test("form checks report the caller's data hole", () => {
  const main = {
    id: "example/negative.forma",
    source: '(import "./stripe.forma" [price]) (price Bad "Bad" -1)',
  };
  try {
    graph("negative.forma", [...files, main]);
    throw Error("expected failure");
  } catch (error) {
    expect((error as ModuleError).diagnostic).toMatchObject({
      message: "Price amount must be nonnegative",
      span: {
        sourceId: main.id,
        startOffset: main.source.indexOf("-1"),
        endOffset: main.source.indexOf("-1") + 2,
      },
    });
  }
});

test("project prelude exports use ordinary resolution and do not leak across projects", () => {
  const a = {
    id: "a/prelude.forma",
    source: "(export answer) (define answer 42)",
  };
  const b = {
    id: "b/prelude.forma",
    source: "(export answer) (define answer 7)",
  };
  const library = {
    id: "b/library.forma",
    source: "(export result) (define result answer)",
  };
  const main = {
    id: "a/main.forma",
    source:
      '(import "../b/library.forma" :as b) (define result [answer b/result]) (export result)',
  };
  const g = resolveModuleGraph(main, sourceModuleResolver([a, b, library]), {
    projects: [
      { id: "a", base: "a/project", prelude: "./prelude.forma" },
      { id: "b", base: "b/project", prelude: "./prelude.forma" },
    ],
    projectForModule: (id) => id.split("/")[0],
  });
  expect(checkModuleGraph(g).diagnostics).toEqual([]);
  expect(g.modules.at(-1)!.interface.exports[0]!.data?.value).toEqual([42, 7]);
});
