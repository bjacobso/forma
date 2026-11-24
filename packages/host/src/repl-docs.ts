/**
 * Documentation the REPL's `:doc` and `:outline` read: prelude and module
 * sources (forms with their `:examples`, macros with their `;; name — summary`
 * blocks), and the catalog below for Effect program keywords and builtins,
 * which have no Forma source to read docs from.
 */
import { builtinContracts } from "@formalang/ts/builtins";
import { extractPreludeReference, type Entry } from "@formalang/ts/descriptor";
import { showMechanicsType } from "@formalang/ts/mechanics";
import { bundledModuleSources } from "@formalang/ts/modules";
import { preludeSources } from "@formalang/ts/preludes";

/**
 * An Effect program keyword. An example that starts with a declaration
 * (`type`, `error`, `service`, `:`, `define`, `layer`, ...) is a whole
 * program for `:effect`; any other example is an expression for `:infer`.
 */
export interface KeywordDoc {
  readonly name: string;
  readonly signature: string;
  readonly summary: string;
  /** Option keys, with what each does. */
  readonly options?: Readonly<Record<string, string>>;
  readonly example: string;
}

const users = `(type User {:id String :name String})
(error NotFound {:id String})
(service Users (: find (-> String (Effect (Option User)))))`;
const refs = "(do! [r (ref-make 0) _ (ref-update r (fn [n] (+ n 1))) _ (ref-set r 5) v (ref-get r)] (succeed v))";

