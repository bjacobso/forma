import { copySourceTrace } from "../evaluator/source-trace.js";
import type { SExpr } from "../reader/types.js";
import { head, name, list, sym } from "./effect.js";

export function patternBindings(e: SExpr | undefined): readonly string[] {
  if (!e) return [];
  if (e._tag === "Sym") return /^[a-z_$]/.test(e.name) && e.name !== "_" ? [e.name] : [];
  if (e._tag === "Vector" || e._tag === "List") return e.items.flatMap(patternBindings);
  if (e._tag === "Map") return e.pairs.flatMap(([,v]) => patternBindings(v));
  return [];
}
/** Only lexical values use record access. Nominal members stay qualified symbols. */
export function lowerMembers(e: SExpr, bound: ReadonlySet<string>): SExpr {
  return copySourceTrace(e, lowerMembersInner(e, bound));
}

function lowerMembersInner(e: SExpr, bound: ReadonlySet<string>): SExpr {
  if (e._tag === "Sym") {
    const [root,...fields] = e.name.split(".");
    return fields.length && bound.has(root!) ? fields.reduce((r,f)=>list(e,[sym(e,"get"),r,sym(e,`:${f}`)]),sym(e,root!)) : e;
  }
  if (e._tag === "Map") {
    const pairs = e.pairs.map(([k,v])=>[k,lowerMembers(v,bound)] as const);
    return pairs.every(([,v],i)=>v === e.pairs[i]![1]) ? e : {...e,pairs};
  }
  if (e._tag === "Vector") {
    const items = e.items.map(v=>lowerMembers(v,bound));
    return items.every((v,i)=>v===e.items[i]) ? e : {...e,items};
  }
  if (e._tag !== "List" || ["quote","quasiquote","type","__sum-type","__schema",":"].includes(head(e) ?? "")) return e;
  let items: readonly SExpr[];
  if ((head(e)==="fn" || head(e)==="lambda") && e.items[1]?._tag==="Vector") {
    const scope = new Set([...bound,...patternBindings(e.items[1])]);
    items = [...e.items.slice(0,2),...e.items.slice(2).map(v=>lowerMembers(v,scope))];
  } else if (["let","do!"].includes(head(e) ?? "") && e.items[1]?._tag==="Vector") {
    const scope = new Set(bound), bindings: SExpr[] = [];
    for (let i=0;i<e.items[1].items.length;i+=2) {
      const p=e.items[1].items[i]!,value=e.items[1].items[i+1];
      if (!value) {bindings.push(p);break;}
      if (name(p)===":let" && value._tag === "Vector") {
        const pure: SExpr[]=[];
        for (let j=0;j<value.items.length;j+=2) {const binder=value.items[j]!,rhs=value.items[j+1]; if (!rhs) {pure.push(binder);break;} pure.push(binder,lowerMembers(rhs,scope)); patternBindings(binder).forEach(n=>scope.add(n));}
        bindings.push(p,copySourceTrace(value,{...value,items:pure}));
      } else {bindings.push(p,lowerMembers(value,scope)); patternBindings(p).forEach(n=>scope.add(n));}
    }
    items = [e.items[0]!,copySourceTrace(e.items[1],{...e.items[1],items:bindings}),...e.items.slice(2).map(v=>lowerMembers(v,scope))];
  } else if (head(e)==="match" || head(e)==="catch") {
    items=e.items.map((v,i)=>i<2 ? lowerMembers(v,bound) : i%2===0 ? v : lowerMembers(v,new Set([...bound,...patternBindings(e.items[i-1])])));
  } else if (head(e)==="define" && e.items[2]?._tag==="Vector" && e.items.length>3) {
    const scope=new Set([...bound,...patternBindings(e.items[2])]);
    items=[...e.items.slice(0,3),...e.items.slice(3).map(v=>lowerMembers(v,scope))];
  } else items=e.items.map(v=>lowerMembers(v,bound));
  return items.every((v,i)=>v===e.items[i]) ? e : {...e,items};
}
export function moduleBindings(exprs: readonly SExpr[]): ReadonlySet<string> {
  return new Set(exprs.flatMap(e=>head(e)==="define" && e._tag==="List" && name(e.items[1]) ? [name(e.items[1])!] : []));
}
