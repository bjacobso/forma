/** Definition and application validation. Artifact contracts plug into checkForm. */
import { typeDefinition } from "../surface/type-alias.js";
import { matchFormSyntax, parseUnifiedForm } from "../surface/form.js";
import { parseElaborationDescriptor } from "./ElaborationDescriptor.js";
import { parseMetaFnDecl, MetaFnSyntaxError } from "./meta-fn-decl.js";
import { parse, toSExprMany } from "../reader/index.js";
import { headSym, tail, type SExpr } from "../reader/types.js";
import { parseFormDescriptorForms } from "./parse-descriptor.js";
import type { FormDescriptor } from "./FormDescriptor.js";
import { elaborationMentionsChild, type BootstrappedPrelude } from "./bootstrap.js";
import type { Diagnostic, Span } from "../diagnostic/diagnostic.js";

export interface DescriptorSource {
  readonly sourceId: string;
  readonly source: string;
  /** Reuse syntax after the caller has checked parser diagnostics. */
  readonly expressions?: readonly SExpr[];
}
export interface CheckDescriptorsOptions {
  readonly prelude?: BootstrappedPrelude | undefined;
  /** Extra native or session-owned hooks, after dependencies have loaded. */
  readonly resolveHook?: (name: string) => boolean;
  /** Registration may defer references until all modules have loaded. */
  readonly checkReferences?: boolean;
  /** Artifact workspace owns payload, validator, and artifact summary checks. */
  readonly checkForm?: (form: FormDescriptor, span: Span) => readonly Diagnostic[];
}

const hookClauses = new Set([":bindings-fn", ":validate-fn", ":construct-fn", ":result-type-fn", ":infer-fn", ":infer", ":check-fn", ":check"]);
const text = (e: SExpr | undefined): string | undefined => e?._tag === "Sym" ? e.name.replace(/^:/, "") : e?._tag === "Str" ? e.value.replace(/^:/, "") : undefined;
const items = (e: SExpr) => e._tag === "List" || e._tag === "Vector" ? e.items : [];
const keywordHead = (e: SExpr) => items(e)[0]?._tag === "Sym" && (items(e)[0] as SExpr & {name:string}).name.startsWith(":") ? (items(e)[0] as SExpr & {name:string}).name : undefined;

