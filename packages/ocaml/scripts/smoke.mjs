import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const cwd = new URL("..", import.meta.url);
const nativeCli = new URL("dist/native/forma_cli.exe", cwd).pathname;
const jsEntry = new URL("dist/js/jsoo_entry.cjs", cwd).pathname;
const wasmEntry = new URL("dist/wasm/wasm_entry.cjs", cwd).pathname;
const buildTargetsPath = new URL("dist/build-targets.json", cwd);

const buildTargets = existsSync(buildTargetsPath)
  ? JSON.parse(readFileSync(buildTargetsPath, "utf8"))
  : { native: true, js: existsSync(jsEntry), wasm: existsSync(wasmEntry) };

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    ...options,
  });

  if (result.error?.code === "ENOENT") {
    console.error(
      `Missing required command: ${command}. Install OCaml and Dune before testing @formalang/ocaml.`,
    );
    process.exit(127);
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.stdout.write(result.stdout ?? "");
    process.exit(result.status ?? 1);
  }

  return result;
};

const request = JSON.stringify({ op: "version" });
const result = run(nativeCli, ["request", request]);

const output = JSON.parse(result.stdout);
if (output?.ok !== true) {
  throw new Error(`Expected ok response, received: ${result.stdout}`);
}

if (output.value?.engine !== "forma-ocaml") {
  throw new Error(`Unexpected engine response: ${result.stdout}`);
}

console.log("forma-ocaml smoke ok");

const parseResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "parse",
    sourceId: "smoke",
    source: '(+ 1 2) [true nil] {:name "Ada"}',
  }),
]);

const parsed = JSON.parse(parseResult.stdout);
if (parsed?.ok !== true || parsed.value?.length !== 3) {
  throw new Error(`Unexpected parse response: ${parseResult.stdout}`);
}

console.log("forma-ocaml parse smoke ok");

const multilineStringParseResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "parse",
    sourceId: "smoke-multiline",
    source: '"""hello\nworld"""',
  }),
]);

const multilineParsed = JSON.parse(multilineStringParseResult.stdout);
if (
  multilineParsed?.ok !== true ||
  multilineParsed.value?.length !== 1 ||
  multilineParsed.value?.[0]?.kind !== "string" ||
  multilineParsed.value?.[0]?.value !== "hello\nworld"
) {
  throw new Error(
    `Unexpected multiline string parse response: ${multilineStringParseResult.stdout}`,
  );
}

console.log("forma-ocaml multiline string parse smoke ok");

const parseAstResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "parseAst",
    sourceId: "smoke-ast",
    source: "(let [x 1] x)",
  }),
]);

const parsedAst = JSON.parse(parseAstResult.stdout);
if (
  parsedAst?.ok !== true ||
  parsedAst.value?.length !== 1 ||
  parsedAst.value?.[0]?.kind !== "list"
) {
  throw new Error(`Unexpected parseAst response: ${parseAstResult.stdout}`);
}

console.log("forma-ocaml parseAst smoke ok");

const expandResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "expand",
    sourceId: "expand-smoke",
    source: "(define-macro unless [test body] `(if ~test nil ~body)) (unless false 7)",
  }),
]);
const expanded = JSON.parse(expandResult.stdout);
if (
  expanded?.ok !== true ||
  expanded.value?.length !== 2 ||
  expanded.value?.[1]?.items?.[0]?.value !== "if"
) {
  throw new Error(`Unexpected expand response: ${expandResult.stdout}`);
}

console.log("forma-ocaml expand smoke ok");

const expandErrorResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "expand",
    sourceId: "expand-error",
    source: "(define-macro one [x] x) (one)",
  }),
]);
const expandError = JSON.parse(expandErrorResult.stdout);
const expandDiagnostic = expandError?.diagnostics?.[0];
if (
  expandError?.ok !== false ||
  expandDiagnostic?.code !== "expand/arity" ||
  expandDiagnostic?.span?.sourceId !== "expand-error" ||
  typeof expandDiagnostic?.span?.startOffset !== "number" ||
  expandDiagnostic.span.endOffset <= expandDiagnostic.span.startOffset
) {
  throw new Error(`Unexpected expand diagnostic response: ${expandErrorResult.stdout}`);
}

console.log("forma-ocaml expand diagnostic span smoke ok");

const lowerCoreResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "lowerCore",
    sourceId: "lower-core-smoke",
    source: '(: inc (-> Int Int)) (define (inc x) (+ x 1)) {:name "Ada" :score (inc 2)}',
  }),
]);
const lowerCore = JSON.parse(lowerCoreResult.stdout);
if (
  lowerCore?.ok !== true ||
  lowerCore.value?.length !== 2 ||
  lowerCore.value?.[0]?.kind !== "definition" ||
  lowerCore.value?.[0]?.signature?.kind !== "type-function" ||
  lowerCore.value?.[0]?.value?.kind !== "lambda" ||
  lowerCore.value?.[1]?.kind !== "record" ||
  lowerCore.value?.[1]?.fields?.[1]?.value?.kind !== "application"
) {
  throw new Error(`Unexpected lowerCore response: ${lowerCoreResult.stdout}`);
}

console.log("forma-ocaml lowerCore smoke ok");

const typecheckCoreResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "typecheckCore",
    sourceId: "typecheck-core-smoke",
    source: "(: inc (-> Int Int)) (define (inc x) (+ x 1)) (inc 2)",
  }),
]);
const typecheckCore = JSON.parse(typecheckCoreResult.stdout);
if (typecheckCore?.ok !== true || typecheckCore.type !== "Int") {
  throw new Error(`Unexpected typecheckCore response: ${typecheckCoreResult.stdout}`);
}

console.log("forma-ocaml typecheckCore smoke ok");

const typecheckCoreTypedResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "typecheckCoreTyped",
    sourceId: "typecheck-core-typed-smoke",
    source: "(: inc (-> Int Int)) (define (inc x) (+ x 1)) (inc 2)",
  }),
]);
const typecheckCoreTyped = JSON.parse(typecheckCoreTypedResult.stdout);
const typedCoreAnnotations = typecheckCoreTyped.typedCore?.annotations ?? [];
const typedDefinition = typedCoreAnnotations.find(
  (annotation) => annotation.expr?.kind === "definition",
);
const typedLambda = typedCoreAnnotations.find((annotation) => annotation.expr?.kind === "lambda");
const typedPlusCall = typedCoreAnnotations.find(
  (annotation) => annotation.expr?.kind === "application" && annotation.expr?.callee?.name === "+",
);
const typedIncCall = typedCoreAnnotations.find(
  (annotation) =>
    annotation.expr?.kind === "application" && annotation.expr?.callee?.name === "inc",
);
const typedParamRef = typedCoreAnnotations.find(
  (annotation) => annotation.expr?.kind === "variable" && annotation.expr?.name === "x",
);
const typedLiteralOne = typedCoreAnnotations.find(
  (annotation) => annotation.expr?.kind === "literal" && annotation.expr?.literal?.value === 1,
);
if (
  typecheckCoreTyped?.ok !== true ||
  typecheckCoreTyped.type !== "Int" ||
  typecheckCoreTyped.typedCore?.resultType !== "Int" ||
  typedCoreAnnotations.length < 8 ||
  typedDefinition?.type !== "Int -> Int" ||
  typedDefinition?.symbol?.role !== "binding" ||
  typedDefinition?.typeExpr?.kind !== "function" ||
  typedDefinition?.typeExpr?.params?.[0]?.name !== "Int" ||
  typedDefinition?.typeExpr?.return?.name !== "Int" ||
  typedLambda?.typeExpr?.kind !== "function" ||
  typedPlusCall?.type !== "Int" ||
  typedIncCall?.type !== "Int" ||
  typedIncCall?.expr?.callee?.name !== "inc" ||
  typedParamRef?.type !== "Int" ||
  typedParamRef?.symbol?.role !== "reference" ||
  typedLiteralOne?.type !== "Int"
) {
  throw new Error(`Unexpected typecheckCoreTyped response: ${typecheckCoreTypedResult.stdout}`);
}

console.log("forma-ocaml typecheckCoreTyped smoke ok");

const editorSource = "(define x 1)\nx";
const editorAnalyzeResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "editorAnalyze",
    sourceId: "editor-smoke",
    source: editorSource,
  }),
]);
const editorAnalyze = JSON.parse(editorAnalyzeResult.stdout);
if (
  editorAnalyze?.ok !== true ||
  editorAnalyze.value?.typedCore?.resultType !== "Int" ||
  editorAnalyze.value?.definitions?.[0]?.name !== "x" ||
  !Array.isArray(editorAnalyze.value?.completionItems)
) {
  throw new Error(`Unexpected editorAnalyze response: ${editorAnalyzeResult.stdout}`);
}

const editorHoverResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "editorHover",
    sourceId: "editor-smoke",
    source: editorSource,
    offset: 13,
  }),
]);
const editorHover = JSON.parse(editorHoverResult.stdout);
if (editorHover?.ok !== true || editorHover.value?.hover?.type !== "Int") {
  throw new Error(`Unexpected editorHover response: ${editorHoverResult.stdout}`);
}

const editorDefinitionResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "editorDefinition",
    sourceId: "editor-smoke",
    source: editorSource,
    offset: 13,
  }),
]);
const editorDefinition = JSON.parse(editorDefinitionResult.stdout);
if (editorDefinition?.ok !== true || editorDefinition.value?.definition?.name !== "x") {
  throw new Error(`Unexpected editorDefinition response: ${editorDefinitionResult.stdout}`);
}

const editorCompletionResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "editorCompletion",
    sourceId: "editor-smoke",
    source: editorSource,
    offset: 13,
  }),
]);
const editorCompletion = JSON.parse(editorCompletionResult.stdout);
const editorCompletionLabels = editorCompletion.value?.items?.map((item) => item.label) ?? [];
if (editorCompletion?.ok !== true || !editorCompletionLabels.includes("x")) {
  throw new Error(`Unexpected editorCompletion response: ${editorCompletionResult.stdout}`);
}

const editorFormatResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "editorFormat",
    sourceId: "editor-smoke",
    source: "(define   x   1)",
  }),
]);
const editorFormat = JSON.parse(editorFormatResult.stdout);
if (editorFormat?.ok !== true || editorFormat.value?.text !== "(define x 1)\n") {
  throw new Error(`Unexpected editorFormat response: ${editorFormatResult.stdout}`);
}

console.log("forma-ocaml editor services smoke ok");

const readerSugarResult = run(nativeCli, [
  "request",
  JSON.stringify({
    op: "parse",
    sourceId: "reader-sugar",
    source: "'alpha `(list ~x ~@xs)",
  }),
]);
const readerSugar = JSON.parse(readerSugarResult.stdout);
if (
  readerSugar?.ok !== true ||
  readerSugar.value?.[0]?.items?.[0]?.value !== "quote" ||
  readerSugar.value?.[1]?.items?.[0]?.value !== "quasiquote"
) {
  throw new Error(`Unexpected reader sugar response: ${readerSugarResult.stdout}`);
}

console.log("forma-ocaml reader sugar smoke ok");

const evalResult = run(nativeCli, [
  "request",
  JSON.stringify({ op: "evaluate", sourceId: "smoke", source: "(+ 1 2)" }),
]);

const evaluated = JSON.parse(evalResult.stdout);
if (evaluated?.ok !== true || evaluated.value?.kind !== "int" || evaluated.value?.value !== 3) {
  throw new Error(`Unexpected evaluate response: ${evalResult.stdout}`);
}

console.log("forma-ocaml eval smoke ok");

const evalErrorResult = run(nativeCli, [
  "request",
  JSON.stringify({ op: "evaluate", sourceId: "eval-error", source: "(+ 1 nope)" }),
]);

const evalError = JSON.parse(evalErrorResult.stdout);
const evalDiagnostic = evalError?.diagnostics?.[0];
if (
  evalError?.ok !== false ||
  evalDiagnostic?.code !== "eval/unbound-symbol" ||
  evalDiagnostic?.span?.sourceId !== "eval-error" ||
  typeof evalDiagnostic?.span?.startOffset !== "number" ||
  evalDiagnostic.span.endOffset <= evalDiagnostic.span.startOffset
) {
  throw new Error(`Unexpected eval diagnostic response: ${evalErrorResult.stdout}`);
}

