import {buildDescriptorTreeLayoutAliases,rewriteDescriptorTreeLayoutAliases} from "../descriptor/descriptor-tree-aliases.js";
import { createMetaBuiltins, type HostedMetaBuiltinsFactory } from "../descriptor/meta-builtins.js";
import { datum } from "./datum.js";
import { typeCheckDescriptorTree } from "../descriptor/descriptor-tree-check.js";
import { coerceProgram } from "./coerce.js";
import { reachableHelpers } from "./helpers.js";
import { typeSyntaxErrors, unknownTypeReferences } from "./type-syntax.js";
import { KernelTypeError } from "../diagnostic/errors.js";
import { KKeyword, KSymbol, mapKey, mapKeyValue, isKKeyword, isKSymbol } from "../evaluator/types.js";
import { Effect, Layer } from "effect";
import type { SExpr } from "../reader/types.js";
import type { FormDescriptor, IdentifierSpec, SlotSpec, DescriptorExtensionValue } from "../descriptor/FormDescriptor.js";
import { ElaborationError, type ElaborationHook, type HookInput } from "../descriptor/ElaborationHook.js";
import { SimpleNormalizedSlots, type SlotValue } from "../descriptor/NormalizedSlots.js";
import { Env } from "../Env.js";
import { defaultBuiltins } from "../builtins/index.js";
import { evaluateExprs } from "../evaluator/eval.js";
import type { KValue, BuiltinFn } from "../evaluator/types.js";
import { showType, type Type } from "../type/types.js";
import { InferContext, makeOwnedInferContext } from "../type/context.js";
import { typeExprToType } from "../type/infer-core.js";
import { parseTypeExpr } from "../type/type-parser.js";
import { kValueToSExpr } from "../evaluator/quasiquote.js";
import { assignType } from "../type/assign.js";
import type { Diagnostic } from "../descriptor/ElaborationHook.js";
import { head, name, sym, list } from "./effect.js";
import { contractErrors, typeDescriptor, normalizeContractValue } from "./contract.js";
import type { FormDescriptorRegistry } from "../descriptor/FormDescriptorRegistry.js";
import { SimpleSemanticEnvironment } from "../descriptor/SemanticEnvironment.js";
import { namespaceOf, stripTypeMetadata } from "./domain.js";

export interface UnifiedForm {
  readonly pattern: readonly SExpr[];
  readonly holes: ReadonlyMap<string, SExpr>;
  readonly options: ReadonlyMap<string, SExpr>;
  readonly body: SExpr;
  readonly ir?: SExpr;
  readonly helpers: readonly SExpr[];
  readonly types: ReadonlyMap<string,SExpr>;
}

const typeSyntax = (value: KValue, template: SExpr): SExpr => {
  const toTypeSyntax = (v: KValue): SExpr => v instanceof Map ? {_tag:"Map",loc:template.loc,pairs:[...v].map(([k,t])=>[kValueToSExpr(mapKeyValue(k)),toTypeSyntax(t)] as const)} : Array.isArray(v) ? { _tag: "List",items:v.map(toTypeSyntax),loc:template.loc } : typeof v === "string" ? sym(template,v) : {...kValueToSExpr(v),loc:template.loc};
  const normalize = (e: SExpr): SExpr => e._tag === "Map" ? {...e,pairs:e.pairs.map(([k,t])=>[k,normalize(t)] as const)} : e._tag === "Vector" ? {...e,_tag:"List",items:e.items.map(normalize)} : e._tag === "List" ? {...e,items:e.items.map((t,i)=>head(e)==="Effect" && i>=2 && (t._tag==="List" || t._tag==="Vector") ? {...t,_tag:"Vector"} : normalize(t))} : e;
  return normalize(toTypeSyntax(value));
};
const resolveType = (value: KValue, template: SExpr): Effect.Effect<Type, Error> => {
  const syntax=typeSyntax(value,template);
  return Effect.gen(function* () {
    const context = yield* makeOwnedInferContext();
    return yield* typeExprToType(parseTypeExpr(syntax), new Map(), new Map()).pipe(Effect.provide(Layer.succeed(InferContext, context)));
  });
};
const typeName = (e: SExpr | undefined): Type | undefined => name(e) ? {_tag:"TCon",name:name(e)!} : undefined;
const fieldName = (e: SExpr): string | undefined => name(e)?.replace(/^:/, "");
const unwrapOption = (t: SExpr): SExpr => head(t) === "Option" && t._tag === "List" ? t.items[1]! : t;
const arg = (t: SExpr): SExpr | undefined => t._tag === "List" ? t.items[1] : undefined;

