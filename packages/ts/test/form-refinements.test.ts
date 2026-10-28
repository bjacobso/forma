import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { Type } from "../src/index.js";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { elaborateProgram } from "../src/descriptor/elaborate.js";
import { generateEffectProgram } from "../src/mechanics/elaborate.js";
import { protocolType } from "../src/surface/contract.js";
import { Reader } from "../src/index.js";

const elaborate = (prelude: string, source: string) => {
  const result = elaborateProgram(source, { prelude: bootstrapFromSources("", prelude) });
  return {
    ok: result.ok,
    payloads: result.declarations.map(declaration => declaration.payload),
    diagnostics: result.diagnostics.map(diagnostic => ({
      message: diagnostic.message,
      text: diagnostic.span ? source.slice(diagnostic.span.startOffset, diagnostic.span.endOffset) : undefined,
    })),
  };
};
const infer = (source: string) => Effect.runPromise(Type.inferSourceStr(source));

describe("refined fields in form contracts", () => {
  test("patterned IR fields accept matching values and reject others at the form", () => {
    const prelude = `(type SlugIR {:kind "Slug" :slug (String :pattern "^[a-z]+$")})
      (form (slug value) :types {:value String} :ir SlugIR {:kind "Slug" :slug value})`;
    const result = elaborate(prelude, '(slug "abc") (slug "ABC")');
    expect(result.payloads).toEqual([{ kind: "Slug", slug: "abc" }]);
    expect(result.diagnostics).toEqual([{ message: "payload.slug must match the pattern ^[a-z]+$", text: '(slug "ABC")' }]);
  });

  test("length and range refinements check IR values", () => {
    const prelude = `(type FieldIR {:kind "Field" :label (String :min-length 1 :max-length 5) :width (Int :min 1 :max 12) :tags (List String :max-length 1)})
      (form (field label width tag ...) :types {:label String :width Int :tag (List String)} :ir FieldIR
        {:kind "Field" :label label :width width :tags tag})`;
    expect(elaborate(prelude, '(field "Name" 6 "a")').diagnostics).toEqual([]);
    expect(elaborate(prelude, '(field "" 0 "a" "b") (field "Too long" 13)').diagnostics.map(d => d.message)).toEqual([
      "payload.label must have at least 1 character; payload.width must be at least 1; payload.tags must have at most 1 item",
      "payload.label must have at most 5 characters; payload.width must be at most 12",
    ]);
  });

  test("refined and enum holes check literals where the author wrote them", () => {
    const prelude = `(type Status (Union "active" "inactive"))
      (type AccountIR {:kind "Account" :name String :status Status})
      (form (account name status) :types {:name (String :pattern "^[a-z]+$") :status Status} :ir AccountIR
        {:kind "Account" :name name :status status})`;
    expect(elaborate(prelude, '(account "ada" "active")').ok).toBe(true);
    expect(elaborate(prelude, '(account "Ada" "actve")').diagnostics).toEqual([
      { message: "name must match the pattern ^[a-z]+$", text: '"Ada"' },
      { message: "status does not match its declared hole type", text: '"actve"' },
    ]);
  });

  test("refinement metadata does not hide the base protocol type", () => {
    expect(protocolType(Effect.runSync(Reader.parseToSExpr('(String :pattern "^a")')))).toEqual({ type: "string" });
  });
});

describe("child forms", () => {
  const prelude = `(type ClauseIR {:kind "Clause" :weight Int})
    (type RuleIR {:kind "Rule" :clauses (List ClauseIR)})
    (form (clause weight) :types {:weight Int} :ir ClauseIR {:kind "Clause" :weight weight})
    (form (rule clause ...) :types {:clause (List clause)} :ir RuleIR {:kind "Rule" :clauses clause})`;

  test("report errors at the child, not the parent", () => {
    const result = elaborate(prelude, '(rule (clause 1)\n  (clause "heavy")\n  (clause 2.5))');
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      { message: "weight does not match its declared hole type", text: '"heavy"' },
      { message: "weight does not match its declared hole type", text: "2.5" },
    ]);
  });

  test("still project valid children", () => {
    expect(elaborate(prelude, "(rule (clause 1) (clause 2))").payloads).toEqual([
      { kind: "Rule", clauses: [{ kind: "Clause", weight: 1 }, { kind: "Clause", weight: 2 }] },
    ]);
  });
});

