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
  .filter((name) => name.endsWith(".lisp"))
  .map((name) => ({
    id: `example/${name}`,
    source: readFileSync(resolve(fixture, name), "utf8"),
  }));
const graph = (
  entry = "main.lisp",
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
          origin.identity.moduleId === "example/billing.lisp" &&
          origin.identity.declaration === "Monthly",
      ),
    ).toBe(true);
  });
  test("a broken imported reference points to its authored token", () => {
    try {
      graph("broken.lisp");
      throw Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleError);
      const diagnostic = (error as ModuleError).diagnostic;
      const source = files.find((s) => s.id === "example/broken.lisp")!.source;
      expect(diagnostic.span).toMatchObject({
        sourceId: "example/broken.lisp",
        startOffset: source.indexOf("billing/Missing"),
        endOffset: source.indexOf("billing/Missing") + "billing/Missing".length,
      });
    }
  });
  test("private form helpers cannot be imported", () => {
    const entry = {
      id: "example/private.lisp",
      source: '(import "./stripe.lisp" [display-label])',
    };
    expect(() =>
      resolveModuleGraph(entry, sourceModuleResolver(files)),
    ).toThrow(/does not export/);
  });
});

test("imported macros retain their defining helpers", () => {
  const library = {
    id: "example/macros.lisp",
    source:
      "(export increment) (define helper [x] (+ x 1)) (macro (increment x) `(helper ~x))",
  };
  const main = {
    id: "example/macro-main.lisp",
    source:
      '(import "./macros.lisp" [increment]) (define helper [x] "caller") (define answer (increment 41)) (export answer)',
  };
  const g = graph("macro-main.lisp", [library, main]);
  expect(checkModuleGraph(g).diagnostics).toEqual([]);
  expect(g.modules.at(-1)!.interface.exports[0]!.data?.value).toBe(42);
});

test("form checks report the caller's data hole", () => {
  const main = {
    id: "example/negative.lisp",
    source: '(import "./stripe.lisp" [price]) (price Bad "Bad" -1)',
  };
  try {
    graph("negative.lisp", [...files, main]);
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
    id: "a/prelude.lisp",
    source: "(export answer) (define answer 42)",
  };
  const b = {
    id: "b/prelude.lisp",
    source: "(export answer) (define answer 7)",
  };
  const library = {
    id: "b/library.lisp",
    source: "(export result) (define result answer)",
  };
  const main = {
    id: "a/main.lisp",
    source:
      '(import "../b/library.lisp" :as b) (define result [answer b/result]) (export result)',
  };
  const g = resolveModuleGraph(main, sourceModuleResolver([a, b, library]), {
    projects: [
      { id: "a", base: "a/project", prelude: "./prelude.lisp" },
      { id: "b", base: "b/project", prelude: "./prelude.lisp" },
    ],
    projectForModule: (id) => id.split("/")[0],
  });
  expect(checkModuleGraph(g).diagnostics).toEqual([]);
  expect(g.modules.at(-1)!.interface.exports[0]!.data?.value).toEqual([42, 7]);
});

describe("forms that produce an imported IR type", () => {
  const sources = (retries: string) => [
    {
      id: "p/ir.lisp",
      source: `(export FlowIR StepIR)
(type StepIR {:name String :retries Int})
(type FlowIR {:kind "Flow" :steps (List StepIR)})`,
    },
    {
      id: "p/flow.lisp",
      source: `(import "./ir.lisp" [FlowIR])
(export flow)
(type FlowDecl Symbol)
(form (flow name step ...) :types {:name (Declares FlowDecl) :step (List String)} :ir FlowIR
  {:kind "Flow" :steps (map (fn [n] {:name n :retries 0}) step)})`,
    },
    {
      id: "p/process.lisp",
      source: `(import "./ir.lisp" [FlowIR])
(export process)
(type ProcessDecl Symbol)
(form (process name step ...) :types {:name (Declares ProcessDecl) :step (List String)} :ir FlowIR
  {:kind "Flow" :steps (map (fn [n] {:name n :retries ${retries}}) step)})`,
    },
    {
      id: "p/main.lisp",
      source: `(import "./flow.lisp" [flow])
(import "./process.lisp" [process])
(export Onboard Offboard)
(flow Onboard "collect-i9")
(process Offboard "revoke-access")`,
    },
  ];
  const resolve = (retries: string) => {
    const all = sources(retries);
    return resolveModuleGraph(all.at(-1)!, sourceModuleResolver(all));
  };

  test("type-check, check payloads against the imported definitions, and share a contract identity", () => {
    const g = resolve("1");
    expect(checkModuleGraph(g).diagnostics).toEqual([]);
    const [onboard, offboard] = g.modules.at(-1)!.interface.exports.map((binding) => binding.data);
    expect(onboard?.value).toMatchObject({ record: expect.arrayContaining([[{ keyword: ":data" }, expect.anything()]]) });
    expect(onboard?.contractId).toMatch(/^[a-f0-9]{64}$/);
    expect(offboard?.contractId).toBe(onboard?.contractId);
  });

  test("reject a payload that breaks a type the IR type reaches", () => {
    expect(() => resolve('"none"')).toThrow("payload.steps[0].retries must be Int");
  });
});
