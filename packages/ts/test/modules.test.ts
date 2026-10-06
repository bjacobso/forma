import { describe, expect, test } from "vitest";
import {
  checkModuleGraph,
  resolveModuleGraph,
  sourceModuleResolver,
  ModuleError,
  type ModuleSource,
} from "../src/Modules.js";
const graph = (source: string, files: readonly ModuleSource[] = []) =>
  resolveModuleGraph(
    { id: "src/main.forma", source },
    sourceModuleResolver(files),
  );
const checked = (source: string, files: readonly ModuleSource[] = []) =>
  checkModuleGraph(graph(source, files));
const id = {
  id: "src/id.forma",
  source: "(export identity) (define identity [x] x)",
};
describe("isolated file modules", () => {
  test("polymorphic imports instantiate at each use", () => {
    const r = checked(
      '(import "./id.forma" [identity]) (define a (identity 1)) (define b (identity "hello")) b',
      [id],
    );
    expect(r.diagnostics).toEqual([]);
  });
  test("no ambient source names", () => {
    expect(checked("(identity 1)", [id]).ok).toBe(false);
    expect(() => graph('(import "./id.forma" [private])', [id])).toThrow(
      /does not export/,
    );
  });
  test("namespace aliases preserve duplicate names and original re-export identity", () => {
    const a = { id: "src/a.forma", source: "(export value) (define value 1)" },
      b = { id: "src/b.forma", source: '(export value) (define value "b")' };
    const g = graph(
      '(import "./a.forma" :as a) (import "./b.forma" :as b) (define pair [x] {:a a/value :b b/value}) (export pair)',
      [a, b],
    );
    expect(checkModuleGraph(g).diagnostics).toEqual([]);
    const barrel = {
      id: "src/barrel.forma",
      source: '(export-from "./a.forma" [value])',
    };
    const r = graph('(import "./barrel.forma" [value]) (export value)', [
      a,
      barrel,
    ]);
    expect(r.modules.at(-1)?.interface.exports[0]?.identity).toEqual({
      moduleId: a.id,
      declaration: "value",
    });
  });
  test("brands from different files remain nominal", () => {
    const a = {
      id: "src/a.forma",
      source:
        '(export Id consume) (type Id (Brand String)) (: consume (-> Id String)) (define consume [id] "a")',
    };
    const b = {
      id: "src/b.forma",
      source: "(export Id) (type Id (Brand String))",
    };
    expect(
      checked(
        '(import "./a.forma" :as a) (import "./b.forma" :as b) (a/consume (b/Id "x"))',
        [a, b],
      ).ok,
    ).toBe(false);
    expect(
      checked('(import "./a.forma" :as a) (a/consume (a/Id "x"))', [a])
        .diagnostics,
    ).toEqual([]);
  });
  test("constructors remain owned and do not create bare imported bindings", () => {
    const a = {
      id: "src/a.forma",
      source: "(export Choice) (type Choice (Tagged (Yes Int) No))",
    };
    expect(
      checked('(import "./a.forma" [Choice]) (Choice.Yes 1)', [a]).diagnostics,
    ).toEqual([]);
    expect(checked('(import "./a.forma" [Choice]) (Yes 1)', [a]).ok).toBe(
      false,
    );
  });
  test("full cycles have the closing author's span", () => {
    const files = [
      { id: "src/a.forma", source: '(import "./b.forma" [])' },
      { id: "src/b.forma", source: '(import "./a.forma" [])' },
    ];
    try {
      graph('(import "./a.forma" [])', files);
      throw Error("expected cycle");
    } catch (e) {
      expect(e).toBeInstanceOf(ModuleError);
      expect((e as ModuleError).diagnostic).toMatchObject({
        code: "module/cycle",
        span: { sourceId: "src/b.forma", startOffset: 8 },
      });
      expect((e as Error).message).toContain(
        "src/main.forma -> src/a.forma -> src/b.forma -> src/a.forma",
      );
    }
  });
  test("duplicate imports and exports and unsupported compile-time exports fail", () => {
    expect(() =>
      graph('(import "./id.forma" [identity identity])', [id]),
    ).toThrow(/conflicts/);
    expect(() => graph("(export x x) (define x 1)")).toThrow(
      /Duplicate export/,
    );
    expect(() => graph("(export m) (macro (m x) x)")).toThrow(/stage 2/);
  });
  test("lexical binders shadow imports", () => {
    expect(
      checked(
        '(import "./id.forma" [identity]) (define apply [identity] (identity 2)) (apply (fn [x] (+ x 1)))',
        [id],
      ).diagnostics,
    ).toEqual([]);
  });
});

test("private nominal types and capabilities cannot escape a public interface", () => {
  expect(
    checked(
      '(type Hidden (Brand String)) (: expose (-> Hidden String)) (define expose [x] "x") (export expose)',
    ).diagnostics[0]?.code,
  ).toBe("module/private-type");
  expect(
    checked(
      "(type Hidden (Brand String)) (type Public {:id Hidden}) (export Public)",
    ).diagnostics[0]?.code,
  ).toBe("module/private-type");
});

test("missing files and namespace misuse are located at the authored reference", () => {
  for (const source of [
    '(import "./missing.forma" [])',
    '(import "./id.forma" :as id) id',
    '(import "./id.forma" :as id) id/private',
    "wrong/identity",
  ]) {
    try {
      graph(source, [id]);
      throw Error("expected module error");
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleError);
      expect((error as ModuleError).diagnostic.span?.sourceId).toBe(
        "src/main.forma",
      );
    }
  }
});

test("local macros retain references to their owning module's helpers", () => {
  const source =
    "(define helper [x] (+ x 1)) (macro (increment x) `(helper ~x)) (export value) (define value (increment 41))";
  expect(checked(source).diagnostics).toEqual([]);
});

test("imported type constructors remain polymorphic", () => {
  const box = {
    id: "src/box.forma",
    source: "(export Box) (type (Box a) (Tagged (Wrap a)))",
  };
  expect(
    checked(
      '(import "./box.forma" [Box]) (define a (Box.Wrap 42)) (define b (Box.Wrap "text")) b',
      [box],
    ).diagnostics,
  ).toEqual([]);
});

test("a diamond initializes once, concurrent requests share the instance, and edits invalidate dependents", async () => {
  const { ModuleRuntime } = await import("../src/modules/runtime.js");
  const { Env } = await import("../src/Env.js");
  const { Effect } = await import("effect");
  let initializations = 0;
  const core = Env.empty().extend({
    construct: {
      _tag: "KFn" as const,
      params: [],
      body: graph("nil").modules[0]!.expressions[0]!,
      closure: Env.empty(),
      apply: () => Effect.sync(() => ++initializations),
    },
  });
  const runtime = new ModuleRuntime(core);
  const base = {
    id: "src/base.forma",
    source: "(export value) (define value (construct)) missing-application",
  };
  const files = [
    base,
    { id: "src/a.forma", source: '(export-from "./base.forma" [value])' },
    { id: "src/b.forma", source: '(export-from "./base.forma" [value])' },
  ];
  const source =
    '(import "./a.forma" :as a) (import "./b.forma" :as b) (+ a/value b/value)';
  const g = graph(source, files);
  expect(
    (await Promise.all([runtime.evaluate(g), runtime.evaluate(g)])).map(
      (r) => r.result.value,
    ),
  ).toEqual([2, 2]);
  expect(initializations).toBe(1);
  const changed = graph(source, [
    { ...base, source: base.source + " " },
    ...files.slice(1),
  ]);
  expect((await runtime.evaluate(changed)).result.value).toBe(4);
  expect(initializations).toBe(2);
});