export const effectKeywordDocs: readonly KeywordDoc[] = [
  // Declarations.
  { name: "type", signature: "(type Name Schema)", summary: "Declares a schema: a record, brand, union, tagged union, list, map or refined primitive. Generates a Schema constant and a TypeScript type.",
    options: { ":pattern": "regular expression a String must match", ":min-length": "minimum String or List length", ":max-length": "maximum String or List length", ":min": "minimum Int or Float", ":max": "maximum Int or Float", ":finite": "a Float must be finite" },
    example: "(type UserId (Brand String))\n(type Role (Union :admin :member))\n(type User {:id UserId :name (String :min-length 1) :role Role :nick (Option String)})" },
  { name: "class", signature: "(class Name {:field Type ...})", summary: "Declares a nominal record class (Schema.Class). Construct it with (Name {...}).",
    example: "(class Customer {:name String})\n(: ada Customer)\n(define ada (Customer {:name \"Ada\"}))" },
  { name: "error", signature: "(error Name {:field Type ...})", summary: "Declares a tagged error (Schema.TaggedError). Fail with (fail (Name {...})) and recover with catch.",
    example: "(error NotFound {:id String})" },
  { name: "service", signature: "(service Name (: member Type) ...)", summary: "Declares a service. A member of type (-> P ... (Effect R)) is a method; any other member is a value. Implement it with layer.",
    example: "(service Users\n  (: find (-> String (Effect (Option String))))\n  (: count (Effect Int)))" },
  { name: ":", signature: "(: name Type)", summary: "Declares the type of a definition. An Effect type lists success, errors and requirements: (Effect A [Errors] [Requirements]).",
    example: "(: greet (-> String String))\n(define greet [name] (str \"Hello \" name))" },
  { name: "define", signature: "(define name [params] body) or (define name value)", summary: "Defines a function or constant; its signature comes from a (: name Type) declaration. A zero-argument effect is a value.",
    example: "(: ready (Effect Bool))\n(define ready (succeed true))" },
  { name: "layer", signature: "(layer Name :provides Service [:setup [name effect ...]] (define method [args] body) ...) or (layer Name layer-expression)", summary: "Implements a service, or composes layers. Every method of the service needs a definition with the service's types.",
    options: { ":provides": "the service this layer implements", ":setup": "effects to run once when the layer is built; their names are in scope in the methods" },
    example: `${users}\n(layer UsersLive :provides Users\n  (define find [id] (succeed (Some {:id id :name "Ada"}))))` },
  { name: "layer-merge", signature: "(layer-merge layer ...)", summary: "Combines layers into one that provides all of their services.",
    example: "(service A (: a (Effect Int)))\n(service B (: b (Effect Int)))\n(layer ALive :provides A (define a (succeed 1)))\n(layer BLive :provides B (define b (succeed 2)))\n(layer AppLive (layer-merge ALive BLive))" },
  { name: "layer-provide", signature: "(layer-provide layer dependencies)", summary: "Satisfies layer's requirements with the services dependencies provide.",
    example: "(service Settings (: port (Effect Int)))\n(service Server (: start (Effect Int)))\n(layer SettingsLive :provides Settings (define port (succeed 8080)))\n(layer ServerLive :provides Server (define start Settings.port))\n(layer AppLive (layer-provide ServerLive SettingsLive))" },
  { name: "import", signature: "(import \"forma:effect\" [do bind pure])", summary: "Imports the forma:effect library, which adds do with bind and let steps, and pure.",
    example: "(import \"forma:effect\" [do bind pure])\n(: total (Effect Int))\n(define total (do (bind n (succeed 2)) (let doubled (* n 2)) (pure doubled)))" },
  // Effect bodies.
  { name: "succeed", signature: "(succeed value)", summary: "An effect that succeeds with value. A plain value in an effect body succeeds too.", example: "(succeed 42)" },
  { name: "fail", signature: "(fail (ErrorName {...}))", summary: "An effect that fails with a declared error. The error must appear in the signature's error list.",
    example: "(error NotFound {:id String})\n(: find (-> String (Effect Int [NotFound])))\n(define find [id] (fail (NotFound {:id id})))" },
  { name: "catch", signature: "(catch effect (Tag e) handler ... ) or (catch effect e handler)", summary: "Recovers from failures: by tag, several tags at once, or every error. Handlers may succeed or fail again.",
    example: "(error NotFound {:id String})\n(: find (-> String (Effect String [NotFound])))\n(define find [id] (fail (NotFound {:id id})))\n(: safe (-> String (Effect String)))\n(define safe [id] (catch (find id) (NotFound e) (succeed \"guest\")))" },
  { name: "do!", signature: "(do! [name effect _ effect :let [name value] ...] result)", summary: "Runs effects in order, naming each success value; _ discards a value but keeps the effect. :let binds pure values. The last form is the result.",
    example: "(do! [x (succeed 1) _ (log \"x is\" x) :let [y (+ x 1)]] (succeed y))" },
  { name: "<-", signature: "(<- effect)", summary: "Marks a binding in a do! vector as running an effect; do! already runs each bound effect, so it is optional.",
    example: "(do! [x (<- (succeed 1))] (succeed x))" },
  { name: "do", signature: "(do effect ... result)", summary: "Runs effects in order and returns the last. With (import \"forma:effect\" [do bind pure]) it also takes bind and let steps; see :doc do for the macro.",
    example: "(do (log \"starting\") (succeed 1))" },
  { name: "when", signature: "(when test effect ...)", summary: "Runs the effects when test is true, otherwise succeeds with nil. test must be Bool.", example: "(when (> 2 1) (log \"bigger\"))" },
  { name: "unless", signature: "(unless test effect ...)", summary: "Runs the effects when test is false, otherwise succeeds with nil.", example: "(unless (> 1 2) (log \"not bigger\"))" },
  { name: "all", signature: "(all {:key effect ...} :concurrency n) or (all [effect ...])", summary: "Runs a record or tuple of effects and collects their values (Effect.all).",
    options: { ":concurrency": "how many run at once: a number or :unbounded; sequential by default" },
    example: "(all {:a (succeed 1) :b (succeed \"x\")} :concurrency :unbounded)" },
  { name: "for-each", signature: "(for-each items (fn [item] effect) :concurrency n)", summary: "Runs an effect for each item and collects the results (Effect.forEach).",
    options: { ":concurrency": "how many run at once: a number or :unbounded; sequential by default" },
    example: "(for-each [1 2 3] (fn [x] (succeed (* x 2))) :concurrency 2)" },
  { name: "race", signature: "(race effect effect)", summary: "Runs both and keeps the first to succeed, interrupting the other.", example: "(race (succeed 1) (succeed 2))" },
  { name: "fork", signature: "(fork effect)", summary: "Starts the effect in a child fiber and returns the fiber.", example: "(do! [f (fork (succeed 1)) v (join f)] (succeed v))" },
  { name: "join", signature: "(join fiber)", summary: "Waits for a fiber and returns its value or fails with its error.", example: "(do! [f (fork (succeed 1)) v (join f)] (succeed v))" },
  { name: "interrupt", signature: "(interrupt fiber)", summary: "Interrupts a fiber.", example: "(do! [f (fork (sleep 1000)) _ (interrupt f)] (succeed true))" },
  { name: "sleep", signature: "(sleep millis)", summary: "Waits for a number of milliseconds or a Duration.", example: "(sleep 10)" },
  { name: "timeout", signature: "(timeout effect millis)", summary: "Fails with TimeoutError when the effect takes longer than millis.", example: "(timeout (sleep 100) 50)" },
  { name: "retry", signature: "(retry effect :times n :schedule schedule)", summary: "Runs the effect again when it fails (Effect.retry).",
    options: { ":times": "the most retries", ":schedule": "when to retry: (exponential ms), (spaced ms), (fixed ms), (recurs n), (jittered schedule)" },
    example: "(retry (config Int \"PORT\") :times 3 :schedule (exponential 10))" },
  { name: "repeat", signature: "(repeat effect :times n :schedule schedule)", summary: "Runs the effect again after it succeeds (Effect.repeat).",
    options: { ":times": "the most repetitions", ":schedule": "when to repeat: (spaced ms), (fixed ms), (exponential ms), (recurs n), (jittered schedule)" },
    example: "(repeat (log \"tick\") :times 2 :schedule (spaced 100))" },
  { name: "map-error", signature: "(map-error effect (fn [e] new-error))", summary: "Translates the effect's error into another error.",
    example: "(error Missing {:key String})\n(: port (Effect Int [Missing]))\n(define port (map-error (config Int \"PORT\") (fn [e] (Missing {:key \"PORT\"}))))" },
  { name: "or-else-succeed", signature: "(or-else-succeed effect value)", summary: "Succeeds with value when the effect fails.", example: "(or-else-succeed (config Int \"PORT\") 8080)" },
  { name: "or-die", signature: "(or-die effect)", summary: "Turns the effect's errors into defects, removing them from its type.", example: "(or-die (config Int \"PORT\"))" },
  { name: "option", signature: "(option effect)", summary: "Succeeds with (Some value), or None when the effect fails.", example: "(option (config Int \"PORT\"))" },
  { name: "result", signature: "(result effect)", summary: "Succeeds with (Ok value) or (Err error).", example: "(result (config Int \"PORT\"))" },
  { name: "scoped", signature: "(scoped effect)", summary: "Closes the resources the effect acquired when it ends, removing Scope from its requirements.",
    example: "(scoped (acquire-release (succeed 1) (fn [r] (log \"release\" r))))" },
  { name: "acquire-release", signature: "(acquire-release acquire (fn [resource] release))", summary: "Acquires a resource and registers its release in the current scope. The release must not fail.",
    example: "(scoped (acquire-release (succeed 1) (fn [r] (log \"release\" r))))" },
  { name: "ensuring", signature: "(ensuring effect finalizer)", summary: "Runs finalizer after the effect, whether it succeeded, failed or was interrupted.", example: "(ensuring (succeed 1) (log \"done\"))" },
  { name: "add-finalizer", signature: "(add-finalizer effect)", summary: "Registers an effect to run when the current scope closes.",
    example: "(scoped (do! [_ (add-finalizer (log \"closing\"))] (succeed 1)))" },
  { name: "provide", signature: "(provide effect Layer)", summary: "Satisfies an effect's requirements with a layer. Services used inside are resolved inside the provided effect.",
    example: `${users}\n(layer UsersLive :provides Users (define find [id] (succeed None)))\n(: lookup (Effect (Option User)))\n(define lookup (provide (Users.find "u-1") UsersLive))` },
  { name: "log", signature: "(log message value ...)", summary: "Logs a message and values (Effect.log).", example: "(log \"user\" \"u-1\" 42)" },
  { name: "ref-make", signature: "(ref-make value)", summary: "Creates a mutable reference (Ref.make).", example: refs },
  { name: "ref-get", signature: "(ref-get ref)", summary: "Reads a reference.", example: refs },
  { name: "ref-set", signature: "(ref-set ref value)", summary: "Replaces a reference's value.", example: refs },
  { name: "ref-update", signature: "(ref-update ref (fn [value] new-value))", summary: "Updates a reference's value with a function.", example: refs },
  { name: "config", signature: "(config Type \"NAME\" :default value)", summary: "Reads a configuration value; fails with ConfigError when it is missing or invalid and has no default.",
    options: { ":default": "the value to use when the variable is missing" },
    example: "(config Int \"PORT\" :default 8080)" },
  { name: "decode", signature: "(decode Schema value)", summary: "Decodes an unknown value against a schema; fails with SchemaError.",
    example: "(type User {:id String})\n(: parse (-> (Map String String) (Effect User [SchemaError])))\n(define parse [input] (decode User input))" },
  // Streams.
  { name: "stream-of", signature: "(stream-of [value ...])", summary: "A stream of the given values.", example: "(stream-run-collect (stream-of [1 2 3]))" },
  { name: "stream-range", signature: "(stream-range from to)", summary: "A stream of the integers from from to to, inclusive.", example: "(stream-run-collect (stream-range 1 5))" },
  { name: "stream-map", signature: "(stream-map stream (fn [x] value))", summary: "Transforms each element with a pure function.", example: "(stream-run-collect (stream-map (stream-range 1 3) (fn [x] (* x 2))))" },
  { name: "stream-filter", signature: "(stream-filter stream (fn [x] bool))", summary: "Keeps the elements that satisfy a predicate.", example: "(stream-run-collect (stream-filter (stream-range 1 10) (fn [x] (= (mod x 2) 0))))" },
  { name: "stream-take", signature: "(stream-take stream n)", summary: "Keeps the first n elements.", example: "(stream-run-collect (stream-take (stream-range 1 100) 3))" },
  { name: "stream-map-effect", signature: "(stream-map-effect stream (fn [x] (Service.op x)) concurrency?)", summary: "Transforms each element with an operation call, running up to concurrency at once.",
    example: "(service Sensors (: read (-> String (Effect Int))))\n(: readings (Effect (List Int) [] [Sensors.read]))\n(define readings (stream-run-collect (stream-map-effect (stream-of [\"a\" \"b\"]) (fn [s] (Sensors.read s)) 2)))" },
  { name: "stream-run-collect", signature: "(stream-run-collect stream)", summary: "Runs a stream and collects its elements into a list.", example: "(stream-run-collect (stream-of [1 2 3]))" },
  { name: "stream-run-fold", signature: "(stream-run-fold stream initial (fn [acc x] acc))", summary: "Runs a stream and folds its elements.", example: "(stream-run-fold (stream-range 1 4) 0 (fn [acc x] (+ acc x)))" },
  { name: "stream-run-for-each", signature: "(stream-run-for-each stream (fn [x] (Service.op x)))", summary: "Runs a stream and an operation call for each element.",
    example: "(service Sink (: write (-> String (Effect Unit))))\n(: drain (Effect Unit [] [Sink.write]))\n(define drain (stream-run-for-each (stream-of [\"a\" \"b\"]) (fn [x] (Sink.write x))))" },
];

