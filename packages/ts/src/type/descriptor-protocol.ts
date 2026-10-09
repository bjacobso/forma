/** Descriptor rules run in the active HM context, including lexical bindings and substitutions. */
import { Effect, Ref } from "effect";
import type { BootstrappedPrelude } from "../descriptor/bootstrap.js";
import { checkDescriptorApplication } from "../descriptor/check-descriptors.js";
import { normalizeForm } from "../descriptor/normalize.js";
import { hookInputToKValue } from "../descriptor/meta-fn-executor.js";
import { createMetaBuiltins } from "../descriptor/meta-builtins.js";
import { metaText, metaType, metaTypeValue } from "../descriptor/meta-types.js";
import { SimpleSemanticEnvironment } from "../descriptor/SemanticEnvironment.js";
import { matchFormSyntax } from "../surface/form.js";
import { head, name as syntaxName } from "../surface/effect.js";
import type { InferContextService } from "./context.js";
import { Env } from "../Env.js";
import { evaluateExprs } from "../evaluator/eval.js";
import { defaultBuiltins } from "../builtins/index.js";
import type { BuiltinFn, KValue } from "../evaluator/types.js";
import { mapKeyValue } from "../evaluator/types.js";
import { KernelTypeError } from "../diagnostic/errors.js";
import type { SExpr } from "../reader/types.js";
import { headSym, tail } from "../reader/types.js";
import { lowerProgram } from "./lower.js";
import { checkExpr } from "./check-expr.js";
import { inferExpr, originOf } from "./infer-core.js";
import { InferContext } from "./context.js";
import { InferenceError } from "./errors.js";
import { TCon, mono, type Type } from "./types.js";
import { applyType, type TypeEnv } from "./substitution.js";
import type { DSLTypeProvider } from "./dsl-provider.js";
import type { CDSLForm, CoreExpr } from "./core-expr.js";

// Vector metadata remains indexable while retaining the syntax and author span
// needed when a hook passes that vector back to the checker.
const vectorSyntax = new WeakMap<object, SExpr>();

function expressionValue(expr: SExpr): KValue {
  const base = new Map<string,KValue>([
    ["syntax", expr as unknown as KValue],
    ["span", new Map<string,KValue>([["source-id",expr.loc.sourceId ?? "source"],["start-offset",expr.loc.start],["end-offset",expr.loc.end]])],
  ]);
  if (["Str", "Num", "Bool"].includes(expr._tag)) {
    base.set("kind", "literal"); base.set("value", (expr as SExpr & { value: KValue }).value);
  } else if (expr._tag === "Sym") {
    base.set("kind", expr.name === "nil" ? "literal" : "variable");
    if (expr.name === "nil") base.set("value",null); else base.set("name",expr.name);
  }
  else if (expr._tag === "List") {
    base.set("kind", "application"); base.set("form", headSym(expr) ?? "");
    base.set("args", tail(expr).map(expressionValue));
  } else if (expr._tag === "Vector") {
    const items = expr.items.map(expressionValue);
    vectorSyntax.set(items, expr);
    return items;
  }
  else if (expr._tag === "Map") {
    base.set("kind", "record");
    base.set("fields",expr.pairs.map(([key,value])=>new Map<string,KValue>([["label",syntaxName(key) ?? ""],["value",expressionValue(value)]])));
  }
  return base;
}

const builtinTypeNames = new Set(["Int","Num","Number","Float","Bool","Boolean","Str","String","Nil","Unit","Keyword","Symbol","Syntax","Any","_","List","Vector","Map","Fn","Declaration","TypeValue","FormDescriptor","ProtocolDescriptor"]);
function hookType(value: KValue): Type | undefined {
  const name = metaText(value);
  return name && !builtinTypeNames.has(name) ? undefined : metaType(value);
}

const environments = new WeakMap<InferContextService, SimpleSemanticEnvironment>();

