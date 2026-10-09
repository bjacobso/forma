import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { descriptorFormProvider } from "../src/type/unified-form-provider.js";
import { inferSource } from "../src/type/index.js";
import { analyzeLsp } from "../src/lsp/hm-lsp.js";
import { AnalysisWorkspace } from "../src/analysis/workspace.js";
const fixture = (name:string) => readFileSync(resolve(import.meta.dirname,"../../../conformance/thesis-gate",name),"utf8");
const prelude = fixture("prelude.lisp");
const provider = descriptorFormProvider(bootstrapFromSources("", "", prelude));

describe("descriptor typing hooks", () => {
  for (const [file, type] of [["typed", "String"],["inferred-bool", "Bool"],["inferred-string", "String"],["expected-echo", "Bool"],["checked-bool", "Bool"],["nested-field-bool", "Declaration"],["typed-field-bool", "Declaration"],["repeated-bool", "Declaration"]]) {
    it(file!, () => {
      const result = Effect.runSync(analyzeLsp(fixture(`${file}.lisp`),{dslProvider:provider}));
      expect(result.errors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      expect(result.resultTypeString).toBe(type);
    });
  }
  for (const file of ["mismatch", "checked-string", "nested-field-string", "typed-field-string", "repeated-string", "repeated-errors"]) {
    it(file, () => {
      const result = Effect.runSync(analyzeLsp(fixture(`${file}.lisp`),{dslProvider:provider}));
      expect([...result.errors,...result.diagnostics].length).toBe(file === "repeated-errors" ? 2 : 1);
    });
  }
  it("source-local hooks", () => {
    const result = Effect.runSync(inferSource(`${prelude}\n(inferred-type true)`));
    expect(result.type).toMatchObject({_tag:"TCon",name:"Bool"});
  });
  it("workspace hover", () => {
    const workspace = new AnalysisWorkspace();
    workspace.setPrelude("hooks.lisp",prelude);
    workspace.setDocument("doc.lisp","(inferred-type true)");
    expect(workspace.analysis("doc.lisp").resultType).toBe("Bool");
  });
});

describe("ontology thesis fixtures", () => {
  const ontology = readFileSync(resolve(import.meta.dirname,"../../../preludes/ontology.lisp"),"utf8");
  for (const file of ["query-bool","query-scope-bool","query-string","query-scope-global","record-bool","record-string"]) {
    it(file, () => {
      const workspace = new AnalysisWorkspace();
      workspace.setPrelude("ontology.lisp",ontology);
      workspace.setDocument("doc.lisp",fixture(`${file}.lisp`));
      const result=workspace.analysis("doc.lisp");
      if (["query-string","query-scope-global","record-string"].includes(file)) expect(result.diagnostics.length).toBeGreaterThan(0);
      else { expect(result.diagnostics).toEqual([]); expect(result.resultType).toBeDefined(); }
    });
  }
});

describe("hook contracts and lexical scope", () => {
  it("decodes authored symbol keys in binding maps", () => {
    const source=`
(__form-descriptor scoped (:bindings-fn scoped/bindings) (:infer-fn scoped/infer))
(__form-hook scoped/bindings (:kind bindings) (:body {'local (type/constant "Bool")}))
(__form-hook scoped/infer (:kind infer) (:body (meta/infer-expr-type input (meta/positional-arg input 0))))
(scoped local)`;
    expect(Effect.runSync(analyzeLsp(source))).toMatchObject({resultTypeString:"Bool",errors:[],diagnostics:[]});
  });
  it("binding hooks scope their result to the form", () => {
    const source=`
(__form-descriptor scoped (:bindings-fn scoped/bindings) (:infer-fn scoped/infer))
(__form-hook scoped/bindings (:kind bindings) (:body (bindings/scoped (bindings/of [:local (type/constant "Bool")]))))
(__form-hook scoped/infer (:kind infer) (:body (meta/infer-expr-type input (meta/positional-arg input 0))))
(define result (scoped local))
local`;
    const result=Effect.runSync(analyzeLsp(source));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain("local");
    expect(result.typedSpans.some(s=>s.code==='(scoped local)' && s.typeString==='Bool')).toBe(true);
  });
  for (const [phase,body,code] of [
    ["infer", "42", "typecheck/descriptor-infer"],
    ["check", "false", "typecheck/descriptor-check"],
    ["result-type", "42", "typecheck/descriptor-result-type"],
    ["bindings", "42", "typecheck/descriptor-bindings"],
    ["bindings", '{:x 42}', "typecheck/descriptor-binding-type"],
    ["infer", '"MissingType"', "typecheck/descriptor-infer"],
  ]) it(`${phase} rejects ${body}`, () => {
    const source=`(__form-descriptor bad (:${phase}-fn bad/hook)) (__form-hook bad/hook (:kind ${phase}) (:body ${body})) (bad)`;
    const result=Effect.runSync(analyzeLsp(source));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.diagnosticCode).toBe(code);
  });
  it("infer hooks retain the calling lexical environment and substitutions", () => {
    const source=`${prelude}\n(define identity (fn [x] (inferred-type x))) (identity true)`;
    expect(Effect.runSync(analyzeLsp(source)).resultTypeString).toBe("Bool");
  });
});

describe("shared thesis gate expectations", () => {
  const expectations = JSON.parse(fixture("typescript-expectations.json")) as Record<string,{resultType:string|null;diagnostics:{code:string;text:string}[]}>;
  const ontology = readFileSync(resolve(import.meta.dirname,"../../../preludes/ontology.lisp"),"utf8");
  for (const [file,expected] of Object.entries(expectations)) it(file, () => {
    const workspace=new AnalysisWorkspace();
    workspace.setPrelude("hooks.lisp",prelude);
    if (/query|record/.test(file)) workspace.setPrelude("ontology.lisp",ontology);
    const source=fixture(file);
    workspace.setDocument(`thesis-gate/${file}`,source);
    const result=workspace.analysis(`thesis-gate/${file}`);
    expect({resultType:result.resultType ?? null,diagnostics:result.diagnostics.map(d=>({code:d.code,text:source.slice(d.span?.startOffset,d.span?.endOffset)}))}).toEqual(expected);
  });
});

