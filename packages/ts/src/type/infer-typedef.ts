/**
 * Inference for type definitions, class definitions, and instance declarations.
 */
import { Effect, Ref } from "effect";
import type { Type, Row } from "./types.js";
import { TVar, TCon, TApp, tNil, Scheme as mkScheme, fnType, TRow, RExtend } from "./types.js";
import { applyType, applyEnv, type TypeEnv } from "./substitution.js";
import { unify } from "./unify.js";
import { InferContext } from "./context.js";
import type { ClassInfo, InstanceInfo } from "./context.js";
import { InferenceError } from "./errors.js";
import type { CoreExpr, TypeExpr } from "./core-expr.js";
import type { Kind } from "./kind.js";
import { KStar, KArrow } from "./kind.js";
import { isTypeVar, originOf, typeExprToType } from "./infer-core.js";
import {
  getAdtConstructorSchemes,
  getClassMethodSchemes,
  getServiceMethodSchemes,
} from "./infer-state.js";
import type { InferFn } from "./infer-binding.js";

// ---------------------------------------------------------------------------
// TypeDef (type alias + ADT)
// ---------------------------------------------------------------------------

export const inferTypeDef = (
  expr: CoreExpr & { _tag: "TypeDef" },
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    if (expr.source === "form") {
      const type = TCon("FormDescriptor");
      getAdtConstructorSchemes().set(expr.name, mkScheme([], [], type));
      return type;
    }

    // Type alias
    if (expr.typeExpr) {
      if (expr.source === "error" || expr.source === "class") {
        const fields = yield* typeExprToType(expr.typeExpr, new Map(), new Map());
        if (fields._tag !== "TRow") return yield* ctx.fail(originOf(expr, "named-record"), {message: "Named record types require record fields"});
        const nominal = TCon(expr.name);
        const shape = expr.source === "error" ? TRow(RExtend(":_tag", TCon(JSON.stringify(expr.name)), fields.row)) : fields;
        yield* Ref.update(ctx.nominalRecords, records => new Map(records).set(expr.name, shape));
        getAdtConstructorSchemes().set(expr.name, mkScheme([], [], fnType([fields], nominal)));
        yield* Ref.update(ctx.constructorToType, constructors => new Map(constructors).set(expr.name, expr.name));
        yield* Ref.update(ctx.adtRegistry, registry => new Map(registry).set(expr.name, {typeParams: [], constructors: new Map([[expr.name, 1]])}));
        if (expr.source === "error") yield* Ref.update(ctx.errorTypes, errors => new Set(errors).add(expr.name));
        return tNil;
      }
      yield* typeExprToType(expr.typeExpr, new Map(), new Map());
      yield* Ref.update(ctx.typeAliasParams, params => new Map(params).set(expr.name, expr.typeParams ?? []));
      if (expr.source === "schema") {
        yield* validateMechanicsTypeRefs(expr.name, expr.typeExpr);
      }
      yield* Ref.update(ctx.typeAliases, (m) => {
        const next = new Map(m);
        next.set(expr.name, expr.typeExpr!);
        return next;
      });
      if (expr.typeExpr._tag === "TEApp" && expr.typeExpr.con._tag === "TESym" && expr.typeExpr.con.name === "Brand") {
        const base = yield* typeExprToType(expr.typeExpr.args.at(-1)!, new Map(), new Map());
        const branded = yield* typeExprToType(expr.typeExpr, new Map(), new Map());
        getAdtConstructorSchemes().set(expr.name, mkScheme([], [], fnType([base], branded)));
      }
      return tNil;
    }

    // ADT: register type and constructors
    if (expr.constructors && expr.constructors.length > 0) {
      const typeParams = expr.typeParams ?? [];
      const typeCon = TCon(expr.name);

      // Register ADT info
      const conArities = new Map<string, number>();
      for (const con of expr.constructors) {
        conArities.set(con.name, con.fields.length);
      }
      yield* Ref.update(ctx.adtRegistry, (m) => {
        const next = new Map(m);
        next.set(expr.name, { typeParams, constructors: conArities });
        return next;
      });

      // Register constructor → type mapping
      yield* Ref.update(ctx.constructorToType, (m) => {
        const next = new Map(m);
        for (const con of expr.constructors!) {
          next.set(con.name, expr.name);
          next.set(`${expr.name}.${con.name}`,expr.name);
        }
        return next;
      });

      // Register each constructor as a function in the type environment
      // via a module-level map that inferProgram will pick up
      const _adtConstructorSchemes = getAdtConstructorSchemes();
      for (const con of expr.constructors) {
        // Build the result type: TypeName<a, b, ...> or just TypeName
        const resultType =
          typeParams.length > 0
            ? TApp(
                typeCon,
                typeParams.map((p) => TVar(`__adt_${expr.name}_${p}`)),
              )
            : typeCon;

        // Build the constructor's function type
        let conType: Type;
        if (con.fields.length === 0) {
          conType = resultType;
        } else {
          // Convert field TypeExprs to Types using the type param mapping
          const tvarMap = new Map<string, Type>();
          const rvarMap = new Map<string, import("./types.js").Row>();
          for (const p of typeParams) {
            tvarMap.set(p, TVar(`__adt_${expr.name}_${p}`));
          }
          const fieldTypes: Type[] = [];
          for (const field of con.fields) {
            fieldTypes.push(yield* typeExprToType(field, tvarMap, rvarMap));
          }
          conType = fnType(fieldTypes, resultType);
        }

        // Generalize over the ADT's type params
        const tvars = typeParams.map((p) => `__adt_${expr.name}_${p}`);
        const scheme = mkScheme(tvars, [], conType);

        // Store in _adtConstructorSchemes for inferProgram to register
        _adtConstructorSchemes.set(con.name, scheme);
        _adtConstructorSchemes.set(`${expr.name}.${con.name}`,scheme);
      }
    }

    return tNil;
  });

