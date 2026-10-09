import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { TsLanguageHost, NodeOcamlLanguageHost } from "../src/index.js";
import type { LanguageHost, SourceDocument } from "../src/types.js";

const cliPath = resolve(
  import.meta.dirname,
  "../../ocaml/dist/native/forma_cli.exe",
);
const native = existsSync(cliPath);
if (process.env["FORMA_REQUIRE_NATIVE_MODULES"] && !native)
  throw Error("Compile-time module parity requires the native CLI.");
const hosts = [
  new TsLanguageHost(),
  ...(native ? [new NodeOcamlLanguageHost({ cliPath })] : []),
];
const directory = resolve(
  import.meta.dirname,
  "../../../conformance/compile-time-modules",
);
const files = readdirSync(directory)
  .filter((n) => n.endsWith(".forma"))
  .map((n) => ({
    sourceId: n,
    source: readFileSync(resolve(directory, n), "utf8"),
    kind: "source" as const,
  }));
async function withSources(
  host: LanguageHost,
  sources: readonly SourceDocument[],
  run: (sessionId: string) => Promise<void>,
) {
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
    await run(sessionId);
  } finally {
    await host.closeSession({ sessionId });
  }
}

describe("compile-time module conformance", () => {
  test.skipIf(!native)(
    "both engines expose the same declarations, data, schemas, and provenance",
    async () => {
      const interfaces: import("@formalang/ts/modules").ModuleInterface[][] =
        [];
      for (const host of hosts)
        await withSources(host, files, async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.forma",
          });
          expect(result.diagnostics).toEqual([]);
          interfaces.push([...result.interfaces]);
        });
      expect(interfaces[1]).toEqual(interfaces[0]);
    },
  );
  for (const host of hosts) {
    test(`${host.constructor.name}: broken references and form checks keep authored spans`, async () => {
      await withSources(host, files, async (sessionId) => {
        const broken = await host.moduleGraph({
          sessionId,
          sourceId: "broken.forma",
        });
        const source = files.find((f) => f.sourceId === "broken.forma")!.source;
        expect(broken.diagnostics[0]).toMatchObject({
          code: "module/private-export",
          span: {
            sourceId: "broken.forma",
            startOffset: source.indexOf("billing/Missing"),
            endOffset:
              source.indexOf("billing/Missing") + "billing/Missing".length,
          },
        });
        const bad = '(import "./stripe.forma" [price]) (price Bad "Bad" -1)';
        const result = await host.moduleGraph({
          sessionId,
          sourceId: "bad.forma",
          source: bad,
        });
        expect(result.diagnostics[0]).toMatchObject({
          message: "Price amount must be nonnegative",
          span: {
            sourceId: "bad.forma",
            startOffset: bad.indexOf("-1"),
            endOffset: bad.indexOf("-1") + 2,
          },
        });
      });
    });
    test(`${host.constructor.name}: project preludes coexist and their changes take effect`, async () => {
      const sources = [
        {
          sourceId: "a/prelude.forma",
          source: "(export answer) (define answer 42)",
        },
        {
          sourceId: "b/prelude.forma",
          source: "(export answer) (define answer 7)",
        },
        {
          sourceId: "b/library.forma",
          source: "(export result) (define result answer)",
        },
        {
          sourceId: "a/main.forma",
          source:
            '(import "../b/library.forma" :as b) (export result) (define result [answer b/result])',
        },
      ];
      await withSources(host, sources, async (sessionId) => {
        await host.configureSession({
          sessionId,
          projects: [
            {
              id: "a",
              base: "a/project",
              prelude: "./prelude.forma",
              modules: ["a/main.forma", "a/prelude.forma"],
            },
            {
              id: "b",
              base: "b/project",
              prelude: "./prelude.forma",
              modules: ["b/library.forma", "b/prelude.forma"],
            },
          ],
        });
        const result = await host.moduleGraph({
          sessionId,
          sourceId: "a/main.forma",
        });
        expect(result.diagnostics).toEqual([]);
        expect(result.interfaces.at(-1)?.exports[0]?.data?.value).toEqual([
          42, 7,
        ]);
        await host.loadSource({
          sessionId,
          sourceId: "b/prelude.forma",
          source: "(export answer) (define answer 9)",
        });
        expect(
          (
            await host.moduleGraph({ sessionId, sourceId: "a/main.forma" })
          ).interfaces.at(-1)?.exports[0]?.data?.value,
        ).toEqual([42, 9]);
      });
    });
    test(`${host.constructor.name}: imported macros keep private helpers`, async () => {
      await withSources(
        host,
        [
          {
            sourceId: "macros.forma",
            source:
              "(export increment) (define helper [x] (+ x 1)) (macro (increment x) `(helper ~x))",
          },
          {
            sourceId: "main.forma",
            source:
              '(import "./macros.forma" [increment]) (define helper [x] "caller") (define answer (increment 41)) (export answer)',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.forma",
          });
          expect(result.diagnostics).toEqual([]);
          expect(result.interfaces.at(-1)?.exports[0]?.data?.value).toBe(42);
          expect(
            await host.evaluateInSession({
              sessionId,
              sourceId: "main.forma",
              source: '(import "./macros.forma" [increment]) (increment 41)',
            }),
          ).toMatchObject({
            status: "completed",
            result: { value: { kind: "int", value: 42 } },
          });
        },
      );
    });
    test(`${host.constructor.name}: private helpers retain transitive imported constants`, async () => {
      const stripe = files.find((f) => f.sourceId === "stripe.forma")!;
      const changed = {
        ...stripe,
        source:
          '(import "./labels.forma" [prefix])\n' +
          stripe.source.replace('(str "Stripe: " label)', "(str prefix label)"),
      };
      await withSources(
        host,
        [
          ...files.filter((f) => f.sourceId !== "stripe.forma"),
          changed,
          {
            sourceId: "labels.forma",
            source: '(export prefix) (define prefix "Stripe: ")',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.forma",
          });
          expect(result.diagnostics).toEqual([]);
          expect(
            JSON.stringify(result.interfaces.at(-1)?.exports[0]?.data?.value),
          ).toContain("Stripe: Monthly");
          expect(
            result.interfaces.at(-1)?.exports[0]?.data?.provenance,
          ).toContainEqual(
            expect.objectContaining({
              identity: { moduleId: "labels.forma", declaration: "prefix" },
            }),
          );
        },
      );
    });
    test(`${host.constructor.name}: kernel sugar is an ordinary dependency`, async () => {
      const kernel = readFileSync(
        resolve(directory, "../../preludes/kernel.forma"),
        "utf8",
      );
      await withSources(
        host,
        [
          { sourceId: "kernel.forma", source: kernel },
          {
            sourceId: "main.forma",
            source:
              '(import "./kernel.forma" [when cond]) (export answer) (define answer (when true (cond false 0 :else 42)))',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.forma",
          });
          expect(result.diagnostics).toEqual([]);
          expect(result.interfaces.at(-1)?.exports[0]?.data?.value).toBe(42);
          const missing = await host.moduleGraph({
            sessionId,
            sourceId: "missing.forma",
            source: "(export answer) (define answer (when true 42))",
          });
          expect(missing.diagnostics.length).toBeGreaterThan(0);
        },
      );
    });
    test(`${host.constructor.name}: reference checks compare declaration classifications`, async () => {
      const source =
        '(import "./salesforce.forma" [picklist-of selected-price]) (picklist-of Plan []) (selected-price Bad Plan)';
      await withSources(host, files, async (sessionId) => {
        const result = await host.moduleGraph({
          sessionId,
          sourceId: "wrong-kind.forma",
          source,
        });
        expect(result.diagnostics[0]).toMatchObject({
          code: "elaborate/reference-type",
          span: {
            sourceId: "wrong-kind.forma",
            startOffset: source.lastIndexOf("Plan"),
            endOffset: source.lastIndexOf("Plan") + 4,
          },
        });
      });
    });
    test(`${host.constructor.name}: macro binders cannot capture caller syntax`, async () => {
      await withSources(
        host,
        [
          {
            sourceId: "macros.forma",
            source:
              "(export wrap) (macro (wrap x) `(let [temporary 7] (+ temporary ~x)))",
          },
          {
            sourceId: "main.forma",
            source:
              '(import "./macros.forma" [wrap]) (define answer (let [temporary 35] (wrap temporary))) (export answer)',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.forma",
          });
          expect(result.diagnostics).toEqual([]);
          expect(result.interfaces.at(-1)?.exports[0]?.data?.value).toBe(42);
          expect(
            await host.evaluateInSession({
              sessionId,
              sourceId: "main.forma",
              source:
                '(import "./macros.forma" [wrap]) (let [temporary 35] (wrap temporary))',
            }),
          ).toMatchObject({
            status: "completed",
            result: { value: { kind: "int", value: 42 } },
          });
        },
      );
    });
    test(`${host.constructor.name}: macros may introduce declarations through private imported forms`, async () => {
      await withSources(
        host,
        [
          ...files,
          {
            sourceId: "macros.forma",
            source:
              '(import "./stripe.forma" [price]) (export charge) (macro (charge name) `(price ~name "Macro" 1200))',
          },
          {
            sourceId: "macro-main.forma",
            source:
              '(import "./macros.forma" [charge]) (export FromMacro) (charge FromMacro)',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "macro-main.forma",
          });
          expect(result.diagnostics).toEqual([]);
          expect(result.interfaces.at(-1)?.exports[0]).toMatchObject({
            kind: "declaration",
            identity: {
              moduleId: "macro-main.forma",
              declaration: "FromMacro",
            },
            declaration: {
              form: { moduleId: "stripe.forma", declaration: "price" },
            },
          });
        },
      );
    });
    test(`${host.constructor.name}: re-exports preserve declaration identity and member provenance`, async () => {
      await withSources(
        host,
        [
          ...files,
          {
            sourceId: "bridge.forma",
            source: '(export-from "./billing.forma" [Monthly prices])',
          },
          {
            sourceId: "reexport-main.forma",
            source:
              '(import "./bridge.forma" :as billing) (import "./salesforce.forma" [picklist-of]) (export Plan) (picklist-of Plan billing/prices)',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "reexport-main.forma",
          });
          expect(result.diagnostics).toEqual([]);
          expect(
            result.interfaces.find((m) => m.moduleId === "bridge.forma")
              ?.exports[0]?.identity,
          ).toEqual({ moduleId: "billing.forma", declaration: "Monthly" });
          expect(
            result.interfaces.at(-1)?.exports[0]?.data?.provenance,
          ).toContainEqual(
            expect.objectContaining({
              path: "/data/entries/0",
              identity: { moduleId: "billing.forma", declaration: "Monthly" },
            }),
          );
        },
      );
    });
    test(`${host.constructor.name}: imported public schemas are inspectable in a library projection`, async () => {
      await withSources(
        host,
        [
          {
            sourceId: "schema.forma",
            source:
              "(export Account) (type Account {:name String :active Bool})",
          },
          {
            sourceId: "mapping.forma",
            source:
              "(export fields-of) (type MappingDecl Symbol) (type MappingIR {:fields Any}) (form (fields-of name schema) :types {:name (Declares MappingDecl) :schema Type} :ir MappingIR {:fields (declaration-fields schema)})",
          },
          {
            sourceId: "main.forma",
            source:
              '(import "./schema.forma" [Account]) (import "./mapping.forma" [fields-of]) (export Mapping) (fields-of Mapping Account)',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.forma",
          });
          expect(result.diagnostics).toEqual([]);
          expect(
            JSON.stringify(result.interfaces.at(-1)?.exports[0]?.data?.value),
          ).toContain('"String"');
          expect(
            result.interfaces.find((m) => m.moduleId === "schema.forma")
              ?.exports[0]?.schema,
          ).toEqual({
            fields: [
              [":name", "String"],
              [":active", "Bool"],
            ],
          });
        },
      );
    });
    test(`${host.constructor.name}: deferred platform syntax remains data`, async () => {
      await withSources(
        host,
        [
          {
            sourceId: "actions.forma",
            source:
              "(export action) (type Action Symbol) (type ActionIR {:body Syntax}) (form (action name body) :types {:name (Declares Action) :body RuntimeExpr} :ir ActionIR {:body body})",
          },
          {
            sourceId: "main.forma",
            source:
              '(import "./actions.forma" [action]) (export Save) (action Save (update! Account {:name "future"}))',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.forma",
          });
          expect(result.diagnostics).toEqual([]);
          expect(
            JSON.stringify(result.interfaces.at(-1)?.exports[0]?.data?.value),
          ).toContain("update!");
        },
      );
    });
    test(`${host.constructor.name}: a private projection helper edit refreshes derived data`, async () => {
      await withSources(host, files, async (sessionId) => {
        const before = await host.moduleGraph({
          sessionId,
          sourceId: "main.forma",
        });
        const stripe = files.find((f) => f.sourceId === "stripe.forma")!;
        await host.loadSource({
          sessionId,
          sourceId: "stripe.forma",
          source: stripe.source.replace('"Stripe: "', '"Price: "'),
        });
        const after = await host.moduleGraph({
          sessionId,
          sourceId: "main.forma",
        });
        expect(after.diagnostics).toEqual([]);
        expect(after.interfaces.at(-1)?.exports[0]?.identity).toEqual(
          before.interfaces.at(-1)?.exports[0]?.identity,
        );
        expect(after.interfaces.at(-1)?.exports[0]?.data?.value).not.toEqual(
          before.interfaces.at(-1)?.exports[0]?.data?.value,
        );
      });
    });
  }
});
