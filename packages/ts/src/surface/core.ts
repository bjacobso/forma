import { typeSyntaxErrors, schemaMetadata } from "./type-syntax.js";
import { resolveConstructors } from "./constructor-scope.js";
import { coerceProgram } from "./coerce.js";
import { lowerMembers, moduleBindings } from "./members.js";
import type { SExpr } from "../reader/types.js";
import { head, name, sym, list, vector } from "./effect.js";

const call = (e: SExpr, h: string, ...args: SExpr[]) => list(e, [sym(e, h), ...args]);

/** Surface sugar common to expansion, inference and evaluation. */
export function normalizeCoreProgram(exprs: readonly SExpr[]): readonly SExpr[] {
  return coerceProgram(resolveConstructors(exprs.map(e => normalizeCore(lowerMembers(e,moduleBindings(exprs)), true))));
}

function normalizeCore(e: SExpr, top = false): SExpr {
  if (e._tag === "Sym") {
    return e;
  }
  if (e._tag === "Map") {
    const pairs = e.pairs.map(([k, v]) => [k, normalizeCore(v)] as const);
    return pairs.every(([k, v], i) => k === e.pairs[i]![0] && v === e.pairs[i]![1]) ? e : { ...e, pairs };
  }
  if (e._tag === "Vector") {
  const items = e.items.map(a => normalizeCore(a));
    return items.every((a,i)=>a===e.items[i]) ? e : {...e,items};
  }
  if (e._tag !== "List") return e;
  const h = head(e);
  if (h === "quote" || h === "quasiquote" || h === "__schema" || h === "__sum-type") return e;
  const obsolete = new Map([["def","define"],["defn","define"],["defmacro","macro"],["lambda","fn"],["let*","let"]]);
  if (h && obsolete.has(h)) throw new Error(`Use ${obsolete.get(h)} instead of ${h}`);
  if (h === ":" && e.items.length === 3) {
    const errors = typeSyntaxErrors(e.items[2]!, schemaMetadata);
    if (errors.length) throw new Error(errors.join("; "));
    return e;
  }
  if (top && (h === "class" || h === "error")) {
    const fields = e.items[2]?._tag === "Map" ? e.items[2] : { _tag: "Map", pairs: [], loc: e.loc } as SExpr;
    if (!name(e.items[1]) || fields._tag !== "Map") throw new Error(`${h} requires a name and a record type`);
    const options=e.items.slice(e.items[2]?._tag === "Map" ? 3 : 2);
    for (let i=0;i<options.length;i+=2) {const value=options[i+1]; if (i>0 || h!=="error" || name(options[i])!==":status" || value?._tag!=="Num" || !Number.isInteger(value.value) || value.value<400 || value.value>599) throw new Error("error options support :status with an HTTP error status (400–599)");}
    const errors = typeSyntaxErrors(fields, schemaMetadata);
    if (errors.length) throw new Error(errors.join("; "));
    return call(e, "__record-type", e.items[1]!, fields, sym(e, h));
  }
  if (top && h === "type" && e.items.length === 3) {
    const n = e.items[1]!;
    const t = e.items[2]!;
    const errors = head(t) === "Brand" && t._tag === "List" && t.items.length === 2
      ? typeSyntaxErrors(t.items[1]!, schemaMetadata) : typeSyntaxErrors(t, schemaMetadata);
    if (errors.length) throw new Error(errors.join("; "));
    if (head(t) === "Tagged" && t._tag === "List") {
      const arms = t.items.slice(name(t.items[1]) === ":tag" ? 3 : 1).map(a => a._tag === "Sym" ? list(a, [a]) : a);
      const declaration = call(e, "__sum-type", n._tag === "Sym" ? list(n, [n]) : n, ...arms, call(t,":tag", name(t.items[1]) === ":tag" ? t.items[2]! : sym(t,"_tag")));
      return declaration;
    }
    return call(e, n._tag === "List" ? "__type-alias" : "__sum-type", n, t);
  }
  if (top && h === "macro" && e.items[1]?._tag === "List") {
    const pattern = e.items[1];
    const params = [...pattern.items.slice(1)];
    if (name(params.at(-1)) === "..." && params.length >= 2) {
      params.splice(params.length - 2, 2, sym(params.at(-2)!, "&"), params.at(-2)!);
    }
    return call(e, "__macro", pattern.items[0]!, vector(pattern, params), ...e.items.slice(2));
  }
  if (top && h === "typeclass") {
    const args: SExpr[] = [];
    for (let i = 2; i < e.items.length; i++) {
      const a = e.items[i]!;
      if (name(a) === ":extends" && e.items[i + 1]) args.push(e.items[++i]!);
      else args.push(head(a) === ":" && a._tag === "List" ? list(a, a.items.slice(1)) : a);
    }
    return call(e, "__typeclass", e.items[1]!, ...args);
  }
  if (h === "define" && e.items[1]?._tag === "Sym" && e.items[2]?._tag === "Vector" && e.items.length >= 4) {
    return call(e, "define", e.items[1], normalizeCore(call(e, "fn", e.items[2], ...e.items.slice(3))));
  }
  if ((h === "fn" || h === "lambda") && e.items[1]?._tag === "Vector") {
    const params = e.items[1];
    const patterns: [SExpr,SExpr][] = [];
    const plain = params.items.map((p,i) => {
      if (p._tag === "Sym" && (/^[a-z_$]/.test(p.name) && p.name !== "nil" || p.name === "&")) return p;
      const temporary = sym(p, `__argument_${p.loc.start}_${i}`);
      patterns.push([p,temporary]); return temporary;
    });
    let body = e.items.length === 3 ? normalizeCore(e.items[2]!) : call(e,"do",...e.items.slice(2).map(v=>normalizeCore(v)));
    for (const [pattern,value] of patterns.reverse()) body = call(pattern,"match",value,pattern,body);
    if (patterns.length) return call(e,h,vector(params,plain),body);
    const items = [e.items[0]!,params,...e.items.slice(2).map(v=>normalizeCore(v))];
    return items.every((v,i)=>v===e.items[i]) ? e : {...e,items};
  }
  if (h === "let" && e.items[1]?._tag === "Vector" && e.items[1].items.some((p,i)=>i%2===0 && !(p._tag === "Sym" && /^[a-z_$]/.test(p.name) && p.name !== "nil"))) {
    const bindings = e.items[1].items;
    if (bindings.length % 2) throw new Error("let expects pattern/value pairs");
    let body = e.items.length === 3 ? normalizeCore(e.items[2]!) : call(e,"do",...e.items.slice(2).map(v=>normalizeCore(v)));
    for (let i=bindings.length-2;i>=0;i-=2) {
      const pattern = bindings[i]!, value = normalizeCore(bindings[i+1]!);
      body = pattern._tag === "Sym" && /^[a-z_$]/.test(pattern.name) && pattern.name !== "nil" ? call(pattern,"let",vector(pattern,[pattern,value]),body) : call(pattern,"match",value,pattern,body);
    }
    return body;
  }
  if (h === "get" && e.items.length === 3 && !(e.items[2]?._tag === "Str" || name(e.items[2])?.startsWith(":"))) {
    return call(e, "__map-get", normalizeCore(e.items[1]!), normalizeCore(e.items[2]!));
  }
  const items = e.items.map(a => normalizeCore(a));
  return items.every((a, i) => a === e.items[i]) ? e : { ...e, items };
}

