import { mapKey } from "../evaluator/types.js";
/**
 * Type expression parsing — standalone, no dependency on the lower dispatch.
 */
import type { SExpr } from "../reader/index.js";
import type { TypeExpr } from "./core-expr.js";
import { TESym, TEFun, TEApp, TERow } from "./core-expr.js";
import { InferenceError } from "./errors.js";
import { spanOf } from "./lower-core.js";

function parseEffectTypeSet(expr: SExpr, setName: "ErrorSet" | "RequirementSet"): TypeExpr {
  if (expr._tag !== "Vector") {
    throw new InferenceError({
      message:
        setName === "ErrorSet"
          ? "ErrorSet entries must be written as a vector."
          : "RequirementSet entries must be written as a vector.",
    });
  }

  return TEApp(
    spanOf(expr),
    TESym(spanOf(expr), setName),
    expr.items.map((item) => {
      if (item._tag !== "Sym" || item.name.startsWith(":")) {
        throw new InferenceError({
          message:
            setName === "ErrorSet"
              ? "Effect error entries must be type symbols."
              : "Effect requirement entries must be service or capability symbols.",
        });
      }
      return TESym(spanOf(item), item.name);
    }),
  );
}

/**
 * Parse a type expression from SExpr.
 *
 * Supported forms:
 *   Num, Str, Bool, Nil, String, Unit, Number, Boolean, a, b
 *                               -> TESym (type constants or variables)
 *   (-> A B C)                  -> TEFun (function type, last is return)
 *   (List A), (Map K V)         -> TEApp (type application)
 *   [(name String)]             -> TERow (closed record)
 *   [(name String) ...]         -> TERow (open record with synthetic row variable)
 *   {:name Str :age Num}        -> TERow (legacy closed record)
 *   {:name Str :* r}            -> TERow (legacy open record with row variable)
 */
export function parseTypeExpr(expr: SExpr): TypeExpr {
  try { return parseTypeExprInner(expr); }
  catch (error) {
    if (!(error instanceof InferenceError)) throw error;
    throw new InferenceError({message:error.message.replace(/ \(at offset \d+\)$/, ""),
      origin:error.origin ?? {nodeId:`type:${expr.loc.start}`, kind:"type-expression", span:spanOf(expr)},
      details:{code:"lower/type-expression",...error.details}});
  }
}
function parseTypeExprInner(expr: SExpr): TypeExpr {
  const span = spanOf(expr);

  switch (expr._tag) {
    case "Sym":
      return TESym(span, expr.name);

    case "List": {
      const items = expr.items;
      if (items.length === 0) {
        throw new InferenceError({ message: "Empty type expression" });
      }

      const head = items[0]!;
      if (head._tag !== "Sym") {
        throw new InferenceError({ message: "Type expression must start with a symbol" });
      }

      // Function type: (-> A B C) means A -> B -> C
      if (head.name === "->") {
        if (items.length < 3) {
          throw new InferenceError({ message: "(-> ...) requires at least 2 type arguments" });
        }

        const params = items.slice(1, -1).map(parseTypeExpr);
        const ret = parseTypeExpr(items[items.length - 1]!);
        return TEFun(span, params, ret);
      }

      if (head.name === "->!") {
        throw new InferenceError({
          message:
            "Legacy algebraic effect function type '->!' is no longer supported; use (Effect Success [Errors...] [Requirements...]).",
        });
      }

      // Operational Effect type: (Effect Success [Errors...] [Requirements...])
      if (head.name === "Effect") {
        if (items.length < 2 || items.length > 4) {
          throw new InferenceError({
            message: "Effect type expects success and optional error and requirement vectors.",
          });
        }

        return TEApp(span, TESym(spanOf(head), "Effect"), [
          parseTypeExpr(items[1]!),
          parseEffectTypeSet(items[2] ?? { _tag: "Vector", items: [], loc: expr.loc }, "ErrorSet"),
          parseEffectTypeSet(items[3] ?? { _tag: "Vector", items: [], loc: expr.loc }, "RequirementSet"),
        ]);
      }

      // Type application: (List A), (Map K V)
      const con = parseTypeExpr(head);
      const args = items.slice(1).map(parseTypeExpr);
      return TEApp(span, con, args);
    }

    case "Vector": {
      const fields: { label: string; type: TypeExpr }[] = [];
      let tail: string | undefined;

      for (const item of expr.items) {
        if (item._tag === "Sym" && item.name === "...") {
          tail = `@row_${span.start}`;
          continue;
        }
        if (item._tag !== "List" || item.items.length !== 2 || item.items[0]!._tag !== "Sym") {
          throw new InferenceError({ message: "Record field must be (name Type)" });
        }
        const rawLabel = item.items[0]!.name;
        const label = rawLabel.startsWith(":") ? rawLabel : `:${rawLabel}`;
        fields.push({ label, type: parseTypeExpr(item.items[1]!) });
      }

      return TERow(span, fields, tail);
    }

    case "Map": {
      // Record type: {:name Str :age Num} or {:name Str :* r}
      const fields: { label: string; type: TypeExpr }[] = [];
      let tail: string | undefined;

      for (const [k, v] of expr.pairs) {
        // Check for row variable tail: :* r
        if (k._tag === "Sym" && (k.name === ":*" || k.name === "&")) {
          if (v._tag !== "Sym") {
            throw new InferenceError({ message: "Row variable tail must be a symbol" });
          }
          tail = v.name;
          continue;
        }

        const label = k._tag === "Sym" ? k.name : k._tag === "Str" ? mapKey(k.value)! : "";
        if (!label) {
          throw new InferenceError({ message: "Record field label must be a symbol or string" });
        }
        fields.push({ label, type: parseTypeExpr(v) });
      }

      return TERow(span, fields, tail);
    }

    case "Set":
      throw new InferenceError({
        message: "Set literal not allowed in type expression.",
      });

    case "Num":
    case "Str":
    case "Bool":
      return TESym(span,JSON.stringify(expr.value));

    case "Error":
      throw new InferenceError({ message: `Parse error in type: ${expr.message}` });
  }
}