const mechanicsBuiltinTypes = new Set([
  "Any",
  "Bytes",
  "Boolean",
  "Bool",
  "DateTime",
  "Float",
  "Int",
  "Json",
  "Keyword",
  "List",
  "Map",
  "Nil",
  "Number",
  "Num",
  "Option",
  "Str",
  "String",
  "Symbol",
  "Syntax",
  "TaggedUnion",
  "Tuple",
  "Unit",
  "Union",
  "Vector",
]);

function uppercaseInitial(name: string): boolean {
  if (name.length === 0) return false;
  const first = name[0]!;
  return first.toUpperCase() === first && first.toLowerCase() !== first;
}

const validateMechanicsTypeRefs = (
  ownerName: string,
  typeExpr: TypeExpr,
): Effect.Effect<void, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;
    const aliases = yield* Ref.get(ctx.typeAliases);

    const visit = (expr: TypeExpr): Effect.Effect<void, InferenceError, InferContext> =>
      Effect.gen(function* () {
        switch (expr._tag) {
          case "TERowOp": {
            for (const operand of expr.operands) yield* visit(operand);
            return;
          }
          case "TESym": {
            const name = expr.name;
            if (
              mechanicsBuiltinTypes.has(name) ||
              isTypeVar(name) ||
              name === ownerName ||
              aliases.has(name)
            ) {
              return;
            }
            if (uppercaseInitial(name)) {
              return yield* ctx.fail(
                { nodeId: `mechanics-schema-ref:${name}`, span: expr.span, kind: "__schema" },
                { message: `Unknown schema reference: ${name}` },
              );
            }
            return;
          }
          case "TEFun": {
            for (const param of expr.params) {
              yield* visit(param);
            }
            yield* visit(expr.ret);
            return;
          }
          case "TEApp": {
            if (expr.con._tag === "TESym" && expr.con.name === "Brand") {
              for (const arg of expr.args.slice(1)) {
                yield* visit(arg);
              }
              return;
            }
            yield* visit(expr.con);
            for (const arg of expr.args) {
              yield* visit(arg);
            }
            return;
          }
          case "TERow": {
            for (const field of expr.fields) {
              yield* visit(field.type);
            }
            return;
          }
        }
      });

    yield* visit(typeExpr);
  });

// ---------------------------------------------------------------------------
// DefClass (type class definition)
// ---------------------------------------------------------------------------

/**
 * Parse a simple kind from a type expression.
 * Handles: * (KStar), (-> * *) (KArrow(KStar, KStar))
 */
function parseKindFromTypeExpr(te: TypeExpr): Kind {
  if (te._tag === "TESym" && te.name === "*") return KStar;
  if (te._tag === "TEFun") {
    const params = te.params.map(parseKindFromTypeExpr);
    let result = parseKindFromTypeExpr(te.ret);
    for (let i = params.length - 1; i >= 0; i--) {
      result = KArrow(params[i]!, result);
    }
    return result;
  }
  // Default to KStar
  return KStar;
}