export function parseUnifiedForm(e: SExpr, types: ReadonlyMap<string, SExpr> = new Map(), helpers: readonly SExpr[] = []): FormDescriptor | undefined {
  if (head(e) !== "form" || e._tag !== "List") return undefined;
  const pattern = e.items[1];
  if (pattern?._tag !== "List" || !name(pattern.items[0])) throw new Error("form expects (head pattern ...) followed by :types, :ir and a body");
  const formName = name(pattern.items[0])!;
  let i = 2;
  const doc = e.items[i]?._tag === "Str" ? (e.items[i++] as Extract<SExpr, { _tag: "Str" }>).value : undefined;
  const options = new Map<string, SExpr>();
  while (i < e.items.length - 1) {
    const key = name(e.items[i]);
    if (!key?.startsWith(":")) throw new Error(`form ${formName}: expected a :key value option`);
    if (![":types", ":ir", ":type", ":scope", ":check", ":examples", ":emit"].includes(key)) throw new Error(`form ${formName}: unknown option ${key}`);
    if (options.has(key)) throw new Error(`form ${formName}: duplicate option ${key}`);
    const value = e.items[++i];
    if (!value) throw new Error(`form ${formName}: ${key} needs a value`);
    options.set(key, value);
    i++;
  }
  const holeTypes = options.get(":types");
  const irName = name(options.get(":ir"));
  const body = e.items[i];
  if (holeTypes?._tag !== "Map" || !irName || !body) throw new Error(`form ${formName} requires :types {:hole Type ...}, :ir IRType and one body`);
  if (!types.has(irName)) throw new Error(`form ${formName}: unknown IR type ${irName}`);
  const holes = new Map<string, SExpr>();
  for (const [k, t] of holeTypes.pairs) {
    const n = fieldName(k);
    if (!n || !name(k)?.startsWith(":")) throw new Error("form :types keys must be keywords");
    if (holes.has(n)) throw new Error(`Duplicate hole type ${n}`);
    holes.set(n, t);
  }
  const identifiers: IdentifierSpec[] = [];
  const slots: SlotSpec[] = [];
  const variables = new Set<string>();
  let declares: string | undefined;
  const addHole = (n: string, positional: boolean, many = false) => {
    if (variables.has(n)) throw new Error(`form ${formName}: duplicate pattern variable ${n}`);
    variables.add(n);
    const t = holes.get(n);
    if (!t) throw new Error(`form ${formName}: missing type for ${n}`);
    const u = unwrapOption(t);
    const h = head(u);
    if (positional && (h === "Declares" || h === "Refers" || name(u) === "Symbol")) {
      identifiers.push({ name: n, kind: h === "Declares" && u._tag === "List" && name(u.items[2]) === "String" ? "String" : "Symbol", ...(h === "Declares" ? { declaration: true } : {}) });
      if (h === "Declares") declares = name(arg(u));
    } else slots.push({ name: n, mode: h === "Expr" ? "expr" : many ? "form" : "value", required: head(t) !== "Option" && !many, ...(many ? { many: true } : {}), ...(h === "Expr" && name(arg(u)) ? { type: name(arg(u))! } : {}) });
  };
  const patterns = pattern.items.slice(1);
  for (let j = 0; j < patterns.length; j++) {
    const p = patterns[j]!;
    if (p._tag === "Map") {
      if (p.pairs.length !== 1 || name(p.pairs[0]![0]) !== ":keys" || p.pairs[0]![1]._tag !== "Vector") throw new Error("Form options pattern must be {:keys [names ...]}");
      for (const key of p.pairs[0]![1].items) {
        if (!name(key)) throw new Error("Form option names must be symbols");
        addHole(name(key)!, false);
      }
    } else if (name(p) && name(p) !== "...") {
      const many = name(patterns[j + 1]) === "...";
      addHole(name(p)!, true, many);
      if (many) {
        if (j !== patterns.length - 2) throw new Error("A repeated form hole must be final");
        j++;
      }
    } else throw new Error("Form patterns contain symbols, {:keys [...]} and a final repeated hole");
  }
  for (const n of holes.keys()) if (!variables.has(n)) throw new Error(`form ${formName}: type for unknown hole ${n}`);
  const resultType = options.get(":type");
  const extensions = typeDescriptor(irName, types.get(irName)!, types).extensions;
  return {
    name: formName, phase: "domain", ...(doc ? { doc } : {}), identifiers, slots,
    bindings: declares ? { kind: "static", rules: identifiers.filter(i => i.declaration).map(i => ({ kind: "declaration" as const, identifier: i.name, type: declares! })) } : { kind: "none" },
    validation: { kind: "hook", fn: `form/${formName}/validate` },
    elaboration: { kind: "hook", fn: `form/${formName}/construct` },
    resultType: head(resultType) === "fn" ? {kind:"hook",fn:`form/${formName}/result-type`} : { kind: "constant", type: name(resultType) ?? declares ?? "Unit" },
    produces: irName, ...(extensions ? {extensions} : {}),
    completionShape: `(${formName} ${patterns.map(p => name(p) ?? "options").join(" ")})`,
    surface: { pattern: patterns, holes, options, body, helpers:reachableHelpers([body,...options.values()],helpers,new Set(holes.keys())), types, ...(types.has(irName) ? { ir: types.get(irName)! } : {}) },
  };
}