console.log("forma-ocaml eval diagnostic span smoke ok");

const evaluate = (source) => {
  const result = run(nativeCli, [
    "request",
    JSON.stringify({ op: "evaluate", sourceId: "smoke", source }),
  ]);
  return JSON.parse(result.stdout);
};

const evaluateWithSourceId = (sourceId, source) => {
  const result = run(nativeCli, ["request", JSON.stringify({ op: "evaluate", sourceId, source })]);
  return JSON.parse(result.stdout);
};

const typecheck = (source) => {
  const result = run(nativeCli, [
    "request",
    JSON.stringify({ op: "typecheck", sourceId: "smoke", source }),
  ]);
  return JSON.parse(result.stdout);
};

const typecheckWithSourceId = (sourceId, source) => {
  const result = run(nativeCli, ["request", JSON.stringify({ op: "typecheck", sourceId, source })]);
  return JSON.parse(result.stdout);
};

const typecheckRequest = (payload) => {
  const result = run(nativeCli, ["request", JSON.stringify({ op: "typecheck", ...payload })]);
  return JSON.parse(result.stdout);
};

const assertInt = (source, expected) => {
  const response = evaluate(source);
  if (
    response?.ok !== true ||
    response.value?.kind !== "int" ||
    response.value?.value !== expected
  ) {
    throw new Error(
      `Expected ${source} to evaluate to int ${expected}: ${JSON.stringify(response)}`,
    );
  }
};

const entryValue = (mapValue, keyValue) => {
  const entry = mapValue?.entries?.find((candidate) => candidate.key?.value === keyValue);
  return entry?.value;
};

const assertKind = (source, expectedKind) => {
  const response = evaluate(source);
  if (response?.ok !== true || response.value?.kind !== expectedKind) {
    throw new Error(
      `Expected ${source} to evaluate to ${expectedKind}: ${JSON.stringify(response)}`,
    );
  }
  return response.value;
};

const assertBool = (source, expected) => {
  const response = evaluate(source);
  if (
    response?.ok !== true ||
    response.value?.kind !== "bool" ||
    response.value?.value !== expected
  ) {
    throw new Error(
      `Expected ${source} to evaluate to bool ${expected}: ${JSON.stringify(response)}`,
    );
  }
};

const assertType = (source, expectedType) => {
  const response = typecheck(source);
  if (response?.ok !== true || response.type !== expectedType) {
    throw new Error(
      `Expected ${source} to typecheck as ${expectedType}: ${JSON.stringify(response)}`,
    );
  }
};

assertInt("(let [x 1 y (+ x 2)] y)", 3);
assertInt("(if false 1 2)", 2);
assertInt("(cond false 1 (< 1 2) 3 :else 4)", 3);
assertInt("(match [1 2] [x y] (+ x y) :else 0)", 3);
assertInt("(match :ready :done 1 :ready 2 :else 3)", 2);
assertInt("(do 1 2 (+ 1 2))", 3);
assertInt("(and true 1 3)", 3);
assertInt("(or nil false 7)", 7);
assertInt("((fn [x] (+ x 1)) 2)", 3);
assertInt("(let [base 10 add-base (fn [x] (+ base x))] (add-base 5))", 15);
assertInt("(defn add-two [x] (+ x 2)) (add-two 3)", 5);
assertInt("(define x 4) (+ x 1)", 5);
assertInt("(define (add-three x) (+ x 3)) (add-three 4)", 7);
assertInt("(defmacro unless [test body] `(if ~test nil ~body)) (unless false 7)", 7);

const quoted = assertKind("(quote (alpha :beta 3))", "list");
if (quoted.items?.[0]?.kind !== "symbol" || quoted.items?.[0]?.value !== "alpha") {
  throw new Error(`Unexpected quoted syntax response: ${JSON.stringify(quoted)}`);
}

const shorthandQuoted = assertKind("'alpha", "symbol");
if (shorthandQuoted.value !== "alpha") {
  throw new Error(`Unexpected shorthand quote response: ${JSON.stringify(shorthandQuoted)}`);
}

const quasiquoted = assertKind("(let [x 2 xs (list 3 4)] `(1 ~x ~@xs))", "list");
if (
  quasiquoted.items?.length !== 4 ||
  quasiquoted.items?.[0]?.value !== 1 ||
  quasiquoted.items?.[1]?.value !== 2 ||
  quasiquoted.items?.[2]?.value !== 3 ||
  quasiquoted.items?.[3]?.value !== 4
) {
  throw new Error(`Unexpected quasiquote response: ${JSON.stringify(quasiquoted)}`);
}

const evaluatedMap = assertKind('{:name "Ada" :score (+ 1 2)}', "map");
if (evaluatedMap.entries?.[1]?.value?.value !== 3) {
  throw new Error(`Unexpected evaluated map response: ${JSON.stringify(evaluatedMap)}`);
}

const mapped = assertKind("(map (fn [x] (+ x 1)) (list 1 2))", "list");
if (mapped.items?.[0]?.value !== 2 || mapped.items?.[1]?.value !== 3) {
  throw new Error(`Unexpected map response: ${JSON.stringify(mapped)}`);
}

const filtered = assertKind("(filter (fn [x] (> x 1)) (list 1 2 3))", "list");
if (
  filtered.items?.length !== 2 ||
  filtered.items?.[0]?.value !== 2 ||
  filtered.items?.[1]?.value !== 3
) {
  throw new Error(`Unexpected filter response: ${JSON.stringify(filtered)}`);
}

const flatMapped = assertKind("(list/flat-map (list 1 2) (fn [x] (list x (+ x 10))))", "list");
if (
  flatMapped.items?.length !== 4 ||
  flatMapped.items?.[0]?.value !== 1 ||
  flatMapped.items?.[1]?.value !== 11 ||
  flatMapped.items?.[2]?.value !== 2 ||
  flatMapped.items?.[3]?.value !== 12
) {
  throw new Error(`Unexpected flat-map response: ${JSON.stringify(flatMapped)}`);
}

