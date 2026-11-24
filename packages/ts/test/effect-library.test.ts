/**
 * `forma:effect` (RFC 0029 stage 1): `do`/`bind`/`pure` are library spelling
 * over the engine's `do!`, so a program written either way must generate the
 * same Effect TypeScript and report the same diagnostics.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { generateEffectSystem } from "../src/EffectSystem.js";
import * as Mechanics from "../src/Mechanics.js";
import { checkModuleGraph, ModuleError, resolveModuleGraph, sourceModuleResolver } from "../src/Modules.js";
import { parse, toSExprMany, type SExpr } from "../src/Reader.js";

const cases = resolve(import.meta.dirname, "../../../conformance/effect-typescript/cases");
const library = '(import "forma:effect" [do bind pure])\n';
const name = (e: SExpr | undefined) => (e?._tag === "Sym" ? e.name : undefined);

/** Rewrites every `(do! [x e :let [y v] ...] body)` as `(do (bind x e) (let y v) ... body)`, keeping all other text. */
function toSteps(source: string): string {
  const render = (e: SExpr): string => {
    if (e._tag === "List" && name(e.items[0]) === "do!" && e.items[1]?._tag === "Vector") {
      const steps: string[] = [];
      const items = e.items[1].items;
      for (let i = 0; i + 1 < items.length; i += 2) {
        const value = items[i + 1]!;
        if (name(items[i]) === ":let" && value._tag === "Vector")
          for (let j = 0; j + 1 < value.items.length; j += 2) steps.push(`(let ${render(value.items[j]!)} ${render(value.items[j + 1]!)})`);
        else steps.push(`(bind ${render(items[i]!)} ${render(value)})`);
      }
      return `(do ${[...steps, ...e.items.slice(2).map(render)].join(" ")})`;
    }
    const children = (e._tag === "List" || e._tag === "Vector" ? e.items : e._tag === "Map" ? e.pairs.flat() : [])
      .filter((child) => child.loc.start >= e.loc.start && child.loc.end <= e.loc.end)
      .sort((a, b) => a.loc.start - b.loc.start);
    let out = "", at = e.loc.start;
    for (const child of children) { out += source.slice(at, child.loc.start) + render(child); at = child.loc.end; }
    return out + source.slice(at, e.loc.end);
  };
  let out = "", at = 0;
  for (const form of toSExprMany(parse(source).redTree)) { out += source.slice(at, form.loc.start) + render(form); at = form.loc.end; }
  return library + out + source.slice(at);
}

const isSystemCase = (dir: string) => ["effect-system.json", "http-api.json", "cluster.json"].some((file) => existsSync(resolve(dir, file)));
const generate = (dir: string, source: string) =>
  isSystemCase(dir) ? generateEffectSystem(source, { sourceId: "program.lisp" }) : Mechanics.generateEffectProgram(source, { sourceId: "program.lisp" });
const positive = readdirSync(cases).sort().filter((c) => {
  const dir = resolve(cases, c);
  return c !== "defect-checkout" && existsSync(resolve(dir, "expected.ts")) && !["elm.json", "email.json"].some((file) => existsSync(resolve(dir, file)))
    && readFileSync(resolve(dir, "program.lisp"), "utf8").includes("do!");
});
/** A file module, checked the way `forma check` does: expansion errors arrive as a ModuleError. */
const checkModule = (source: string) => {
  try {
    return checkModuleGraph(resolveModuleGraph({ id: "m.lisp", source }, sourceModuleResolver([])));
  } catch (error) {
    if (error instanceof ModuleError) return { diagnostics: error.diagnostics, interfaces: [] };
    throw error;
  }
};
const located = (source: string, result: { readonly diagnostics: readonly { readonly code: string; readonly span?: { readonly startOffset: number; readonly endOffset: number } | undefined }[] }) =>
  result.diagnostics.map((d) => [d.code, d.span ? source.slice(d.span.startOffset, d.span.endOffset) : undefined]);

