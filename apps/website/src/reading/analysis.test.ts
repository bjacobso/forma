import { describe, expect, test } from "vitest";
import { analyze, definition, inScope, inspect, references, rename, symbols } from "./analysis";

const domain = `(export Order Missing)
(type Order {:id String})
(error Missing {:id String})`;
const rpc = `(import "./domain.lisp" [Order Missing])
(import "forma:effect/rpc" [rpc-group rpc])
(rpc-group Orders (rpc "Get" :payload {:id String} :success Order :error Missing))`;
const files = [{ id: "rpc.lisp", source: rpc }, { id: "domain.lisp", source: domain }];

describe("reading editor analysis across files", () => {
  test("types a file with the files it imports in scope, and sees edits to them", () => {
    expect(analyze(files, "rpc.lisp").diagnostics).toEqual([]);
    const renamed = files.map(file => file.id === "domain.lisp" ? { ...file, source: domain.replace("(type Order ", "(type Purchase ") } : file);
    expect(analyze(renamed, "rpc.lisp").diagnostics.map(d => d.message)).toContain("Unknown type Order");
  });

  test("reports an import of a name the other file does not export", () => {
    const source = rpc.replace("[Order Missing]", "[Order Missing Nope]");
    const codes = analyze([{ id: "rpc.lisp", source }, files[1]!], "rpc.lisp").diagnostics.map(d => d.code);
    expect(codes).toContain("module/private-export");
  });

  test("goes to a definition in another file, and from a form head to its prelude", () => {
    const toOrder = definition(files, "rpc.lisp", rpc.indexOf("Order :error"));
    expect(toOrder && { file: toOrder.file, text: domain.slice(toOrder.from, toOrder.to) }).toEqual({ file: "domain.lisp", text: "Order" });
    const toForm = definition(files, "rpc.lisp", rpc.indexOf("(rpc \"Get\"") + 1);
    expect(toForm?.file).toBe("forma:rpc.lisp");
    expect(toForm?.source?.slice(toForm.formFrom, toForm.formFrom + 11)).toBe("(form (rpc ");
  });

  test("finds references in every file that imports the definition, from either side", () => {
    const where = (offset: number, file = "rpc.lisp") =>
      references(files, file, offset).occurrences.map(o => `${o.file}:${o.role}:${(o.file === "rpc.lisp" ? rpc : domain).slice(o.from, o.to)}`);
    const expected = ["rpc.lisp:module:Order", "rpc.lisp:use:Order", "domain.lisp:module:Order", "domain.lisp:definition:Order"];
    expect(where(rpc.indexOf("Order :error"))).toEqual(expected);
    expect(where(domain.indexOf("Order {"), "domain.lisp")).toEqual(expected);
    // A prelude form head: its uses in the open files.
    expect(references(files, "rpc.lisp", rpc.indexOf("(rpc \"Get\"") + 1).occurrences.map(o => `${o.file}:${o.from}`)).toEqual([`rpc.lisp:${rpc.indexOf("(rpc \"Get\"") + 1}`]);
  });

  test("renames a definition, its uses, and the import and export lists that name it", () => {
    const result = rename(files, "rpc.lisp", rpc.indexOf("Order :error"), "Purchase");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const apply = (source: string, edits: readonly { from: number; to: number; insert: string }[] = []) =>
      [...edits].sort((a, b) => b.from - a.from).reduce((text, edit) => text.slice(0, edit.from) + edit.insert + text.slice(edit.to), source);
    const renamed = files.map(file => ({ ...file, source: apply(file.source, result.edits[file.id]) }));
    expect(renamed.map(file => /\bOrder\b/.test(file.source))).toEqual([false, false]);
    expect(analyze(renamed, "rpc.lisp").diagnostics).toEqual([]);
    expect(rename(files, "rpc.lisp", rpc.indexOf("Order :error"), "Missing")).toMatchObject({ ok: false });
  });

  test("lists each file's definitions with how often they are used", () => {
    const found = symbols(files).map(s => `${s.file}:${s.form}:${s.name}:${s.uses}`);
    expect(found).toEqual(["rpc.lisp:rpc-group:Orders:0", "domain.lisp:type:Order:1", "domain.lisp:error:Missing:1"]);
  });
});

describe("a playground's language definition and program", () => {
  const prelude = `(type ResearchIR {:kind "Research" :name Symbol :title String :cost Int})
(form (research name {:keys [title cost]})
  :types {:name (Declares Research) :title String :cost Int}
  :ir ResearchIR
  {:kind "Research" :name name :title title :cost cost})`;
  const program = "(macro (quick-research n)\n  `(research ~n :title \"x\" :cost 1))\n(quick-research foo)";

  test("checks a declaration the program's own macro produces, and keeps what it elaborates to", () => {
    inScope("playground", { preludes: "core", implicit: ["prelude.lisp"] });
    const analysis = analyze([{ id: "prelude.lisp", source: prelude }, { id: "example.lisp", source: program }], "example.lisp");
    inScope("");
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.declarations).toEqual([{ name: "foo", resultType: "Research", payload: { kind: "Research", name: "foo", title: "x", cost: 1 } }]);
  });
});

describe("how a selected form lowers", () => {
  const span = (source: string, start: string): [number, number] => {
    const from = source.indexOf(start);
    for (let index = from, depth = 0; index < source.length; index++) {
      if (source[index] === "(") depth++;
      if (source[index] === ")" && --depth === 0) return [from, index + 1];
    }
    throw new Error(start);
  };
  const entity = `(entity Counter
  :state {:count Int}
  :initial {:count 0}
  :storage :memory
  (command Increment :payload {:by Int} :success Int :delivery :volatile :update {:count (+ state.count by)} :reply state.count))`;
  const steps = (source: string, start: string) =>
    inspect([{ id: "main.lisp", source }], "main.lisp", ...span(source, start)).steps?.map(step => `${step.kind} ${step.label}`);

  test("a prelude form shows its IR record and the TypeScript generated from it", () => {
    expect(steps(entity, "(entity")).toEqual(["ir IR · ClusterEntityIR", "code TypeScript"]);
    const whole = inspect([{ id: "main.lisp", source: entity }], "main.lisp", ...span(entity, "(entity")).steps!;
    expect(whole[1]!.text).toContain("export const CounterLive");
  });

  test("a sub-form shows its own record in the parent's IR and the code it generates", () => {
    expect(steps(entity, "(command")).toEqual(["ir IR at /messages/0", "code TypeScript · counterIncrement"]);
    const rpc = `(rpc-group G (rpc "Get" :payload {:id String} :success String) (rpc "Put" :payload {:id String} :success String))`;
    expect(steps(rpc, "(rpc \"Put\"")).toEqual(["ir IR at /operations/1", "code TypeScript · G"]);
  });

  test("other forms expand one macro at a time, with the file's own macros in scope", () => {
    const source = `(macro (twice x) \`(do ~x ~x))\n(define f [x] (twice (when x (println "a"))))`;
    expect(steps(source, "(twice (when")).toEqual(["macro twice", "macro when", "macro when"]);
  });
});
