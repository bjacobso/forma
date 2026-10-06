import { Effect } from "effect";
import type { BuiltinFn } from "../evaluator/types.js";
import { ArityError } from "../diagnostic/errors.js";
const constructor = (name: string): BuiltinFn => args => args.length===1
  ? Effect.succeed(new Map([[":_tag",name],[":value",args[0]!]]))
  : Effect.fail(new ArityError({name,expected:1,got:args.length}));
export const constructorBuiltins: Record<string,BuiltinFn> = {
  Some:constructor("Some"),"Option.Some":constructor("Some"),
  Ok:constructor("Ok"),"Result.Ok":constructor("Ok"),
  Err:constructor("Err"),"Result.Err":constructor("Err"),
};