/** Parse the pattern once for both normalization and hook execution. */
export function matchFormSyntax(spec: UnifiedForm, expr: SExpr): ReadonlyMap<string, SExpr> {
  if (expr._tag !== "List") throw new Error("Expected a form application");
  const result = new Map<string, SExpr>();
  const accepted = new Set<string>();
  for (const p of spec.pattern) if (p._tag === "Map") {
    const keys = p.pairs[0]![1];
    if (keys._tag === "Vector") keys.items.forEach(k => accepted.add(name(k)!));
  }
  let at = 1;
  for (let i = 0; i < spec.pattern.length; i++) {
    const p = spec.pattern[i]!;
    if (p._tag === "Map") {
      while (at < expr.items.length && name(expr.items[at])?.startsWith(":")) {
        const key = fieldName(expr.items[at++]!)!;
        if (!accepted.has(key)) throw new Error(`Unknown option :${key}`);
        if (result.has(key)) throw new Error(`Duplicate option :${key}`);
        const value = expr.items[at++];
        if (!value) throw new Error(`Option :${key} needs a value`);
        result.set(key, value);
      }
      for (const n of accepted) if (!result.has(n) && head(spec.holes.get(n)) !== "Option") throw new Error(`Missing required option :${n}`);
    } else {
      const n = name(p)!;
      if (name(spec.pattern[i + 1]) === "...") {
        result.set(n, { _tag: "Vector", items: expr.items.slice(at), loc: expr.loc });
        at = expr.items.length;
        i++;
      } else {
        const optional = head(spec.holes.get(n)) === "Option";
        const value = optional && accepted.has(fieldName(expr.items[at]!) ?? "") ? undefined : expr.items[at++];
        if (value) result.set(n, value);
        else if (head(spec.holes.get(n)) !== "Option") throw new Error(`Missing positional argument ${n}`);
      }
    }
  }
  if (at < expr.items.length) throw new Error("Too many positional arguments");
  return result;
}

