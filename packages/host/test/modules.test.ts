import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expectModuleGolden } from "./module-golden.js";
import { TsLanguageHost } from "../src/index.js";
import type { LanguageHost } from "../src/types.js";
const hosts = [new TsLanguageHost()];
const fixture = resolve(import.meta.dirname, "../../../conformance/modules");
const sources = [
  "ids.lisp",
  "log.lisp",
  "identity.lisp",
  "state.lisp",
  "main.lisp",
].map((name) => ({
  kind: "source" as const,
  sourceId: name,
  source: readFileSync(resolve(fixture, name), "utf8"),
}));
describe("module contracts", () => {
  test(
    "interfaces and linked artifacts agree, including reverse source loading",
    async () => {
      for (const host of hosts) {
        const { sessionId } = await host.openSession();
        try {
          expect(
            (
              await host.loadSourceBundle({
                sessionId,
                sources: [...sources].reverse(),
              })
            ).diagnostics,
          ).toEqual([]);
          const graph = await host.moduleGraph({
            sessionId,
            sourceId: "main.lisp",
          });
          expect(graph.diagnostics).toEqual([]);
          const linked = await host.linkEffectModules({
            sessionId,
            sourceId: "main.lisp",
          });
          expect(linked.diagnostics).toEqual([]);
          expectModuleGolden(host, fixture, "interfaces-and-linked-modules", {
            interfaces: graph.interfaces,
            modules: linked.modules,
          });
        } finally {
          await host.closeSession({ sessionId });
        }
      }
    },
  );
  for (const host of hosts)
    test(`${host.name}: private scopes, polymorphism, brands, constructors, cycles, and re-export identity`, async () => {
      const { sessionId } = await host.openSession();
      const load = async (sourceId: string, source: string) =>
        expect(
          (await host.loadSource({ sessionId, sourceId, source })).diagnostics,
        ).toEqual([]);
      const check = async (source: string) =>
        await host.typecheck({ sessionId, sourceId: "query.lisp", source });
      try {
        await load(
          "id.lisp",
          "(export identity) (define identity [x] x) (define secret 42)",
        );
        expect(
          (await check("(identity 1)")).diagnostics.length,
        ).toBeGreaterThan(0);
        expect(
          (
            await check(
              '(import "./id.lisp" [identity]) (define a (identity 1)) (identity "text")',
            )
          ).diagnostics,
        ).toEqual([]);
        const evaluated = await host.evaluateInSession({
          sessionId,
          sourceId: "query.lisp",
          source: '(import "./id.lisp" [identity]) (identity "text")',
        });
        expect(evaluated).toMatchObject({
          status: "completed",
          result: { value: { kind: "string", value: "text" } },
        });
        await load("barrel.lisp", '(export-from "./id.lisp" [identity])');
        const reexport = await host.moduleGraph({
          sessionId,
          sourceId: "barrel.lisp",
        });
        expect(reexport.interfaces.at(-1)?.exports[0]?.identity).toEqual({
          moduleId: "id.lisp",
          declaration: "identity",
        });
        expect(
          (await check('(import "./id.lisp" [secret]) secret')).diagnostics[0],
        ).toMatchObject({
          code: "module/private-export",
          span: { sourceId: "query.lisp" },
        });
        await load(
          "a.lisp",
          '(export Id take Choice) (type Id (Brand String)) (: take (-> Id String)) (define take [id] "ok") (type Choice (Tagged (Yes Int) No))',
        );
        await load("b.lisp", "(export Id) (type Id (Brand String))");
        expect(
          (
            await check(
              '(import "./a.lisp" :as a) (import "./b.lisp" :as b) (a/take (b/Id "wrong"))',
            )
          ).diagnostics.length,
        ).toBeGreaterThan(0);
        expect(
          (await check('(import "./a.lisp" [Choice]) (Choice.Yes 1)'))
            .diagnostics,
        ).toEqual([]);
        expect(
          (await check('(import "./a.lisp" [Choice]) (Yes 1)')).diagnostics
            .length,
        ).toBeGreaterThan(0);
        await load("cycle-a.lisp", '(import "./cycle-b.lisp" [])');
        await load("cycle-b.lisp", '(import "./cycle-a.lisp" [])');
        const cycle = await check('(import "./cycle-a.lisp" [])');
        expect(cycle.diagnostics[0]).toMatchObject({
          code: "module/cycle",
          span: { sourceId: "cycle-b.lisp", startOffset: 8 },
        });
        expect(cycle.diagnostics[0]?.message).toContain(
          "query.lisp -> cycle-a.lisp -> cycle-b.lisp -> cycle-a.lisp",
        );
      } finally {
        await host.closeSession({ sessionId });
      }
    });
});