/** Runtime implementation of declared constructors; inference uses the declaration. */
export function runtimeTypeDefinitions(expr: SExpr): readonly SExpr[] | undefined {
  if (head(expr) === "__type-alias") return [];
  if (head(expr) === "__record-type" && expr._tag === "List") {
    const n = expr.items[1]!, value = sym(expr, "__record_value");
    const error = name(expr.items[3]) === "error";
    const tag: SExpr = {_tag: "Str", value: name(n)!, loc: n.loc};
    const spec: SExpr = {_tag: "Map",loc:expr.loc,pairs:[[sym(expr, ":discriminator"),{_tag:"Str",value:"_tag",loc:expr.loc}],[sym(expr, ":record"),{_tag:"Bool",value:true,loc:expr.loc}],[sym(expr, ":class"),{_tag:"Bool",value:!error,loc:expr.loc}],[sym(expr, ":arity"),{_tag:"Num",value:1,loc:expr.loc}]]};
    return [call(expr,"define",sym(expr,`__constructor/${name(n)}`),spec), call(expr,"define",n,call(expr,"fn",vector(expr,[value]),error ? call(expr,"assoc",value,sym(expr,":_tag"),tag) : value))];
  }
  if (head(expr) !== "__sum-type" || expr._tag !== "List") return undefined;
  if (expr.items[1]?._tag !== "List") {
    if (head(expr.items[2]) === "Brand" && expr.items[1]?._tag === "Sym") {
      const value = sym(expr, "__brand_value");
      return [call(expr, "define", expr.items[1], call(expr, "fn", vector(expr, [value]), value))];
    }
    return [];
  }
  return expr.items.slice(2).flatMap(arm => {
    if (arm._tag !== "List" || arm.items[0]?._tag !== "Sym" || head(arm)?.startsWith(":")) return [];
    const ctor = arm.items[0];
    const fields = arm.items.slice(1);
    const params = fields.map((f, i) => sym(f, `__payload${i}`));
    const tag: SExpr = { _tag: "Str", value: ctor.name, loc: ctor.loc };
    const tagClause = expr.items.find(a=>head(a)===":tag");
    const discriminator = tagClause?._tag === "List" ? name(tagClause.items[1])!.replace(/^:/,"") : "_tag";
    const record = fields.length === 1 && fields[0]?._tag === "Map";
    const pairs: (readonly [SExpr, SExpr])[] = [[sym(arm, `:${discriminator}`), tag]];
    if (params.length === 1 && !record) pairs.push([sym(arm, ":value"), params[0]!]);
    if (params.length > 1) pairs.push([sym(arm, ":values"), vector(arm, params)]);
    let value: SExpr = { _tag: "Map", pairs, loc: arm.loc };
    if (record) value = call(arm,"assoc",params[0]!,sym(arm,`:${discriminator}`),tag);

    if (params.length) value = call(arm, "fn", vector(arm, params), value);
    const spec: SExpr = {_tag:"Map",loc:arm.loc,pairs:[[sym(arm,":discriminator"),{_tag:"Str",loc:arm.loc,value:discriminator}],[sym(arm,":record"),{_tag:"Bool",loc:arm.loc,value:record}],[sym(arm,":arity"),{_tag:"Num",loc:arm.loc,value:params.length}]]};
    const typeName=expr.items[1]?._tag === "List" ? name(expr.items[1].items[0]) : name(expr.items[1]);
    const qualified=`${typeName}.${ctor.name}`;
    return [call(arm,"define",sym(arm,`__constructor/${ctor.name}`),spec),call(arm,"define",sym(arm,`__constructor/${qualified}`),spec),call(arm, "define",ctor,value),call(arm,"define",sym(arm,qualified),value)];
  });
}