export function normalizeUnifiedForm(descriptor: FormDescriptor, expr: SExpr) {
  const values = matchFormSyntax(descriptor.surface!, expr);
  const identifiers = new Map<string, string>();
  const slots = new Map<string, SlotValue>();
  for (const [n, v] of values) {
    if (descriptor.identifiers.some(i => i.name === n)) {
      const identifier = descriptor.identifiers.find(i => i.name === n)!;
      if (identifier.kind === "String") {
        if (v._tag !== "Str") throw new Error(`${n} must be a string`);
        identifiers.set(n, v.value);
      } else {
        if (v._tag !== "Sym" || v.name.startsWith(":")) throw new Error(`${n} must be a symbol`);
        identifiers.set(n, v.name);
      }
    } else slots.set(n, { kind: "expr", value: v });
  }
  return { formName: descriptor.name, descriptor, identifiers, slots: new SimpleNormalizedSlots(slots), loc: expr.loc, rawExpr: expr };
}

const projectionBuiltins: Record<string, BuiltinFn> = {
  List: args => Effect.succeed([KSymbol("List"), ...args]),
  Option: args => Effect.succeed([KSymbol("Option"), ...args]),
  Map: args => Effect.succeed([KSymbol("Map"), ...args]),

};

function validLiteral(e: SExpr, type: SExpr): boolean {
  const t = unwrapOption(type);
  const h = head(t);
  if (h === "Declares" && t._tag === "List" && name(t.items[2]) === "String") return e._tag === "Str";
  if (h === "Declares" || h === "Refers" || name(t) === "Symbol") return e._tag === "Sym" && !e.name.startsWith(":");
  if (name(t) === "String") return e._tag === "Str";
  if (name(t) === "Int") return e._tag === "Num" && Number.isInteger(e.value);
  if (name(t) === "Number") return e._tag === "Num";
  if (name(t) === "Bool") return e._tag === "Bool";
  if (name(t) === "Keyword") return name(e)?.startsWith(":") === true;
  if (h === "Union" && t._tag === "List") return t.items.slice(1).some(member => validLiteral(e, member));
  if (t._tag === "Str" || t._tag === "Num" || t._tag === "Bool") return (e._tag === "Str" || e._tag === "Num" || e._tag === "Bool") && e._tag === t._tag && e.value === t.value;
  if (name(t)?.startsWith(":")) return name(e) === name(t);
  if (h === "Record") return e._tag === "Map" && e.pairs.every(([k]) => name(k)?.startsWith(":") === true);
  if (h === "List") return e._tag === "Vector";
  return true;
}