/** A builtin function: its usage, what it does, and an example that checks in pure Forma, with :infer, or (when it declares a signature) with :effect. */
export interface BuiltinDoc { readonly name: string; readonly usage: string; readonly summary: string; readonly example: string }
const builtin = (name: string, usage: string, summary: string, example: string): BuiltinDoc => ({ name, usage, summary, example });

export const builtinDocs: readonly BuiltinDoc[] = [
  builtin("map", "(map f xs)", "Applies f to each element of a list and returns the new list.", "(map (fn [x] (* x 2)) [1 2 3])"),
  builtin("filter", "(filter pred xs)", "Keeps the elements for which pred is true.", "(filter (fn [x] (> x 1)) [1 2 3])"),
  builtin("reduce", "(reduce (fn [acc x] acc) init xs)", "Folds a list from the left; the callback takes the accumulator first.", "(reduce (fn [acc x] (+ acc x)) 0 [1 2 3])"),
  builtin("find", "(find pred xs)", "The first element for which pred is true, as an Option. Effect programs only.", "(find (fn [x] (> x 1)) [1 2 3])"),
  builtin("any?", "(any? pred xs)", "True when pred holds for some element. Effect programs only.", "(any? (fn [x] (> x 2)) [1 2 3])"),
  builtin("every?", "(every? pred xs)", "True when pred holds for every element.", "(every? (fn [x] (> x 0)) [1 2 3])"),
  builtin("count", "(count xs)", "The number of elements in a list.", "(count [1 2 3])"),
  builtin("empty?", "(empty? xs)", "True when a list has no elements.", "(empty? [])"),
  builtin("first", "(first xs)", "The first element of a list.", "(first [1 2 3])"),
  builtin("concat", "(concat xs ys)", "Joins two lists; use str for strings.", "(concat [1 2] [3])"),
  builtin("conj", "(conj xs x)", "Appends one element, returning a new list.", "(conj [1 2] 3)"),
  builtin("reverse", "(reverse xs)", "A reversed copy of a list.", "(reverse [1 2 3])"),
  builtin("sum", "(sum xs)", "Adds the numbers in a list. Effect programs only.", "(sum [1 2 3])"),
  builtin("get", "(get record :key) or (get map \"key\")", "Reads a record field or map key. An optional field or a map key gives an Option.", "(get {:name \"Ada\"} :name)"),
  builtin("assoc", "(assoc record :key value)", "A copy of a record or map with one field set.", "(assoc {:name \"Ada\"} :name \"Grace\")"),
  builtin("keys", "(keys map)", "The keys of a map, as strings.", "(keys {\"a\" 1 \"b\" 2})"),
  builtin("vals", "(vals map)", "The values of a map.", "(vals {\"a\" 1 \"b\" 2})"),
  builtin("dissoc", "(dissoc map \"key\")", "A copy of a map without one key.", "(dissoc {\"a\" 1 \"b\" 2} \"a\")"),
  builtin("has-key?", "(has-key? map \"key\")", "True when a map has the key. Effect programs only.", "(has-key? {\"a\" 1} \"a\")"),
  builtin("str", "(str value ...)", "Concatenates values into a string.", "(str \"Hello \" \"Ada\" \"!\")"),
  builtin("join", "(join strings separator)", "Joins a list of strings with a separator, in Effect program functions; in an effect body, join waits for a fiber.",
    "(: csv (-> (List String) String))\n(define csv [xs] (join xs \", \"))"),
  builtin("split", "(split string separator)", "Splits a string on a separator.", "(split \"a,b\" \",\")"),
  builtin("trim", "(trim string)", "Removes surrounding whitespace.", "(trim \"  hi  \")"),
  builtin("upcase", "(upcase string)", "Upper-cases a string.", "(upcase \"ada\")"),
  builtin("downcase", "(downcase string)", "Lower-cases a string.", "(downcase \"ADA\")"),
  builtin("starts-with?", "(starts-with? string prefix)", "True when the string starts with prefix.", "(starts-with? \"forma\" \"for\")"),
  builtin("ends-with?", "(ends-with? string suffix)", "True when the string ends with suffix.", "(ends-with? \"forma\" \"ma\")"),
  builtin("includes?", "(includes? string part)", "True when the string contains part. Effect programs only.", "(includes? \"forma\" \"orm\")"),
  builtin("to-string", "(to-string value)", "Converts a value to a string. Effect programs only.", "(to-string 42)"),
  builtin("get-or-else", "(get-or-else option default)", "The value inside Some, or default for None. Effect programs only.", "(get-or-else (Some 1) 0)"),
  builtin("is-some", "(is-some option)", "True for Some. Effect programs only.", "(is-some (Some 1))"),
  builtin("is-none", "(is-none option)", "True for None. Effect programs only.", "(is-none (Some 1))"),
  builtin("quot", "(quot a b)", "Integer division, truncated toward zero.", "(quot 7 2)"),
  builtin("mod", "(mod a b)", "The remainder of integer division.", "(mod 7 2)"),
  builtin("sqrt", "(sqrt x)", "The square root of a Float.", "(sqrt 2.0)"),
  builtin("round", "(round x)", "Rounds to the nearest Int.", "(round 2.5)"),
  builtin("floor", "(floor x)", "Rounds down to an Int.", "(floor 2.5)"),
  builtin("abs", "(abs x)", "The absolute value.", "(abs -3)"),
  builtin("min", "(min a b)", "The smaller of two numbers.", "(min 2 3)"),
  builtin("max", "(max a b)", "The larger of two numbers.", "(max 2 3)"),
  builtin("millis", "(millis n)", "A Duration of n milliseconds. Effect programs only.", "(sleep (millis 10))"),
  builtin("seconds", "(seconds n)", "A Duration of n seconds. Effect programs only.", "(sleep (seconds 1))"),
  builtin("minutes", "(minutes n)", "A Duration of n minutes. Effect programs only.", "(timeout (succeed 1) (minutes 1))"),
  builtin("exponential", "(exponential millis)", "A schedule whose delays double from millis, for :schedule. Effect programs only.", "(retry (config Int \"PORT\") :schedule (exponential 10))"),
  builtin("spaced", "(spaced millis)", "A schedule with a fixed delay between runs. Effect programs only.", "(repeat (log \"tick\") :times 2 :schedule (spaced 100))"),
  builtin("fixed", "(fixed millis)", "A schedule that runs at a fixed interval. Effect programs only.", "(repeat (log \"tick\") :times 2 :schedule (fixed 100))"),
  builtin("recurs", "(recurs n)", "A schedule that recurs n times. Effect programs only.", "(retry (config Int \"PORT\") :schedule (recurs 3))"),
  builtin("jittered", "(jittered schedule)", "Randomizes a schedule's delays. Effect programs only.", "(retry (config Int \"PORT\") :schedule (jittered (exponential 10)))"),
];

