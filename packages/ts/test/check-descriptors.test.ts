import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { checkDescriptors } from "../src/descriptor/check-descriptors.js";
const cases = JSON.parse(readFileSync(resolve(import.meta.dirname,"../../../conformance/descriptor-metacheck/cases.json"),"utf8")) as {name:string;source:string;code:string;text:string;ontology?:boolean}[];
describe("shared descriptor metacheck fixtures", () => {
  for (const test of cases) it(test.name, () => {
    const prelude=test.ontology ? bootstrapFromSources("","",readFileSync(resolve(import.meta.dirname,"../../../preludes/ontology.lisp"),"utf8")) : undefined;
    const diagnostics=checkDescriptors([{sourceId:test.name,source:test.source}],{prelude});
    const diagnostic=diagnostics.find(d=>d.code===test.code);
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.span?.sourceId).toBe(test.name);
    expect(test.source.slice(diagnostic!.span!.startOffset,diagnostic!.span!.endOffset)).toBe(test.text);
  });
  it("resolves forward references, text targets, and external hooks", () => {
    const source='(__form-descriptor x (:check-fn "x/check")) (__form-hook x/check (:kind :check) (:body true))';
    expect(checkDescriptors([{sourceId:"source",source}])).toEqual([]);
    expect(checkDescriptors([{sourceId:"source",source:'(__form-descriptor x (:construct-fn native/construct))'}],{resolveHook:name=>name==='native/construct'})).toEqual([]);
  });
  it("accepts and preserves vector extension clauses", () => {
    const source='(__form-descriptor item [:extensions [:editor [:completion "record"]]])';
    expect(checkDescriptors([{sourceId:"source",source}])).toEqual([]);
    expect(bootstrapFromSources("","",source).descriptions.get("item")?.extensions).toEqual({editor:{completion:"record"}});
  });
  it("artifact checks can report located diagnostics without owning loading", () => {
    const source='(__form-descriptor item (:extensions (:artifact (:summary true))))';
    const result=checkDescriptors([{sourceId:"source",source}],{checkForm:(_form,span)=>[{code:"artifact/descriptor-summary",severity:"error",message:"Missing construct hook",span}]});
    expect(result[0]).toMatchObject({code:"artifact/descriptor-summary",span:{sourceId:"source",startOffset:0,endOffset:source.length}});
  });
  it("slot aliases are valid and close unknown names get a suggestion", () => {
    const source='(__form-descriptor item (:slots (slot description value (:alias doc)))) (item (:doc "ok")) (item (:dco "bad"))';
    const result=checkDescriptors([{sourceId:"source",source}]);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain("Did you mean ':doc'?");
  });
});