export function unifiedFormHooks(descriptor: FormDescriptor, registry?: FormDescriptorRegistry, hostedBuiltins?: HostedMetaBuiltinsFactory, hostedDsls: import("../descriptor/meta-builtins.js").MetaBuiltinsContext["hostedDsls"] = new Map()): readonly ElaborationHook[] {
  const spec = descriptor.surface;
  if (!spec) return [];
  const execute = (input: HookInput, kind: "construct" | "validate" | "result-type") => Effect.gen(function* () {
    const values = matchFormSyntax(spec, input.rawExpr);
    let env = Env.empty();
    const converted = new Map<string,KValue>();
    const childDiagnostics: Diagnostic[] = [];
    for (const [n,t] of spec.holes) {
      const e = values.get(n);
      const u = unwrapOption(t);
      let value: KValue = e ? datum(e) : null;
      if (e && head(u) === "Record" && e._tag === "Map") value = e.pairs.map(([k,v])=>[datum(k),datum(v)]);

      converted.set(`:${n}`,value); env = env.bind(n,value);
    }
    env = env.bind("__holes",converted);
    const fieldsOf = (owner: KValue, strip = false): Map<string,KValue> => {
      const fields=input.semanticEnv.getFact("declaration-field-syntax",String(owner));
      return fields instanceof Map ? new Map([...fields].map(([k,t])=>[k,datum(strip ? stripTypeMetadata(t as SExpr) : t as SExpr)])) : new Map();
    };
    const builtins: Record<string,BuiltinFn> = { ...defaultBuiltins, ...createMetaBuiltins(input.semanticEnv, {hostedDsls, hostedBuiltins: hostedBuiltins?.(input.semanticEnv, {hostedDsls}) ?? {}}), ...projectionBuiltins,
      "meta/entries": args => args[0] instanceof Map
        ? Effect.succeed([...args[0]].map(([key, value]) => [mapKeyValue(key), value]))
        : Effect.fail(new KernelTypeError({message:"meta/entries expects a record",expected:"record",got:typeof args[0]})),
      "declaration-fields": args => Effect.succeed(fieldsOf(args[0]!)),
      "attribute-type": args => {
        const attribute=String(args[0]).replace(/^:/, "");
        for (const owner of input.semanticEnv.getDeclaredNames().keys()) {
          const fields=input.semanticEnv.getFact("declaration-field-syntax",owner);
          const holes=input.semanticEnv.getFact("declaration-hole-values",owner);
          if (owner===attribute && holes instanceof Map && holes.has("value-type")) return Effect.succeed(datum(stripTypeMetadata(holes.get("value-type") as SExpr)));
          if (holes instanceof Map) for (const endpoint of ["source","target"]) {
            const entity=holes.get(endpoint) as SExpr | undefined;
            if (entity?._tag==="Sym" && `${namespaceOf(owner)}/${namespaceOf(entity.name)}`===attribute) return Effect.succeed([KSymbol("Id"),KSymbol(entity.name)]);
          }
          if (fields instanceof Map) for (const [key,syntax] of fields) {
            const id=key.includes("/") ? key : `${namespaceOf(owner)}/${key}`;
            if (id===attribute) return Effect.succeed(datum(stripTypeMetadata(syntax as SExpr)));
          }
        }
        return Effect.fail(new KernelTypeError({message:`Unknown attribute ${attribute}`,expected:"declared attribute",got:attribute}));
      },
      "declaration-hole": args => {
        const holes=input.semanticEnv.getFact("declaration-hole-values",String(args[0]));
        const syntax=holes instanceof Map ? holes.get(String(args[1]).replace(/^:/,"")) : undefined;
        return Effect.succeed(syntax ? datum(syntax as SExpr) : null);
      },
      "type/kind": args => {
        const n=String(args[0]);
        const kind=input.semanticEnv.getFact("type-kind",n) ?? (spec.types.has(n) ? "type" : null);
        return Effect.succeed(kind ? KKeyword(`:${kind}`) : null);
      },
      "schema/validate-record": args => {
        const syntax = (value: KValue): SExpr => {
          const result = kValueToSExpr(value);
          const type = (e: SExpr): SExpr => e._tag === "Vector" ? {...e,_tag:"List",items:e.items.map(type)} : e._tag === "Map" ? {...e,pairs:e.pairs.map(([k,v])=>[k,type(v)] as const)} : e;
          return type(result);
        };
        const schema = syntax(args[0]!);
        const referenceErrors = (value: KValue, type: SExpr): string[] => {
          if (head(type) === "Id" && type._tag === "List" && typeof value === "string") {
            const record = input.semanticEnv.getFact("declaration-hole-values", value);
            const owner = record instanceof Map ? record.get("entity") as SExpr | undefined : undefined;
            return owner && name(owner) === name(type.items[1]) ? [] : [`Unknown ${name(type.items[1])} ID ${value}`];
          }
          if (type._tag === "Map" && value instanceof Map) return type.pairs.flatMap(([key,type]) => {
            const field = value.get(mapKey(datum(key))!);
            return field === undefined ? [] : referenceErrors(field, type);
          });
          if (head(type) === "List" && type._tag === "List" && Array.isArray(value)) return value.flatMap(value => referenceErrors(value, type.items[1]!));
          if (head(type) === "Option" && type._tag === "List" && value !== null) return referenceErrors(value, type.items[1]!);
          return [];
        };
        const errors = [...contractErrors(args[1]!, schema, spec.types, "fields"), ...referenceErrors(args[1]!, schema)];
        return Effect.succeed(errors.map(message => new Map<string,KValue>([[":severity",KKeyword(":error")],[":slot",KKeyword(":fields")],[":message",message]])));
      },
      "row-of": args => {
        const fields=fieldsOf(args[0]!,true); const selected=args[1];
        const keys=Array.isArray(selected) && selected.length ? selected.map(String) : [...fields.keys()];
        for (const key of keys) if (!fields.has(key)) return Effect.fail(new KernelTypeError({message:`Unknown field ${key} on ${String(args[0])}`,expected:"declared field",got:key}));
        return Effect.succeed(new Map(keys.map(k=>[`:${k}`,fields.get(k)!])));
      },
    };
    const constructors = [...spec.types].filter(([,type]) => head(type) === "Tagged" || head(type) === "Brand").map(([typeName,type]) => list(type,[sym(type,"type"),sym(type,typeName),type]));
    const run = (expression: SExpr) => evaluateExprs([...constructors,...spec.helpers,expression],{env,builtins,stepLimit:100_000}).pipe(Effect.map(r=>r.value));
    const invoke = (fn: SExpr) => run(list(fn,[fn,sym(fn,"__holes")]));
    for (const [n,t] of spec.holes) {
      const e = values.get(n), u = unwrapOption(t);
      const repeatedChildren = head(u) === "List";
      const childName = repeatedChildren ? name(arg(u)) : name(u)?.match(/^[a-z]/) ? name(u) : undefined;
      const childForm = childName ? registry?.get(childName) : undefined;
      const family = childName && !childForm?.surface ? spec.types.get(childName) : undefined;
      const irMembers = (type: SExpr, seen = new Set<string>()): readonly string[] => {
        const n = name(type);
        if (n && !seen.has(n)) {
          const alias = spec.types.get(n);
          return alias && alias._tag !== "Map" ? irMembers(alias, new Set([...seen, n])) : [n];
        }
        return head(type) === "Union" && type._tag === "List" ? type.items.slice(1).flatMap(t => irMembers(t, seen)) : [];
      };
      if (e && childName && (repeatedChildren ? e._tag === "Vector" : e._tag === "List") && registry && (childForm?.surface || family)) {
        let semanticEnv = input.semanticEnv;
        const scopes = spec.options.get(":scope");
        const scopeFn = scopes?._tag === "Map" ? scopes.pairs.find(([key])=>fieldName(key)===n)?.[1] : undefined;
        if (scopeFn && semanticEnv instanceof SimpleSemanticEnvironment) {
          const scope = yield* invoke(scopeFn);
          const scoped = semanticEnv.childScope();
          if (!(scope instanceof Map)) throw new ElaborationError({message:":scope must return a record of bindings",hookName:descriptor.name,phase:"validate"});
          for (const [key,type] of scope) scoped.bind(String(mapKeyValue(key)).replace(/^:/,""),yield* resolveType(type,e));
          semanticEnv = scoped;
        }
        const children = repeatedChildren && e._tag === "Vector" ? e.items : [e];
        const childValues = yield* Effect.forEach(children, original => {
          const childHead = head(original) ?? "";
          const direct = registry.get(childHead);
          const childDescriptor = family && (!direct?.surface || !irMembers(family).includes(direct.produces ?? "")) ? registry.get(`${childName}/${childHead}`) : direct;
          const child = childDescriptor && original._tag === "List" ? {...original, items: [sym(original.items[0]!, childDescriptor.name), ...original.items.slice(1)]} : original;
          if (!childDescriptor?.surface || (family ? !irMembers(family).includes(childDescriptor.produces ?? "") : childDescriptor.name !== childName)) return Effect.fail(new ElaborationError({message:`Expected child form ${childName}`,hookName:descriptor.name,phase:"construct"}));
          const normalized = normalizeUnifiedForm(childDescriptor,child);
          const hooks = unifiedFormHooks(childDescriptor,registry,hostedBuiltins,hostedDsls);
          const childInput = {...input,semanticEnv,formName:childDescriptor.name,descriptor:childDescriptor,rawExpr:child,loc:child.loc,identifiers:normalized.identifiers,normalizedSlots:normalized.slots};
          return Effect.gen(function* () {
            const checked = yield* hooks.find(h=>h.kind==="validate")!.execute(childInput);
            if (checked.kind === "validate" && checked.diagnostics.some(d=>d.severity==="error")) return yield* Effect.fail(new ElaborationError({message:checked.diagnostics.map(d=>d.message).join("; "),hookName:childDescriptor.name,phase:"validate"}));
            if (checked.kind === "validate") childDiagnostics.push(...checked.diagnostics);
            const out = yield* hooks.find(h=>h.kind==="construct")!.execute(childInput);
            return out.kind === "construct" ? out.ir as KValue : null;
          });
        });
        const projected = repeatedChildren ? childValues : childValues[0]!;
        converted.set(`:${n}`,projected);
        env = env.bind(n,projected);
      }
    }
    if (kind === "result-type") return {kind: "result-type" as const, type: yield* resolveType(yield* invoke(spec.options.get(":type")!), input.rawExpr)};
    if (kind === "validate") {
      const diagnostics: Diagnostic[] = [...childDiagnostics];
      for (const [n, e] of values) {
        const t = spec.holes.get(n)!;
        if (!validLiteral(e, t)) diagnostics.push({ severity: "error", message: `${n} does not match its declared hole type`, loc: e.loc });
        const u = unwrapOption(t);
        if (n === "layout" && registry) {
          const keys = (hole: string) => new Set(values.get(hole)?._tag === "Map" ? (values.get(hole) as Extract<SExpr,{_tag:"Map"}>).pairs.flatMap(([key])=>fieldName(key) ?? []) : []);
          const state=values.get("state");
          const stateVars = new Map(state?._tag === "Map" ? state.pairs.map(([key,value])=>{
            const kind=value._tag === "Map" ? value.pairs.find(([key])=>fieldName(key)==="kind")?.[1] : undefined;
            return [fieldName(key)!,kind?._tag === "Str" ? kind.value : "any"] as const;
          }) : []);
          const aliases=buildDescriptorTreeLayoutAliases(registry.list(),{extensionKey:"view/layout-alias",defaultTo:"custom"});
          const defs=values.get("defs");
          const layouts=[e,...(defs?._tag === "Map" ? defs.pairs.map(([,layout])=>layout) : [])];
          for (const layout of layouts) {
            const checked=typeCheckDescriptorTree({layout:rewriteDescriptorTreeLayoutAliases(layout,aliases),descriptors:registry.list(),extensionKey:"view/component",stateVars,queryNames:keys("queries"),inputParams:keys("input"),defNames:keys("defs")});
            for (const problem of checked.diagnostics) diagnostics.push({severity:problem.severity,message:problem.message,loc:layout.loc});
          }
        }
        const typeHoles = name(u) === "Type" ? [e] : head(u) === "Record" && name(arg(u)) === "Type" && e._tag === "Map" ? e.pairs.map(([,v]) => v) : head(u) === "List" && name(arg(u)) === "Type" && e._tag === "Vector" ? e.items : [];
        for (const syntax of typeHoles) for (const message of [...typeSyntaxErrors(syntax), ...unknownTypeReferences(syntax, n => spec.types.has(n) || input.semanticEnv.getDeclaredNames().has(n) || input.semanticEnv.getFact("type-kind", n) !== undefined)]) diagnostics.push({severity: "error", message, loc: syntax.loc});
        const checkReferences = (value: SExpr, type: SExpr): void => {
          type = unwrapOption(type);
          if (head(type) === "List" && type._tag === "List" && value._tag === "Vector") {
            for (const item of value.items) checkReferences(item, type.items[1]!);
          } else if (head(type) === "Refers" && value._tag === "Sym") {
            const declared = input.semanticEnv.getDeclaredNames().get(value.name);
            const declaring = declared ? registry?.get(declared.formName) : undefined;
            const classification = [...(declaring?.surface?.holes.values() ?? [])].find(t => head(t) === "Declares");
            const actual = classification ? typeName(arg(classification)) : input.semanticEnv.getBindingType(value.name) ?? declared?.type;
            if (!declared && !actual) diagnostics.push({severity:"error", message:`Unknown reference ${value.name}`, loc:value.loc});
            else if (actual && name(arg(type)) && (actual._tag !== "TCon" || actual.name !== name(arg(type)))) diagnostics.push({severity:"error", message:`${value.name} is ${showType(actual)}, expected ${name(arg(type))}`, loc:value.loc});
          }
        };
        checkReferences(e, u);
        if (head(u) === "Expr") {
          let checkedExpression=e;
          let semanticEnv = input.semanticEnv;
          const scope = spec.options.get(":scope");
          const scopeFn = scope?._tag === "Map" ? scope.pairs.find(([k])=>fieldName(k)===n)?.[1] : undefined;
          if (scopeFn && semanticEnv instanceof SimpleSemanticEnvironment) {
            const bindings = yield* invoke(scopeFn);
            const child = semanticEnv.childScope();
            if (bindings instanceof Map) {
              const annotations=new Map([...bindings].map(([key,value])=>[String(mapKeyValue(key)).replace(/^:/,""),typeSyntax(value,e)]));
              checkedExpression=coerceProgram([e],annotations)[0]!;
              for (const [key,value] of bindings) child.bind(String(mapKeyValue(key)).replace(/^:/,""),yield* resolveType(value, e));
            }
            semanticEnv = child;
          }
          const inferred = semanticEnv.inferExpression(checkedExpression);
          if (inferred._tag === "failure") diagnostics.push({ severity: "error", message: inferred.message, loc: e.loc });
          else {
            const expectedSyntax = arg(u)!;
            const expected = yield* resolveType(converted.get(`:${name(expectedSyntax)}`) ?? datum(expectedSyntax), e);
            const context = yield* makeOwnedInferContext();
            const checked = yield* assignType(inferred.type,expected,{kind:"expression",nodeId:"form-hole",span:{start:e.loc.start,end:e.loc.end}}).pipe(Effect.provide(Layer.succeed(InferContext,context)),Effect.result);
            if (checked._tag === "Failure") diagnostics.push({severity:"error",message:`${n} expects ${showType(expected)}, found ${showType(inferred.type)}`,loc:e.loc});
          }
        }
      }
      const check = spec.options.get(":check");
      if (check) {
        const extra = yield* invoke(check);
        if (!Array.isArray(extra)) throw new ElaborationError({message: ":check must return a list of diagnostics",hookName:descriptor.name,phase:"validate"});
        for (const problem of extra) {
          if (!(problem instanceof Map)) throw new ElaborationError({message:"Each :check diagnostic must be a record",hookName:descriptor.name,phase:"validate"});
          const severity = String(problem.get(":severity") ?? problem.get("severity") ?? "error").replace(/^:/, "");
          if (!["error","warning","info"].includes(severity)) throw new ElaborationError({message:"Invalid diagnostic severity",hookName:descriptor.name,phase:"validate"});
          const slot = String(problem.get(":slot") ?? problem.get("slot") ?? "").replace(/^:/,"");
          const code = problem.get(":code") ?? problem.get("code");
          if (code !== undefined && typeof code !== "string") throw new ElaborationError({message:"Diagnostic code must be a string",hookName:descriptor.name,phase:"validate"});
          diagnostics.push({...(code !== undefined ? {code} : {}),severity:severity as Diagnostic["severity"],message:String(problem.get(":message") ?? problem.get("message") ?? "Form validation failed"),loc:values.get(slot)?.loc ?? input.loc});
        }
      }
      return { kind: "validate" as const, diagnostics };
    }
    const result = {value: yield* run(spec.body)};
    const ir = result.value;
    if (spec.ir) {
      const errors = contractErrors(ir,spec.ir,spec.types);
      if (errors.length) throw new ElaborationError({message:errors.join("; "),hookName:descriptor.name,phase:"construct"});
    }
    return { kind: "construct" as const, ir: spec.ir ? normalizeContractValue(ir,spec.ir,spec.types) : ir };
  }).pipe(Effect.mapError(error => new ElaborationError({ message: String(error.message), hookName: `form/${descriptor.name}/${kind}`, phase: kind })));
  const kinds = ["construct", "validate", ...(head(spec.options.get(":type")) === "fn" ? ["result-type"] : [])] as ("construct" | "validate" | "result-type")[];
  return kinds.map(kind => ({ name: `form/${descriptor.name}/${kind}`, kind, inputType: "NormalizedForm", outputType: kind === "validate" ? "Diagnostics" : kind === "result-type" ? "Type" : descriptor.produces!, pure: true, phase: "compile" as const, execute: input => execute(input, kind) }));
}
