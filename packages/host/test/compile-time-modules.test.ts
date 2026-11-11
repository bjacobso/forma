import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { expectModuleGolden } from "./module-golden.js";
import { TsLanguageHost } from "../src/index.js";
import type { LanguageHost, SourceDocument } from "../src/types.js";

const hosts = [new TsLanguageHost()];
const directory = resolve(
  import.meta.dirname,
  "../../../conformance/compile-time-modules",
);
const files = readdirSync(directory)
  .filter((n) => n.endsWith(".lisp"))
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
  test(
    "declarations, data, schemas, and provenance match stored goldens",
    async () => {
      for (const host of hosts)
        await withSources(host, files, async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.lisp",
          });
          expect(result.diagnostics).toEqual([]);
          expectModuleGolden(host, directory, "interfaces", result.interfaces);
        });
    },
  );
  for (const host of hosts) {
    test(`${host.constructor.name}: broken references and form checks keep authored spans`, async () => {
      await withSources(host, files, async (sessionId) => {
        const broken = await host.moduleGraph({
          sessionId,
          sourceId: "broken.lisp",
        });
        const source = files.find((f) => f.sourceId === "broken.lisp")!.source;
        expect(broken.diagnostics[0]).toMatchObject({
          code: "module/private-export",
          span: {
            sourceId: "broken.lisp",
            startOffset: source.indexOf("billing/Missing"),
            endOffset:
              source.indexOf("billing/Missing") + "billing/Missing".length,
          },
        });
        const bad = '(import "./stripe.lisp" [price]) (price Bad "Bad" -1)';
        const result = await host.moduleGraph({
          sessionId,
          sourceId: "bad.lisp",
          source: bad,
        });
        expect(result.diagnostics[0]).toMatchObject({
          message: "Price amount must be nonnegative",
          span: {
            sourceId: "bad.lisp",
            startOffset: bad.indexOf("-1"),
            endOffset: bad.indexOf("-1") + 2,
          },
        });
      });
    });
    test(`${host.constructor.name}: project preludes coexist and their changes take effect`, async () => {
      const sources = [
        {
          sourceId: "a/prelude.lisp",
          source: "(export answer) (define answer 42)",
        },
        {
          sourceId: "b/prelude.lisp",
          source: "(export answer) (define answer 7)",
        },
        {
          sourceId: "b/library.lisp",
          source: "(export result) (define result answer)",
        },
        {
          sourceId: "a/main.lisp",
          source:
            '(import "../b/library.lisp" :as b) (export result) (define result [answer b/result])',
        },
      ];
      await withSources(host, sources, async (sessionId) => {
        await host.configureSession({
          sessionId,
          projects: [
            {
              id: "a",
              base: "a/project",
              prelude: "./prelude.lisp",
              modules: ["a/main.lisp", "a/prelude.lisp"],
            },
            {
              id: "b",
              base: "b/project",
              prelude: "./prelude.lisp",
              modules: ["b/library.lisp", "b/prelude.lisp"],
            },
          ],
        });
        const result = await host.moduleGraph({
          sessionId,
          sourceId: "a/main.lisp",
        });
        expect(result.diagnostics).toEqual([]);
        expect(result.interfaces.at(-1)?.exports[0]?.data?.value).toEqual([
          42, 7,
        ]);
        await host.loadSource({
          sessionId,
          sourceId: "b/prelude.lisp",
          source: "(export answer) (define answer 9)",
        });
        expect(
          (
            await host.moduleGraph({ sessionId, sourceId: "a/main.lisp" })
          ).interfaces.at(-1)?.exports[0]?.data?.value,
        ).toEqual([42, 9]);
      });
    });
    test(`${host.constructor.name}: imported macros keep private helpers`, async () => {
      await withSources(
        host,
        [
          {
            sourceId: "macros.lisp",
            source:
              "(export increment) (define helper [x] (+ x 1)) (macro (increment x) `(helper ~x))",
          },
          {
            sourceId: "main.lisp",
            source:
              '(import "./macros.lisp" [increment]) (define helper [x] "caller") (define answer (increment 41)) (export answer)',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.lisp",
          });
          expect(result.diagnostics).toEqual([]);
          expect(result.interfaces.at(-1)?.exports[0]?.data?.value).toBe(42);
          expect(
            await host.evaluateInSession({
              sessionId,
              sourceId: "main.lisp",
              source: '(import "./macros.lisp" [increment]) (increment 41)',
            }),
          ).toMatchObject({
            status: "completed",
            result: { value: { kind: "int", value: 42 } },
          });
        },
      );
    });
    test(`${host.constructor.name}: private helpers retain transitive imported constants`, async () => {
      const stripe = files.find((f) => f.sourceId === "stripe.lisp")!;
      const changed = {
        ...stripe,
        source:
          '(import "./labels.lisp" [prefix])\n' +
          stripe.source.replace('(str "Stripe: " label)', "(str prefix label)"),
      };
      await withSources(
        host,
        [
          ...files.filter((f) => f.sourceId !== "stripe.lisp"),
          changed,
          {
            sourceId: "labels.lisp",
            source: '(export prefix) (define prefix "Stripe: ")',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.lisp",
          });
          expect(result.diagnostics).toEqual([]);
          expect(
            JSON.stringify(result.interfaces.at(-1)?.exports[0]?.data?.value),
          ).toContain("Stripe: Monthly");
          expect(
            result.interfaces.at(-1)?.exports[0]?.data?.provenance,
          ).toContainEqual(
            expect.objectContaining({
              identity: { moduleId: "labels.lisp", declaration: "prefix" },
            }),
          );
        },
      );
    });
    test(`${host.constructor.name}: form checks call imported helpers and report every failing application`, async () => {
      const dir = resolve(directory, "hook-imports");
      const fixture = (sourceId: string, source = readFileSync(resolve(dir, sourceId), "utf8")) =>
        ({ sourceId, source, kind: "source" as const });
      const kernel = fixture("../../../preludes/modules/kernel.lisp", readFileSync(resolve(directory, "../../preludes/modules/kernel.lisp"), "utf8"));
      await withSources(
        host,
        [kernel, fixture("rules.lisp"), fixture("forms.lisp")],
        async (sessionId) => {
          const ledger = await host.moduleGraph({ sessionId, sourceId: "ledger.lisp", source: fixture("ledger.lisp").source });
          expect(ledger.diagnostics).toEqual([]);
          expect(JSON.stringify(ledger.interfaces.at(-1)?.exports[0]?.data?.value)).toMatch(/due\D{0,30}31/);
          const over = fixture("over.lisp").source;
          const rejected = await host.moduleGraph({ sessionId, sourceId: "over.lisp", source: over });
          // A helper that fails at run time is reported at the application,
          // naming the helper and its location in author terms.
          const broken = '(import "./rules.lisp" [limit]) (export bad) (define bad [x] ((first x) limit))';
          const caller = '(import "./forms-broken.lisp" [spend]) (spend tea 1 1)';
          await host.loadSource({ sessionId, sourceId: "helpers.lisp", source: broken });
          await host.loadSource({ sessionId, sourceId: "forms-broken.lisp", source: fixture("forms.lisp").source
            .replace('(import "./rules.lisp" [next-day within-limit?])', '(import "./rules.lisp" [next-day within-limit?]) (import "./helpers.lisp" [bad])')
            .replace("(within-limit? (get h :amount))", "(bad [(get h :amount)])") });
          const failed = await host.moduleGraph({ sessionId, sourceId: "caller.lisp", source: caller });
          expect(failed.diagnostics).toMatchObject([{
            code: "elaborate/hook-failed",
            span: { sourceId: "caller.lisp", startOffset: caller.indexOf("(spend tea") },
          }]);
          expect(failed.diagnostics[0]!.message).toMatch(/^:check <anonymous> of form spend: Cannot call Int as function \(in bad\)$/);
          // Every failing application is reported, each at its own hole.
          expect(rejected.diagnostics).toMatchObject(["250", "900"].map((amount) => ({
            code: "spend/over-limit",
            span: { sourceId: "over.lisp", startOffset: over.indexOf(amount), endOffset: over.indexOf(amount) + 3 },
          })));
        },
      );
    });
    test(`${host.constructor.name}: kernel sugar is an ordinary dependency`, async () => {
      const kernel = readFileSync(
        resolve(directory, "../../preludes/modules/kernel.lisp"),
        "utf8",
      );
      await withSources(
        host,
        [
          { sourceId: "kernel.lisp", source: kernel },
          {
            sourceId: "main.lisp",
            source:
              '(import "./kernel.lisp" [when cond]) (export answer) (define answer (when true (cond false 0 :else 42)))',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.lisp",
          });
          expect(result.diagnostics).toEqual([]);
          expect(result.interfaces.at(-1)?.exports[0]?.data?.value).toBe(42);
          const missing = await host.moduleGraph({
            sessionId,
            sourceId: "missing.lisp",
            source: "(export answer) (define answer (when true 42))",
          });
          expect(missing.diagnostics.length).toBeGreaterThan(0);
        },
      );
    });
    test(`${host.constructor.name}: Clojure spellings are an ordinary library`, async () => {
      const read = (name: string) =>
        readFileSync(resolve(directory, `../../preludes/modules/${name}`), "utf8");
      await withSources(
        host,
        [
          { sourceId: "kernel.lisp", source: read("kernel.lisp") },
          { sourceId: "clojure.lisp", source: read("clojure.lisp") },
          {
            sourceId: "main.lisp",
            source: [
              '(import "./clojure.lisp" [def defn if-let if-not ->])',
              "(export answer)",
              "(def base 40)",
              '(defn add "Add two." [a b] (+ a b))',
              "(defn pick [o] (if-let [v o] v 0))",
              "(define answer (if-not false (-> base (add (pick (Some 2)))) 0))",
            ].join("\n"),
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.lisp",
          });
          expect(result.diagnostics).toEqual([]);
          expect(result.interfaces.at(-1)?.exports[0]?.data?.value).toBe(42);
          const unclaimed = await host.moduleGraph({
            sessionId,
            sourceId: "unclaimed.lisp",
            source: "(define g 1) (defn f [x] x)",
          });
          expect(unclaimed.diagnostics[0]).toMatchObject({
            code: "surface/invalid-form",
            message: expect.stringContaining("Use define instead of defn"),
          });
        },
      );
    });
    test(`${host.constructor.name}: reference checks compare declaration classifications`, async () => {
      const source =
        '(import "./salesforce.lisp" [picklist-of selected-price]) (picklist-of Plan []) (selected-price Bad Plan)';
      await withSources(host, files, async (sessionId) => {
        const result = await host.moduleGraph({
          sessionId,
          sourceId: "wrong-kind.lisp",
          source,
        });
        expect(result.diagnostics[0]).toMatchObject({
          code: "elaborate/reference-type",
          span: {
            sourceId: "wrong-kind.lisp",
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
            sourceId: "macros.lisp",
            source:
              "(export wrap) (macro (wrap x) `(let [temporary 7] (+ temporary ~x)))",
          },
          {
            sourceId: "main.lisp",
            source:
              '(import "./macros.lisp" [wrap]) (define answer (let [temporary 35] (wrap temporary))) (export answer)',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.lisp",
          });
          expect(result.diagnostics).toEqual([]);
          expect(result.interfaces.at(-1)?.exports[0]?.data?.value).toBe(42);
          expect(
            await host.evaluateInSession({
              sessionId,
              sourceId: "main.lisp",
              source:
                '(import "./macros.lisp" [wrap]) (let [temporary 35] (wrap temporary))',
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
            sourceId: "macros.lisp",
            source:
              '(import "./stripe.lisp" [price]) (export charge) (macro (charge name) `(price ~name "Macro" 1200))',
          },
          {
            sourceId: "macro-main.lisp",
            source:
              '(import "./macros.lisp" [charge]) (export FromMacro) (charge FromMacro)',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "macro-main.lisp",
          });
          expect(result.diagnostics).toEqual([]);
          expect(result.interfaces.at(-1)?.exports[0]).toMatchObject({
            kind: "declaration",
            identity: {
              moduleId: "macro-main.lisp",
              declaration: "FromMacro",
            },
            declaration: {
              form: { moduleId: "stripe.lisp", declaration: "price" },
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
            sourceId: "bridge.lisp",
            source: '(export-from "./billing.lisp" [Monthly prices])',
          },
          {
            sourceId: "reexport-main.lisp",
            source:
              '(import "./bridge.lisp" :as billing) (import "./salesforce.lisp" [picklist-of]) (export Plan) (picklist-of Plan billing/prices)',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "reexport-main.lisp",
          });
          expect(result.diagnostics).toEqual([]);
          expect(
            result.interfaces.find((m) => m.moduleId === "bridge.lisp")
              ?.exports[0]?.identity,
          ).toEqual({ moduleId: "billing.lisp", declaration: "Monthly" });
          expect(
            result.interfaces.at(-1)?.exports[0]?.data?.provenance,
          ).toContainEqual(
            expect.objectContaining({
              path: "/data/entries/0",
              identity: { moduleId: "billing.lisp", declaration: "Monthly" },
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
            sourceId: "schema.lisp",
            source:
              "(export Account) (type Account {:name String :active Bool})",
          },
          {
            sourceId: "mapping.lisp",
            source:
              "(export fields-of) (type MappingDecl Symbol) (type MappingIR {:fields Any}) (form (fields-of name schema) :types {:name (Declares MappingDecl) :schema Type} :ir MappingIR {:fields (declaration-fields schema)})",
          },
          {
            sourceId: "main.lisp",
            source:
              '(import "./schema.lisp" [Account]) (import "./mapping.lisp" [fields-of]) (export Mapping) (fields-of Mapping Account)',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.lisp",
          });
          expect(result.diagnostics).toEqual([]);
          expect(
            JSON.stringify(result.interfaces.at(-1)?.exports[0]?.data?.value),
          ).toContain('"String"');
          expect(
            result.interfaces.find((m) => m.moduleId === "schema.lisp")
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
            sourceId: "actions.lisp",
            source:
              "(export action) (type Action Symbol) (type ActionIR {:body Syntax}) (form (action name body) :types {:name (Declares Action) :body RuntimeExpr} :ir ActionIR {:body body})",
          },
          {
            sourceId: "main.lisp",
            source:
              '(import "./actions.lisp" [action]) (export Save) (action Save (update! Account {:name "future"}))',
          },
        ],
        async (sessionId) => {
          const result = await host.moduleGraph({
            sessionId,
            sourceId: "main.lisp",
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
          sourceId: "main.lisp",
        });
        const stripe = files.find((f) => f.sourceId === "stripe.lisp")!;
        await host.loadSource({
          sessionId,
          sourceId: "stripe.lisp",
          source: stripe.source.replace('"Stripe: "', '"Price: "'),
        });
        const after = await host.moduleGraph({
          sessionId,
          sourceId: "main.lisp",
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
