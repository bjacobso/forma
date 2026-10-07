import { describe, expect, test } from "vitest";

import { Editor } from "../src/index.js";
import { bootstrapOntologyPreludes } from "../src/Preludes.js";

const index = (source: string, options?: Editor.SymbolIndexOptions) =>
  Editor.indexSymbols([{ sourceId: "doc", source }], options);

const textOf = (source: string, item: { span: { start: number; end: number } }) =>
  source.slice(item.span.start, item.span.end);

/** Offset of the `nth` occurrence of `text` as a whole symbol. */
const at = (source: string, text: string, nth = 0) => {
  let from = 0;
  for (let count = 0; ; count++) {
    const found = source.indexOf(text, from);
    if (found < 0) throw new Error(`no ${text}`);
    const before = source[found - 1] ?? " ";
    const after = source[found + text.length] ?? " ";
    if (/[\s()[\]{}~`@]/.test(before) && /[\s()[\]{}]/.test(after)) {
      if (count === nth) return found;
    } else {
      count--;
    }
    from = found + 1;
  }
};

const occurrences = (source: string, symbolIndex: Editor.SymbolIndex, offset: number) => {
  const found = Editor.findReferences(symbolIndex, { sourceId: "doc", offset });
  return {
    definition: found.definition ? [found.definition.span.start, found.definition.kind] : undefined,
    references: found.references.map((reference) => reference.span.start),
  };
};

describe("indexSymbols", () => {
  test("resolves globals, parameters, and let locals with shadowing", () => {
    const source = `(define rate 2)
(define (scale x) (* x rate))
(define (shadow rate) (let [x rate] (+ x rate)))
(scale rate)`;
    const symbols = index(source);
    expect(
      symbols.definitions.map((definition) => [
        definition.name,
        definition.kind,
        definition.scope,
        definition.form,
      ]),
    ).toEqual([
      ["rate", "value", "global", "define"],
      ["scale", "function", "global", "define"],
      ["x", "parameter", "local", "define"],
      ["shadow", "function", "global", "define"],
      ["rate", "parameter", "local", "define"],
      ["x", "local", "local", "let"],
    ]);
    expect(occurrences(source, symbols, at(source, "rate"))).toEqual({
      definition: [at(source, "rate"), "value"],
      references: [at(source, "rate", 1), at(source, "rate", 5)],
    });
    expect(occurrences(source, symbols, at(source, "rate", 3))).toEqual({
      definition: [at(source, "rate", 2), "parameter"],
      references: [at(source, "rate", 3), at(source, "rate", 4)],
    });
    const builtin = symbols.references.find((reference) => reference.name === "*");
    expect(builtin?.resolution).toBe("builtin");
  });

  test("finds definitions made by macros and ignores macro temporaries", () => {
    const source = `(macro (defstep name system) \`(define ~name {:system ~system}))
(defstep verify "Persona")
(and verify (or true verify))`;
    const symbols = index(source);
    const verify = symbols.definitions.find((definition) => definition.name === "verify");
    expect(verify).toMatchObject({ kind: "value", scope: "global", form: "defstep" });
    expect(textOf(source, verify!)).toBe("verify");
    expect(occurrences(source, symbols, at(source, "verify", 1)).references).toEqual([
      at(source, "verify", 1),
      at(source, "verify", 2),
    ]);
    expect(symbols.definitions.map((definition) => definition.name)).not.toContain(
      expect.stringMatching(/^(and|or|@)/),
    );
    expect(symbols.definitions.find((definition) => definition.name === "defstep")?.kind).toBe(
      "macro",
    );
  });

  test("uses descriptors for domain forms", () => {
    const source = `(entity Employee {:name String})
(query directory
  :from Employee
  :select [employee/name])`;
    const symbols = index(source, { descriptors: bootstrapOntologyPreludes().descriptions });
    expect(
      symbols.definitions.map((definition) => [definition.name, definition.kind, definition.form]),
    ).toEqual([
      ["Employee", "declaration", "entity"],
      ["directory", "declaration", "query"],
    ]);
    expect(occurrences(source, symbols, at(source, "Employee", 1)).references).toEqual([
      at(source, "Employee", 1),
    ]);
  });

  test("learns descriptors from form in the indexed documents", () => {
    const prelude = `(type WorkflowIR {:kind "Workflow" :name Symbol :steps (Option Syntax)})
(form (defworkflow name {:keys [steps]}) :types {:name (Declares Workflow) :steps (Option Syntax)} :ir WorkflowIR {:kind "Workflow" :name name :steps steps})`;
    const source = "(defworkflow onboarding :steps verify)\n(run onboarding)";
    const symbols = Editor.indexSymbols([
      { sourceId: "prelude", source: prelude },
      { sourceId: "doc", source },
    ]);
    const onboarding = symbols.definitions.find((definition) => definition.name === "onboarding");
    expect(onboarding).toMatchObject({ sourceId: "doc", form: "defworkflow" });
    expect(
      symbols.references.find((reference) => reference.name === "onboarding")?.definition,
    ).toBe(onboarding?.key);
    expect(
      symbols.definitions.find((definition) => definition.name === "defworkflow"),
    ).toMatchObject({ sourceId: "prelude", form: "form" });
  });

  test("resolves references across documents in load order", () => {
    const symbols = Editor.indexSymbols([
      { sourceId: "lib", source: "(define (greet name) name)" },
      { sourceId: "doc", source: "(greet 1)" },
    ]);
    const reference = symbols.references.find((candidate) => candidate.name === "greet");
    expect(reference).toMatchObject({ sourceId: "doc", resolution: "definition" });
    expect(reference?.definition).toMatch(/^lib#/);
  });

  test("uses the last document for a repeated source id", () => {
    const symbols = Editor.indexSymbols([
      { sourceId: "lib", source: "(define old 1)" },
      { sourceId: "doc", source: "(+ fresh 1)" },
      { sourceId: "lib", source: "(define fresh 1)" },
    ]);
    expect(symbols.definitions.map((definition) => definition.name)).toEqual(["fresh"]);
    expect(symbols.references.find((reference) => reference.name === "fresh")?.resolution).toBe(
      "definition",
    );
  });

  test("binds match and catch patterns and references constructors", () => {
    const source = `(type (Option a) (Tagged (Some a) None))
(define (unwrap opt) (match opt (Some v) v (None) 0))`;
    const symbols = index(source);
    expect(
      symbols.definitions
        .filter((definition) => definition.scope === "global")
        .map((definition) => [definition.name, definition.kind]),
    ).toEqual([
      ["Option", "type"],
      ["Some", "constructor"],
      ["None", "constructor"],
      ["unwrap", "function"],
    ]);
    expect(occurrences(source, symbols, at(source, "Some")).references).toEqual([
      at(source, "Some", 1),
    ]);
    expect(occurrences(source, symbols, at(source, "v")).references).toEqual([
      at(source, "v", 1),
    ]);
  });

  test("resolves template symbols in macros to globals", () => {
    const source = `(define (helper x) x)
(macro (call-helper y) \`(helper ~y))`;
    const symbols = index(source);
    expect(occurrences(source, symbols, at(source, "helper")).references).toEqual([
      at(source, "helper", 1),
    ]);
    expect(occurrences(source, symbols, at(source, "y")).references).toEqual([at(source, "y", 1)]);
  });

  test("binds destructured names in let and fn", () => {
    const source = "(let [{:keys [a b] :as m} {:a 1 :b 2} [c d] [3 4]] (+ a b c d (count m)))\n((fn [[x y]] (+ x y)) [1 2])";
    const symbols = index(source);
    for (const name of ["a", "b", "m", "c", "d", "x", "y"]) {
      const found = Editor.findReferences(symbols, { sourceId: "doc", offset: at(source, name, 1) });
      expect(found.definition, name).toMatchObject({ name, scope: "local" });
      expect(found.definition?.span.start, name).toBe(at(source, name));
    }
  });

  test("treats a define inside a body as a global", () => {
    const source = "(define (setup) (define config 1))\n(when true (define flag 2))\nconfig\nflag";
    const symbols = index(source);
    for (const name of ["config", "flag"]) {
      expect(symbols.references.find((reference) => reference.name === name)?.resolution).toBe(
        "definition",
      );
    }
  });

  test("does not take binders in a macro template for definitions at expansion sites", () => {
    const source = "(macro (m a) `(let [tmp ~a] tmp))\n(define tmp 5)\n(m tmp)";
    const symbols = index(source);
    expect(symbols.definitions.map((definition) => [definition.name, definition.scope])).toEqual([
      ["m", "global"],
      ["a", "local"],
      ["tmp", "global"],
    ]);
    expect(occurrences(source, symbols, at(source, "tmp", 3)).definition).toEqual([
      at(source, "tmp", 2),
      "value",
    ]);
  });

  test("indexes what it can in a source that does not parse", () => {
    const source = '(define a 1)\n(define b (+ a "x)';
    const symbols = index(source);
    expect(symbols.definitions.map((definition) => definition.name)).toEqual(["a", "b"]);
    expect(symbols.references.find((reference) => reference.name === "a")?.resolution).toBe(
      "definition",
    );
  });

  test("reports unresolved names and finds their other occurrences", () => {
    const source = "(frobnicate 1)\n(frobnicate 2)";
    const symbols = index(source);
    const found = Editor.findReferences(symbols, { sourceId: "doc", offset: 2 });
    expect(found.definition).toBeUndefined();
    expect(found.references.map((reference) => reference.resolution)).toEqual([
      "unresolved",
      "unresolved",
    ]);
  });
});

describe("indexSymbols with a cache", () => {
  test("gives the same index as a fresh call after documents change", () => {
    const prelude = { sourceId: "prelude", source: "(macro (defstep name) `(define ~name 1))\n(define base 2)" };
    const versions = [
      "(defstep verify)\n(+ verify base)",
      "(defstep verify)\n(defstep check)\n(+ check verify base)",
      "(define verify 3)\n(+ verify base)",
    ];
    const cache = Editor.createSymbolIndexCache();
    for (const source of versions) {
      const documents = [prelude, { sourceId: "doc", source }];
      const cached = Editor.indexSymbols(documents, { cache });
      const fresh = Editor.indexSymbols(documents);
      const strip = (index: Editor.SymbolIndex) => ({
        definitions: index.definitions,
        references: index.references,
      });
      expect(strip(cached)).toEqual(strip(fresh));
    }
    // The prelude's reading and expansion were reused across the edits.
    expect(cache.prepared.get("prelude")?.source).toBe(prelude.source);
  });
});