/** The Effect signatures of a builtin, from the checker's own table, with its type variables named a, b, .... */
export function effectSignatures(name: string): string[] {
  const lowering = builtinContracts.get(name)?.lowering;
  if (!Array.isArray(lowering)) return [];
  return lowering.map(o => {
    const names = new Map<number, string>();
    const named = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(named);
      if (!value || typeof value !== "object" || value instanceof Map) return value;
      const type = value as { kind?: string; id?: number; numeric?: boolean };
      if (type.kind === "var") {
        if (!names.has(type.id!)) names.set(type.id!, type.numeric ? "Number" : String.fromCharCode(97 + names.size));
        return { kind: "prim", name: names.get(type.id!) };
      }
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, named(inner)]));
    };
    return showMechanicsType(named({ kind: "function", params: o.params, result: o.result }) as Parameters<typeof showMechanicsType>[0]);
  });
}

/** A form or macro from prelude or module source, with where it comes from. */
export interface SourceDoc {
  readonly kind: Entry["kind"];
  readonly name: string;
  readonly source: string;
  readonly line: number;
  readonly signature: string;
  readonly summary?: string;
  readonly doc?: string;
  readonly arguments?: readonly { readonly name: string; readonly type?: string }[];
  readonly options?: readonly { readonly name: string; readonly type?: string }[];
  readonly ir?: string;
  readonly examples: readonly string[];
  /** How to bring it into scope. */
  readonly use: string;
}

