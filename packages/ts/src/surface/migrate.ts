import { parse, toSExprMany, type SExpr } from "../reader/index.js";
import { identifySyntax, type SyntaxIdentity } from "../syntax/identity.js";
import { applyEditScript, type EditScript } from "../editor/edit-script.js";
import { head, name } from "./effect.js";

export interface MigrationResult {
  readonly source: string;
  readonly changed: boolean;
  readonly script: EditScript;
  readonly identity: SyntaxIdentity;
}
/** Structural migration. Untouched slices, including every comment, retain their bytes. */
export function migrateSource(source: string): MigrationResult {
  const parsed = parse(source);
  if (parsed.errors.length) throw new Error(parsed.errors.map(e=>e.message).join("\n"));
  const identity = identifySyntax(source);
  const exprs = toSExprMany(parsed.redTree);
  const schemaNames = new Set(exprs.flatMap(e=>head(e)==="define-schema" && e._tag==="List" ? [name(e.items[1]) ?? ""] : []));
  const actions = new Set(exprs.flatMap(expr => {
    if (head(expr) === ":" && expr._tag === "List") {
      const type = expr.items[2];
      const result = type?._tag === "List" && head(type) === "->" ? type.items.at(-1) : type;
      if (head(result) === "Action") return [name(expr.items[1])!];
    }
    return ["define-action","define-mutation"].includes(head(expr) ?? "") && expr._tag === "List" ? [name(expr.items[1])!] : [];
  }));
  const brands = new Map<string,SExpr>();
  const declarations = new Set(exprs.flatMap(e=>e._tag === "List" && ["define-schema","type","define-class","class","define-error","error"].includes(head(e) ?? "") ? [name(e.items[1]) ?? ""] : []));
  const zeroEffects = new Set<string>();
  const tagKeys = new Set<string>();
  const constructors = new Map<string,string>([["some","Some"],["none","None"],["success","Ok"],["failure","Err"],["Success","Ok"],["Failure","Err"]]);
  const namespaceOfMigration = (n:string) => n.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();
  const capitalize = (n:string) => n.split(/[-_]/).map(p=>p[0]?.toUpperCase()+p.slice(1)).join("");
  const scan = (e:SExpr):void => {
    if (["quote","quasiquote"].includes(head(e) ?? "")) return;
    if (head(e) === "Brand" && e._tag === "List" && e.items.length === 3 && name(e.items[1])) {
      const n=name(e.items[1])!, base=e.items[2]!;
      const structural=(t:SExpr)=>JSON.stringify(t,(key,value)=>key === "loc" ? undefined : value);
      if(brands.has(n) && structural(brands.get(n)!) !== structural(base)) throw new Error(`Conflicting brand definitions for ${n}`);
      brands.set(n,base);
    }
    if (head(e)==="define-service" && e._tag === "List") {
      const methods = e.items.find(a=>head(a)===":methods");
      if (methods?._tag === "List") for (const m of methods.items.slice(1)) if (m._tag === "List" && m.items[1]?._tag === "Vector" && m.items[1].items.length===0) zeroEffects.add(`${name(e.items[1])}.${name(m.items[0])}`);
    }
    if (head(e)===":" && e._tag === "List" && head(e.items[2])==="->" && e.items[2]?._tag === "List" && e.items[2].items.length===2 && head(e.items[2].items[1])==="Effect") zeroEffects.add(name(e.items[1])!);
    if (head(e)==="TaggedUnion" && e._tag === "List") { tagKeys.add(`:${name(e.items[1])}`); for (const arm of e.items.slice(2)) if (arm._tag === "Vector" && name(arm.items[0])) constructors.set(name(arm.items[0])!,capitalize(name(arm.items[0])!)); }
    if (e._tag === "List" || e._tag === "Vector") e.items.forEach(scan);
    else if (e._tag === "Map") e.pairs.forEach(([,v])=>scan(v));
  };
  exprs.forEach(scan);
  const text = (e: SExpr) => source.slice(e.loc.start,e.loc.end);
  const patch = (e: SExpr, changes: readonly {start:number;end:number;text:string}[]): string => {
    let result=text(e);
    for (const c of [...changes].sort((a,b)=>b.start-a.start)) result=result.slice(0,c.start-e.loc.start)+c.text+result.slice(c.end-e.loc.start);
    return result;
  };
  const replaceChildren = (e: SExpr, children: readonly SExpr[], type=false) => patch(e,children.map(c=>({start:c.loc.start,end:c.loc.end,text:rewrite(c,type)})));
  const comments = (e:SExpr) => identity.nodes.filter(n=>n.kind==="Comment" && n.span.start>=e.loc.start && n.span.end<=e.loc.end).map(n=>source.slice(n.span.start,n.span.end)).join("\n");
  const retainComments = (e:SExpr,result:string) => { const lost=comments(e).split("\n").filter(c=>c && !result.includes(c)); return lost.length ? `${lost.join("\n")}\n${result}` : result; };
  const schema = (e: SExpr, owner?: string): string => {
    if (e._tag !== "List") return rewrite(e,true);
    const h=head(e),args=e.items.slice(1);
    if (h==="Struct" || h===":fields") {
      const fields=args.map(f=>{
        const items=f._tag==="Vector" ? f.items : f._tag==="List" && head(f)==="field" ? f.items.slice(1) : undefined;
        if (!items || items.length!==2) throw new Error("Cannot migrate malformed record field");
        const [k,t]=items;
        return retainComments(f,`${name(k)?.startsWith(":") ? text(k!) : `:${name(k) ?? (k?._tag==="Str" ? k.value : text(k!))}`} ${schema(t!)}`);
      });
      return retainComments(e,`{${fields.join("\n ")}}`);
    }
    if (h==="Brand" && args.length===2) return retainComments(e,owner === name(args[0]) ? `(Brand ${schema(args[1]!)})` : text(args[0]!));
    if (h==="Ref" && args.length===1 && schemaNames.has(name(args[0]) ?? "")) return text(args[0]!);
    if (h==="Enum" || h==="Literal") return retainComments(e,`(Union ${args.map(a=>a._tag==="Sym" && !a.name.startsWith(":") ? `:${a.name}` : text(a)).join(" ")})`);
    if (h==="TaggedUnion" && args[0]) return retainComments(e,`(Tagged :tag ${text(args[0])} ${args.slice(1).map(a=>a._tag==="Vector" ? `(${constructors.get(name(a.items[0])!) ?? text(a.items[0]!)} ${schema(a.items[1]!)})` : text(a)).join(" ")})`);
    if (h==="->" && args.length===1 && head(args[0])==="Effect") return schema(args[0]!);
    if (h==="Map" && args.length===1) return retainComments(e,`(Map String ${schema(args[0]!)})`);
    return replaceChildren(e,e.items,true);
  };
  const section = (e:SExpr):string => e._tag==="List" && head(e)?.startsWith(":") ? retainComments(e,`${text(e.items[0]!)} ${e.items.slice(1).map(v=>rewrite(v)).join(" ")}`) : rewrite(e);
  const effectHeads = new Set(["create!","update!","retract!","link!","instantiate!","task!","emit!","do!",...actions]);
  const effectful = (e:SExpr):boolean => {
    if (e._tag === "Vector") return e.items.some(effectful);
    if (e._tag === "Map") return e.pairs.some(([,value])=>effectful(value));
    if (e._tag !== "List" || ["quote","quasiquote","fn"].includes(head(e) ?? "")) return false;
    return effectHeads.has(head(e) ?? "") || e.items.slice(1).some(effectful);
  };
  const actionBody = (e:SExpr):string => {
    if (e._tag !== "List" || !effectful(e) || head(e)==="do!") return rewrite(e);
    const args=e.items.slice(1);
    if (head(e)==="do") {
      const prefix=args.slice(0,-1).map(value => effectful(value) ? `_ ${actionBody(value)}` : `:let [_ ${rewrite(value)}]`);
      return retainComments(e,`(do! [${prefix.join("\n    ")}] ${actionBody(args.at(-1)!)})`);
    }
    if (head(e)==="let" && args[0]?._tag==="Vector") {
      const bindings=args[0].items;
      const pairs=[];
      for(let i=0;i<bindings.length;i+=2) pairs.push(effectful(bindings[i+1]!) ? `${text(bindings[i]!)} ${actionBody(bindings[i+1]!)}` : `:let [${text(bindings[i]!)} ${rewrite(bindings[i+1]!)}]`);
      const bodies=args.slice(1);
      const body=bodies.length===1 ? actionBody(bodies[0]!) : actionBody({...e,items:[e.items[0]!,...bodies].map((value,i)=>i===0 ? {...value,_tag:"Sym" as const,name:"do"} : value)});
      return retainComments(e,`(do! [${pairs.join("\n    ")}] ${body})`);
    }
    if (head(e)==="if" && args.length===3) return retainComments(e,`(if ${rewrite(args[0]!)} ${args.slice(1).map(branch=>effectful(branch) ? actionBody(branch) : `(do! [] ${rewrite(branch)})`).join(" ")})`);
    return replaceChildren(e,e.items);
  };
  function rewrite(e:SExpr,type=false):string {
    if (e._tag==="Sym") return type ? ({Str:"String",Num:"Number",Float:"Number",Uint8Array:"Bytes",Boolean:"Bool",Nil:"Unit",Array:"List",Vector:"List",Optional:"Option",string:"String",integer:"Int",number:"Number",boolean:"Bool"}[e.name] ?? text(e)) : (constructors.get(e.name) ?? text(e));
    if (e._tag==="Map") return patch(e,e.pairs.map(([k,v])=>({start:v.loc.start,end:v.loc.end,text:type ? schema(v) : tagKeys.has(name(k) ?? "") && v._tag === "Str" && constructors.has(v.value) ? JSON.stringify(constructors.get(v.value)) : rewrite(v)})));
    if (e._tag==="Vector") return replaceChildren(e,e.items,type);
    if (e._tag!=="List" || head(e)==="quote" || head(e)==="quasiquote") return text(e);
    const h=head(e),args=e.items.slice(1);
    if (type) return schema(e);
    if (h==="define" && actions.has(name(args[0]) ?? "")) {
      const bodies=args[1]?._tag==="Vector" ? args.slice(2) : args.slice(1);
      return patch(e,bodies.map(body=>({start:body.loc.start,end:body.loc.end,text:actionBody(body)})));
    }
    if (h===":" && args.length===2) return patch(e,[{start:args[1]!.loc.start,end:args[1]!.loc.end,text:schema(args[1]!)}]);
    if (h==="define-schema") {
      if (head(args[1]) !== ":kind") return retainComments(e,`(type ${text(args[0]!)} ${schema(args[1]!,name(args[0]))})`);
      const clauses = new Map(args.slice(1).flatMap(a=>a._tag === "List" ? [[head(a)!,a.items.slice(1)] as const] : []));
      const kind = name(clauses.get(":kind")?.[0]);
      for (const key of clauses.keys()) if (![":kind",":fields",":field",":items",":value",":variants",":brand",":identifier",":doc",":pattern"].includes(key)) throw new Error(`Cannot migrate HTTP schema annotation ${key}; rewrite it as a canonical schema constraint`);
      let t: string;
      if (kind === "struct") t = schema({ ...e, items: [ {...e.items[0]!, _tag:"Sym", name:"Struct"}, ...(clauses.get(":fields") ?? []), ...(clauses.get(":field") ?? []) ] });
      else if (kind === "array" && clauses.get(":items")?.[0]) t = `(List ${schema(clauses.get(":items")![0]!)})`;
      else if (kind === "map" && clauses.get(":value")?.[0]) t = `(Map String ${schema(clauses.get(":value")![0]!)})`;
      else if (["string","integer","number","boolean"].includes(kind ?? "")) t = ({string:"String",integer:"Int",number:"Number",boolean:"Bool"} as Record<string,string>)[kind!]!;
      else throw new Error(`Cannot migrate HTTP schema kind ${kind}`);
      const metadata = [":pattern",":doc",":identifier"].flatMap(key=>key === ":identifier" && clauses.get(key)?.[0]?._tag === "Str" && (clauses.get(key)![0] as Extract<SExpr,{_tag:"Str"}>).value === name(args[0]) ? [] : clauses.get(key)?.[0] ? [`${key} ${text(clauses.get(key)![0]!)}`] : []);
      if (metadata.length) t = t.startsWith("(") ? `${t.slice(0,-1)} ${metadata.join(" ")})` : t.startsWith("{") ? (()=>{throw new Error("Record-level schema annotations require manual migration")})() : `(${t} ${metadata.join(" ")})`;
      if (clauses.has(":brand")) t = `(Brand ${t})`;
      return retainComments(e,`(type ${text(args[0]!)} ${t})`);
    }
    if (h==="define-type") {
      const body=args[0]?._tag==="List" ? `(Tagged ${args.slice(1).map(a=>a._tag==="List" && a.items.length===1 ? text(a.items[0]!) : schema(a)).join(" ")})` : schema(args[1]!);
      return retainComments(e,`(type ${text(args[0]!)} ${body})`);
    }
    if (h === "define-error" && args.slice(1).some(a=>head(a)?.startsWith(":"))) {
      const fields = args.filter(a=>head(a) === ":fields").flatMap(a=>a._tag === "List" ? a.items.slice(1) : []);
      const status = args.find(a=>head(a) === ":status");
      for (const clause of args.slice(1)) if (![":fields",":status",":identifier",":doc"].includes(head(clause) ?? "")) throw new Error("Unsupported HTTP error option");
      return retainComments(e,`(error ${text(args[0]!)} ${schema({...e,items:[{...e.items[0]!,_tag:"Sym",name:"Struct"},...fields]})}${status?._tag === "List" && status.items[1] ? ` :status ${text(status.items[1])}` : ""})`);
    }
    if (h==="define-error" || h==="define-class") return retainComments(e,`(${h==="define-error" ? "error" : "class"} ${text(args[0]!)}${args[1] ? ` ${schema(args[1])}` : ""})`);
    if (h==="define-service") {
      const methods=args.find(a=>head(a)===":methods");
      if (methods?._tag!=="List") throw new Error("Cannot migrate service without :methods");
      return retainComments(e,`(service ${text(args[0]!)}\n  ${methods.items.slice(1).map(m=>{
        if (m._tag!=="List" || m.items[1]?._tag!=="Vector") throw new Error("Invalid service method");
        const types=m.items[1].items.filter((_,i)=>i%2===1).map(e=>schema(e));
        return retainComments(m,`(: ${text(m.items[0]!)} ${types.length ? `(-> ${types.join(" ")} ${schema(m.items[2]!)})` : schema(m.items[2]!)})`);
      }).join("\n  ")})`);
    }
    if (e.items.length===1 && zeroEffects.has(h!)) return text(e.items[0]!);
    if (h==="define-operation" && zeroEffects.has(name(args[0])!)) return retainComments(e,`(define ${text(args[0]!)} ${args.slice(2).map(v=>rewrite(v)).join(" ")})`);
    if (h==="define-operation") return patch(e,[{start:e.items[0]!.loc.start,end:e.items[0]!.loc.end,text:"define"},...args.slice(2).map(v=>({start:v.loc.start,end:v.loc.end,text:rewrite(v)}))]);
    if (h==="lambda" || h==="let*") return patch(e,[{start:e.items[0]!.loc.start,end:e.items[0]!.loc.end,text:h === "lambda" ? "fn" : "let"},...args.map(v=>({start:v.loc.start,end:v.loc.end,text:rewrite(v)}))]);
    if (h==="def") return retainComments(e,`(define ${text(args[0]!)} ${rewrite(args[1]!)})`);
    if (h==="defn") return retainComments(e,`(define ${text(args[0]!)} ${args.slice(1).map(v=>rewrite(v)).join(" ")})`);
    if (h==="define" && args[1]?._tag==="List" && head(args[1])==="fn") {
      const fn=args[1]; return patch(e,[{start:fn.loc.start,end:fn.items[0]!.loc.end,text:""},{start:fn.loc.end-1,end:fn.loc.end,text:""},...fn.items.slice(2).map(v=>({start:v.loc.start,end:v.loc.end,text:rewrite(v)}))]);
    }
    if (h==="define-layer") return retainComments(e,`(layer ${text(args[0]!)} ${args.slice(1).map(a=>a._tag==="List" && head(a)===":methods" ? a.items.slice(1).map(m=>m._tag==="List" ? `(define ${m.items.map(v=>rewrite(v)).join(" ")})` : text(m)).join("\n  ") : section(a)).join("\n  ")})`);
    if (h==="define-macro" || h==="defmacro") {
      if (args[1]?._tag!=="Vector") throw new Error("Invalid macro parameters");
      const params=args[1].items.map(v=>text(v)); const rest=params.indexOf("&"); if (rest>=0) params.splice(rest,2,params[rest+1]!,"...");
      return retainComments(e,`(macro (${text(args[0]!)} ${params.join(" ")}) ${args.slice(2).map(v=>text(v)).join("\n ")})`);
    }
    if (h==="define-typeclass") return retainComments(e,`(typeclass ${text(args[0]!)} ${args.slice(1).map(a=>a._tag==="Vector" ? `:extends ${text(a)}` : a._tag==="List" ? `(: ${a.items.map(v=>schema(v)).join(" ")})` : text(a)).join("\n  ")})`);
    if (h==="define-entity" || h==="define-meta-entity" || h==="define-relation") {
      const entity=name(args[0])!;
      const fields=args.filter(a=>head(a)===":field");
      const relation=h==="define-relation";
      const other=args.slice(relation && !args.find(a=>head(a)===":source") ? 3 : 1).filter(a=>head(a)!==":field" && (!relation || ![":source", ":target"].includes(head(a) ?? "")));
      const namespace=entity.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();
      const record=fields.map(f=>{
        if (f._tag !== "List" || f.items[1]?._tag !== "Vector") throw new Error("Entity fields must use vectors during migration");
        const [key,t,metadata]=f.items[1].items;
        let label=name(key)?.replace(/^:/,"") ?? (key?._tag === "Str" ? key.value : "");
        if (label.startsWith(`${namespace}/`)) label=label.slice(namespace.length+1);
        const pairs=metadata?._tag === "Map" ? metadata.pairs : [];
        const required=pairs.find(([k])=>name(k)===":required")?.[1];
        let type=head(t)==="Ref" && t?._tag === "List" ? `(Id ${text(t.items[1]!)})` : schema(t!);
        const options=pairs.filter(([k])=>name(k)!==":required");
        if (!(required?._tag === "Bool" && required.value)) type=`(Option ${type})`;
        if (options.length) type=type.startsWith("(") ? `${type.slice(0,-1)} ${options.map(([k,v])=>`${text(k)} ${text(v)}`).join(" ")})` : `(${type} ${options.map(([k,v])=>`${text(k)} ${text(v)}`).join(" ")})`;
        return retainComments(f,`:${label} ${type}`);
      }).join("\n    ");
      const source=relation ? args.find(a=>head(a)===":source") : undefined;
      const target=relation ? args.find(a=>head(a)===":target") : undefined;
      if (relation && !args[1] && (source?._tag!=="List" || !source.items[1] || target?._tag!=="List" || !target.items[1])) throw new Error("Relation migration requires :source and :target");
      const positionals=relation ? `${text(args[0]!)} ${source?._tag === "List" ? text(source.items[1]!) : text(args[1]!)} ${target?._tag === "List" ? text(target.items[1]!) : text(args[2]!)}` : text(args[0]!);
      return retainComments(e,`(${h === "define-meta-entity" ? "entity" : h.slice(7)} ${positionals} {${record}}${h === "define-meta-entity" ? " :tier :meta" : ""}${other.length ? "\n  "+other.map(section).join("\n  ") : ""})`);
    }
    if (h==="define-record" || h==="define-link") {
      const seed=h==="define-record", entity=args[seed ? 1 : 0]!;
      const namespace=(name(entity) ?? "").replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase();
      const fields=args.filter(a=>head(a)===":field");
      const record=fields.map(f=>{
        if(f._tag!=="List" || f.items[1]?._tag!=="Vector" || f.items[1].items.length!==2) throw new Error("Invalid seed/link field during migration");
        const [key,value]=f.items[1].items;
        let label=(name(key) ?? (key?._tag === "Str" ? key.value : "")).replace(/^:/,"");
        if(label.startsWith(`${namespace}/`))label=label.slice(namespace.length+1);
        return retainComments(f,`:${label} ${rewrite(value!)}`);
      }).join("\n  ");
      const positionals = seed ? [entity,args[0]!] : args.slice(0,3);
      return retainComments(e,`(${seed ? "seed" : "link"} ${positionals.map(text).join(" ")} {${record}})`);
    }
    if (h==="define-system-attribute") {
      const valueType=args.find(a=>head(a)===":value-type");
      if (valueType?._tag!=="List" || !valueType.items[1]) throw new Error("Attribute migration requires :value-type");
      const required=args.find(a=>head(a)===":required");
      const isRequired=required?._tag==="List" && required.items[1]?._tag==="Bool" && required.items[1].value;
      const t=schema(valueType.items[1]);
      const other=args.slice(1).filter(a=>![":value-type",":required"].includes(head(a) ?? ""));
      return retainComments(e,`(attribute ${text(args[0]!)} ${isRequired ? t : `(Option ${t})`} ${other.map(section).join(" ")})`);
    }
    const legacyOptions = new Map<string,SExpr[]>();
    for(const a of args) if(a._tag==='List' && head(a)?.startsWith(':')) {const k=head(a)!.slice(1);legacyOptions.set(k,[...(legacyOptions.get(k) ?? []),...a.items.slice(1)]);}
    const option = (key:string) => legacyOptions.get(key)?.[0];
    const ref = (v:SExpr) => v._tag==='Str' ? v.value.replace(/^:/,'') : text(v);
    const literal = (v:SExpr) => v._tag==='Sym' ? JSON.stringify(v.name.replace(/^:/,'')) : rewrite(v);
    const value = (key:string) => option(key) ? rewrite(option(key)!) : undefined;
    const pairs = (keys:readonly string[],rename:Record<string,string>={}) => keys.flatMap(key=>option(key) ? [`:${rename[key] ?? key} ${rewrite(option(key)!)}`] : []).join(' ');
    const references = (keys:readonly string[]) => keys.flatMap(key=>option(key) ? [`:${key} ${ref(option(key)!)}`] : []).join(' ');
    const recordOptions = (key:string,kind:'value'|'type'='value') => `{${(legacyOptions.get(key) ?? []).flatMap(v=>v._tag==='Vector' ? [`:${name(v.items[0])?.replace(/^:/,'')} ${kind==='type' ? schema(v.items[1]!) : rewrite(v.items[1]!)}`] : v._tag==='List' && head(v)?.startsWith(':') ? [] : [`:${name(v)?.replace(/^:/,'')} nil`]).join(' ')}}`;
    const childOptions = (keys:readonly string[]) => keys.flatMap(key=>legacyOptions.get(key) ?? []).map(v=>rewrite(v)).join('\n ');
    const domain = (head:string,positionals:string,options:string,children='') => retainComments(e,`(${head} ${positionals}${options ? ' '+options : ''}${children ? '\n '+children : ''})`);
    if (h === 'define-api-group') {
      const parameters = (legacyOptions.get('path-params') ?? []).map(p=>{
        if (p._tag !== 'List' || head(p) !== 'param' || p.items.length !== 3) throw new Error('Malformed HTTP path parameter');
        return `:${ref(p.items[1]!)} ${schema(p.items[2]!)}`;
      });
      return domain('api',ref(args[0]!),`${parameters.length ? ':path-params {'+parameters.join(' ')+'}' : ''} ${pairs(['openapi'])}`,args.filter(a=>head(a)==='endpoint').map(a=>rewrite(a)).join('\n '));
    }
    if (h === 'endpoint' && legacyOptions.size) {
      if (!option('method') || !option('path') || !option('success')) throw new Error('HTTP endpoint requires method, path and success');
      const record = (key:string) => `{${(legacyOptions.get(key) ?? []).map(f=>{
        if(f._tag !== 'List' || head(f) !== 'field' || f.items.length !== 3) throw new Error('Malformed HTTP endpoint field');
        return `:${ref(f.items[1]!)} ${schema(f.items[2]!)}`;
      }).join(' ')}}`;
      return domain('endpoint',ref(args[0]!),`:method :${ref(option('method')!).toLowerCase()} :path ${rewrite(option('path')!)}${option('payload') ? ' :payload '+schema(option('payload')!) : ''}${legacyOptions.has('query') ? ' :query '+record('query') : ''}${legacyOptions.has('headers') ? ' :headers '+record('headers') : ''} :success ${schema(option('success')!)}${legacyOptions.has('errors') ? ' :errors ['+legacyOptions.get('errors')!.map(e=>schema(e)).join(' ')+']' : ''} ${pairs(['openapi'])}`);
    }
    if(h==='define-role' || h==='define-group' || h==='define-membership' || h==='define-contextual-role') return domain('identity',text(args[0]!),`:kind :${h.slice(7)} ${pairs(['description'])} ${references(['member','group','principal','resource'])} ${pairs(['resolver'])}`);
    if(h==='define-permission') return domain('permission',text(args[0]!),`${references(['principal','action','resource'])} ${pairs(['description','condition'])}${option('effect') ? ' :effect :'+ref(option('effect')!) : ''}`);
    if(h==='define-workspace') return domain('workspace',text(args[0]!),`${pairs(['title','persona'])} ${references(['subject','home'])} :views [${(legacyOptions.get('view') ?? []).flatMap(v=>v._tag==='Vector' ? v.items.map(ref) : [ref(v)]).join(' ')}]`);
    if(h==='define-datalog-query') return domain('datalog-query',text(args[0]!)+' '+rewrite(option('query')!),'');
    if(h==='define-query-preset') return domain('query-preset',`${text(args[0]!)} ${ref(option('query')!)} ${recordOptions('param')}`,option('merge-policy') ? `:merge-policy :${ref(option('merge-policy')!)}` : '');
    if(h==='define-process') return domain('process',text(args[0]!),pairs(['description','trigger']),childOptions(['node','edge']));
    if(h==='trigger') return domain(ref(args[0]!),args[1] ? ref(args[1]) : '','');
    if(h==='node' && legacyOptions.size) return domain('node',ref(args[0]!),`${references(['action'])} ${option('mutation') ? ':action '+ref(option('mutation')!) : ''} ${['join','fan-out'].flatMap(key=>option(key) ? [':'+key+' '+literal(option(key)!)] : []).join(' ')}${legacyOptions.has('input') ? ' :input '+recordOptions('input') : ''}`);
    if(h==='edge' && legacyOptions.size) return domain('edge',args.slice(0,2).map(ref).join(' '),pairs(['guard']));
    if(h==='guard') return name(args[0])==='not-expr' ? `(not ${rewrite(args[1]!)})` : rewrite(args[1]!);
    if(h==='define-document') return domain('document',text(args[0]!),pairs(['description']),childOptions(['page']));
    if(h==='page' && legacyOptions.size) return domain('page',option('section-id') ? ref(option('section-id')!) : 'section',`${references(['assignee'])} ${pairs(['description','page-description'],{'page-description':'description'})}${legacyOptions.has('depends-on') ? ' :depends-on ['+(legacyOptions.get('depends-on') ?? []).map(ref).join(' ')+']' : ''} ${option('completion-action') ? ':completion '+rewrite(option('completion-action')!) : pairs(['completion-mutation'],{'completion-mutation':'completion'})}`,childOptions(['field']));
    if(h==='field' && args[0] && ['text','date','number','checkbox','select','textarea','signature','file','email','phone','radio','hidden','content','boolean'].includes(name(args[0]) ?? '')){
      const kind=name(args[0])==='boolean' ? 'checkbox' : name(args[0])!,path=ref(args[1]!).replace(/^:/,'');
      const bind=option('bind');
      const binding=bind?._tag==='List' && name(bind.items[0])==='attribute' ? `${ref(bind.items[1]!)}.${ref(bind.items[2]!).split('/').at(-1)}` : bind ? (ref(bind).includes('/') ? `${capitalize(ref(bind).replace(/^:/,'').split('/')[0]!)}.${ref(bind).split('/').at(-1)}` : ref(bind)) : undefined;
      return domain(kind,':'+path+' '+(kind==='content' ? value('content') ?? '""' : value('label') ?? JSON.stringify(path)),`${pairs(['description','required'])}${binding ? ' :bind '+binding : ''}`,childOptions(['option']));
    }
    if(h==='define-constraint') return domain('constraint',ref(args[0]!),`${references(['entity'])} ${pairs(['description','category'])} :severity :${ref(option('severity')!).replace(/^:/,'')} :query (${(legacyOptions.get('violation-query') ?? []).map(v=>rewrite(v)).join(' ')}) ${pairs(['message'])}`,childOptions(['resolution','assigns-task-to']));
    if(h==='resolution' && legacyOptions.size) {
      const inputs=(legacyOptions.get('input') ?? []).map(v=>v._tag==='Vector' ? ':'+ref(v.items[0]!).replace(/^:/,'')+' '+rewrite(v.items[1]!) : '');
      return domain('resolution',`${value('label')} ${ref(option('action')!)}`,`${option('auto') || option('auto-invoke') ? ':auto '+rewrite((option('auto') ?? option('auto-invoke'))!) : ''}${inputs.length ? ' :input {'+inputs.join(' ')+'}' : ''}`);
    }
    if(h==='assigns-task-to' && legacyOptions.size) return domain('assigns-task-to',ref(args[0]!),pairs(['priority','title','body']));
    if(h==='completion-action' || h==='completion-mutation') return domain('completion',ref(args[0]!),args[1] ? ':entity '+ref(args[1]) : '');
    if(h==='option' && args.length===2) return domain('option',args.map(literal).join(' '),'');
    if(h==='define-document-locale') return domain('document-locale',`${ref(option('document')!)} ${literal(option('locale')!)}`,'',childOptions(['role','section','field']));
    if((h==='role' || h==='section' || h==='locale-field') && legacyOptions.size) return domain(h==='locale-field' ? 'field' : h,h==='locale-field' ? ':'+ref(args[0]!).replace(/^:/,'') : ref(args[0]!),pairs(['label','description']),childOptions(['option']));
    if(h==='define-document-localized') return domain('document-localized',`${ref(option('document')!)} [${(legacyOptions.get('locales') ?? []).flatMap(v=>v._tag==='Vector' ? v.items.map(literal) : [literal(v)]).join(' ')}]`,option('default-locale') ? ':default-locale '+literal(option('default-locale')!) : '');
    if(h==='direct' && (args[0]?._tag==='Str' || legacyOptions.size)) return domain('direct',':'+ref(args[0]!).replace(/^:/,'')+' '+rewrite(args[1]!),references(['transform']));
    if(h==='computed' && legacyOptions.size) return domain('computed',rewrite(args[0]!)+' '+rewrite(args[1]!),references(['transform']));
    if(h==='switch' && legacyOptions.size) return domain('switch',':'+ref(args[0]!).replace(/^:/,''),'',childOptions(['case']));
    if(h==='case' && legacyOptions.size) return domain('case',literal(args[0]!), '',childOptions(['set']));
    if(h==='define-pdf-mapping') return domain('pdf-mapping',ref(args[0]!),`${pairs(['display-name','description','template-blob','template-file','template-filename'])} ${references(['document'])}${option('form-ref') ? ' :document '+ref(option('form-ref')!) : ''}`,childOptions(['direct','computed','switch']));
    if(h==='define-task'){
      const inputs=(legacyOptions.get('input') ?? []).map(v=>v._tag==='Vector' ? `:${ref(v.items[0]!)} ${schema(v.items[1]!)}` : '');
      return domain('task',`${ref(args[0]!)} {${inputs.join(' ')}}`,`${pairs(['title','description','scope'])} ${references(['document','guidance'])} ${option('assignee') ? ':default-assignee '+rewrite(option('assignee')!) : ''}${legacyOptions.has('section') ? ' :sections ['+(legacyOptions.get('section') ?? []).map(ref).join(' ')+']' : ''}`);
    }
    if(h==='define-view' || h==='define-view-component'){
      const stateForms=args.filter(v=>head(v)===':state' && v._tag==='List') as Extract<SExpr,{_tag:'List'}>[];
      const states=stateForms.map(v=>`:${ref(v.items[1]!)} {:initial ${rewrite(v.items[2]!)} :kind ${v.items[3]?._tag==='List' ? literal(v.items[3].items[1]!) : '"null"'}}`);
      const inputs=(legacyOptions.get('input-param') ?? []).map(v=>v._tag==='Vector' ? `:${ref(v.items[0]!)} ${schema(v.items[1]!)}` : '');
      const nqForms=args.filter(v=>head(v)===':named-query' && v._tag==='List') as Extract<SExpr,{_tag:'List'}>[];
      const queries=nqForms.map(v=>{const reference=v.items.find(x=>head(x)===':ref');const params=v.items.find(x=>head(x)===':params');return `:${ref(v.items[1]!)} {:ref ${reference?._tag==='List' ? JSON.stringify(ref(reference.items[1]!)) : 'nil'}${params?._tag==='List' ? ' :params '+rewrite(params.items[1]!) : ''}}`;});
      const defs=args.filter(v=>head(v)===':def' && v._tag==='List').map(v=>v._tag==='List' ? `:${ref(v.items[1]!)} ${rewrite(v.items[2]!)}` : '');
      const cols=(legacyOptions.get('column') ?? []).flatMap(v=>v._tag==='Vector' ? v.items : [v]).map(v=>v._tag==='List' && head(v)==='column' ? rewrite(v) : `(column :${ref(v).replace(/^:/,'')})`).join('\n ');
      return domain('view',ref(args[0]!),`${references(['query','subject'])} ${pairs(['title','description','mode','empty-state','where','default-sort','row-action','layout'])}${h==='define-view-component' ? ' :fragment true' : ''}${states.length ? ' :state {'+states.join(' ')+'}' : ''}${inputs.length ? ' :input {'+inputs.join(' ')+'}' : ''}${queries.length ? ' :queries {'+queries.join(' ')+'}' : ''}${defs.length ? ' :defs {'+defs.join(' ')+'}' : ''}`,cols);
    }
    if(h==='column' && legacyOptions.size) return domain('column',':'+ref(args[0]!).replace(/^:/,''),pairs(['label','expr']));

    if(h==='define-action' || h==='define-mutation') {
      const fields=(legacyOptions.get('input') ?? []).map(v=>v._tag==='Vector' ? v.items : v._tag==='List' && head(v)==='input' ? v.items.slice(1) : []);
      if(fields.some(f=>!f[0] || !f[1])) throw new Error('Malformed action input');
      const returns=option('returns');
      if(!returns || !option('do')) throw new Error('Actions require :returns and :do');
      return retainComments(e,`(: ${ref(args[0]!)} ${fields.length ? '(-> '+fields.map(f=>schema(f[1]!)).join(' ')+' (Action '+schema(returns)+'))' : '(Action '+schema(returns)+')'})\n(define ${ref(args[0]!)}${fields.length ? ' ['+fields.map(f=>ref(f[0]!)).join(' ')+']' : ''} ${actionBody(option('do')!)})`);
    }
    if(h==='create!' && args[0]?._tag==='Str') {
      if(args.length%2!==1) throw new Error('create! fields require key/value pairs');
      const ns=namespaceOfMigration(args[0].value);
      return retainComments(e,`(create! ${ref(args[0])} {${args.slice(1).flatMap((v,i,all)=>i%2===0 ? [':'+ref(v).replace(/^:/,'').replace(new RegExp('^'+ns+'/'),'')+' '+rewrite(all[i+1]!)] : []).join(' ')}})`);
    }
    const nouns=new Set(["entity","meta-entity","relation","record","link","system-attribute","query","datalog-query","query-preset","role-identity","policy","action","view","workspace","document","process","http-schema","http-error","http-api-group"]);
    if (h?.startsWith("define-") && nouns.has(h.slice(7))) return retainComments(e,`(${h === "define-record" ? "seed" : h.slice(7)} ${args.map((a,i)=>i===0 ? text(a) : section(a)).join("\n  ")})`);
    return replaceChildren(e,e.items);
  }
  const newBrands=[...brands].filter(([n])=>!declarations.has(n));
  const prefix=newBrands.map(([n,t])=>`(type ${n} (Brand ${schema(t)}))`).join("\n");
  const ops: EditScript["ops"][number][]=[];
  for (const e of exprs) {
    const rewritten=(e === exprs[0] && prefix ? prefix+"\n\n" : "")+rewrite(e);
    if (rewritten!==text(e)) {
      const node=identity.nodes.find(n=>n.span.start===e.loc.start && n.span.end===e.loc.end);
      if (!node) throw new Error("Migration could not identify a source node");
      ops.push({op:"replace",target:node.id,text:rewritten});
    }
  }
  const script:EditScript={version:1,description:"Migrate to unified Forma syntax",ops};
  const result=applyEditScript({source,identity,script});
  if (!result.ok) throw new Error(result.errors.map(e=>e.message).join("\n"));
  return {source:result.source,changed:result.source!==source,script,identity:result.identity};
}
