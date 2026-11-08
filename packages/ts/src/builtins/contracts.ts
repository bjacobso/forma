/**
 * Builtin availability inventory. The parity test compares this table with all
 * three registries; adding a name requires recording its supported passes.
 * Presence is not a claim of semantic parity for the legacy entries. The six
 * RFC 0019 contracts below additionally have cross-pass execution fixtures.
 * Runtime means the shared evaluator/VM function registry, not special forms,
 * constructor constants, prelude bindings, or host-provided hook operations.
 */
import type { BuiltinFn } from "../evaluator/types.js";
import type { Scheme } from "../type/types.js";
import type { BuiltinOverload } from "../mechanics/builtins.js";
import { defaultBuiltins } from "./index.js";
import { builtinScheme } from "../type/builtin-schemes.js";
import { builtins, arithmeticOperators } from "../mechanics/builtins.js";

export interface BuiltinContract {
  readonly runtime: boolean;
  readonly hm: boolean;
  readonly effect: boolean;
  readonly reason?: string;
  readonly checked?: string;
}

export interface ResolvedBuiltinContract extends BuiltinContract {
  readonly implementation: BuiltinFn | undefined;
  readonly scheme: Scheme | undefined;
  readonly lowering: readonly BuiltinOverload[] | string | undefined;
}

const entries: [string, BuiltinContract][] = [];
function group(names: string, runtime: boolean, hm: boolean, effect: boolean, reason?: string): void {
  for (const name of names.split(" ")) entries.push([name, { runtime, hm, effect, ...(reason ? { reason } : {}) }]);
}

group("+ - * / min max mod abs floor ceil round < <= > >= map filter count first trim starts-with? ends-with? split", true, true, true);
group("= != Some Option.Some Ok Result.Ok Err Result.Err str format keyword sym keyword? symbol? rest nth id fail meta meta/get type/base keyword/name", true, true, false,
  "Kernel or hook builtin; Effect uses its own syntax/constructors or has no pure lowering yet.");
group("reduce conj concat reverse sqrt quot", true, true, true);
group("every? empty? keys vals dissoc", true, false, true,
  "Legacy runtime/Effect operation; no HM scheme yet (outside the six stage-1 contracts).");
group("upper lower contains? list sort-by group-by flat-map some distinct into get get-in path assoc merge select-keys nil? string? number? boolean? list? map? fn? apply pipe __dictionary __map-get", true, false, false,
  "Unchecked runtime operation or internal lowering helper; no ordinary HM scheme or Effect builtin entry yet.");
group("gensym sexpr-list? sexpr-vector? sexpr-items sexpr-sym-name", true, false, false,
  "Expansion-time syntax helpers, intentionally outside ordinary value checking and Effect lowering.");
group("schema/any schema/string schema/number schema/boolean schema/nil schema/literal schema/optional schema/list schema/map schema/strict schema/transform validate assert-valid decode encode type/metadata", true, false, false,
  "Runtime schema/metadata operations; descriptors and Effect schema syntax have separate checking paths.");
group("None Option.None __not", false, true, false,
  "Constructor constants or normalized core syntax, not runtime function-registry entries.");
group("attribute-type declaration-hole type/kind", false, true, false,
  "Host-provided declaration-hook operations, not default runtime functions.");
group("pow uppercase lowercase length starts-with ends-with contains substring subs index-of replace is-nil is-string is-number is-boolean is-list is-map type", false, true, false,
  "Legacy HM-only spelling: not supplied by the default runtime; recorded gap, not a checked-runtime guarantee.");
// These spellings also have Effect translations, but no default runtime.
group("upcase downcase join", false, true, true,
  "HM/Effect spelling missing from the default runtime; recorded legacy gap.");
group("not find any? has-key? includes? get-or-else is-some is-none millis seconds minutes spaced exponential fixed recurs jittered to-string sum", false, false, true,
  "Effect-only operation; uses generated JavaScript or the Effect library, not the default evaluator registry.");

// Keep one entry per name. Checked arities are deliberately the intersection
// of the passes: unchecked runtime concat is variadic and conj accepts 2+.
const checked: Readonly<Record<string, string>> = {
  reverse: "(-> (List a) (List a))",
  sqrt: "(-> Float Float)",
  reduce: "(-> (-> b a b) b (List a) b)",
  conj: "(-> (List a) a (List a))",
  concat: "(-> (List a) (List a) (List a))",
  quot: "(-> Int Int Int)",
};

export const builtinContracts: ReadonlyMap<string, ResolvedBuiltinContract> = new Map(
  entries.map(([name, entry]) => [name, {
    ...entry,
    ...(checked[name] ? { checked: checked[name] } : {}),
    implementation: defaultBuiltins[name],
    scheme: builtinScheme(name),
    lowering: builtins.get(name) ?? arithmeticOperators.get(name),
  }]),
);
