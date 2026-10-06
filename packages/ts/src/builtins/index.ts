import { constructorBuiltins } from "./constructors.js";
import type { BuiltinFn } from "../evaluator/types.js";
import { arithmeticBuiltins } from "./arithmetic.js";
import { comparisonBuiltins } from "./comparison.js";
import { stringBuiltins } from "./strings.js";
import { collectionBuiltins } from "./collections.js";
import { dataBuiltins } from "./data.js";
import { typecheckBuiltins } from "./typecheck.js";
import { controlBuiltins } from "./control.js";
import { macroBuiltins } from "./macro.js";
import { meta, typeBase, typeMetadata, keywordName } from "./meta.js";
import { schemaBuiltins } from "./schema.js";

export const defaultBuiltins: Record<string, BuiltinFn> = {
  ...arithmeticBuiltins,
  ...constructorBuiltins,
  ...comparisonBuiltins,
  ...stringBuiltins,
  ...collectionBuiltins,
  ...dataBuiltins,
  ...typecheckBuiltins,
  ...controlBuiltins,
  ...macroBuiltins,
  ...schemaBuiltins,
  meta,
  "type/base":typeBase,
  "type/metadata":typeMetadata,
  "keyword/name":keywordName,
};