for (const host of hosts)
  test(`${host.name}: entry expressions are explicit and sessions cannot publish source definitions`, async () => {
    const { sessionId } = await host.openSession();
    try {
      expect(
        (
          await host.loadSource({
            sessionId,
            sourceId: "library.lisp",
            source: "(export value) (define value 42) missing-application",
          })
        ).diagnostics,
      ).toEqual([]);
      // Import initializes definitions; a library's trailing application is not run.
      expect(
        await host.evaluateInSession({
          sessionId,
          sourceId: "app.lisp",
          source: '(import "./library.lisp" [value]) value',
        }),
      ).toMatchObject({
        status: "completed",
        result: { value: { kind: "int", value: 42 } },
      });
      await host.evaluateInSession({
        sessionId,
        source: "(define ambient-secret 123)",
      });
      expect(
        (await host.evaluateInSession({ sessionId, source: "ambient-secret" }))
          .status,
      ).toBe("failed");
      const privateType = await host.typecheck({
        sessionId,
        sourceId: "app.lisp",
        source:
          '(export expose) (type Secret (Brand String)) (: expose (-> Secret String)) (define expose [x] "x")',
      });
      expect(privateType.diagnostics[0]).toMatchObject({
        code: "module/private-type",
        span: { sourceId: "app.lisp" },
      });
      const compileTime = await host.moduleGraph({
        sessionId,
        sourceId: "app.lisp",
        source: "(export m) (macro (m x) x)",
      });
      expect(compileTime.diagnostics).toEqual([]);
      expect(compileTime.interfaces.at(-1)?.exports[0]?.kind).toBe("macro");
    } finally {
      await host.closeSession({ sessionId });
    }
  });

for (const host of hosts)
  test(`${host.name}: explicit imports work through suspended host calls`, async () => {
    const { sessionId } = await host.openSession();
    try {
      await host.configureSession({
        sessionId,
        hostBuiltins: [
          {
            name: "host-label",
            arity: 1,
            handler: { kind: "host-effect", effect: "test/label" },
          },
        ],
      });
      await host.loadSource({
        sessionId,
        sourceId: "helper.lisp",
        source: "(export double) (define double [x] (+ x x))",
      });
      const state = await host.evaluateInSession({
        sessionId,
        sourceId: "main.lisp",
        source:
          '(import "./helper.lisp" [double]) (define secret 99) (host-label (double 21))',
      });
      expect(state).toMatchObject({
        status: "host-call",
        call: { name: "host-label", args: [{ kind: "int", value: 42 }] },
      });
      if (state.status !== "host-call")
        throw Error("expected suspended host call");
      expect(
        await host.resumeHostCall({
          sessionId,
          evaluationId: state.call.evaluationId,
          callId: state.call.callId,
          result: { ok: true, value: { kind: "string", value: "answer" } },
        }),
      ).toMatchObject({
        status: "completed",
        result: { value: { kind: "string", value: "answer" } },
      });
      expect(
        (await host.evaluateInSession({ sessionId, source: "secret" })).status,
      ).toBe("failed");
    } finally {
      await host.closeSession({ sessionId });
    }
  });

test(
  "portable schemes preserve multiple quantifiers, open rows, and variadic imports",
  async () => {
    for (const host of hosts) {
      const { sessionId } = await host.openSession();
      try {
        await host.loadSource({
          sessionId,
          sourceId: "functions.lisp",
          source:
            "(export second name rest square total) (define second [a b] b) (define name [record] record.name) (define rest [& items] items) (define square [x] (* x x)) (define total [xs] (reduce + 0 xs))",
        });
        const result = await host.moduleGraph({
          sessionId,
          sourceId: "functions.lisp",
        });
        expect(result.diagnostics).toEqual([]);
        expect(
          result.interfaces[0]?.exports.every((b) => b.scheme !== undefined),
        ).toBe(true);
        expectModuleGolden(host, fixture, "portable-schemes", result.interfaces);
        expect(
          (
            await host.typecheck({
              sessionId,
              sourceId: "main.lisp",
              source:
                '(import "./functions.lisp" [name second rest]) (define a (name {:name "Ada" :extra 1})) (define b (name {:name 42})) (define c (second 1 "s")) (rest 1 2 3)',
            })
          ).diagnostics,
        ).toEqual([]);
      } finally {
        await host.closeSession({ sessionId });
      }
    }
  },
);

