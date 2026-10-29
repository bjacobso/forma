import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnalysisWorkspace } from "../src/Analysis.js";
import { typecheck } from "../src/Engine.js";
import { resolveModuleGraph, sourceModuleResolver, checkModuleGraph, linkEffectModules, moduleMechanicsDeclarations } from "../src/Modules.js";
import { preludeSource } from "../src/Preludes.js";
import { describe, expect, test } from "vitest";
import { validateDeclarations, packageArtifact, ArtifactValidatorRegistry } from "../src/Artifact.js";
import { emit } from "../src/Artifact.js";
import { openSession } from "../src/Session.js";
import { elaborateEffectProgram } from "../src/Mechanics.js";

const invalid = '(: answer (Effect Int))\n(define answer (succeed "wrong"))';

describe("shared Effect checking", () => {
  test("canonical emission rejects the same body mismatch as the generator", () => {
    const generated = elaborateEffectProgram(invalid, { sourceId: "test.forma" });
    expect(generated.ok).toBe(false);
    const session = openSession({ id: "shared" });
    const emitted = emit({ session, source: invalid, sourceId: "test.forma" });
    expect(emitted.ok).toBe(false);
    expect(emitted.diagnostics.map(d => d.code)).toEqual(generated.diagnostics.map(d => d.code));
  });
});

const casesDir = resolve(import.meta.dirname, "../../../conformance/effect-typescript/cases");
const program = (name: string) => readFileSync(resolve(casesDir, name, "program.lisp"), "utf8");
const cases = ["multi-service-checkout", "pure-domain-logic", "concurrent-workflow", "config-and-logging", "stream-pipeline", "reject-undeclared-error", "reject-undeclared-requirement", "reject-argument-type", "reject-finalizer-failure"];

test.each(cases)("%s agrees across generator, canonical emission, author checks and workspace", name => {
  const source = program(name), sourceId = `${name}.forma`;
  const generated = elaborateEffectProgram(source, {sourceId});
  const session = openSession({id: name});
  const emitted = emit({session, source, sourceId});
  const checked = typecheck({source, sourceId});
  const ws = new AnalysisWorkspace();
  ws.setDocument(sourceId, source);
  const analysis = ws.analysis(sourceId);
  const verdict = (ds: readonly {code: string; message: string; severity: string; span?: {sourceId: string; startOffset: number; endOffset: number} | undefined}[]) => ds.filter(d => d.severity === "error").map(d => ({code:d.code, message:d.message, span: d.span && {sourceId: d.span.sourceId, startOffset: d.span.startOffset, endOffset: d.span.endOffset}}));
  expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(generated.ok);
  expect(verdict(emitted.diagnostics)).toEqual(verdict(generated.diagnostics));
  expect(verdict(checked.diagnostics)).toEqual(verdict(generated.diagnostics));
  expect(verdict(analysis.diagnostics)).toEqual(verdict(generated.diagnostics));
  if (generated.ok) expect(analysis.typedSpans.length).toBeGreaterThan(0);
});

test("mechanics routing keeps unrelated kernel errors and partial analysis", () => {
  const source = '(service Clock (: now (Effect Int)))\n(: main (Effect Int [] [Clock.now])) (define main Clock.now)\n(define good 42)\n(+ 1 "bad")';
  const ws = new AnalysisWorkspace();
  ws.setDocument("partial", source);
  expect(ws.diagnostics("partial").some(d => d.code.startsWith("typecheck/"))).toBe(true);
  expect(ws.typeAt("partial", source.indexOf("42"))?.type).toBe("Int");
  ws.setDocument("partial", source + '\n(define broken [');
  expect(ws.diagnostics("partial").some(d => d.code === "parse/syntax")).toBe(true);
  expect(ws.typeAt("partial", source.indexOf("42"))?.type).toBe("Int");
});

test("hover and definitions use recorded mechanics information", () => {
  const source = '(: twice (-> Int Int)) (define twice [x] (+ x x))\n(: main (Effect Int)) (define main (succeed (twice 21)))';
  const ws = new AnalysisWorkspace();
  ws.setDocument("hover", source);
  expect(ws.diagnostics("hover")).toEqual([]);
  const call = source.lastIndexOf("twice");
  expect(ws.definition("hover", call)?.name).toBe("twice");
  expect(ws.hover("hover", call)?.markdown).toContain("Int");
  expect(ws.typeAt("hover", source.lastIndexOf("(twice"))?.type).toBe("Int");
});

test("editing Effect declarations and preludes invalidates checks and author offsets", () => {
  const ws = new AnalysisWorkspace();
  ws.setPrelude("clock", '(service Clock (: now (Effect Int)))');
  const source = '(: main (Effect Int [] [Clock.now])) (define main Clock.now)';
  ws.setDocument("main", source);
  expect(ws.diagnostics("main")).toEqual([]);
  const first = ws.analysis("main");
  expect(ws.analysis("main")).toBe(first);
  ws.setPrelude("clock", '(service Clock (: now (Effect String)))');
  expect(ws.diagnostics("main").map(d => d.code)).toContain("mechanics/type-mismatch");
  ws.setDocument("main", '\n\n' + source.replace("Effect Int", "Effect String"));
  expect(ws.diagnostics("main")).toEqual([]);
  expect(ws.analysis("main")).not.toBe(first);
  ws.setDocument("main", '\n' + invalid);
  expect(ws.diagnostics("main")[0]?.span?.startOffset).toBeGreaterThan(1);
});

