import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { Env } from "../src/Env.js";
import { defaultBuiltins } from "../src/builtins/index.js";
import { evaluateExprs } from "../src/evaluator/eval.js";
import { parse, toSExprMany } from "../src/reader/index.js";
import { createMetaBuiltins } from "../src/descriptor/meta-builtins.js";
import { SimpleSemanticEnvironment } from "../src/descriptor/SemanticEnvironment.js";
import { metaType } from "../src/descriptor/meta-types.js";
import { showType } from "../src/type/types.js";
import type { KValue } from "../src/evaluator/types.js";
const builtins = {...defaultBuiltins,...createMetaBuiltins(new SimpleSemanticEnvironment())};
const run = (source:string, input:KValue = null) => Effect.runSync(evaluateExprs(toSExprMany(parse(source).redTree),{builtins,env:Env.empty().bind("input",input),stepLimit:10000})).value;

describe("ported descriptor meta builtins", () => {
  it("constructs record and reference types", () => {
    expect(showType(metaType(run('(type/record [:active (type/constant "Bool")] ["owner" (type/ref "Employee")])'))!)).toBe('{:active Bool "owner" Employee}');
  });
  it("keeps the existing TypeScript collection representation", () => {
    expect(showType(metaType(run('(type/vector (type/constant "String"))'))!)).toBe("List<String>");
  });
  it("decodes the reference engine's type maps", () => {
    expect(showType(metaType(run('{:kind "type-vector" :item {:type "Bool"}}'))!)).toBe("List<Bool>");
  });
  it("returns all repeated slot values and reports a missing required slot", () => {
    const input=new Map<string,KValue>([["slotValues",new Map([["item",[true,false]]])]]);
    expect(run('(meta/slot-values input :item)',input)).toEqual([true,false]);
    expect(run('(diag/require-slot input :item)',input)).toEqual([]);
    expect(run('(diag/require-slot input :missing)',input)).toEqual([new Map([["severity","error"],["slot","missing"],["message","Missing required slot :missing"]])]);
  });
  it("checks membership with the reference engine's value equality", () => {
    expect(run('(diag/one-of :yes [:yes :no])')).toEqual([]);
    expect(run('(diag/member-of input "yes" [:yes :no])')).toHaveLength(1);
  });
  it("reflects declaration kinds and nested descriptor extensions", () => {
    expect(run('(meta/declaration-kind input)',new Map([["kind","Entity"]]))).toBe("Entity");
    const constructInput=new Map<string,KValue>([["kind","descriptor-hook"],["descriptorRef",{construct:{fields:[{name:"kind",expr:"Entity"}]}} as unknown as KValue]]);
    expect(run('(meta/declaration-kind input)',constructInput)).toBe("Entity");
    const descriptor={extensions:{editor:{completion:"record"}}};
    const input=new Map<string,KValue>([["descriptorRef",descriptor as unknown as KValue]]);
    expect(run('(get-in (meta/descriptor-extension input :editor) [:completion])',input)).toBe("record");
  });
  it("preserves stored nil when using get's default argument", () => {
    expect(run('(get input :value "fallback")',new Map([["value",null]]))).toBeNull();
  });
});