/** Plain synchronous stage; malformed declarations return located diagnostics. */
export function checkDescriptors(sources: readonly DescriptorSource[], options: CheckDescriptorsOptions = {}): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const parsed = sources.map(source => {
    if (source.expressions) return { ...source, expressions: source.expressions };
    const result = parse(source.source);
    for (const error of result.errors) diagnostics.push({code:"parse/syntax",severity:"error",phase:"parse",message:error.message,span:{sourceId:source.sourceId,startOffset:error.loc?.start ?? 0,endOffset:error.loc?.end ?? 0}});
    return {...source, expressions:toSExprMany(result.redTree)};
  });
  const types = new Map<string,SExpr>();
  for (const form of options.prelude?.descriptions.list() ?? []) for (const [name,type] of form.surface?.types ?? []) types.set(name,type);
  for (const {expressions} of parsed) for (const e of expressions) { const definition=typeDefinition(e); if (definition) types.set(...definition); }
  const helpers = parsed.flatMap(s=>s.expressions.filter(e=>headSym(e)==="define" || headSym(e)==="macro"));
  const hooks = new Set(options.prelude?.typingHooks?.keys());
  const elaborations = new Map(options.prelude?.elaborationDescriptors.list().map(e => [e.name,e]));
  const forms = new Map(options.prelude?.descriptions.list().map(f => [f.name,f]));
  for (const {expressions} of parsed) for (const e of expressions) {
    const head = headSym(e);
    if (head === "__elaboration") { try {const descriptor=parseElaborationDescriptor(e);if (descriptor) { elaborations.set(descriptor.name,descriptor);hooks.add(descriptor.hook); }} catch { /* its owning parser reports malformed elaborations */ } }
    if (head === "__form-hook" || head === "define") { const name=text(items(e)[1]); if (name) hooks.add(name); }
  }
  for (const source of parsed) {
    const report = (e: SExpr, code: string, message: string) => diagnostics.push({code,message,severity:"error",phase:"typecheck",span:{sourceId:source.sourceId,startOffset:e.loc.start,endOffset:e.loc.end}});
    for (const expression of source.expressions) {
      const head = headSym(expression);
      if (head !== "__form-descriptor" && head !== "__form-hook" && head !== "form") continue;
      let malformed = false;
      const bad = (e:SExpr, code:string, message:string) => { malformed=true; report(e,code,message); };
      for (const clause of tail(expression).slice(1)) {
        const name = keywordHead(clause);
        const values = items(clause).slice(1);
        if (head === "__form-hook" && name === ":kind") {
          if (values.length !== 1 || !text(values[0]) || !["bindings","validate","construct","result-type","infer","check"].includes(text(values[0])!))
            bad(clause,"descriptor/meta-kind",":kind expects exactly one supported kind symbol, string, or keyword.");
        }
        if (head === "__form-hook") continue;
        if (name && hookClauses.has(name)) {
          if (values.length !== 1 || !text(values[0])) bad(clause,"descriptor/hook-clause",`${name} expects exactly one hook symbol, string, or keyword.`);
          else if (options.checkReferences !== false && !hooks.has(text(values[0])!) && !options.prelude?.elaboration.hasHook(text(values[0])!) && !options.resolveHook?.(text(values[0])!))
            report(clause,"descriptor/unresolved-hook",`Descriptor hook ${name} for form '${text(items(expression)[1])}' references unresolved hook '${text(values[0])}'.`);
        }
        if (name === ":constructed-by") {
          if (!text(values[0])) bad(clause,"descriptor/constructed-by",":constructed-by expects an elaboration symbol, string, or keyword.");
          for (let i=1; i<values.length; i+=2) if (text(values[i]) !== "child" || !text(values[i+1]))
            bad(values[i]!,"descriptor/constructed-by",":constructed-by options must be keyword/value pairs; supported option is :child.");
          if (options.checkReferences !== false && text(values[0]) && !elaborations.has(text(values[0])!))
            report(clause,"descriptor/constructed-by",`Unknown elaboration '${text(values[0])}'.`);
          else if (options.checkReferences !== false && text(values[0]) && elaborations.has(text(values[0])!)) {
            const child = text(values[2]) ?? text(items(expression)[1])!;
            if (!elaborationMentionsChild(elaborations.get(text(values[0])!)!,child)) report(clause,"descriptor/constructed-by",`Elaboration '${text(values[0])}' does not project child form '${child}'.`);
          }
        }
        if (name === ":extensions") for (const extension of values) {
          if (!keywordHead(extension)) bad(extension,"descriptor/extensions","Descriptor :extensions entries must be lists or vectors beginning with an extension keyword.");
          else for (const entry of items(extension).slice(1)) if (!keywordHead(entry))
            bad(entry,"descriptor/extensions","Descriptor extension clauses must be lists or vectors beginning with a clause keyword.");
        }
      }
      if (malformed) continue;
      if (head === "__form-hook") {
        try { parseMetaFnDecl(expression); }
        catch (error) {
          const section = error instanceof MetaFnSyntaxError ? error.section : undefined;
          const clause = tail(expression).find(e => keywordHead(e) === section) ?? expression;
          report(clause, section === ":kind" ? "descriptor/meta-kind" : "descriptor/hook-clause", error instanceof Error ? error.message : String(error));
        }
        continue;
      }
      if (head === "__form-descriptor" && !text(items(expression)[1])) {
        report(expression,"descriptor/form","Descriptor definition requires a name.");
        continue;
      }
      try {
        for (const form of head === "form" ? [parseUnifiedForm(expression,types,helpers)!] : parseFormDescriptorForms(expression)) {
          forms.set(form.name,form);
          const slotNames = new Set(form.slots.map(s=>s.name));
          const identifiers = new Set(form.identifiers.map(i=>i.name));
          const fields = new Set([...slotNames,...identifiers]);
          const unknown = (name:string, names:ReadonlySet<string>) => { if (!names.has(name)) report(expression,"descriptor/unknown-slot",`Unknown descriptor field '${name}' in form '${form.name}'.`); };
          for (const slot of form.slots) if (slot.typeFrom) unknown(slot.typeFrom,slotNames);
          if (form.bindings.kind === "static" || form.bindings.kind === "composite") for (const rule of form.bindings.rules) {
            if (rule.identifier) unknown(rule.identifier,identifiers);
            if (rule.slot) unknown(rule.slot,slotNames);
          }
          if (form.validation.kind === "static" || form.validation.kind === "composite") for (const check of form.validation.checks) {
            for (const name of [check.slot,check.defaultSlot,check.listSlot]) if (name) unknown(name,fields);
          }
          if (form.elaboration.kind === "static" || form.elaboration.kind === "composite") for (const opcode of form.elaboration.opcodes) if (opcode.slot) unknown(opcode.slot,fields);
          if (["slot-type","declaration-result","declaration-ref-result"].includes(form.resultType.kind) && "slot" in form.resultType) unknown(form.resultType.slot,slotNames);
          diagnostics.push(...options.checkForm?.(form,{sourceId:source.sourceId,startOffset:expression.loc.start,endOffset:expression.loc.end}) ?? []);
        }
      } catch (error) { report(expression,"descriptor/form",error instanceof Error ? error.message : String(error)); }
    }
  }
  for (const source of parsed) {
    const visit = (expr:SExpr):void => {
      if (["__form-descriptor","__form-hook","form","quote","quasiquote"].includes(headSym(expr) ?? "")) return;
      const form = forms.get(headSym(expr) ?? "");
      if (form) diagnostics.push(...checkDescriptorApplication(form,expr,source.sourceId));
      if (form?.surface) return;
      if (expr._tag === "Map") for (const [key,value] of expr.pairs) { visit(key);visit(value); }
      else for (const item of items(expr)) visit(item);
    };
    for (const expr of source.expressions) visit(expr);
  }
  return diagnostics;
}

