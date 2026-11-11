import { authorNames } from "../diagnostic/diagnostic.js";
import { showType, type Type, type Row, type ERow } from "./types.js";

/** One namespace per diagnostic, shared by both sides of a mismatch. */
export function diagnosticTypePrinter(): (type: Type) => string {
  const names = new Map<string, string>();
  const name = (id: string): string => {
    let result = names.get(id);
    if (result === undefined) {
      const index = names.size;
      result = String.fromCharCode(97 + index % 26) + (index < 26 ? "" : Math.floor(index / 26));
      names.set(id, result);
    }
    return result;
  };
  const effect = (e: ERow): ERow => e._tag === "EVar" ? {...e,id:name(e.id)}
    : e._tag === "EExtend" ? {...e,tail:effect(e.tail)} : e;
  const row = (r: Row): Row => r._tag === "RVar" ? {...r,id:name(r.id)}
    : r._tag === "RExtend" ? {...r,type:type(r.type),tail:row(r.tail)} : r;
  const type = (t: Type): Type => {
    switch (t._tag) {
      case "TVar": return {...t,id:name(t.id)};
      case "TCon": return t;
      case "TApp": return {...t,con:type(t.con),args:t.args.map(type)};
      case "TRow": return {...t,row:row(t.row)};
      case "TFun": return {...t,arg:type(t.arg),res:type(t.res),...(t.rest ? {rest:type(t.rest)} : {}),...(t.effect ? {effect:effect(t.effect)} : {})};
      case "TVariadic": return {...t,rest:type(t.rest),res:type(t.res),...(t.effect ? {effect:effect(t.effect)} : {})};
    }
  };
  return t => authorNames(showType(type(t)));
}

export function typeMismatch(expectedType: Type, actualType: Type): Record<string, unknown> {
  const print = diagnosticTypePrinter();
  const expected = print(expectedType), got = print(actualType);
  return {code:"typecheck/type-mismatch",message:`Expected ${expected}, found ${got}`,expected,got};
}

export const showDiagnosticType = (type: Type): string => diagnosticTypePrinter()(type);