assertInt("(reduce (fn [acc x] (+ acc x)) 0 [1 2 3])", 6);
assertInt("(list/reduce [1 2 3] 0 (fn [acc x] (+ acc x)))", 6);

const concatenated = assertKind("(concat [1 2] (list 3 4))", "list");
if (
  concatenated.items?.length !== 4 ||
  concatenated.items?.[0]?.value !== 1 ||
  concatenated.items?.[3]?.value !== 4
) {
  throw new Error(`Unexpected concat response: ${JSON.stringify(concatenated)}`);
}

const intoMap = assertKind('(into [["name" "Ada"] [:score 3]])', "map");
if (intoMap.entries?.length !== 2 || intoMap.entries?.[1]?.value?.value !== 3) {
  throw new Error(`Unexpected into response: ${JSON.stringify(intoMap)}`);
}

assertInt("(get {:a 1 :b 2} :a)", 1);
assertInt("(get (assoc {:a 1} :b 2) :b)", 2);
assertInt("(count (keys {:a 1 :b 2}))", 2);
assertInt("(count (values {:a 1 :b 2}))", 2);
assertBool("(empty? [])", true);
assertBool("(set/contains? [1 2 3] 2)", true);
assertBool("(contains? {:a 1} :a)", true);
assertBool('(= (get {:status "active"} :status) "active")', true);
assertBool("(= (get {:status :open} :status) :open)", true);
assertBool("(!= 1 2)", true);
assertBool("(nil? nil)", true);
assertBool('(string? "x")', true);
assertBool("(number? 3)", true);
assertBool("(boolean? false)", true);
assertBool("(list? [1 2])", true);
assertBool("(map? {:a 1})", true);
assertInt('(path {:employee {:status "active"}} "employee" "status" "length")', 6);
assertInt("(get-in {:a {:b 3}} [:a :b])", 3);
assertInt("(get-in {:a {}} [:a :b] 9)", 9);
assertInt("(get (merge {:a 1} {:a 2 :b 3}) :a)", 2);
assertInt("(count (dissoc {:a 1 :b 2} :a))", 1);
assertInt("(count (select-keys {:a 1 :b 2} [:a]))", 1);
assertInt("(count (conj [1] 2 3))", 3);

const bidirectionalDescriptor = evaluate(`
(define-form endpoint
  (:infer-fn endpoint/infer)
  (:check-fn endpoint/check)
  (:construct-fn endpoint/construct))
endpoint
`);
const descriptorClauses = entryValue(bidirectionalDescriptor.value, ":clauses");
const descriptorClauseHeads =
  descriptorClauses?.items?.map((clause) => clause.items?.[0]?.value).filter(Boolean) ?? [];
if (
  bidirectionalDescriptor?.ok !== true ||
  bidirectionalDescriptor.value?.kind !== "map" ||
  !descriptorClauseHeads.includes(":infer-fn") ||
  !descriptorClauseHeads.includes(":check-fn") ||
  !descriptorClauseHeads.includes(":construct-fn")
) {
  throw new Error(
    `Unexpected bidirectional descriptor response: ${JSON.stringify(bidirectionalDescriptor)}`,
  );
}

const malformedDescriptorHook = evaluateWithSourceId(
  "descriptor-hook-error",
  "(define-form endpoint (:infer-fn))",
);
const malformedDescriptorDiagnostic = malformedDescriptorHook?.diagnostics?.[0];
if (
  malformedDescriptorHook?.ok !== false ||
  malformedDescriptorDiagnostic?.code !== "descriptor/hook-clause" ||
  malformedDescriptorDiagnostic?.span?.sourceId !== "descriptor-hook-error" ||
  typeof malformedDescriptorDiagnostic?.span?.startOffset !== "number" ||
  malformedDescriptorDiagnostic.span.endOffset <= malformedDescriptorDiagnostic.span.startOffset
) {
  throw new Error(
    `Unexpected descriptor hook diagnostic: ${JSON.stringify(malformedDescriptorHook)}`,
  );
}

const malformedMetaKind = evaluateWithSourceId(
  "descriptor-meta-kind-error",
  "(meta-fn broken (:kind))",
);
const malformedMetaKindDiagnostic = malformedMetaKind?.diagnostics?.[0];
if (
  malformedMetaKind?.ok !== false ||
  malformedMetaKindDiagnostic?.code !== "descriptor/meta-kind" ||
  malformedMetaKindDiagnostic?.span?.sourceId !== "descriptor-meta-kind-error" ||
  typeof malformedMetaKindDiagnostic?.span?.startOffset !== "number" ||
  malformedMetaKindDiagnostic.span.endOffset <= malformedMetaKindDiagnostic.span.startOffset
) {
  throw new Error(`Unexpected meta-fn kind diagnostic: ${JSON.stringify(malformedMetaKind)}`);
}

const formatted = assertKind('(format "Hello {}, {}" "Ada" nil)', "string");
if (formatted.value !== "Hello Ada, ") {
  throw new Error(`Unexpected format response: ${JSON.stringify(formatted)}`);
}

console.log("forma-ocaml special-form smoke ok");