/** Application structure is checked even when expansion produced the form. */
export function checkDescriptorApplication(form: FormDescriptor, expr:SExpr, sourceId:string): readonly Diagnostic[] {
  const diagnostic = (node:SExpr,code:string,message:string):Diagnostic => ({code,message,severity:"error",phase:"typecheck",span:{sourceId,startOffset:node.loc.start,endOffset:node.loc.end}});
  if (form.surface) {
    try { matchFormSyntax(form.surface,expr);return []; }
    catch (error) { return [diagnostic(expr,"surface/invalid-form",error instanceof Error ? error.message : String(error))]; }
  }
  return tail(expr).flatMap(arg=>{
    const name=keywordHead(arg)?.slice(1);
    if (!name || form.slots.some(s=>s.name===name || s.aliases?.includes(name))) return [];
    const candidate=closestSlot(name,form.slots.flatMap(s=>[s.name,...s.aliases ?? []]));
    return [diagnostic(arg,"descriptor/unknown-slot",`Unknown slot ':${name}' in form '${form.name}'.${candidate ? ` Did you mean ':${candidate}'?` : ""}`)];
  });
}

function closestSlot(name:string, candidates:readonly string[]): string | undefined {
  const distance = (other:string) => {
    let row=Array.from({length:other.length+1},(_,i)=>i);
    for (let i=1;i<=name.length;i++) {
      const next=[i];
      for (let j=1;j<=other.length;j++) next[j]=Math.min(next[j-1]!+1,row[j]!+1,row[j-1]!+(name[i-1]===other[j-1] ? 0 : 1));
      row=next;
    }
    return row[other.length]!;
  };
  const best=candidates.map(n=>({name:n,distance:distance(n)})).sort((a,b)=>a.distance-b.distance)[0];
  return best && best.distance<=Math.max(2,Math.floor(Math.max(name.length,best.name.length)/3)) ? best.name : undefined;
}
