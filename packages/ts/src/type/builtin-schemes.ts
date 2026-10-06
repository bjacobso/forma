/**
 * Built-in type schemes for primitive operations.
 */
import type { Scheme } from "./types.js";
import {
  TVar,
  TCon,
  TApp,
  TFun,
  TVariadic,
  tNum,
  tStr,
  tBool,
  tList,
  tUnknown,
  tNever,
  tMeta,
  mono,
  Scheme as mkScheme,
  fnType,
} from "./types.js";

export type BuiltinSchemeProvider = (name: string) => Scheme | undefined;

/**
 * Keywords that are conventionally used as literal values (not parameter references).
 * These are excluded from the "did you mean (get $input ...)" warning.
 */
export const WELL_KNOWN_KEYWORDS = new Set([
  ":else",
  ":default",
  ":none",
  ":all",
  ":true",
  ":false",
]);

function arithBinop(): Scheme {
  return mono(fnType([tNum, tNum], tNum));
}

function variadicArith(): Scheme {
  return mono(TFun(tNum, tNum, undefined, tNum));
}

function arithUnary(): Scheme {
  return mono(fnType([tNum], tNum));
}

export function builtinScheme(name: string): Scheme | undefined {
  switch (name) {
    case "Some": case "Option.Some": return mkScheme(["__option"],[],fnType([TVar("__option")],TApp(TCon("Option"),[TVar("__option")])));
    case "None": case "Option.None": return mkScheme(["__option"],[],TApp(TCon("Option"),[TVar("__option")]));
    case "Ok": case "Result.Ok": return mkScheme(["__result","__error"],[],fnType([TVar("__result")],TApp(TCon("Result"),[TVar("__result"),TVar("__error")])));
    case "Err": case "Result.Err": return mkScheme(["__result","__error"],[],fnType([TVar("__error")],TApp(TCon("Result"),[TVar("__result"),TVar("__error")])));
    case "+":
    case "-":
    case "*":
    case "/":
    case "min":
    case "max":
      return variadicArith();
    case "mod":
    case "pow":
      return arithBinop();
    case "abs":
    case "sqrt":
    case "floor":
    case "ceil":
    case "round":
      return arithUnary();
    case "=":
    case "!=": {
      // forall a. a -> a -> Bool
      const aId = "__cmp_a";
      const a = TVar(aId);
      return mkScheme([aId], [], fnType([a, a], tBool));
    }
    case "<":
    case "<=":
    case ">":
    case ">=":
      return mono(fnType([tNum, tNum], tBool));
    case "format":
    case "str":
      return mono(TVariadic(tUnknown,tStr));
    case "concat":
      return mono(fnType([tStr, tStr], tStr));

    case "upcase":
    case "downcase":
    case "uppercase":
    case "lowercase":
    case "trim":
      return mono(fnType([tStr], tStr));
    case "length":
      return mono(fnType([tStr], tNum));
    case "starts-with?":
    case "starts-with":
    case "ends-with?":
    case "ends-with":
    case "contains":
      return mono(fnType([tStr, tStr], tBool));
    case "substring":
    case "subs":
      return mono(fnType([tStr, tNum, tNum], tStr));
    case "index-of":
      return mono(fnType([tStr, tStr], tNum));
    case "replace":
      return mono(fnType([tStr, tStr, tStr], tStr));
    case "split":
      return mono(fnType([tStr, tStr], TApp(tList, [tStr])));
    case "join":
      return mono(fnType([TApp(tList, [tStr]), tStr], tStr));
    case "keyword?":
    case "symbol?":
    case "is-nil":
    case "is-string":
    case "is-number":
    case "is-boolean":
    case "is-list":
    case "is-map": {
      const aId = "__pred_a";
      return mkScheme([aId], [], fnType([TVar(aId)], tBool));
    }
    case "type": {
      const aId = "__type_a";
      return mkScheme([aId], [], fnType([TVar(aId)], tStr));
    }
    case "id": {
      const aId = "__id_a";
      return mkScheme([aId], [], fnType([TVar(aId)], tStr));
    }
    case "first": {
      const aId = "__first_a";
      return mkScheme([aId], [], fnType([TApp(tList, [TVar(aId)])], TVar(aId)));
    }
    case "rest": {
      const aId = "__rest_a";
      return mkScheme([aId], [], fnType([TApp(tList, [TVar(aId)])], TApp(tList, [TVar(aId)])));
    }
    case "count": {
      const aId = "__count_a";
      return mkScheme([aId], [], fnType([TApp(tList, [TVar(aId)])], tNum));
    }
    case "reverse": {
      const aId = "__rev_a";
      return mkScheme([aId], [], fnType([TApp(tList, [TVar(aId)])], TApp(tList, [TVar(aId)])));
    }
    case "nth": {
      const aId = "__nth_a";
      return mkScheme([aId], [], fnType([TApp(tList, [TVar(aId)]), tNum], TVar(aId)));
    }
    case "map": {
      // forall a b. (a -> b) -> List a -> List b
      const aId = "__map_a";
      const bId = "__map_b";
      return mkScheme(
        [aId, bId],
        [],
        fnType(
          [fnType([TVar(aId)], TVar(bId)), TApp(tList, [TVar(aId)])],
          TApp(tList, [TVar(bId)]),
        ),
      );
    }
    case "filter": {
      // forall a. (a -> Bool) -> List a -> List a
      const aId = "__filter_a";
      return mkScheme(
        [aId],
        [],
        fnType([fnType([TVar(aId)], tBool), TApp(tList, [TVar(aId)])], TApp(tList, [TVar(aId)])),
      );
    }
    case "__not":
      // (not expr) -> Bool — internal desugared name
      return mono(fnType([tBool], tBool));

    case "meta": return mono(fnType([tUnknown,tUnknown,tUnknown],tUnknown));
    case "attribute-type":
      return mono(fnType([tUnknown], tUnknown));
    case "meta/get": return mono(fnType([tUnknown,tUnknown],tUnknown));
    case "declaration-hole": return mono(fnType([tUnknown,tUnknown],tUnknown));
    case "type/kind": return mono(fnType([tUnknown],tUnknown));
    case "type/base": return mono(fnType([tUnknown],tUnknown));
    case "keyword/name": return mono(fnType([tUnknown],tStr));
    case "keyword": return mono(TFun(tUnknown,{_tag:"TCon",name:"Keyword"},undefined,tUnknown));
    case "sym": return mono(fnType([tStr],{_tag:"TCon",name:"Symbol"}));

    case "fail":
      return mono(fnType([tStr], tNever));

    default:
      return undefined;
  }
}