assertType("(+ 1 2)", "Int");
assertType("(/ 4 2)", "Float");
assertType("(if true 1 2)", "Int");
assertType("(when true (+ 1 2))", "Int");
assertType("(cond false 1 (< 1 2) 3 :else 4)", "Int");
assertType("(and true 1 3)", "Int");
assertType('(str "a" 1)', "Str");
assertType("(defmacro unless [test body] `(if ~test nil ~body)) (unless false 7)", "Int");
assertType("(map (fn [x] (+ x 1)) (list 1 2))", "List");
assertType("(first (map (fn [x] (+ x 1)) [1 2]))", "Int");
assertType('(first (map ["a" "b"] (fn [x] (str x "!"))))', "Str");
assertType("(first (filter (fn [x] (> x 1)) [1 2]))", "Int");
assertType("(first (flat-map [1 2] (fn [x] (list (str x)))))", "Str");
assertType("(reduce (fn [acc x] (+ acc x)) 0 [1 2 3])", "Int");
assertType('(reduce ["a" "b"] "" (fn [acc x] (str acc x)))', "Str");
assertType("(first [1 2])", "Int");
assertType('(nth ["a" "b"] 1)', "Str");
assertType("(first (append [1] [2]))", "Int");
assertType('(first (concat ["a"] ["b"]))', "Str");
assertType('(first (conj ["a"] "b"))', "Str");
assertType("{:a (+ 1 2)}", "Map");
assertType("(get {:a 1} :a)", "Int");
assertType("(get (assoc {:a 1} :b 2) :b)", "Int");
assertType('(get (assoc {:a 1} :a "two") :a)', "Str");
assertType('(get (merge {:a 1} {:b "two"}) :b)', "Str");
assertType('(get (merge {:a 1} {:a "two" :b 3}) :a)', "Str");
assertType('(get (dissoc {:a 1 :b "two"} :a) :b)', "Str");
assertType('(get (select-keys {:a 1 :b "two"} [:b]) :b)', "Str");
assertType("(first (keys {:a 1}))", "Keyword");
assertType("(first (values {:a 1 :b 2}))", "Int");
assertType("(get-in {:a {:b 3}} [:a :b])", "Int");
assertType('(get {:status "active"} :status)', "Str");
assertType("(contains? {:a 1} :a)", "Bool");
assertType('(= (get {:status "active"} :status) "active")', "Bool");
assertType("((fn [x] (+ x 1)) 2)", "Int");
assertType('(let [id (fn [x] x) a (id 1)] (id "x"))', "Str");
assertType("(: inc (-> Int Int)) (define (inc x) (+ x 1)) (inc 2)", "Int");
assertType('(define-type EmployeeId String) (: id EmployeeId) (define id "e1") id', "Str");
assertType(
  '(: employee {:name Str :age Int}) (define employee {:name "Ada" :age 37}) (get employee :age)',
  "Int",
);

console.log("forma-ocaml typecheck smoke ok");

const prefixPolicyTypecheck = typecheckRequest({
  sourceId: "type-policy-prefix",
  source: "?entity",
  typePolicy: {
    unboundSymbols: [
      { match: { kind: "prefix", value: "?" }, type: { kind: "type", name: "String" } },
    ],
  },
});

if (
  prefixPolicyTypecheck?.ok !== true ||
  prefixPolicyTypecheck.type !== "Str" ||
  prefixPolicyTypecheck.value?.type?.name !== "Str"
) {
  throw new Error(
    `Unexpected prefix type policy response: ${JSON.stringify(prefixPolicyTypecheck)}`,
  );
}

const exactPolicyTypecheck = typecheckRequest({
  sourceId: "type-policy-exact",
  source: "runtime-flag",
  result: "per-expression",
  typePolicy: {
    unboundSymbols: [
      {
        match: { kind: "exact", value: "runtime-flag" },
        type: { kind: "type", name: "Bool" },
      },
    ],
  },
});

if (
  exactPolicyTypecheck?.ok !== true ||
  exactPolicyTypecheck.type !== "Bool" ||
  exactPolicyTypecheck.value?.result !== "per-expression" ||
  !Array.isArray(exactPolicyTypecheck.value?.expressionTypes) ||
  exactPolicyTypecheck.value.expressionTypes.length !== 1 ||
  exactPolicyTypecheck.value.expressionTypes[0]?.display !== "Bool"
) {
  throw new Error(`Unexpected exact type policy response: ${JSON.stringify(exactPolicyTypecheck)}`);
}

console.log("forma-ocaml typecheck typePolicy smoke ok");

const hostBuiltinTypecheck = typecheckRequest({
  sourceId: "host-builtin",
  source: "(runtime-add 1 2)",
  typePolicy: { defaultBuiltinScheme: "none" },
  hostBuiltins: [
    {
      name: "runtime-add",
      arity: 2,
      typeScheme: {
        kind: "function",
        params: [
          { kind: "type", name: "Int" },
          { kind: "type", name: "Int" },
        ],
        result: { kind: "type", name: "Int" },
      },
      handler: { kind: "host-effect", effect: "runtime/add" },
    },
  ],
});

if (
  hostBuiltinTypecheck?.ok !== true ||
  hostBuiltinTypecheck.type !== "Int" ||
  hostBuiltinTypecheck.value?.type?.name !== "Int"
) {
  throw new Error(
    `Unexpected host builtin typecheck response: ${JSON.stringify(hostBuiltinTypecheck)}`,
  );
}

console.log("forma-ocaml typecheck hostBuiltins smoke ok");

const keywordLiteral = typecheckWithSourceId("keyword-literal", ":firstName");
const keywordLiteralDiagnostic = keywordLiteral?.diagnostics?.[0];
if (
  keywordLiteral?.ok !== true ||
  keywordLiteral.type !== "Str" ||
  keywordLiteralDiagnostic?.severity !== "warning" ||
  keywordLiteralDiagnostic?.message?.includes("self-evaluating literals") !== true ||
  keywordLiteralDiagnostic?.span?.sourceId !== "keyword-literal" ||
  typeof keywordLiteralDiagnostic?.span?.startOffset !== "number" ||
  keywordLiteralDiagnostic.span.endOffset <= keywordLiteralDiagnostic.span.startOffset
) {
  throw new Error(
    `Unexpected keyword literal typecheck response: ${JSON.stringify(keywordLiteral)}`,
  );
}

console.log("forma-ocaml keyword literal warning smoke ok");

const nonExhaustiveMatch = typecheckWithSourceId(
  "match-warning",
  `(define-type (Option a) (Some a) (None))
   (match (Some 42)
     (Some x) x)`,
);
const nonExhaustiveMatchDiagnostic = nonExhaustiveMatch?.diagnostics?.[0];
if (
  nonExhaustiveMatch?.ok !== true ||
  nonExhaustiveMatch.type !== "Int" ||
  nonExhaustiveMatchDiagnostic?.severity !== "warning" ||
  nonExhaustiveMatchDiagnostic?.message !== "Non-exhaustive match: missing constructor(s) None" ||
  nonExhaustiveMatchDiagnostic?.span?.sourceId !== "match-warning"
) {
  throw new Error(
    `Unexpected non-exhaustive match warning response: ${JSON.stringify(nonExhaustiveMatch)}`,
  );
}

console.log("forma-ocaml match warning smoke ok");