describe("scoped expressions", () => {
  const prelude = `(type Status (Union "active" "inactive"))
    (type CondIR {:kind "Cond"})
    (form (visible-when condition) :types {:condition (Expr Bool)} :ir CondIR
      :scope {:condition (fn [holes] {:present? (quote (-> (Option a) Bool))
                                      :nickname (quote (Option String))
                                      :age (quote (Option Int))
                                      :status (quote Status)
                                      :plan (quote (Union "free" "paid"))})}
      {:kind "Cond"})`;

  test("generic scope functions apply to differently typed bindings", () => {
    expect(elaborate(prelude, "(visible-when (and (present? nickname) (present? age)))").diagnostics).toEqual([]);
  });

  test("enum bindings compare with their members and reject other literals", () => {
    expect(elaborate(prelude, '(visible-when (or (= status "active") (= plan "paid")))').diagnostics).toEqual([]);
    expect(elaborate(prelude, '(visible-when (= status "actve"))').diagnostics.map(d => d.message)).toEqual([
      expect.stringContaining('"actve" is not one of Union<"active", "inactive">'),
    ]);
  });
});

describe("enum equality", () => {
  const color = '(type Color (Union "red" "green"))';
  test.each([
    `${color} (: f (-> Color Bool)) (define f [c] (= c "red")) (f "red")`,
    `${color} (: f (-> Color Bool)) (define f [c] (= "green" c)) (f "red")`,
    `${color} (: f (-> Color String Bool)) (define f [c s] (= c s)) (f "red" "x")`,
    '(type Size (Union 1 2)) (: f (-> Size Bool)) (define f [s] (!= s 2)) (f 1)',
  ])("accepts %s", async source => {
    expect(await infer(source)).toBe("Bool");
  });

  test.each([
    [`${color} (: f (-> Color Bool)) (define f [c] (= c "blue")) (f "red")`, '"blue" is not one of Union<"red", "green">'],
    ['(type Color (Union :red :green)) (: f (-> Color Bool)) (define f [c] (= c :blu)) (f :red)', ":blu is not one of Union<:red, :green>"],
  ])("rejects %s", async (source, message) => {
    await expect(infer(source)).rejects.toThrow(message);
  });
});

describe("refinements in generated Effect schemas", () => {
  test("emit Effect filters", () => {
    const result = generateEffectProgram('(type Field {:name (String :pattern "^[a-z]+$" :min-length 1 :max-length 20) :width (Int :min 1 :max 12) :tags (List String :max-length 3)})');
    expect(result.diagnostics).toEqual([]);
    const code = result.code ?? "";
    expect(code).toContain('name: Schema.String.check(Schema.isPattern(new RegExp("^[a-z]+$"))).check(Schema.isMinLength(1)).check(Schema.isMaxLength(20)),');
    expect(code).toContain("width: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(12)),");
    expect(code).toContain("tags: Schema.Array(Schema.String).check(Schema.isMaxLength(3)),");
  });

  test("reject filters on types they do not apply to", () => {
    const result = generateEffectProgram('(type Bad {:a (Int :pattern "x") :b (Bool :min-length 1) :c (String :min 1) :d (String :min-length -1)})');
    expect(result.diagnostics.map(d => d.message)).toEqual([":min-length metadata expects a non-negative Int"]);
    expect(generateEffectProgram('(type Bad {:a (Int :pattern "x") :b (Bool :min-length 1) :c (String :min 1)})').diagnostics.map(d => d.message)).toEqual([
      ":pattern applies to String.",
      ":min-length applies to String and List.",
      ":min applies to Int and Float.",
    ]);
  });
});