describe("forma:effect do/bind/pure", () => {
  test("covers the Effect conformance cases written with do!", () => {
    expect(positive.length).toBeGreaterThanOrEqual(12);
  });

  test.each(positive)("%s generates identical code when written with do and bind", (c) => {
    const dir = resolve(cases, c);
    const source = toSteps(readFileSync(resolve(dir, "program.lisp"), "utf8"));
    expect(source).not.toContain("do!");
    const result = generate(dir, source);
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe(readFileSync(resolve(dir, "expected.ts"), "utf8"));
  });

  test("Defect's checkout in do! spelling generates the do/bind case's golden", () => {
    const dir = resolve(cases, "defect-checkout");
    const source = readFileSync(resolve(dir, "program.lisp"), "utf8")
      .replace(library, "")
      .replace(/\(do\n[\s\S]*\)\)\)\n$/, `(do! [cart (Shop.find-cart cart-id)
        :let [total (sum (map (fn [item] (get item :price)) (get cart :items)))]
        paid (Payments.charge total)
        _ (Mailer.send email (receipt-message paid total))]
    (succeed {:receipt (get paid :receipt-id) :total total})))
`);
    expect(source).toContain("do!");
    const result = Mechanics.generateEffectProgram(source, { sourceId: "program.lisp" });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toBe(readFileSync(resolve(dir, "expected.ts"), "utf8"));
  });

  test("a narrowed signature is reported at the step that widens it", () => {
    const source = readFileSync(resolve(cases, "defect-checkout/program.lisp"), "utf8")
      .replace("[CartNotFound CardDeclined] [Shop Payments Mailer]", "[CartNotFound] [Shop Mailer]");
    expect(located(source, Mechanics.elaborateEffectProgram(source))).toEqual([
      ["mechanics/undeclared-error", "(Payments.charge total)"],
      ["mechanics/undeclared-requirement", "(Payments.charge total)"],
    ]);
  });

  const op = (body: string) => `${library}(service S (: run (Effect Int)))\n(: f (Effect Int [] [S]))\n(define f ${body})\n`;
  test.each([
    ["(do (bind x) (pure 1))", "effect/bind-shape", "(bind x)"],
    ["(do (bind [x] S.run) (pure 1))", "effect/bind-shape", "(bind [x] S.run)"],
    ["(do (bind x S.run) (bind y S.run))", "effect/do-result", "(bind y S.run)"],
    ["(do (let y 1) (bind x S.run))", "effect/do-result", "(bind x S.run)"],
    ["(bind x S.run)", "effect/bind-outside-do", "(bind x S.run)"],
  ])("%s reports %s at the author's form", (body, code, text) => {
    const source = op(body);
    expect(located(source, Mechanics.elaborateEffectProgram(source))).toEqual([[code, text]]);
    expect(located(source, checkModule(source))).toEqual([[code, text]]);
  });

  test("selects only names the library exports", () => {
    const source = '(import "forma:effect" [do bound])\n(: f (Effect Int))\n(define f (succeed 1))\n';
    expect(located(source, Mechanics.elaborateEffectProgram(source))).toEqual([["module/private-export", "bound"]]);
  });

  // Stage 0 pin: the effect-body do and <- predate the library and keep their meaning under it.
  test.each([
    ["(do S.run (succeed 1))", "(do! [_ S.run] (succeed 1))"],
    ["(do (<- S.run) (succeed 1))", "(do! [_ S.run] (succeed 1))"],
    ["(do S.run (do (bind x S.run) (pure x)))", "(do! [_ S.run] (do! [x S.run] (succeed x)))"],
  ])("%s means %s, with or without forma:effect", (body, equivalent) => {
    const expected = Mechanics.generateEffectProgram(op(equivalent).replace(library, "")).code;
    expect(expected).toBeDefined();
    expect(Mechanics.generateEffectProgram(op(body)).code).toBe(expected);
    if (!body.includes("bind")) expect(Mechanics.generateEffectProgram(op(body).replace(library, "")).code).toBe(expected);
  });

  test("a value-position do keeps its core meaning in a module that imports the library", () => {
    const source = `${library}(export g)\n(: f (-> Int Int))\n(define f [x] (do (+ x 1) (* x 2)))\n(define g (f 3))\n`;
    const result = checkModule(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.interfaces.at(-1)?.exports.find((e) => e.name === "g")?.data?.value).toBe(6);
  });

  // Stage 2: forma:effect lowers service in every Effect program, and its errors stay on the author's member.
  test.each([["(bad x)"], ["(: n)"]])("a service member %s is reported at the member", (member) => {
    const source = `(service S ${member})\n(: f (Effect Int [] [S]))\n(define f (S.run))\n`;
    const expected = [["service members require (: name Type)", member]];
    const at = (result: { readonly diagnostics: readonly { readonly message: string; readonly span?: { readonly startOffset: number; readonly endOffset: number } | undefined }[] }) =>
      result.diagnostics.map((d) => [d.message, d.span ? source.slice(d.span.startOffset, d.span.endOffset) : undefined]);
    expect(at(Mechanics.elaborateEffectProgram(source))).toEqual(expected);
    expect(at(checkModule(source))[0]).toEqual(expected[0]);
  });

  // Stage 3: forma:effect lowers class, layer, and catch in every Effect program, preserving author spans.
  test("class and layer declarations lower without an import", () => {
    const source = [
      "(class Item {:name String})",
      "(service Items (: make (-> String (Effect Item))))",
      "(layer ItemsLive :provides Items",
      "  (define prefix \"item:\")",
      "  (define make [name] (succeed (Item {:name (str prefix name)}))))",
      "(: run (-> String (Effect Item)))",
      "(define run [name] (provide (Items.make name) ItemsLive))",
      "",
    ].join("\n");
    const generated = Mechanics.generateEffectProgram(source);
    expect(generated.diagnostics).toEqual([]);
    expect(generated.code).toContain("class Item extends Schema.Class");
    expect(generated.code).toContain("ItemsLive");
    expect(checkModule(source).diagnostics).toEqual([]);
  });

  test("empty (layer) reports surface/invalid-form at the form", () => {
    const source = "(service S (: run (Effect Int)))\n(layer)\n";
    expect(located(source, Mechanics.elaborateEffectProgram(source))).toEqual([["surface/invalid-form", "(layer)"]]);
  });

  test.each([
    ["(layer 123 S)", "surface/invalid-form", "123"],
    ["(layer L)", "surface/invalid-form", "(layer L)"],
    ["(layer L :provides)", "surface/invalid-form", ":provides"],
    ["(layer L :provides S (define))", "surface/invalid-form", "(define)"],
    ["(layer L :provides S (bad 1))", "surface/invalid-form", "(bad 1)"],
  ])("malformed %s reports %s at %s", (form, code, text) => {
    const source = `(service S (: run (Effect Int)))\n${form}\n`;
    expect(located(source, Mechanics.elaborateEffectProgram(source))).toEqual([[code, text]]);
    expect(located(source, checkModule(source))[0]).toEqual([code, text]);
  });

  test("catch shorthand err lowers identically to (_ err)", () => {
    const program = (pattern: string) => [
      "(error Boom {:detail String})",
      "(service S (: run (Effect String [Boom] [])))",
      "(: safe (Effect String [] [S.run]))",
      `(define safe (catch S.run ${pattern} (succeed (get err :detail))))`,
      "",
    ].join("\n");
    const explicit = Mechanics.generateEffectProgram(program("(_ err)"));
    const shorthand = Mechanics.generateEffectProgram(program("err"));
    expect(explicit.diagnostics).toEqual([]);
    expect(shorthand.diagnostics).toEqual([]);
    expect(shorthand.code).toBe(explicit.code);
  });

  test.each([
    ["(catch S.run (Boom e))", "artifact/effect-body", "(catch S.run (Boom e))"],
    ["(catch S.run Boom (succeed \"x\"))", "artifact/effect-body", "Boom"],
    ["(catch S.run (Boom) (succeed \"x\"))", "artifact/effect-body", "(Boom)"],
    ["(catch S.run 42 (succeed \"x\"))", "artifact/effect-body", "42"],
  ])("malformed %s reports %s at %s", (body, code, text) => {
    const source = `(error Boom {:detail String})\n(service S (: run (Effect String [Boom] [])))\n(: safe (Effect String [] [S.run]))\n(define safe ${body})\n`;
    expect(located(source, Mechanics.elaborateEffectProgram(source))).toEqual([[code, text]]);
    expect(located(source, checkModule(source))[0]).toEqual([code, text]);
  });
});