const typeError = typecheckWithSourceId("type-error", "(+ 1 nope)");
const typeDiagnostic = typeError?.diagnostics?.[0];
if (
  typeError?.ok !== false ||
  typeDiagnostic?.code !== "typecheck/unbound-symbol" ||
  typeDiagnostic?.span?.sourceId !== "type-error" ||
  typeof typeDiagnostic?.span?.startOffset !== "number" ||
  typeDiagnostic.span.endOffset <= typeDiagnostic.span.startOffset
) {
  throw new Error(`Unexpected typecheck diagnostic response: ${JSON.stringify(typeError)}`);
}

console.log("forma-ocaml typecheck diagnostic span smoke ok");

const typeMismatch = typecheckWithSourceId("type-mismatch", '(if true 1 "x")');
const mismatchDiagnostic = typeMismatch?.diagnostics?.[0];
if (
  typeMismatch?.ok !== false ||
  mismatchDiagnostic?.code !== "typecheck/type-mismatch" ||
  mismatchDiagnostic?.span?.sourceId !== "type-mismatch" ||
  typeof mismatchDiagnostic?.span?.startOffset !== "number" ||
  mismatchDiagnostic.span.endOffset <= mismatchDiagnostic.span.startOffset
) {
  throw new Error(`Unexpected type mismatch response: ${JSON.stringify(typeMismatch)}`);
}

console.log("forma-ocaml HM type mismatch smoke ok");

const recordFieldError = typecheckWithSourceId("record-field-error", "{:a nope}");
const recordFieldDiagnostic = recordFieldError?.diagnostics?.[0];
if (
  recordFieldError?.ok !== false ||
  recordFieldDiagnostic?.code !== "typecheck/unbound-symbol" ||
  recordFieldDiagnostic?.span?.sourceId !== "record-field-error" ||
  typeof recordFieldDiagnostic?.span?.startOffset !== "number" ||
  recordFieldDiagnostic.span.endOffset <= recordFieldDiagnostic.span.startOffset
) {
  throw new Error(`Unexpected record field diagnostic: ${JSON.stringify(recordFieldError)}`);
}

console.log("forma-ocaml record field diagnostic smoke ok");

const missingRecordField = typecheckWithSourceId("record-missing-field", "(get {:a 1} :b)");
const missingRecordFieldDiagnostic = missingRecordField?.diagnostics?.[0];
if (
  missingRecordField?.ok !== false ||
  missingRecordFieldDiagnostic?.code !== "typecheck/missing-field" ||
  missingRecordFieldDiagnostic?.span?.sourceId !== "record-missing-field" ||
  typeof missingRecordFieldDiagnostic?.span?.startOffset !== "number" ||
  missingRecordFieldDiagnostic.span.endOffset <= missingRecordFieldDiagnostic.span.startOffset
) {
  throw new Error(
    `Unexpected missing record field diagnostic: ${JSON.stringify(missingRecordField)}`,
  );
}

console.log("forma-ocaml missing record field smoke ok");

const recordSignatureMismatch = typecheckWithSourceId(
  "record-signature-mismatch",
  '(: employee {:name Str :age Int}) (define employee {:name "Ada"})',
);
const recordSignatureDiagnostic = recordSignatureMismatch?.diagnostics?.[0];
if (
  recordSignatureMismatch?.ok !== false ||
  recordSignatureDiagnostic?.code !== "typecheck/record-shape" ||
  recordSignatureDiagnostic?.span?.sourceId !== "record-signature-mismatch" ||
  typeof recordSignatureDiagnostic?.span?.startOffset !== "number" ||
  recordSignatureDiagnostic.span.endOffset <= recordSignatureDiagnostic.span.startOffset
) {
  throw new Error(
    `Unexpected record signature mismatch response: ${JSON.stringify(recordSignatureMismatch)}`,
  );
}

console.log("forma-ocaml record signature mismatch smoke ok");

const nthIndexMismatch = typecheckWithSourceId("nth-index-mismatch", '(nth [1 2] "bad")');
const nthIndexDiagnostic = nthIndexMismatch?.diagnostics?.[0];
if (
  nthIndexMismatch?.ok !== false ||
  nthIndexDiagnostic?.code !== "typecheck/type-mismatch" ||
  nthIndexDiagnostic?.span?.sourceId !== "nth-index-mismatch" ||
  typeof nthIndexDiagnostic?.span?.startOffset !== "number" ||
  nthIndexDiagnostic.span.endOffset <= nthIndexDiagnostic.span.startOffset
) {
  throw new Error(`Unexpected nth index mismatch response: ${JSON.stringify(nthIndexMismatch)}`);
}

console.log("forma-ocaml nth index mismatch smoke ok");

const appendKindMismatch = typecheckWithSourceId("append-kind-mismatch", "(append [1] (list 2))");
const appendKindDiagnostic = appendKindMismatch?.diagnostics?.[0];
if (
  appendKindMismatch?.ok !== false ||
  appendKindDiagnostic?.code !== "typecheck/type-mismatch" ||
  appendKindDiagnostic?.span?.sourceId !== "append-kind-mismatch" ||
  typeof appendKindDiagnostic?.span?.startOffset !== "number" ||
  appendKindDiagnostic.span.endOffset <= appendKindDiagnostic.span.startOffset
) {
  throw new Error(
    `Unexpected append kind mismatch response: ${JSON.stringify(appendKindMismatch)}`,
  );
}

console.log("forma-ocaml append kind mismatch smoke ok");

const conjItemMismatch = typecheckWithSourceId("conj-item-mismatch", '(conj ["a"] 1)');
const conjItemDiagnostic = conjItemMismatch?.diagnostics?.[0];
if (
  conjItemMismatch?.ok !== false ||
  conjItemDiagnostic?.code !== "typecheck/type-mismatch" ||
  conjItemDiagnostic?.span?.sourceId !== "conj-item-mismatch" ||
  typeof conjItemDiagnostic?.span?.startOffset !== "number" ||
  conjItemDiagnostic.span.endOffset <= conjItemDiagnostic.span.startOffset
) {
  throw new Error(`Unexpected conj item mismatch response: ${JSON.stringify(conjItemMismatch)}`);
}

console.log("forma-ocaml conj item mismatch smoke ok");