describe("hook integration", () => {
  it("projects a hook-inferred positional expression for hover", () => {
    const workspace=new AnalysisWorkspace();
    workspace.setPrelude("hooks.lisp",prelude);
    workspace.setDocument("doc.lisp",'(inferred-type "hello")');
    expect(workspace.analysis("doc.lisp").typedSpans).toContainEqual({start:15,end:22,type:"String",exprTag:"Lit"});
  });
  it("source-local hooks can call helpers from a separate prelude", () => {
    const workspace=new AnalysisWorkspace();
    workspace.setPrelude("helpers.lisp",'(define choose-type [x] (if x "Bool" "String"))');
    workspace.setDocument("doc.lisp",'(__form-descriptor choice (:infer-fn choice/infer)) (__form-hook choice/infer (:kind infer) (:body (choose-type true))) (choice)');
    expect(workspace.analysis("doc.lisp").resultType).toBe("Bool");
    expect(workspace.analysis("doc.lisp").diagnostics).toEqual([]);
  });
});

describe("session typing", () => {
  it("runs hooks registered by a prelude and preserves diagnostic codes", async () => {
    const {LanguageSession}=await import("../src/session/session.js");
    const {typecheck}=await import("../src/engine/operations.js");
    const session=new LanguageSession({id:"hooks"});
    session.rememberSource({id:"hooks.lisp",text:prelude,kind:"prelude"});
    expect(typecheck({session,sourceId:"doc.lisp",source:'(inferred-type "hello")'})).toMatchObject({display:"String",diagnostics:[]});
    const result=typecheck({session,sourceId:"doc.lisp",source:'(repeated-bool (:item "bad"))'});
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({code:"typecheck/type-mismatch",span:{sourceId:"doc.lisp",startOffset:22,endOffset:27}});
  });
});

describe("descriptor protocol compatibility", () => {
  it("maps unknown meta types to the existing gradual type", () => {
    for (const body of ['"Any"', '"_"', '(type/unknown)']) {
      const source=`(__form-descriptor value (:infer-fn value/infer)) (__form-hook value/infer (:kind infer) (:body ${body})) (: (value) Bool)`;
      expect(Effect.runSync(analyzeLsp(source))).toMatchObject({resultTypeString:"Bool",errors:[],diagnostics:[]});
    }
  });
  it("accepts vector hook clauses and keyword targets", () => {
    const source='(__form-descriptor value [:infer :value/infer]) (__form-hook value/infer [:kind :infer] [:body {:type "Bool"}]) (value)';
    expect(Effect.runSync(analyzeLsp(source))).toMatchObject({resultTypeString:"Bool",errors:[],diagnostics:[]});
  });
  it("checks keyword vector slots as well as list slots", () => {
    const result=Effect.runSync(analyzeLsp('(repeated-bool [:item true] [:item "bad"])',{dslProvider:provider}));
    expect(result.errors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("a static result type precedes its dynamic fallback", () => {
    const source='(__form-descriptor value (:result-type (constant Bool)) (:result-type-fn value/type)) (__form-hook value/type (:kind result-type) (:body "String")) (value)';
    expect(Effect.runSync(analyzeLsp(source)).resultTypeString).toBe("Bool");
  });
  it("reports an unknown slot on a prelude-defined form at the authored clause", () => {
    const result=Effect.runSync(analyzeLsp('(repeated-bool (:tiem true))',{dslProvider:provider}));
    expect(result.errors[0]).toMatchObject({diagnosticCode:"descriptor/unknown-slot",span:{start:15,end:27}});
  });
});

describe("ordinary function hooks", () => {
  it("retains ordinary program inference for unrelated functions", () => {
    expect(Effect.runSync(analyzeLsp(`${prelude} (define twice [x] (+ x x)) (twice true)`)).errors).toHaveLength(1);
  });
  it("infer callbacks retain authored vector syntax", () => {
    expect(Effect.runSync(analyzeLsp("(inferred-type [true false])", {dslProvider:provider}))).toMatchObject({resultTypeString:"List<Bool>",errors:[],diagnostics:[]});
  });
  it("positional arguments expose expression metadata", () => {
    const source='(__form-descriptor value (:infer-fn value/infer)) (__form-hook value/infer (:kind infer) (:body (if (= (get (meta/positional-arg input 0) :kind) "literal") "Bool" "String"))) (value true)';
    expect(Effect.runSync(analyzeLsp(source)).resultTypeString).toBe("Bool");
  });
  it("runs an infer hook defined with ordinary function shorthand", () => {
    const source='(__form-descriptor value (:infer-fn infer-value)) (define infer-value [input] (meta/infer-expr-type input (meta/positional-arg input 0))) (value true)';
    expect(Effect.runSync(analyzeLsp(source))).toMatchObject({resultTypeString:"Bool",errors:[],diagnostics:[]});
  });
  it("runs a check hook defined as a closure", () => {
    const source='(__form-descriptor value (:check-fn check-value)) (define check-value (fn [input] (meta/check-expr input (meta/positional-arg input 0) (type/constant "Bool")))) (: (value true) Bool)';
    expect(Effect.runSync(analyzeLsp(source))).toMatchObject({resultTypeString:"Bool",errors:[],diagnostics:[]});
  });
});