export const inferDefClass = (
  expr: CoreExpr & { _tag: "DefClass" },
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;

    // Build kind for each type parameter
    const typeParamKinds: { name: string; kind: Kind }[] = [];
    for (const tp of expr.typeParams) {
      // For now, default to KStar unless annotated
      // Kind annotations like (f : * -> *) would need parseKind
      const kind = tp.kindAnnotation ? parseKindFromTypeExpr(tp.kindAnnotation) : KStar;
      typeParamKinds.push({ name: tp.name, kind });
    }

    // Convert method type expressions to Types
    const tvarMap = new Map<string, Type>();
    const rvarMap = new Map<string, Row>();
    for (const tp of expr.typeParams) {
      tvarMap.set(tp.name, TVar(`__class_${expr.name}_${tp.name}`));
    }

    const methodTypes = new Map<string, Type>();
    for (const m of expr.methods) {
      const mType = yield* typeExprToType(m.typeExpr, tvarMap, rvarMap);
      methodTypes.set(m.name, mType);
    }

    // Convert super constraints
    const superConstraints = expr.supers.map((s) => ({
      className: s.className,
      args: s.args.map((a) => {
        // Simple: if arg is a sym matching a type param, use the param's TVar
        if (a._tag === "TESym" && tvarMap.has(a.name)) return tvarMap.get(a.name)!;
        return TCon(a._tag === "TESym" ? a.name : "Unknown");
      }),
    }));

    // Register class info
    const classInfo: ClassInfo = {
      name: expr.name,
      typeParams: typeParamKinds,
      supers: superConstraints,
      methods: methodTypes,
    };

    yield* Ref.update(ctx.classRegistry, (m) => {
      const next = new Map(m);
      next.set(expr.name, classInfo);
      return next;
    });

    // Register each method as a constrained polymorphic function
    const tvars = expr.typeParams.map((tp) => `__class_${expr.name}_${tp.name}`);
    const constraint = {
      className: expr.name,
      args: expr.typeParams.map((tp) => TVar(`__class_${expr.name}_${tp.name}`)),
    };

    const _classMethodSchemes = getClassMethodSchemes();
    for (const [methodName, methodType] of methodTypes) {
      const scheme = mkScheme(tvars, [], methodType, [], [constraint]);
      _classMethodSchemes.set(methodName, scheme);
    }

    return tNil;
  });

// ---------------------------------------------------------------------------
// Instance (type class instance)
// ---------------------------------------------------------------------------

export const inferInstance = (
  env: TypeEnv,
  expr: CoreExpr & { _tag: "Instance" },
  inferExpr: InferFn,
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const ctx = yield* InferContext;

    // Check class exists
    const classReg = yield* Ref.get(ctx.classRegistry);
    const classInfo = classReg.get(expr.className);
    if (!classInfo) {
      return yield* ctx.fail(originOf(expr, "instance"), {
        message: `Unknown type class: ${expr.className}`,
      });
    }

    // Convert instance type args
    const tvarMap = new Map<string, Type>();
    const rvarMap = new Map<string, Row>();
    const typeArgs: Type[] = [];
    for (const ta of expr.typeArgs) {
      typeArgs.push(yield* typeExprToType(ta, tvarMap, rvarMap));
    }

    // Convert instance constraints
    const constraints = expr.constraints.map((c) => ({
      className: c.className,
      args: c.args.map((a) => {
        if (a._tag === "TESym" && tvarMap.has(a.name)) return tvarMap.get(a.name)!;
        return TCon(a._tag === "TESym" ? a.name : "Unknown");
      }),
    }));

    // Type-check each method implementation against the class's expected type
    for (const method of expr.methods) {
      const expectedType = classInfo.methods.get(method.name);
      if (!expectedType) {
        yield* ctx.addDiagnostic({
          message: `Method '${method.name}' is not defined in class ${expr.className}`,
          span: expr.span,
          severity: "warning",
          source: "hm",
        });
        continue;
      }

      // Build substitution from class params to instance args
      const paramSub = new Map<string, Type>();
      for (let i = 0; i < classInfo.typeParams.length && i < typeArgs.length; i++) {
        paramSub.set(`__class_${expr.className}_${classInfo.typeParams[i]!.name}`, typeArgs[i]!);
      }
      const instantiatedType = applyType(
        { tvars: paramSub, rvars: new Map(), evars: new Map() },
        expectedType,
      );

      // Infer method body type
      const s = yield* Ref.get(ctx.subst);
      const envN = applyEnv(s, env);
      const bodyT = yield* inferExpr(envN, method.expr);

      // Unify with expected type
      yield* unify(
        applyType(yield* Ref.get(ctx.subst), bodyT),
        applyType(yield* Ref.get(ctx.subst), instantiatedType),
        originOf(expr, `instance-method:${method.name}`),
      );
    }

    // Register instance
    const instanceInfo: InstanceInfo = {
      className: expr.className,
      args: typeArgs,
      constraints,
      methods: new Map(expr.methods.map((m) => [m.name, m.expr])),
    };

    yield* Ref.update(ctx.instanceRegistry, (m) => {
      const next = new Map(m);
      const existing = next.get(expr.className) ?? [];
      next.set(expr.className, [...existing, instanceInfo]);
      return next;
    });

    return tNil;
  });

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export const inferDefService = (
  expr: CoreExpr & { _tag: "DefService" },
): Effect.Effect<Type, InferenceError, InferContext> =>
  Effect.gen(function* () {
    const serviceMethodSchemes = getServiceMethodSchemes();
    for (const method of expr.methods) {
      const methodType = yield* typeExprToType(
        method.typeExpr,
        new Map<string, Type>(),
        new Map<string, Row>(),
      );
      serviceMethodSchemes.set(`${expr.name}.${method.name}`, mkScheme([], [], methodType));
    }
    return tNil;
  });