const getInMissingField = typecheckWithSourceId(
  "get-in-missing-field",
  "(get-in {:a {:b 1}} [:a :c])",
);
const getInMissingDiagnostic = getInMissingField?.diagnostics?.[0];
if (
  getInMissingField?.ok !== false ||
  getInMissingDiagnostic?.code !== "typecheck/missing-field" ||
  getInMissingDiagnostic?.span?.sourceId !== "get-in-missing-field" ||
  typeof getInMissingDiagnostic?.span?.startOffset !== "number" ||
  getInMissingDiagnostic.span.endOffset <= getInMissingDiagnostic.span.startOffset
) {
  throw new Error(`Unexpected get-in missing field response: ${JSON.stringify(getInMissingField)}`);
}

console.log("forma-ocaml get-in missing field smoke ok");

const signatureMismatch = typecheckWithSourceId(
  "signature-mismatch",
  '(: bad (-> Int Int)) (define (bad x) "nope")',
);
const signatureDiagnostic = signatureMismatch?.diagnostics?.[0];
if (
  signatureMismatch?.ok !== false ||
  signatureDiagnostic?.code !== "typecheck/type-mismatch" ||
  signatureDiagnostic?.span?.sourceId !== "signature-mismatch" ||
  typeof signatureDiagnostic?.span?.startOffset !== "number" ||
  signatureDiagnostic.span.endOffset <= signatureDiagnostic.span.startOffset
) {
  throw new Error(`Unexpected signature mismatch response: ${JSON.stringify(signatureMismatch)}`);
}

console.log("forma-ocaml signature mismatch smoke ok");

if (buildTargets.js === true && existsSync(jsEntry)) {
  const jsResult = run("node", [
    jsEntry,
    JSON.stringify({ op: "evaluate", sourceId: "js-smoke", source: "(+ 1 2)" }),
  ]);
  const jsOutput = JSON.parse(jsResult.stdout);
  if (jsOutput?.ok !== true || jsOutput.value?.kind !== "int" || jsOutput.value?.value !== 3) {
    throw new Error(`Unexpected js_of_ocaml response: ${jsResult.stdout}`);
  }
  const jsTypeResult = run("node", [
    jsEntry,
    JSON.stringify({ op: "typecheck", sourceId: "js-smoke", source: "(+ 1 2)" }),
  ]);
  const jsTypeOutput = JSON.parse(jsTypeResult.stdout);
  if (jsTypeOutput?.ok !== true || jsTypeOutput.type !== "Int") {
    throw new Error(`Unexpected js_of_ocaml typecheck response: ${jsTypeResult.stdout}`);
  }
  console.log("forma-ocaml js smoke ok");
}

if (buildTargets.wasm === true && existsSync(wasmEntry)) {
  const wasmResult = run("node", [
    wasmEntry,
    JSON.stringify({ op: "evaluate", sourceId: "wasm-smoke", source: "(+ 1 2)" }),
  ]);
  const wasmOutput = JSON.parse(wasmResult.stdout);
  if (
    wasmOutput?.ok !== true ||
    wasmOutput.value?.kind !== "int" ||
    wasmOutput.value?.value !== 3
  ) {
    throw new Error(`Unexpected wasm_of_ocaml response: ${wasmResult.stdout}`);
  }
  const wasmTypeResult = run("node", [
    wasmEntry,
    JSON.stringify({ op: "typecheck", sourceId: "wasm-smoke", source: "(+ 1 2)" }),
  ]);
  const wasmTypeOutput = JSON.parse(wasmTypeResult.stdout);
  if (wasmTypeOutput?.ok !== true || wasmTypeOutput.type !== "Int") {
    throw new Error(`Unexpected wasm_of_ocaml typecheck response: ${wasmTypeResult.stdout}`);
  }
  console.log("forma-ocaml wasm smoke ok");
}

const daemon = spawn(nativeCli, ["daemon"], {
  cwd,
  stdio: ["pipe", "pipe", "pipe"],
});

const requests = [
  { op: "openSession" },
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
];

let stdout = "";
let stderr = "";
daemon.stdout.on("data", (chunk) => {
  stdout += chunk;
});
daemon.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const write = (request) => daemon.stdin.write(`${JSON.stringify(request)}\n`);

write(requests[0]);

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Timed out waiting for daemon session")), 5000);
  const poll = () => {
    const lines = stdout.trim().split("\n").filter(Boolean);
    if (lines.length < 1) {
      setTimeout(poll, 10);
      return;
    }
    clearTimeout(timeout);
    resolve();
  };
  poll();
});

const sessionId = JSON.parse(stdout.trim().split("\n")[0]).value.sessionId;
requests[1] = {
  op: "loadSourceBundle",
  sessionId,
  sources: [
    {
      kind: "prelude",
      sourceId: "core",
      source: [
        "(defn add-one [x] (+ x 1))",
        "(defmacro unless [test body] `(if ~test nil ~body))",
        "(define-form typed-box (:infer-fn typed-box/infer))",
        '(meta-fn typed-box/infer (:kind infer) (:body (if (= (count (get input :args)) 1) "Int" "Bool")))',
        "(define-form checked-box (:check-fn checked-box/check))",
        "(meta-fn checked-box/check (:kind check) (:body (get input :expected-type)))",
        "(define-form bad-box (:infer-fn bad-box/infer))",
        '(meta-fn bad-box/infer (:kind infer) (:body "UnknownType"))',
      ].join("\n"),
    },
    {
      kind: "source",
      sourceId: "example",
      source: "(unless false (add-one 2))",
    },
    {
      kind: "source",
      sourceId: "typed-descriptor",
      source: "(typed-box 42)",
    },
    {
      kind: "source",
      sourceId: "checked-descriptor",
      source: "(: (checked-box 42) Int)",
    },
    {
      kind: "source",
      sourceId: "bad-descriptor",
      source: "(bad-box 42)",
    },
  ],
};
requests[2] = { op: "evaluate", sessionId, sourceId: "example" };
requests[3] = { op: "typecheck", sessionId, sourceId: "example" };
requests[4] = { op: "sessionInfo", sessionId };
requests[5] = { op: "sourceSummary", sessionId };
requests[6] = { op: "elaborateMany", sessionId, sourceIds: ["example"] };
requests[7] = { op: "emitMany", sessionId, sourceIds: ["example"] };
requests[8] = { op: "artifactSummary", sessionId, sourceIds: ["example"] };
requests[9] = { op: "typecheckCoreTyped", sessionId, sourceId: "typed-descriptor" };
requests[10] = { op: "typecheckCore", sessionId, sourceId: "typed-descriptor" };
requests[11] = { op: "typecheckCoreTyped", sessionId, sourceId: "checked-descriptor" };
requests[12] = { op: "typecheckCore", sessionId, sourceId: "checked-descriptor" };
requests[13] = { op: "typecheckCoreTyped", sessionId, sourceId: "bad-descriptor" };
requests[14] = { op: "resetSession", sessionId };
requests[15] = { op: "closeSession", sessionId };
for (const request of requests.slice(1)) {
  write(request);
}
daemon.stdin.end();

