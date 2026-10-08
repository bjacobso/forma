import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import {
  generateHttpApiProgram,
  generateHttpApiBuilders,
} from "../src/HttpApi.js";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { elaborateProgram } from "../src/descriptor/elaborate.js";
import { emitFormTypeScript } from "../src/descriptor/form-emitter.js";
import { generateFormBuilders } from "../src/descriptor/form-builders.js";
import ts from "typescript";
import { resolve } from "node:path";

const source = readFileSync(
  new URL(
    "../../../conformance/effect-typescript/cases/http-api/program.lisp",
    import.meta.url,
  ),
  "utf8",
);
describe("prelude emission and HTTP contracts", () => {
  test("generates a real API and derived builders", () => {
    const result = generateHttpApiProgram(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("HttpApiEndpoint.get");
    expect(generateHttpApiBuilders().code).toContain("class ApiBuilder");
  });
  test.each(
    [
      [source.replace(":errors [UserNotFound]", ""), "undeclared-error"],
      [
        source.replace("(handler get-user lookup)", "(handler typo lookup)"),
        "unknown-endpoint",
      ],
      [
        source.replace(
          "(handler get-user lookup)",
          "(handler get-user missing)",
        ),
        "unknown-operation",
      ],
      [
        source.replace("(handle Shop users", "(handle Shop typo"),
        "unknown-group",
      ],
      [
        source.replace("(handler create-user create-user)", ""),
        "missing-handler",
      ],
      [
        source.replace(
          "(handler get-user lookup)",
          "(handler get-user health)",
        ),
        "handler-success",
      ],
      [
        source.replace(
          "(handler get-user lookup)",
          "(handler get-user create-user)",
        ),
        "handler-request",
      ],
    ].map(([program, code]) => ({ program: program!, code: code! })),
  )("rejects a bad HTTP contract ($code)", ({ program, code }) => {
    const result = generateHttpApiProgram(program, { sourceId: "bad.forma" });
    expect(result.ok).toBe(false);
    expect(result.code).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: `http-api/${code}`,
        span: expect.objectContaining({
          sourceId: "bad.forma",
          startLine: expect.any(Number),
        }),
      }),
    );
  });
  test("a consumer-defined form supplies its own emitter without a compiler case", () => {
    const prelude = bootstrapFromSources(
      "",
      `
      (type MessageIR {:kind "Message" :name Symbol :text String})
      (define target-name [prefix] (str prefix ".make"))
      (form (message name text) :types {:name (Declares Message) :text String}
        :ir MessageIR
        :emit (fn [ir] \`(~(ts/ref (target-name "Message")) ~(get ir :name) ~(get ir :text)))
        {:kind "Message" :name name :text text})`,
    );
    const result = elaborateProgram(
      '(message greeting "Hello \\\"world\\\"\\n")',
      { prelude },
    );
    expect(result.diagnostics).toEqual([]);
    expect(
      emitFormTypeScript(
        prelude.descriptions.get("message")!,
        result.declarations[0]!.payload,
        prelude.descriptions.list(),
      ),
    ).toBe('Message.make("greeting", "Hello \\"world\\"\\n")');
  });
  test("builder derivation refuses checks it cannot represent", () => {
    const prelude = bootstrapFromSources(
      "",
      `(type ItemIR {:kind "Item" :name Symbol})
      (form (item name) :types {:name (Declares Item)} :ir ItemIR
        :check (fn [holes] []) :emit (fn [ir] \`(Item.make ~(get ir :name)))
        {:kind "Item" :name name})`,
    );
    expect(() =>
      generateFormBuilders({
        descriptors: prelude.descriptions.list(),
        forms: ["item"],
        imports: [],
      }),
    ).toThrow("executable checks");
  });
  test("Refers builders accept typed references from previously built declarations", () => {
    const prelude = bootstrapFromSources(
      "",
      `
      (type ItemIR {:kind "Item" :name Symbol})
      (type LabelIR {:kind "Label" :owner Symbol :text String})
      (form (item name) :types {:name (Declares ItemDecl)} :ir ItemIR
        :emit (fn [ir] \`(Native.item ~(get ir :name)))
        {:kind "Item" :name name})
      (form (label owner text) :types {:owner (Refers ItemDecl) :text String} :ir LabelIR
        :emit (fn [ir] \`(Native.label ~(get ir :owner) ~(get ir :text)))
        {:kind "Label" :owner owner :text text})`,
    );
    const builders = generateFormBuilders({
      descriptors: prelude.descriptions.list(),
      forms: ["item", "label"],
      imports: [],
    }).code;
    const base = `const Native = {item: (name: string) => name, label: (owner: string, text: string) => ({owner,text})};\n${builders}`;
    const file = resolve("test/__derived_references__.ts");
    const check = (consumer: string) => {
      const host = ts.createCompilerHost({});
      const getSourceFile = host.getSourceFile.bind(host);
      host.getSourceFile = (path, version, onError, create) =>
        path === file
          ? ts.createSourceFile(path, `${base}\n${consumer}`, version, true)
          : getSourceFile(path, version, onError, create);
      const program = ts.createProgram(
        [file],
        {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
          target: ts.ScriptTarget.ESNext,
        },
        host,
      );
      return ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    };
    expect(
      check(
        'const item = Item.make("hello"); const label = Label.make(item.reference, "Hi"); const owner: "hello" = label.ir.owner;',
      ),
    ).toEqual([]);
    expect(
      check('Label.make({kind: "AnotherDecl", name: "hello"}, "Hi");').length,
    ).toBeGreaterThan(0);
  });
});