export function descriptorApplication(
  prelude: BootstrappedPrelude, provider: DSLTypeProvider, env: TypeEnv,
  expr: CDSLForm, expected?: Type,
): Effect.Effect<Type | undefined, InferenceError, InferContext> {
  return Effect.gen(function* () {
    const descriptor = prelude.descriptions.get(expr.name);
    const raw = expr.rawExpr;
    if (!descriptor || !raw) return undefined;
    const ctx = yield* InferContext;
    const structural = checkDescriptorApplication(descriptor, raw, raw.loc.sourceId ?? "source")[0];
    if (structural) return yield* ctx.fail({...originOf(expr,"descriptor"),span:{start:structural.span!.startOffset,end:structural.span!.endOffset}},{code:structural.code,message:structural.message});
    let declarations = environments.get(ctx);
    if (!declarations) { declarations = new SimpleSemanticEnvironment(); environments.set(ctx,declarations); }
    const semanticEnv = declarations.childScope();
    for (const [name, scheme] of env) semanticEnv.bind(name, scheme.type);
    const normalized = normalizeForm({formName: expr.name, descriptor, expr: raw}, prelude.descriptions);
    const hookInput = {formName:expr.name, descriptor, normalizedSlots:normalized.slots,
      identifiers:normalized.identifiers, semanticEnv, loc:raw.loc, rawExpr:raw};
    if (descriptor.surface) {
      const holes = matchFormSyntax(descriptor.surface,raw);
      for (const identifier of descriptor.identifiers.filter(i=>i.declaration)) {
        const name = syntaxName(holes.get(identifier.name));
        if (!name) continue;
        semanticEnv.declareGlobal(name,descriptor.name,descriptor.resultType.kind === "constant" ? TCon(descriptor.resultType.type) : undefined);
        semanticEnv.setFact("declaration-hole-values",name,new Map(holes));
        for (const [hole,type] of descriptor.surface.holes) {
          const record=holes.get(hole);
          if (head(type) === "Record" && type._tag === "List" && syntaxName(type.items[1]) === "Type" && record?._tag === "Map")
            semanticEnv.setFact("declaration-field-syntax",name,new Map(record.pairs.map(([key,value])=>[syntaxName(key)!.replace(/^:/,""),value])));
        }
      }
      if (descriptor.validation.kind === "hook" || descriptor.validation.kind === "composite") {
        const result=yield* prelude.elaboration.validate(descriptor.validation.fn,hookInput).pipe(Effect.mapError(e=>new InferenceError({origin:originOf(expr,"descriptor"),message:e.message,details:{code:"typecheck/descriptor-check"}})));
        for (const diagnostic of result) {
          const slot = diagnostic.slot?.replace(/^:/, "");
          let loc = diagnostic.loc ?? (slot ? holes.get(slot)?.loc : undefined) ?? raw.loc;
          const field=diagnostic.message.match(/^fields\.([^ ]+) must/);
          const fields=holes.get("fields");
          if (field && fields?._tag === "Map") loc=fields.pairs.find(([key])=>syntaxName(key)?.replace(/^:/,"")===field[1]!.split("/").at(-1))?.[1].loc ?? loc;
          yield* ctx.addDiagnostic({code:diagnostic.code ?? (field ? "elaborate/form-check" : "typecheck/type-mismatch"),source:"typecheck",severity:diagnostic.severity === "warning" ? "warning" : "error",message:diagnostic.message,span:{start:loc.start,end:loc.end}});
        }
      }
      if (descriptor.resultType.kind === "hook") return yield* prelude.elaboration.computeResultType(descriptor.resultType.fn,hookInput).pipe(Effect.mapError(e=>new InferenceError({origin:originOf(expr,"descriptor"),message:e.message,details:{code:"typecheck/descriptor-result-type"}})));
      return descriptor.resultType.kind === "constant" && descriptor.resultType.type !== "Unit" ? metaType(descriptor.resultType.type) : TCon("Declaration");
    }
    const input = hookInputToKValue(hookInput) as Map<string,KValue>;
    input.set("kind", "descriptor-hook");
    input.set("form",expr.name);
    input.set("args", tail(raw).map(expressionValue));
    if (expected) { input.set("expected-type", metaTypeValue(expected)); input.set("expected", metaTypeValue(expected)); }
    const repeated = new Map<string,KValue>();
    for (const arg of tail(raw)) {
      const head = arg._tag === "Vector" && arg.items[0]?._tag === "Sym" ? arg.items[0].name : headSym(arg);
      const authored = head?.replace(/^:/, "");
      if (!head?.startsWith(":") || !authored) continue;
      const slot = descriptor.slots.find(s=>s.name===authored || s.aliases?.includes(authored));
      const name = slot?.name ?? authored;
      const values = arg._tag === "Vector" ? arg.items.slice(1) : tail(arg);
      repeated.set(name, [...(repeated.get(name) as KValue[] ?? []), ...values.map(expressionValue)]);
      const slots = input.get("slots");
      if (slots instanceof Map && values[0] && !slots.has(name)) slots.set(name,values[0] as unknown as KValue);
    }
    input.set("slotValues", repeated);
    let localEnv = new Map(env);
    let nestedError: InferenceError | undefined;
    const lowerValue = (value: KValue | undefined): CoreExpr | undefined => {
      const syntax = Array.isArray(value) ? vectorSyntax.get(value) : value instanceof Map ? value.get("syntax") : value;
      if (!syntax || typeof syntax !== "object" || !("_tag" in syntax)) return;
      return lowerProgram([syntax as unknown as SExpr], provider)[0];
    };
    const callback = (checking: boolean): BuiltinFn => args => Effect.gen(function* () {
      const child = lowerValue(args[1]);
      const target = checking ? metaType(args[2]) : undefined;
      if (!child || checking && !target) return yield* Effect.fail(new KernelTypeError({expected:"descriptor typing context",got:"invalid input",message:"Descriptor expression or type is invalid."}));
      yield* Ref.update(ctx.hookNodes, nodes => [...nodes, child]);
      const outcome = yield* Effect.result(checking ? checkExpr(localEnv, child, target!) : inferExpr(localEnv, child));
      if (outcome._tag === "Failure") {
        nestedError = outcome.failure;
        return yield* Effect.fail(new KernelTypeError({expected:"descriptor typing context",got:"invalid input",message: outcome.failure.message}));
      }
      yield* ctx.recordType(child.id, outcome.success);
      return metaTypeValue(applyType(yield* Ref.get(ctx.subst), outcome.success));
    }).pipe(Effect.provideService(InferContext, ctx));
    const builtins = {
      ...defaultBuiltins,
      ...createMetaBuiltins(semanticEnv, {hostedDsls:prelude.hostedDsls,hostedBuiltins:prelude.formBuiltins?.(semanticEnv,{hostedDsls:prelude.hostedDsls}) ?? {},checkExpression:callback(true), inferExpression:callback(false)}),
      "list/map": ((args, apply) => defaultBuiltins["map"]!([args[1]!, args[0]!], apply)) as BuiltinFn,
      "list/flat-map": ((args, apply) => defaultBuiltins["flat-map"]!([args[1]!, args[0]!], apply)) as BuiltinFn,
      "list/filter": ((args, apply) => defaultBuiltins["filter"]!([args[1]!, args[0]!], apply)) as BuiltinFn,
      "list/reduce": ((args, apply) => defaultBuiltins["reduce"]!([args[2]!, args[1]!, args[0]!], apply)) as BuiltinFn,
    };
    const run = (name: string, phase: string) => Effect.gen(function* () {
      input.set("mode",phase);
      const hook = prelude.typingHooks?.get(name.replace(/^:/, ""));
      if (!hook) return yield* ctx.fail(originOf(expr, "descriptor"), {code:"descriptor/unresolved-hook",message:`Unresolved ${phase} hook '${name}' for form '${expr.name}'.`});
      const result = yield* Effect.result(evaluateExprs([...(hook.helpers ?? []), hook.body], {env:Env.empty().bind("input", input), builtins, stepLimit:10000}));
      if (result._tag === "Failure") return yield* Effect.fail(nestedError ?? new InferenceError({origin:originOf(expr,"descriptor"),details:{code:`typecheck/descriptor-${phase}`}, message:result.failure.message}));
      return result.success.value;
    });
    const bindings = descriptor.bindings;
    if (bindings.kind === "hook" || bindings.kind === "composite") {
      const value = yield* run(bindings.fn, "bindings");
      if (value !== null && !(value instanceof Map)) return yield* ctx.fail(originOf(expr,"descriptor"), {code:"typecheck/descriptor-bindings",message:"Descriptor bindings must return a binding map."});
      if (value instanceof Map) for (const [key, valueType] of value) {
        const name = metaText(typeof key === "string" ? mapKeyValue(key) : key); const type = hookType(valueType);
        if (!name) return yield* ctx.fail(originOf(expr,"descriptor"), {code:"typecheck/descriptor-binding-name",message:"Descriptor bindings must use symbolic binding names."});
        if (!type) return yield* ctx.fail(originOf(expr,"descriptor"), {code:"typecheck/descriptor-binding-type",message:`Descriptor binding '${name}' must return a type.`});
        localEnv.set(name, mono(type));
      }
    }
    for (const child of expr.children) {
      const snapshot = yield* Ref.get(ctx.subst);
      const result = yield* Effect.result(child.expectedType ? checkExpr(localEnv,child.expr,child.expectedType) : inferExpr(localEnv,child.expr));
      if (result._tag === "Success") yield* ctx.recordType(child.expr.id,result.success);
      if (result._tag === "Failure") {
        yield* Ref.set(ctx.subst, snapshot);
        yield* ctx.addDiagnostic({code:String(result.failure.details?.["code"] ?? "typecheck/type-mismatch"),source:"typecheck",severity:"error",message:result.failure.message,span:result.failure.origin?.span ?? child.expr.span});
      }
    }
    const typed = (name: string, phase: string) => Effect.gen(function* () {
      const value = yield* run(name, phase);
      if (value === null || value === true) return phase === "check" ? expected : undefined;
      const type = hookType(value);
      if (!type) return yield* ctx.fail(originOf(expr,"descriptor"), {code:`typecheck/descriptor-${phase}`,message:`Descriptor ${phase} hook '${name}' must return a type${phase === "check" ? ", true, or nil" : ""}.`});
      return type;
    });
    const checked = descriptor.checkHook ? yield* typed(descriptor.checkHook,"check") : undefined;
    if (expected && checked) return checked;
    if (descriptor.inferHook) { const inferred = yield* typed(descriptor.inferHook,"infer"); if (inferred) return inferred; }
    if (descriptor.resultType.kind === "hook") return yield* typed(descriptor.resultType.fn,"result-type");
    if (descriptor.resultType.kind === "constant") return metaType(descriptor.resultType.type);
    return TCon("Declaration");
  });
}