/** Bundled sources, named as `:source` and `:outline` take them. */
export const bundledSources: readonly (readonly [string, string])[] = [
  ...Object.entries(preludeSources),
  ...Object.entries(bundledModuleSources).map(([id, text]) => [`forma:${id}`, text] as const),
];

const useOf = (source: string, name: string, bundled: boolean) =>
  source === "kernel.lisp" ? "always in scope"
    : source.startsWith("forma:") ? `(import "${source}" [${name}]) in a file module`
    : bundled ? `:load ${source}` : `defined by session prelude ${source}`;
const prose = (text: string | undefined) => text?.replace(/\s*\n\s*/gu, " ");

/** A macro's `;; name — summary` block: summary, prose and its first example paragraph (one starting with `(`). */
function macroBlock(lines: readonly string[], line: number, name: string) {
  let start = line - 1;
  while (start > 0 && /^\s*;/u.test(lines[start - 1]!)) start--;
  const comment = lines.slice(start, line - 1).map(l => l.replace(/^\s*;+ ?/u, ""));
  const at = comment.findIndex(l => l.startsWith(`${name} — `) || l.startsWith(`${name} - `));
  const paragraphs: string[][] = [[]];
  for (const text of at >= 0 ? comment.slice(at) : comment) {
    if (!text.trim()) { if (paragraphs.at(-1)!.length) paragraphs.push([]); }
    else paragraphs.at(-1)!.push(text);
  }
  const [first = [], ...rest] = paragraphs.filter(p => p.length);
  const summary = first.join(" ").replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")} [—-] `, "u"), "");
  const example = rest.find(p => p[0]!.startsWith("("));
  const prose = rest.filter(p => p !== example).map(p => p.join(" ")).join("\n");
  return { summary, ...(prose ? { doc: prose } : {}), examples: example ? [example.join("\n")] : [] };
}

