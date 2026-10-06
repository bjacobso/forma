import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TsLanguageHost, NodeOcamlLanguageHost } from "../src/index.js";
import type { LanguageHost } from "../src/types.js";
const cliPath = resolve(
  import.meta.dirname,
  "../../ocaml/dist/native/forma_cli.exe",
);
const nativeAvailable = existsSync(cliPath);
if (process.env["FORMA_REQUIRE_NATIVE_MODULES"] && !nativeAvailable)
  throw new Error("Native module conformance requires a built CLI.");
const hosts = [
  new TsLanguageHost(),
  ...(nativeAvailable ? [new NodeOcamlLanguageHost({ cliPath })] : []),
];
const fixture = resolve(import.meta.dirname, "../../../conformance/modules");
const sources = [
  "ids.forma",
  "log.forma",
  "identity.forma",
  "state.forma",
  "main.forma",
].map((name) => ({
  kind: "source" as const,
  sourceId: name,
  source: readFileSync(resolve(fixture, name), "utf8"),
}));
describe("module contracts across engines", () => {
  test.skipIf(!nativeAvailable)(
    "interfaces and linked artifacts agree, including reverse source loading",
    async () => {
      const results = [];
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
            sourceId: "main.forma",
          });
          expect(graph.diagnostics).toEqual([]);
          const linked = await host.linkEffectModules({
            sessionId,
            sourceId: "main.forma",
          });
          expect(linked.diagnostics).toEqual([]);
          results.push({
            interfaces: graph.interfaces,
            modules: linked.modules,
          });
        } finally {
          await host.closeSession({ sessionId });
        }
      }
      expect(results[1]).toEqual(results[0]);
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
        await host.typecheck({ sessionId, sourceId: "query.forma", source });
      try {
        await load(
          "id.forma",
          "(export identity) (define identity [x] x) (define secret 42)",
        );
        expect(
          (await check("(identity 1)")).diagnostics.length,
        ).toBeGreaterThan(0);
        expect(
          (
            await check(
              '(import "./id.forma" [identity]) (define a (identity 1)) (identity "text")',
            )
          ).diagnostics,
        ).toEqual([]);
        const evaluated = await host.evaluateInSession({
          sessionId,
          sourceId: "query.forma",
          source: '(import "./id.forma" [identity]) (identity "text")',
        });
        expect(evaluated).toMatchObject({
          status: "completed",
          result: { value: { kind: "string", value: "text" } },
        });
        await load("barrel.forma", '(export-from "./id.forma" [identity])');
        const reexport = await host.moduleGraph({
          sessionId,
          sourceId: "barrel.forma",
        });
        expect(reexport.interfaces.at(-1)?.exports[0]?.identity).toEqual({
          moduleId: "id.forma",
          declaration: "identity",
        });
        expect(
          (await check('(import "./id.forma" [secret]) secret')).diagnostics[0],
        ).toMatchObject({
          code: "module/private-export",
          span: { sourceId: "query.forma" },
        });
        await load(
          "a.forma",
          '(export Id take Choice) (type Id (Brand String)) (: take (-> Id String)) (define take [id] "ok") (type Choice (Tagged (Yes Int) No))',
        );
        await load("b.forma", "(export Id) (type Id (Brand String))");
        expect(
          (
            await check(
              '(import "./a.forma" :as a) (import "./b.forma" :as b) (a/take (b/Id "wrong"))',
            )
          ).diagnostics.length,
        ).toBeGreaterThan(0);
        expect(
          (await check('(import "./a.forma" [Choice]) (Choice.Yes 1)'))
            .diagnostics,
        ).toEqual([]);
        expect(
          (await check('(import "./a.forma" [Choice]) (Yes 1)')).diagnostics
            .length,
        ).toBeGreaterThan(0);
        await load("cycle-a.forma", '(import "./cycle-b.forma" [])');
        await load("cycle-b.forma", '(import "./cycle-a.forma" [])');
        const cycle = await check('(import "./cycle-a.forma" [])');
        expect(cycle.diagnostics[0]).toMatchObject({
          code: "module/cycle",
          span: { sourceId: "cycle-b.forma", startOffset: 8 },
        });
        expect(cycle.diagnostics[0]?.message).toContain(
          "query.forma -> cycle-a.forma -> cycle-b.forma -> cycle-a.forma",
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
            sourceId: "library.forma",
            source: "(export value) (define value 42) missing-application",
          })
        ).diagnostics,
      ).toEqual([]);
      // Import initializes definitions; a library's trailing application is not run.
      expect(
        await host.evaluateInSession({
          sessionId,
          sourceId: "app.forma",
          source: '(import "./library.forma" [value]) value',
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
        sourceId: "app.forma",
        source:
          '(export expose) (type Secret (Brand String)) (: expose (-> Secret String)) (define expose [x] "x")',
      });
      expect(privateType.diagnostics[0]).toMatchObject({
        code: "module/private-type",
        span: { sourceId: "app.forma" },
      });
      const compileTime = await host.moduleGraph({
        sessionId,
        sourceId: "app.forma",
        source: "(export m) (macro (m x) x)",
      });
      expect(compileTime.diagnostics[0]?.code).toBe(
        "module/compile-time-stage",
      );
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
        sourceId: "helper.forma",
        source: "(export double) (define double [x] (+ x x))",
      });
      const state = await host.evaluateInSession({
        sessionId,
        sourceId: "main.forma",
        source:
          '(import "./helper.forma" [double]) (define secret 99) (host-label (double 21))',
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

test.skipIf(!nativeAvailable)(
  "portable schemes preserve multiple quantifiers, open rows, and variadic imports",
  async () => {
    const interfaces = [];
    for (const host of hosts) {
      const { sessionId } = await host.openSession();
      try {
        await host.loadSource({
          sessionId,
          sourceId: "functions.forma",
          source:
            "(export second name rest) (define second [a b] b) (define name [record] record.name) (define rest [& items] items)",
        });
        const result = await host.moduleGraph({
          sessionId,
          sourceId: "functions.forma",
        });
        expect(result.diagnostics).toEqual([]);
        expect(
          result.interfaces[0]?.exports.every((b) => b.scheme !== undefined),
        ).toBe(true);
        interfaces.push(result.interfaces);
        expect(
          (
            await host.typecheck({
              sessionId,
              sourceId: "main.forma",
              source:
                '(import "./functions.forma" [name second rest]) (define a (name {:name "Ada" :extra 1})) (define b (name {:name 42})) (define c (second 1 "s")) (rest 1 2 3)',
            })
          ).diagnostics,
        ).toEqual([]);
      } finally {
        await host.closeSession({ sessionId });
      }
    }
    expect(interfaces[1]).toEqual(interfaces[0]);
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
        sourceId: "main.forma",
        source,
      });
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.span).toMatchObject({
        sourceId: "main.forma",
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
            sourceId: "box.forma",
            source:
              "(export Box) (type (Box a) (Tagged (Full {:value a}) Empty))",
          })
        ).diagnostics,
      ).toEqual([]);
      const source =
        '(import "./box.forma" [Box]) (define number (Box.Full {:value 1})) (define text (Box.Full {:value "s"})) {:number number :text text}';
      expect(
        (await host.typecheck({ sessionId, sourceId: "main.forma", source }))
          .diagnostics,
      ).toEqual([]);
      expect(
        await host.evaluateInSession({
          sessionId,
          sourceId: "main.forma",
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
  test(`${host.name}: configured core helpers and variables are shared explicitly`, async () => {
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
            kind: "prelude",
            sourceId: "core.forma",
            source: "(define coreIdentity [x] x)",
          })
        ).diagnostics,
      ).toEqual([]);
      const source =
        "(export answer) (define answer (coreIdentity tenant)) answer";
      expect(
        (
          await host.loadSource({
            sessionId,
            sourceId: "./cache/../main.forma",
            source,
          })
        ).diagnostics,
      ).toEqual([]);
      expect(
        (await host.moduleGraph({ sessionId, sourceId: "main.forma" }))
          .diagnostics,
      ).toEqual([]);
      expect(
        await host.evaluateInSession({
          sessionId,
          sourceId: "./main.forma",
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
        sourceId: "failure.forma",
        source: '(export explode) (define explode [] (+ 1 "bad"))',
      });
      const result = await host.evaluateInSession({
        sessionId,
        sourceId: "main.forma",
        source: '(import "./failure.forma" [explode]) (explode)',
      });
      expect(result).toMatchObject({
        status: "failed",
        diagnostics: [{ span: { sourceId: "failure.forma" } }],
      });
    } finally {
      await host.closeSession({ sessionId });
    }
  });
