import { headSym, type SExpr } from "../reader/types.js";
import { flattenRow, type Scheme, type Type } from "../type/types.js";
import type { TypeEnv } from "../type/substitution.js";
import type { ResolvedModule } from "./graph.js";
/** Inference, rather than mandatory source annotations, supplies the target interface. */
export function inferredModuleSignatures(
  module: ResolvedModule,
  env: TypeEnv,
): readonly SExpr[] {
  const signed = new Set(
    module.expressions.flatMap((e) =>
      headSym(e) === ":" && e._tag === "List" && e.items[1]?._tag === "Sym"
        ? [e.items[1].name]
        : [],
    ),
  );
  return module.expressions.flatMap((e) => {
    if (
      headSym(e) !== "define" ||
      e._tag !== "List" ||
      e.items[1]?._tag !== "Sym" ||
      signed.has(e.items[1].name)
    )
      return [e];
    const scheme = env.get(e.items[1].name);
    if (!scheme)
      throw Object.assign(
        new Error(`No inferred interface for ${e.items[1].name}`),
        { loc: e.loc },
      );
    const signature = schemeSyntax(scheme, e);
    return [
      {
        ...e,
        items: [{ _tag: "Sym", name: ":", loc: e.loc }, e.items[1], signature],
      } as SExpr,
      e,
    ];
  });
}
export function schemeSyntax(scheme: Scheme, e: SExpr, target = true): SExpr {
  const sym = (name: string): SExpr => ({ _tag: "Sym", name, loc: e.loc });
  const list = (name: string, items: readonly SExpr[]): SExpr => ({
    _tag: "List",
    items: [sym(name), ...items],
    loc: e.loc,
  });
  const quantified = new Set([
    ...scheme.tvars,
    ...scheme.rvars,
    ...scheme.evars,
  ]);
  const vars = new Map<string, string>();
  const variable = (id: string): string => {
    if (!quantified.has(id)) return id;
    if (!vars.has(id)) vars.set(id, `a${vars.size}`);
    return vars.get(id)!;
  };
  const convert = (t: Type): SExpr => {
    switch (t._tag) {
      case "TVar":
        return sym(variable(t.id));
      case "TCon":
        return sym(t.name);
      case "TFun": {
        const params: SExpr[] = [];
        let result: Type = t;
        while (result._tag === "TFun") {
          params.push(convert(result.arg));
          if (result.rest) {
            if (target)
              throw Object.assign(
                new Error(
                  "Effect TypeScript does not support inferred variadic function exports yet.",
                ),
                { loc: e.loc },
              );
            params.push(sym("&"), convert(result.rest));
          }
          result = result.res;
        }
        return list("->", [...params, convert(result)]);
      }
      case "TVariadic":
        if (target)
          throw Object.assign(
            new Error(
              "Effect TypeScript does not support inferred variadic function exports yet.",
            ),
            { loc: e.loc },
          );
        return list("->", [sym("&"), convert(t.rest), convert(t.res)]);
      case "TRow": {
        const { fields, tail } = flattenRow(t.row);
        if (target && tail._tag !== "REmpty")
          throw Object.assign(
            new Error(
              "Effect TypeScript does not support inferred open-row exports yet; supply a closed signature.",
            ),
            { loc: e.loc },
          );
        return {
          _tag: "Map",
          pairs: [
            ...[...fields]
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([name, type]) => [sym(name), convert(type)] as const),
            ...(tail._tag === "RVar"
              ? [[sym("&"), sym(variable(tail.id))] as const]
              : []),
          ],
          loc: e.loc,
        };
      }
      case "TApp": {
        const name = t.con._tag === "TCon" ? t.con.name : undefined;
        if (name === "Brand" && t.args[0]?._tag === "TCon")
          return sym(t.args[0].name);
        if (
          name === "Effect" ||
          name === "Stream" ||
          name === "Layer" ||
          name === "Fiber"
        )
          return list(
            name,
            t.args.map((a) =>
              a._tag === "TApp" &&
              a.con._tag === "TCon" &&
              ["ErrorSet", "RequirementSet"].includes(a.con.name)
                ? { _tag: "Vector", items: a.args.map(convert), loc: e.loc }
                : convert(a),
            ),
          );
        return {
          _tag: "List",
          items: [convert(t.con), ...t.args.map(convert)],
          loc: e.loc,
        };
      }
    }
  };
  const type = convert(scheme.type);
  // HM represents a zero-argument lambda with Unit as its input.
  const value = e._tag === "List" ? e.items[2] : undefined;
  const zero =
    (value?._tag === "Vector" && value.items.length === 0) ||
    (value &&
      headSym(value) === "fn" &&
      value?._tag === "List" &&
      value.items[1]?._tag === "Vector" &&
      value.items[1].items.length === 0);
  return zero && type._tag === "List" && headSym(type) === "->"
    ? { ...type, items: [type.items[0]!, ...type.items.slice(2)] }
    : type;
}