/** Forms, macros, functions and types defined in Forma source, read without loading it. */
export function sourceDocs(source: string, text: string, bundled = true): SourceDoc[] {
  const lines = text.split("\n");
  return extractPreludeReference(source, text).entries.flatMap((entry): SourceDoc[] => {
    const base = { kind: entry.kind, name: entry.name, source, line: entry.line, use: useOf(source, entry.name, bundled) };
    switch (entry.kind) {
      case "form": {
        const keys = new Set(/\{:keys \[([^\]]*)\]\}/u.exec(entry.pattern ?? "")?.[1]?.split(/\s+/u).filter(Boolean) ?? []);
        const positional = (entry.pattern ?? "").replace(/\{:keys \[[^\]]*\]\}/u, "").replace(/^\(\S+|\)$/gu, "").split(/\s+/u).filter(Boolean);
        const typeOf = (name: string) => entry.slots?.find(slot => slot.name === name)?.type;
        const slot = (name: string) => { const type = typeOf(name); return type ? { name, type } : { name }; };
        return [{ ...base, signature: entry.pattern ?? entry.name, ...(entry.doc ? { summary: prose(entry.doc)! } : {}),
          arguments: positional.map(slot), options: [...keys].map(slot), ...(entry.ir ? { ir: entry.ir } : {}), examples: entry.examples ?? [] }];
      }
      case "macro": return [{ ...base, signature: entry.pattern ?? entry.name, ...macroBlock(lines, entry.line, entry.name) }];
      case "function": return [{ ...base, signature: entry.signature ?? entry.pattern ?? entry.name, ...(entry.doc ? { summary: entry.doc } : {}), examples: [] }];
      case "type": return [{ ...base, signature: entry.source.replace(/\s+/gu, " "), ...(entry.doc ? { summary: entry.doc } : {}), examples: [] }];
      default: return [];
    }
  });
}