test("selected module emission checks dependencies before filtering, keeping lexical identities", () => {
  const sources = [
    {id:"a.forma", source:'(export value) (: value (Effect Int)) (define value (succeed 1))'},
    {id:"b.forma", source:'(export value) (: value (Effect String)) (define value (succeed "b"))'},
    {id:"main.forma", source:'(import "./a.forma" :as a) (import "./b.forma" :as b) (export main) (: main (Effect Int)) (define main a/value)'},
  ];
  const session = openSession({id:"modules"});
  sources.forEach(s => session.rememberSource({id:s.id, text:s.source}));
  const graph = resolveModuleGraph(sources[2]!, sourceModuleResolver(sources));
  expect(checkModuleGraph(graph).diagnostics).toEqual([]);
  expect(linkEffectModules(graph).diagnostics).toEqual([]);
  const emitted = emit({session, sourceId:"main.forma"});
  expect(emitted.ok, JSON.stringify(emitted.diagnostics)).toBe(true);
  if (emitted.ok) expect(emitted.artifacts[0]!.content.declarations.every(d => d.sourceId === "main.forma")).toBe(true);
  const broken = sources[0]!.source.replace("succeed 1", 'succeed "bad"');
  session.rememberSource({id:"a.forma", text:broken});
  const rejected = emit({session, sourceId:"main.forma"});
  expect(rejected.ok).toBe(false);
  expect(rejected.diagnostics.some(d => d.code === "mechanics/type-mismatch" && d.span?.sourceId === "a.forma")).toBe(true);
});

test("mixed descriptor and mechanics artifacts retain domain validation", () => {
  const session = openSession({id:"mixed"});
  for (const name of ["kernel.lisp", "compiler.lisp", "ontology.lisp"] as const) session.rememberSource({id:name, kind:"prelude", text:preludeSource(name)});
  const source = '(entity Person {:name String})\n(: main (Effect Int)) (define main (succeed 1))';
  expect(emit({session, source, sourceId:"mixed.forma"}).ok).toBe(true);
  expect(emit({session, source:source.replace("succeed 1", 'succeed "bad"'), sourceId:"mixed.forma"}).ok).toBe(false);
});


test("direct declaration validation cannot brand invalid bodies, even with a custom registry", () => {
  const session = openSession({id:"direct"});
  session.rememberSource({id:"direct", text:invalid});
  const projected = elaborateEffectProgram(invalid, {sourceId:"direct"});
  expect(projected.declarations.length).toBeGreaterThan(0);
  expect(validateDeclarations(session, projected.declarations, new ArtifactValidatorRegistry()).ok).toBe(false);
});

test("packaging rejects semantic snapshots after a dependency changes", () => {
  const session = openSession({id:"dependencies"});
  const helper = '(export helper) (: helper (-> Int Int)) (define helper [x] (+ x 1))';
  const main = '(import "./helper" [helper]) (: main (Effect Int)) (define main (succeed (helper 1)))';
  session.rememberSource({id:"helper", text:helper});
  session.rememberSource({id:"main", text:main});
  const graph = resolveModuleGraph({id:"main", source:main}, sourceModuleResolver([{id:"helper", source:helper}]));
  const declarations = moduleMechanicsDeclarations(graph).declarations;
  const validated = validateDeclarations(session, declarations.filter(d => d.sourceId === "main"), undefined, declarations.filter(d => d.sourceId === "helper"));
  expect(validated.ok).toBe(true);
  if (!validated.ok) return;
  const request = {session, declarations:validated.declarations, sourceIds:["main"], engineName:"test", engineVersion:"0"};
  expect(packageArtifact(request).ok).toBe(true);
  session.rememberSource({id:"helper", text:helper.replace("+ x 1", '+ x "bad"')});
  expect(packageArtifact(request)).toMatchObject({ok:false, diagnostics:[{code:"artifact/stale-declaration"}]});
});

test("mixed descriptor preludes retain their own checks alongside Effect checks", () => {
  const ws = new AnalysisWorkspace();
  for (const name of ["kernel.lisp", "compiler.lisp", "ontology.lisp"] as const) ws.setPrelude(name, preludeSource(name));
  const source = '(entity Person {:name String})\n(: main (Effect Int)) (define main (succeed 1))';
  ws.setDocument("mixed", source);
  expect(ws.diagnostics("mixed")).toEqual([]);
  ws.setDocument("mixed", source.replace("{:name String}", "42"));
  expect(ws.diagnostics("mixed").some(d => d.severity === "error")).toBe(true);
});

