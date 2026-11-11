import { readFileSync } from "node:fs";
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
    { id: "src/main.lisp", source },
    sourceModuleResolver(files),
  );
const checked = (source: string, files: readonly ModuleSource[] = []) =>
  checkModuleGraph(graph(source, files));
const id = {
  id: "src/id.lisp",
  source: "(export identity) (define identity [x] x)",
};
describe("isolated file modules", () => {
  test("the retired-extension conformance fixture reports a fix before resolution", () => {
    const source = readFileSync(new URL("../../../conformance/modules/retired-extension.lisp", import.meta.url), "utf8");
    expect(() => graph(source)).toThrowError(expect.objectContaining({
      diagnostic: expect.objectContaining({ code: "module/retired-extension", fix: expect.any(Array) }),
    }));
  });
  test.each(["import", "export-from"])("%s rejects retired source paths with an author edit", directive => {
    const source = `(${directive} "./id.forma" [identity])`;
    try {
      graph(source, [id]);
      expect.fail("expected a retired-extension diagnostic");
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleError);
      const diagnostic = (error as ModuleError).diagnostic;
      expect(diagnostic.code).toBe("module/retired-extension");
      expect(diagnostic.help).toContain(".lisp");
      expect(diagnostic.fix).toEqual([{
        span: expect.objectContaining({ sourceId: "src/main.lisp", startOffset: source.indexOf('"'), endOffset: source.lastIndexOf('"') + 1 }),
        newText: '"./id.lisp"',
      }]);
    }
  });
  test("incomplete matches reject a module at the author's match span", () => {
    const source = [
      "(export Choice choose)",
      "(type Choice (Tagged (Yes Int) No))",
      "(: choose (-> Choice Int))",
      "(define choose [value] (match value (Yes n) n))",
    ].join("\n");
    const check = (source: string) => checked('(import "./choice.lisp" [choose])', [
      { id: "src/choice.lisp", source },
    ]);
    const result = check(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        message: "Non-exhaustive match: missing constructor(s) No",
        span: expect.objectContaining({
          sourceId: "src/choice.lisp",
          startOffset: source.indexOf("(match"),
          endOffset: source.length - 1,
        }),
      }),
    ]);
    for (const fallback of ["(No) 0", "_ 0"]) {
      const total = check(source.replace("(Yes n) n)", `(Yes n) n ${fallback})`));
      expect(total.ok).toBe(true);
      expect(total.diagnostics).toEqual([]);
    }
  });
  test("polymorphic imports instantiate at each use", () => {
    const r = checked(
      '(import "./id.lisp" [identity]) (define a (identity 1)) (define b (identity "hello")) b',
      [id],
    );
    expect(r.diagnostics).toEqual([]);
  });
  test("no ambient source names", () => {
    expect(checked("(identity 1)", [id]).ok).toBe(false);
    expect(() => graph('(import "./id.lisp" [private])', [id])).toThrow(
      /does not export/,
    );
  });
  test("namespace aliases preserve duplicate names and original re-export identity", () => {
    const a = { id: "src/a.lisp", source: "(export value) (define value 1)" },
      b = { id: "src/b.lisp", source: '(export value) (define value "b")' };
    const g = graph(
      '(import "./a.lisp" :as a) (import "./b.lisp" :as b) (define pair [x] {:a a/value :b b/value}) (export pair)',
      [a, b],
    );
    expect(checkModuleGraph(g).diagnostics).toEqual([]);
    const barrel = {
      id: "src/barrel.lisp",
      source: '(export-from "./a.lisp" [value])',
    };
    const r = graph('(import "./barrel.lisp" [value]) (export value)', [
      a,
      barrel,
    ]);
    expect(r.modules.at(-1)?.interface.exports[0]?.identity).toEqual({
      moduleId: a.id,
      declaration: "value",
    });
  });
  test("an imported macro does not shadow the arrow in a type annotation", () => {
    const sugar = {
      id: "src/sugar.lisp",
      source: "(export ->) (macro (-> value forms ...) value)",
    };
    expect(
      checked(
        [
          '(import "./sugar.lisp" [->])',
          "(export total)",
          "(: total (-> Int Int))",
          "(define total [n] (-> n (+ 1)))",
        ].join("\n"),
        [sugar],
      ).diagnostics,
    ).toEqual([]);
  });
  test("brands from different files remain nominal", () => {
    const a = {
      id: "src/a.lisp",
      source:
        '(export Id consume) (type Id (Brand String)) (: consume (-> Id String)) (define consume [id] "a")',
    };
    const b = {
      id: "src/b.lisp",
      source: "(export Id) (type Id (Brand String))",
    };
    expect(
      checked(
        '(import "./a.lisp" :as a) (import "./b.lisp" :as b) (a/consume (b/Id "x"))',
        [a, b],
      ).ok,
    ).toBe(false);
    expect(
      checked('(import "./a.lisp" :as a) (a/consume (a/Id "x"))', [a])
        .diagnostics,
    ).toEqual([]);
  });
  test("constructors remain owned and do not create bare imported bindings", () => {
    const a = {
      id: "src/a.lisp",
      source: "(export Choice) (type Choice (Tagged (Yes Int) No))",
    };
    expect(
      checked('(import "./a.lisp" [Choice]) (Choice.Yes 1)', [a]).diagnostics,
    ).toEqual([]);
    expect(checked('(import "./a.lisp" [Choice]) (Yes 1)', [a]).ok).toBe(
      false,
    );
  });
  test("full cycles have the closing author's span", () => {
    const files = [
      { id: "src/a.lisp", source: '(import "./b.lisp" [])' },
      { id: "src/b.lisp", source: '(import "./a.lisp" [])' },
    ];
    try {
      graph('(import "./a.lisp" [])', files);
      throw Error("expected cycle");
    } catch (e) {
      expect(e).toBeInstanceOf(ModuleError);
      expect((e as ModuleError).diagnostic).toMatchObject({
        code: "module/cycle",
        span: { sourceId: "src/b.lisp", startOffset: 8 },
      });
      expect((e as Error).message).toContain(
        "src/main.lisp -> src/a.lisp -> src/b.lisp -> src/a.lisp",
      );
    }
  });
  test("duplicate imports and exports fail; macros are exportable", () => {
    expect(() =>
      graph('(import "./id.lisp" [identity identity])', [id]),
    ).toThrow(/conflicts/);
    expect(() => graph("(export x x) (define x 1)")).toThrow(
      /Duplicate export/,
    );
    expect(graph("(export m) (macro (m x) x)").modules[0]!.interface.exports[0]!.kind).toBe("macro");
  });
  test("lexical binders shadow imports", () => {
    expect(
      checked(
        '(import "./id.lisp" [identity]) (define apply [identity] (identity 2)) (apply (fn [x] (+ x 1)))',
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
    '(import "./missing.lisp" [])',
    '(import "./id.lisp" :as id) id',
    '(import "./id.lisp" :as id) id/private',
    "wrong/identity",
  ]) {
    try {
      graph(source, [id]);
      throw Error("expected module error");
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleError);
      expect((error as ModuleError).diagnostic.span?.sourceId).toBe(
        "src/main.lisp",
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
    id: "src/box.lisp",
    source: "(export Box) (type (Box a) (Tagged (Wrap a)))",
  };
  expect(
    checked(
      '(import "./box.lisp" [Box]) (define a (Box.Wrap 42)) (define b (Box.Wrap "text")) b',
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
    id: "src/base.lisp",
    source: "(export value) (define value (construct)) missing-application",
  };
  const files = [
    base,
    { id: "src/a.lisp", source: '(export-from "./base.lisp" [value])' },
    { id: "src/b.lisp", source: '(export-from "./base.lisp" [value])' },
  ];
  const source =
    '(import "./a.lisp" :as a) (import "./b.lisp" :as b) (+ a/value b/value)';
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
