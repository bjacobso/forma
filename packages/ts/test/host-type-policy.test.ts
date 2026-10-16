import { describe, expect, it } from "vitest";
import { typecheck, debugCore, type TypecheckRequest } from "../src/Engine.js";

const check = (configuration: unknown, source = "external") => typecheck({sourceId:"author.forma",source,...configuration as object} as TypecheckRequest);
describe("host type configuration", () => {
  it("locates invalid policies at the affected symbol and names the configuration path", () => {
    const result = check({typePolicy:{unboundSymbols:[{match:{kind:"prefix",value:"ext"},type:{kind:"type",name:"Typo"}}]}});
    expect(result.diagnostics[0]).toMatchObject({code:"typecheck/type-policy",span:{sourceId:"author.forma",startOffset:0,endOffset:8},details:{path:"typePolicy.unboundSymbols[0].type"}});
    expect(result.diagnostics[0]?.message).toContain("supported host type");
  });
  it("preserves an empty prefix as a policy matching every unbound symbol", () => {
    expect(check({typePolicy:{unboundSymbols:[{match:{kind:"prefix",value:""},type:{kind:"type",name:"String"}}]}})).toMatchObject({display:"String",diagnostics:[]});
  });
  it("validates nested builtin schemes including map children", () => {
    const result = check({hostBuiltins:[{name:"external",typeScheme:{kind:"map",key:{kind:"type",name:"String"},value:{kind:"type",name:"Typo"}}}]});
    expect(result.diagnostics[0]).toMatchObject({code:"typecheck/host-builtin",span:{startOffset:0,endOffset:8},details:{path:"hostBuiltins[0].typeScheme.value"}});
  });
  it.each([null,{kind:"wat"},{kind:"function",params:[]},{kind:"type",name:""},{kind:"type",name:"List Number"}])("rejects malformed schemes: %j", scheme => {
    expect(check({hostBuiltins:[{name:"external",typeScheme:scheme}]}).diagnostics[0]?.code).toBe("typecheck/host-builtin");
  });
  it("validates unused rules and invalid match kinds", () => {
    expect(check({typePolicy:{unboundSymbols:[{match:{kind:"regex",value:"x"},type:{kind:"any"}}]}},"1").diagnostics[0]?.code).toBe("typecheck/type-policy");
    expect(check({typePolicy:{defaultBuiltinScheme:"wat"}},"1").diagnostics[0]?.code).toBe("typecheck/type-policy");
  });
  it.each(["Int","Float","Number","Num"])("preserves the host numeric alias %s", name => {
    const result = check({hostBuiltins:[{name:"external",typeScheme:{kind:"type",name}}]});
    expect(result.diagnostics).toEqual([]);
    expect(result.display).toBe(name === "Int" ? "Int" : "Float");
  });
  it("keeps typed core annotations attached to author nodes", () => {
    const result = debugCore({sourceId:"author.forma",source:"(+ 1 2)"},"typecheckCoreTyped");
    expect(result.diagnostics).toEqual([]);
    expect(JSON.stringify(result.typedCore)).toContain('"inferredType"');
    expect(result.display).toBeTruthy();
  });
});