const daemonExit = await new Promise((resolve) => {
  daemon.on("close", (code) => resolve(code));
});

if (daemonExit !== 0) {
  throw new Error(`Daemon exited with ${daemonExit}: ${stderr}`);
}

const daemonOutputs = stdout
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
if (daemonOutputs.length !== requests.length) {
  throw new Error(`Expected ${requests.length} daemon responses, received ${daemonOutputs.length}`);
}

const expectedFailureIndexes = new Set([13]);
if (
  !daemonOutputs.every((response, index) =>
    expectedFailureIndexes.has(index) ? response.ok === false : response.ok === true,
  )
) {
  throw new Error(`Unexpected daemon response: ${stdout}`);
}

if (daemonOutputs[1].value.loadedCount !== 5) {
  throw new Error(`Unexpected loadSourceBundle response: ${JSON.stringify(daemonOutputs[1])}`);
}

if (daemonOutputs[2].value.kind !== "int" || daemonOutputs[2].value.value !== 3) {
  throw new Error(`Unexpected daemon evaluate response: ${JSON.stringify(daemonOutputs[2])}`);
}

if (daemonOutputs[3].type !== "Int") {
  throw new Error(`Unexpected daemon typecheck response: ${JSON.stringify(daemonOutputs[3])}`);
}

if (daemonOutputs[4].value.preludeCount !== 1 || daemonOutputs[4].value.sourceCount !== 4) {
  throw new Error(`Unexpected sessionInfo response: ${JSON.stringify(daemonOutputs[4])}`);
}

if (
  daemonOutputs[4].value.parsedPreludeCount !== 1 ||
  daemonOutputs[4].value.parsedSourceCount !== 4 ||
  daemonOutputs[4].value.envBindingCount !== 8 ||
  daemonOutputs[4].value.typeBindingCount !== 8
) {
  throw new Error(`Unexpected parsed sessionInfo response: ${JSON.stringify(daemonOutputs[4])}`);
}

if (
  daemonOutputs[5].value.preludeCount !== 1 ||
  daemonOutputs[5].value.sourceCount !== 4 ||
  !daemonOutputs[5].value.sources?.some((source) => source.id === "example")
) {
  throw new Error(`Unexpected sourceSummary response: ${JSON.stringify(daemonOutputs[5])}`);
}

if (
  daemonOutputs[6].value.sourceCount !== 1 ||
  daemonOutputs[6].value.elaboratedCount !== 1 ||
  daemonOutputs[6].value.results?.[0]?.ok !== true
) {
  throw new Error(`Unexpected elaborateMany response: ${JSON.stringify(daemonOutputs[6])}`);
}

if (
  daemonOutputs[7].value.sourceCount !== 1 ||
  daemonOutputs[7].value.emittedCount !== 1 ||
  daemonOutputs[7].value.results?.[0]?.artifact?.content?.irVersion !== "1"
) {
  throw new Error(`Unexpected emitMany response: ${JSON.stringify(daemonOutputs[7])}`);
}

if (
  daemonOutputs[8].value.sourceCount !== 1 ||
  daemonOutputs[8].value.declarationCount !== 0 ||
  daemonOutputs[8].value.diagnosticCount !== 0
) {
  throw new Error(`Unexpected artifactSummary response: ${JSON.stringify(daemonOutputs[8])}`);
}

const descriptorInferAnnotation = daemonOutputs[9].typedCore?.annotations?.find(
  (annotation) =>
    annotation.expr?.kind === "application" && annotation.expr?.callee?.name === "typed-box",
);
if (
  daemonOutputs[9].type !== "Int" ||
  daemonOutputs[9].typedCore?.resultType !== "Int" ||
  descriptorInferAnnotation?.type !== "Int" ||
  daemonOutputs[10].type !== daemonOutputs[9].typedCore.resultType ||
  daemonOutputs[10].typedCore != null
) {
  throw new Error(
    `Unexpected descriptor infer typecheckCore projection response: ${JSON.stringify({
      typed: daemonOutputs[9],
      compact: daemonOutputs[10],
    })}`,
  );
}

const descriptorCheckAnnotation = daemonOutputs[11].typedCore?.annotations?.find(
  (annotation) =>
    annotation.expr?.kind === "application" && annotation.expr?.callee?.name === "checked-box",
);
if (
  daemonOutputs[11].type !== "Int" ||
  daemonOutputs[11].typedCore?.resultType !== "Int" ||
  descriptorCheckAnnotation?.type !== "Int" ||
  daemonOutputs[12].type !== daemonOutputs[11].typedCore.resultType ||
  daemonOutputs[12].typedCore != null
) {
  throw new Error(
    `Unexpected descriptor check typecheckCore projection response: ${JSON.stringify({
      typed: daemonOutputs[11],
      compact: daemonOutputs[12],
    })}`,
  );
}

const badDescriptorDiagnostic = daemonOutputs[13].diagnostics?.[0];
if (
  badDescriptorDiagnostic?.code !== "typecheck/descriptor-infer" ||
  !badDescriptorDiagnostic?.message?.includes("UnknownType")
) {
  throw new Error(`Unexpected bad descriptor infer response: ${JSON.stringify(daemonOutputs[13])}`);
}

console.log("forma-ocaml daemon smoke ok");