let bundledDocs: SourceDoc[] | undefined;
/** Every bundled form, macro, function and type; a macro in both kernel.lisp and forma:kernel is listed once. */
export function allBundledDocs(): readonly SourceDoc[] {
  if (!bundledDocs) {
    const seen = new Set<string>();
    bundledDocs = bundledSources.flatMap(([source, text]) => sourceDocs(source, text)).filter(doc => {
      const key = `${doc.kind} ${doc.name} ${doc.signature} ${doc.summary ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return bundledDocs;
}

/** The first sentence of a doc, short enough for one line. */
export function firstSentence(text: string | undefined, max = 72): string {
  if (!text) return "";
  const sentence = text.replace(/\s+/gu, " ").trim().split(/(?<=\.)\s/u)[0]!;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/** One line per top-level definition, under the source's section banners. */
export function outlineSource(source: string, text: string, bundled = true): string {
  const lines = text.split("\n");
  const docs = sourceDocs(source, text, bundled);
  const sections = lines.flatMap((line, index) => {
    const title = /^;+\s*SECTION\s+\S+\s+[—-]\s+(.+)$/u.exec(line)?.[1];
    return title ? [{ line: index + 1, text: `${title.trim()}` }] : [];
  });
  const counts = new Map<string, number>();
  for (const doc of docs) counts.set(doc.kind, (counts.get(doc.kind) ?? 0) + 1);
  const label: Record<string, string> = { form: "form", macro: "macro", function: "fn", type: "type" };
  const items = [
    ...sections.map(s => ({ line: s.line, text: `${String(s.line).padStart(5)} ── ${s.text}` })),
    // Forms and macros are the vocabulary, so they keep a summary; types and functions are a :doc away.
    ...docs.map(d => ({ line: d.line, text: `${String(d.line).padStart(5)} ${label[d.kind]!.padEnd(5)} ${d.name}${d.summary && (d.kind === "form" || d.kind === "macro") ? ` — ${firstSentence(d.summary, 64)}` : ""}` })),
  ].sort((a, b) => a.line - b.line);
  const summary = [...counts].map(([kind, n]) => `${n} ${kind}${n === 1 ? "" : "s"}`).join(", ");
  return [`${source}: ${lines.length} lines; ${summary || "no definitions"}.`, ...items.map(i => i.text),
    `:doc <name> documents one; :source ${source} <from>-<to> shows lines.`].join("\n");
}
