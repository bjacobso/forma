import { describe, expect, test } from "vitest";
import { bootstrapFromSources, elaborateSources } from "../src/Descriptor.js";
import { preludeSource } from "../src/Preludes.js";
import { Effect } from "effect";
import { inferSourceStr } from "../src/Type.js";

const elaborate = (prelude: string, source: string) => elaborateSources(
  [{ sourceId: "a", source }],
  { prelude: bootstrapFromSources(preludeSource("compiler.lisp"), prelude) },
);

const checkForm = (bindings: string) => `
  (type R {:kind "R" :name Symbol :body RuntimeExpr})
  (form (check name body)
    :types {:name (Declares Check) :body (Expr Bool)}
    :scope {:body (fn [_] {${bindings}})}
    :ir R {:kind "R" :name name :body body})`;

describe("scoped expression inference", () => {
  test.each(["", ":= (quote (-> a a Bool))"])("keyword comparisons in lambdas (%s)", equality => {
    const prelude = checkForm(`${equality}
      :in? (quote (-> a (List a) Bool))
      :item (quote {:status Keyword})
      :items (quote (List {:status Keyword}))`);
    const source = `
      (check top-level (= item.status :done))
      (check in-lambda (empty? (filter (fn [s] (= s.status :done)) items)))
      (check reversed (empty? (filter (fn [s] (= :done s.status)) items)))
      (check in-let (let [s item] (= s.status :done)))
      (check in-map (empty? (map (fn [s] (= (get s :status) :done)) items)))
      (check nested (empty? (map (fn [s] (filter (fn [t] (and (= s.status :done) (= t.status :done))) items)) items)))
      (check membership (empty? (filter (fn [s] (in? :done [s.status])) items)))
      (check membership-reversed (empty? (filter (fn [s] (in? s.status [:done])) items)))`;
    const result = elaborate(prelude, source);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.declarations).toHaveLength(8);
  });

  test.each([
    ["res.checkin", ":res (quote {:check-in Int :check-out Int})", "res", "checkin"],
    ["a.b.checkin", ":a (quote {:b {:check-in Int :check-out Int}})", "a.b", "checkin"],
  ])("missing scoped field %s", (path, bindings, owner, field) => {
    const source = `(check c (after? 1 ${path}))`;
    const result = elaborate(checkForm(`:after? (quote (-> Int Int Bool)) ${bindings}`), source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0]!;
    expect(diagnostic.message).toContain(`${owner} has no field ${field}`);
    expect(diagnostic.message).toContain("did you mean check-in?");
    expect(diagnostic.message).toContain("fields: check-in, check-out");
    expect(source.slice(diagnostic.span!.startOffset, diagnostic.span!.endOffset)).toBe(path);
  });

  test("numeric argument errors name the argument and operator", () => {
    const source = "(check c (= (* 2 res.label) 0))";
    const result = elaborate(checkForm(":res (quote {:label String})"), source);
    expect(result.diagnostics).toHaveLength(1);
    const diagnostic = result.diagnostics[0]!;
    expect(diagnostic.message).toContain("Argument 2 to *");
    expect(diagnostic.message).toContain("String");
    expect(source.slice(diagnostic.span!.startOffset, diagnostic.span!.endOffset)).toBe("res.label");
  });

  test.each([
    [":res (quote {})", "res.absent", "res has no field absent; fields: (none)"],
    [":res (quote {:check-in Int :check-out Int})", "res.unrelated", "res has no field unrelated; fields: check-in, check-out"],
    [":res (quote {:check-in Int :check-out Int})", "(get res :checkin)", "res has no field checkin (did you mean check-in?); fields: check-in, check-out"],
  ])("closed record diagnostics for %s", (bindings, expression, message) => {
    const source = `(check c (= ${expression} 0))`;
    const result = elaborate(checkForm(bindings), source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain(message);
    expect(source.slice(result.diagnostics[0]!.span!.startOffset, result.diagnostics[0]!.span!.endOffset)).toBe(expression);
  });
});

test.each([
  ["(define shared/check [{:keys [name extra]}] [])", "shared/check"],
  ["(define shared/check (fn [{:keys [name extra]}] []))", "shared/check"],
  ["(define original [{:keys [name extra]}] []) (define shared/check original)", "shared/check"],
  ["", "(fn [{:keys [name extra]}] [])"],
])(":check missing holes name the check, form, and keys (%s)", (helper, check) => {
  const result = elaborate(`
    (type R {:kind "R" :name Symbol})
    ${helper}
    (form (a name) :types {:name (Declares A)} :check ${check}
      :ir R {:kind "R" :name name})`, "(a x)");
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]).toMatchObject({
    code: "elaborate/validation-failed",
    message: `:check ${helper ? "shared/check" : "<anonymous>"} of form a: no hole named extra`,
    span: { sourceId: "a", startOffset: 0, endOffset: 5 },
  });
});

test("shared checks can read missing holes with get and destructure omitted optional holes", () => {
  const result = elaborate(`
    (type R {:kind "R" :name Symbol})
    (define shared/check [holes]
      (if (= (get holes :extra) nil) [] [{:message "unexpected extra"}]))
    (form (a name) :types {:name Symbol} :check shared/check :ir R {:kind "R" :name name})
    (form (b name {:keys [extra]}) :types {:name Symbol :extra (Option String)}
      :check (fn [{:keys [name extra]}] (shared/check {:name name :extra extra}))
      :ir R {:kind "R" :name name})`, "(a x) (b y)");
  expect(result.diagnostics).toEqual([]);
  expect(result.declarations).toHaveLength(2);
});

test("multiple missing check holes are listed together", () => {
  const result = elaborate(`
    (type R {:kind "R"})
    (form (a) :types {} :check (fn [{:keys [extra final]}] []) :ir R {:kind "R"})`, "(a)");
  expect(result.diagnostics[0]!.message).toBe(":check <anonymous> of form a: no holes named extra, final");
});

describe("literal widening in ordinary inference", () => {
  test("inferred record accessors accept Keyword fields after comparison with a literal", () => {
    const source = `(define matches [s] (= s.status :done))
      (matches (: {:status :open} {:status Keyword}))`;
    expect(Effect.runSync(inferSourceStr(source))).toBe("Bool");
  });

  test("explicit singleton and enum parameters still reject nonmembers", () => {
    for (const type of [":done", "(Union :open :done)"]) {
      const source = `(: only (-> ${type} Bool)) (define only [s] true) (only :typo)`;
      expect(() => Effect.runSync(inferSourceStr(source))).toThrow();
    }
  });

  test("direct keyword bindings and branches retain singleton types", () => {
    expect(Effect.runSync(inferSourceStr("(define state :done) state"))).toBe(":done");
    expect(Effect.runSync(inferSourceStr("(if true :open :done)"))).toBe("Union<:open, :done>");
  });
});