test("mixed module artifacts retain domain declarations and author export names", () => {
  const session = openSession({id:"mixed-modules"});
  for (const name of ["compiler.lisp", "ontology.lisp"] as const) session.rememberSource({id:name, kind:"prelude", text:preludeSource(name)});
  session.rememberSource({id:"mixed.forma", text:'(export Person main) (entity Person {:name String}) (: main (Effect Int)) (define main (succeed 1))'});
  const result = emit({session, sourceId:"mixed.forma"});
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (result.ok) {
    expect(result.artifacts[0]!.content.declarations.map(d => d.summary.kind)).toEqual(["Entity", "EffectDef"]);
    expect(result.artifacts[0]!.content.modules[0]?.exports.map(e => e["kind"])).toEqual(["Entity", "EffectDef"]);
  }
});

test("selection retains legacy helper dependencies without checking unrelated programs", () => {
  const session = openSession({id:"plain-dependencies"});
  session.rememberSource({id:"helper", text:'(: plus-one (-> Int Int)) (define plus-one [x] (+ x 1))'});
  session.rememberSource({id:"main", text:'(: main (Effect Int)) (define main (succeed (plus-one 1)))'});
  session.rememberSource({id:"unrelated", text:invalid});
  expect(emit({session, sourceId:"main"}).ok).toBe(true);
  session.rememberSource({id:"helper", text:'(: plus-one (-> Int Int)) (define plus-one [x] (+ x "bad"))'});
  const rejected = emit({session, sourceId:"main"});
  expect(rejected.ok).toBe(false);
  expect(rejected.diagnostics.some(d => d.span?.sourceId === "helper")).toBe(true);
});

test("module checking retains private type boundaries for Effect signatures", () => {
  const source = '(type Private {:value Int}) (export main) (: main (Effect Private)) (define main (succeed {:value 1}))';
  const graph = resolveModuleGraph({id:"private", source}, sourceModuleResolver([]));
  expect(checkModuleGraph(graph).diagnostics.map(d => d.code)).toContain("module/private-type");
});

test("HTTP validators link authored domain references to lexical mechanics identities", () => {
  const session = openSession({id:"http-module"});
  for (const name of ["compiler.lisp", "http-api.lisp"] as const) session.rememberSource({id:name, kind:"prelude", text:preludeSource(name)});
  const source = '(export lookup User UserId UserNotFound UserRepo)\n' + program("http-api");
  const result = emit({session, sourceId:"http.forma", source});
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  const invalid = emit({session, sourceId:"http.forma", source:source.replace(":errors [UserNotFound]", "")});
  expect(invalid.ok).toBe(false);
  expect(invalid.diagnostics.map(d => d.code)).toContain("http-api/undeclared-error");
});

test("signed descriptor programs retain domain ownership in a mixed Effect document", () => {
  const ws = new AnalysisWorkspace();
  for (const name of ["kernel.lisp", "compiler.lisp", "ontology.lisp"] as const) ws.setPrelude(name, preludeSource(name));
  const source = program("ontology-actions");
  ws.setDocument("mixed-actions", source);
  const domainDiagnostics = ws.diagnostics("mixed-actions");
  ws.setDocument("mixed-actions", source + '\n(: ready (Effect Int)) (define ready (succeed 1))');
  expect(ws.diagnostics("mixed-actions")).toEqual(domainDiagnostics);
});

test("a service does not take ownership of unrelated signed kernel forms", () => {
  const source = '(service Clock (: now (Effect Int)))\n(: value (Merge {:a Int} {:b String})) (define value {:a 1 :b "ok"})';
  const checked = typecheck({source});
  expect(checked.diagnostics).toEqual([]);
  const ws = new AnalysisWorkspace();
  ws.setDocument("kernel", source);
  expect(ws.diagnostics("kernel")).toEqual([]);
});

test("author checks return actual Effect types and per-expression displays", () => {
  const source = '(: main (Effect Int)) (define main (succeed 1))';
  const checked = typecheck({source, result:"per-expression"});
  expect(checked.display).toBe("(Effect Int [] [])");
  expect(checked.expressionTypes?.at(-1)?.display).toBe("(Effect Int [] [])");
});

test("selection includes services named only in a requirement signature", () => {
  const session = openSession({id:"declared-dependency"});
  session.rememberSource({id:"clock", text:'(service Clock (: now (Effect Int)))'});
  session.rememberSource({id:"main", text:'(: main (Effect Int [] [Clock.now])) (define main (succeed 1))'});
  const result = emit({session, sourceId:"main"});
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
});

test("domain re-exports remain valid beside mechanics module checking", () => {
  const session = openSession({id:"domain-barrel"});
  for (const name of ["compiler.lisp", "ontology.lisp"] as const) session.rememberSource({id:name, kind:"prelude", text:preludeSource(name)});
  session.rememberSource({id:"people.forma", text:'(export Person) (entity Person {:name String})'});
  session.rememberSource({id:"public.forma", text:'(export-from "./people.forma" [Person])'});
  session.rememberSource({id:"main.forma", text:'(import "./public.forma" [Person]) (export main) (: main (Effect Int)) (define main (succeed 1))'});
  const result = emit({session});
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
});