for (const host of hosts)
  test(`${host.name}: local form validation retains caller spans after resolution`, async () => {
    const { sessionId } = await host.openSession();
    try {
      const source =
        "(type GreetingIR {:text String}) (form (greet text) :types {:text String} :ir GreetingIR {:text text}) (export value) (define value 0) (greet 42)";
      const result = await host.typecheck({
        sessionId,
        sourceId: "main.lisp",
        source,
      });
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.span).toMatchObject({
        sourceId: "main.lisp",
        startOffset: source.indexOf("42"),
        endOffset: source.indexOf("42") + 2,
      });
    } finally {
      await host.closeSession({ sessionId });
    }
  });

for (const host of hosts)
  test(`${host.name}: imported generic tagged constructors instantiate independently`, async () => {
    const { sessionId } = await host.openSession();
    try {
      expect(
        (
          await host.loadSource({
            sessionId,
            sourceId: "box.lisp",
            source:
              "(export Box) (type (Box a) (Tagged (Full {:value a}) Empty))",
          })
        ).diagnostics,
      ).toEqual([]);
      const source =
        '(import "./box.lisp" [Box]) (define number (Box.Full {:value 1})) (define text (Box.Full {:value "s"})) {:number number :text text}';
      expect(
        (await host.typecheck({ sessionId, sourceId: "main.lisp", source }))
          .diagnostics,
      ).toEqual([]);
      expect(
        await host.evaluateInSession({
          sessionId,
          sourceId: "main.lisp",
          source,
        }),
      ).toMatchObject({
        status: "completed",
        result: {
          value: {
            kind: "map",
            entries: [{ value: { kind: "map" } }, { value: { kind: "map" } }],
          },
        },
      });
    } finally {
      await host.closeSession({ sessionId });
    }
  });

for (const host of hosts)
  test(`${host.name}: project prelude helpers and configured variables are explicit`, async () => {
    const { sessionId } = await host.openSession();
    try {
      await host.configureSession({
        sessionId,
        variables: [{ name: "tenant", value: { kind: "int", value: 42 } }],
      });
      expect(
        (
          await host.loadSource({
            sessionId,
            kind: "source",
            sourceId: "core.lisp",
            source: "(export coreIdentity) (define coreIdentity [x] x)",
          })
        ).diagnostics,
      ).toEqual([]);
      await host.configureSession({
        sessionId,
        projects: [
          {
            id: "app",
            base: "project",
            prelude: "./core.lisp",
            modules: ["main.lisp", "core.lisp"],
          },
        ],
      });
      const source =
        "(export answer) (define answer (coreIdentity tenant)) answer";
      expect(
        (
          await host.loadSource({
            sessionId,
            sourceId: "./cache/../main.lisp",
            source,
          })
        ).diagnostics,
      ).toEqual([]);
      expect(
        (await host.moduleGraph({ sessionId, sourceId: "main.lisp" }))
          .diagnostics,
      ).toEqual([]);
      expect(
        await host.evaluateInSession({
          sessionId,
          sourceId: "./main.lisp",
        }),
      ).toMatchObject({
        status: "completed",
        result: { value: { kind: "int", value: 42 }, diagnostics: [] },
      });
    } finally {
      await host.closeSession({ sessionId });
    }
  });

for (const host of hosts)
  test(`${host.name}: failures in imported closures point to the defining author`, async () => {
    const { sessionId } = await host.openSession();
    try {
      await host.loadSource({
        sessionId,
        sourceId: "failure.lisp",
        source: '(export explode) (define explode [] (+ 1 "bad"))',
      });
      const result = await host.evaluateInSession({
        sessionId,
        sourceId: "main.lisp",
        source: '(import "./failure.lisp" [explode]) (explode)',
      });
      expect(result).toMatchObject({
        status: "failed",
        diagnostics: [{ span: { sourceId: "failure.lisp" } }],
      });
    } finally {
      await host.closeSession({ sessionId });
    }
  });

for (const host of hosts)
  test(`${host.name}: imported record types fill optional fields and allow field access`, async () => {
    const dir = resolve(fixture, "imported-records");
    const { sessionId } = await host.openSession();
    try {
      expect(
        (
          await host.loadSource({
            sessionId,
            sourceId: "shapes.lisp",
            source: readFileSync(resolve(dir, "shapes.lisp"), "utf8"),
          })
        ).diagnostics,
      ).toEqual([]);
      const source = readFileSync(resolve(dir, "main.lisp"), "utf8");
      const checked = await host.typecheck({ sessionId, sourceId: "main.lisp", source });
      expect(checked.diagnostics).toEqual([]);
      expect(
        await host.evaluateInSession({ sessionId, sourceId: "main.lisp", source }),
      ).toMatchObject({ status: "completed", result: { printed: "[7 -1 4]" } });
    } finally {
      await host.closeSession({ sessionId });
    }
  });
