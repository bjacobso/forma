import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  elaborateProgramOrThrow,
  isJsonRuntimeStringLiteral,
  RUNTIME_STRING_LITERAL_KEY,
  SimpleSemanticEnvironment,
  isRuntimeStringLiteral,
  normalizeForm,
  recognizeForms,
} from "../src/Descriptor.js";
import {
  bootstrapOntologyPreludes,
  bootstrapPreludes,
  ontologyPreludeStack,
  preludeSources,
} from "../src/Preludes.js";
import { parse, toSExprMany } from "../src/Reader.js";

const preludesDir = resolve(import.meta.dirname, "../../../preludes");

const ontology = bootstrapOntologyPreludes();

const construct = (source: string): unknown[] => elaborateProgramOrThrow(source, {prelude:ontology}).map(declaration => declaration.payload);

describe("bundled preludes", () => {
  test("embed every repository prelude verbatim", () => {
    const files = readdirSync(preludesDir).filter((name) => name.endsWith(".lisp")).sort();
    expect(Object.keys(preludeSources), "run `pnpm preludes:generate`").toEqual(files);
    for (const name of files) {
      expect(preludeSources[name as keyof typeof preludeSources], name).toBe(
        readFileSync(resolve(preludesDir, name), "utf8"),
      );
    }
  });

  test("bootstrap fresh registries for a named stack", () => {
    const first = bootstrapPreludes(ontologyPreludeStack);
    expect(first.descriptions.get("entity")).toBeDefined();
    expect(bootstrapOntologyPreludes().descriptions).not.toBe(first.descriptions);
    expect(() => bootstrapPreludes(["compiler.lisp"])).toThrow(/domain prelude/);
  });
});

describe("ontology preludes on the TypeScript engine", () => {
  test("constructs Datalog queries from typed syntax", () => {
    const [,query] = construct(`(entity Order {:title String})
      (datalog-query open-orders {:find [?title] :where [[?o :order/title ?title]]})`);
    expect(query).toMatchObject({kind:"Query",name:"open-orders",datalog:{kind:"raw-expr",expr:{find:["?title"],where:[["?o",":order/title","?title"]]}}});
  });

  test("marks runtime string literals with a Forma-owned key", () => {
    const [action] = construct(`(: close (Action String)) (define close "closed")`) as {do:{expr:import("../src/artifact/artifact.js").JsonValue}}[];
    expect(RUNTIME_STRING_LITERAL_KEY).toBe("$forma.runtimeExpr");
    expect(isJsonRuntimeStringLiteral(action!.do.expr)).toBe(true);
    expect(action!.do.expr).toEqual({"$forma.runtimeExpr":"string-literal",value:"closed"});
  });

  test("constructs typed queries with select fields", () => {
    const [,query] = construct(`(entity Order {:title String}) (query titles :from Order :select [title])`);
    expect(query).toMatchObject({kind:"Query",from:"Order",select:["order/title"]});
  });
});
