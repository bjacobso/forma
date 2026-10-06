// Read the canonical type/form declarations without bootstrapping the generated prelude.
// The scanner retains source slices; generation never formats or edits ontology.lisp.
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../../');
const source=readFileSync(resolve(root,'preludes/ontology.lisp'),'utf8');
function readForms(source) {
  let at=0;
  const skip=()=>{while(at<source.length){if(/\s|,/.test(source[at]))at++;else if(source[at]===';'){while(at<source.length && source[at]!=='\n')at++;}else break;}};
  const read=()=>{
    skip();const start=at, c=source[at++];
    if(['(', '[', '{'].includes(c)){
      const close={'(':')','[':']','{':'}'}[c],items=[];
      skip();while(source[at]!==close){if(at>=source.length)throw new Error('Unclosed form');items.push(read());skip();}at++;
      return{start,end:at,kind:c,items};
    }
    if(c==='"'){while(at<source.length){if(source[at++]==='\\')at++;else if(source[at-1]==='"')break;}return{start,end:at,value:JSON.parse(source.slice(start,at))};}
    if(['\'', '`', '~'].includes(c)){if(source[at]==='@')at++;const value=read();return{start,end:value.end,kind:'quote',items:[value]};}
    while(at<source.length && !/[\s,()\[\]{};]/.test(source[at]))at++;
    return{start,end:at,value:source.slice(start,at)};
  };
  const forms=[];skip();while(at<source.length){forms.push(read());skip();}return forms;
}
const forms=readForms(source), head=e=>e?.items?.[0]?.value;
const declarations=new Map(forms.filter(e=>head(e)==='type' && e.items[1].value).map(e=>[e.items[1].value,e]));
const options=e=>new Map(e.items.slice(2).flatMap((v,i,all)=>typeof v.value==='string' && v.value.startsWith(':') && all[i+1] ? [[v.value,all[i+1]]] : []));
const roots=[];
for(const form of forms.filter(e=>head(e)==='form')){
  const pattern=form.items[1],opts=options(form);
  const types=opts.get(':types');
  const declares=types?.items?.some(e=>head(e)==='Declares');
  const standalone=declares || /^\w+Def$/.test(opts.get(':type')?.value ?? '');
  if(!standalone || pattern.items[0].value.includes('/'))continue;
  const ir=opts.get(':ir')?.value;
  if(ir && !roots.includes(ir))roots.push(ir);
}
const records=[];
const visitRoot=n=>{
  const body=declarations.get(n)?.items[2];
  if(!body)throw new Error(`Missing IR type ${n}`);
  if(head(body)==='Union')body.items.slice(1).forEach(e=>visitRoot(e.value));
  else if(body.kind==='{'){
    const fields=new Map(body.items.flatMap((v,i,all)=>i%2===0 ? [[v.value,all[i+1]]] : []));
    const kind=fields.get(':kind')?.value;
    if(typeof kind!=='string')throw new Error(`Top-level IR ${n} requires a literal :kind`);
    if(!records.some(r=>r.name===n))records.push({name:n,kind,fields});
  }else throw new Error(`IR ${n} must be a record or union of records`);
};
roots.forEach(visitRoot);
const reachable=new Set();
const visit=e=>{if(e.value && declarations.has(e.value) && !reachable.has(e.value)){reachable.add(e.value);visit(declarations.get(e.value).items[2]);}else e.items?.forEach(visit);};
records.forEach(r=>visit({value:r.name}));
const plural=n=>n.endsWith('y') && !/[aeiou]y$/.test(n) ? n.slice(0,-1)+'ies' : n.endsWith('s') ? n+'es' : n+'s';
const collection=kind=>plural(kind[0].toLowerCase()+kind.slice(1));
const quote=JSON.stringify;
const catalog=records.map((r,i)=>{
  const index=r.fields.has(':name') ? 'name' : r.fields.has(':id') ? 'id' : 'composite';
  const keys=[...r.fields].filter(([k,t])=>k!==':kind' && head(t)!=='Option' && ['Symbol','String','Keyword'].includes(t.value)).map(([k])=>k.slice(1));
  return `{:kind ${quote(r.kind)} :schema ${quote(r.name+'Schema')} :collection ${quote(collection(r.kind))} :flatten-order ${i+1} :index-order ${i+1} :index-name ${quote(index)} :index-fields [${keys.map(quote).join(' ')}]}`;
});
const result=[
  '; Generated from ontology.lisp by scripts/derive-domain-protocol.mjs. Do not edit.',
  '; Forms, their IR types and their declaration order are the only source of truth.',
  ...[...declarations].filter(([n])=>reachable.has(n)).map(([,e])=>source.slice(e.start,e.end)),
  `(type CanonicalIR (Union ${records.map(r=>r.name).join(' ')}))`,
  `(type CompiledDeclarations {${records.map(r=>':'+collection(r.kind)+' (List '+r.name+')').join('\n ')}})`,
  '(define protocol {:name "OntologyIR"})',
  `(define canonical-ir-declaration-catalog (quote {:extensions {:protocol/catalog {:name "CanonicalIRDeclarations" :entries [${catalog.join('\n ')}]}}}))`,
  ''
].join('\n\n').trimEnd()+'\n';
const output=resolve(root,'preludes/ontology-ir.lisp');
if(process.argv.includes('--check')){
  if(readFileSync(output,'utf8')!==result){console.error('ontology-ir.lisp must be regenerated');process.exitCode=1;}
}else writeFileSync(output,result);
