import { describe, expect, test } from "vitest";
import { Mechanics } from "../src/index.js";

const prelude = `(error Declined {:reason String})
(error AuditDown)
(service Stripe (: charge (-> Int (Effect String [Declined] []))))
(service Audit (: log (-> String (Effect Unit [AuditDown] []))))
(: charge (-> Int (Effect String [Declined] [Stripe.charge])))
(define charge [n] (Stripe.charge n))
(: lookup-cached (-> Int (Effect String)))
(define lookup-cached [n] (succeed (str "c" n)))
(: with-audit (-> (-> Int (Effect a [e] [r])) Int (Effect a [e AuditDown] [r Audit.log])))
(define with-audit [f n] (do! [v (f n) _ (Audit.log "called")] v))
`;

const check = (source: string) => {
  const result = Mechanics.elaborateEffectProgram(source, { sourceId: "test.lisp" });
  return result.diagnostics.map((d) => ({ code: d.code, message: d.message, text: d.span ? source.slice(d.span.startOffset, d.span.endOffset) : undefined }));
};

describe("effect-polymorphic signatures (RFC 0023, stages 1-3)", () => {
  test("a generic operation is accepted, and each call solves its own sets", () => {
    expect(check(`${prelude}
(: charged (-> Int (Effect String [Declined AuditDown] [Stripe.charge Audit.log])))
(define charged [n] (with-audit charge n))
(: free (-> Int (Effect String [AuditDown] [Audit.log])))
(define free [n] (with-audit lookup-cached n))`)).toEqual([]);
  });

  test("a caller of an effect-free callback is not charged for the callback's capabilities", () => {
    expect(check(`${prelude}
(: free (-> Int (Effect String [AuditDown] [Audit.log])))
(define free [n] (with-audit charge n))`).map((d) => d.code)).toEqual(["mechanics/undeclared-error", "mechanics/undeclared-requirement"]);
  });

  test("the callback that introduced an entry is where the caller's diagnostic points", () => {
    const [error] = check(`${prelude}
(: free (-> Int (Effect String [AuditDown] [Audit.log])))
(define free [n] (with-audit (fn [m] (charge m)) n))`);
    expect(error?.text).toBe("(charge m)");
  });

  test("type variables are solved from arguments and from the expected result", () => {
    expect(check(`(: pair (-> a b (Effect (Tuple a b))))
(define pair [x y] (succeed [x y]))
(: both (-> Int String (Effect (Tuple Int String))))
(define both [n s] (pair n s))`)).toEqual([]);
    expect(check(`(: wrap (-> a (Effect (List a))))
(define wrap [x] (succeed [x]))
(: names (-> Int (Effect (List String))))
(define names [n] (wrap n))`).map((d) => d.code)).toEqual(["mechanics/type-mismatch"]);
  });

  test("a rigid variable cannot escape into a closed result", () => {
    expect(check(`${prelude}
(: leaky (-> (-> Int (Effect a [e] [r])) Int (Effect a [] [])))
(define leaky [f n] (f n))`).map((d) => [d.code, d.message])).toEqual([
      ["mechanics/undeclared-error", "Operation leaky can fail with the errors of e, but its signature declares no errors."],
      ["mechanics/undeclared-requirement", "Operation leaky requires the requirements of r, but its signature declares no requirements."],
    ]);
  });

  test("set variable misuse is reported where it is written", () => {
    const diagnostics = check(`${prelude}
(: unbound (-> Int (Effect Int [declined] [])))
(define unbound [n] (succeed n))
(: both-kinds (-> (-> Int (Effect a [e] [e])) Int (Effect a [e] [e])))
(define both-kinds [f n] (f n))
(: inside (-> (-> (-> Int (Effect a [e] [])) Int) (Effect Int [] [])))
(define inside [f] (succeed 1))`);
    expect(diagnostics.map((d) => d.code)).toEqual(["mechanics/unbound-set-variable", "mechanics/set-variable-kind", "mechanics/set-variable-position"]);
    expect(diagnostics[0]?.message).toContain("Did you mean the error Declined?");
  });

  test("set variables are only accepted in operation signatures", () => {
    expect(check(`(service Bad (: run (-> (Effect Unit [e] []))))`).map((d) => d.code)).toEqual(["mechanics/unknown-error"]);
  });

  test("the generated operation is generic over E and R, and its callers are closed", () => {
    const code = Mechanics.generateEffectProgram(`${prelude}
(: free (-> Int (Effect String [AuditDown] [Audit.log])))
(define free [n] (with-audit lookup-cached n))`).code ?? "";
    expect(code).toContain("export const withAudit = <A0, E, R>(");
    expect(code).toContain("f: (arg0: number) => Effect.Effect<A0, E, R>,");
    expect(code).toContain("): Effect.Effect<A0, AuditDown | E, Audit | R> =>");
    expect(code).toContain("export const free = (n: number): Effect.Effect<string, AuditDown, Audit> =>");
  });

  test("combinators keep their diagnostics when routed through signatures", () => {
    const source = `(error Down)
(service Net (: get (-> Int (Effect Int [Down] []))))
(: fetch-all (-> (List Int) (Effect (List Int) [] [])))
(define fetch-all [ids] (timeout (for-each ids (fn [id] (Net.get id))) 10))`;
    expect(check(source).map((d) => d.code)).toEqual(["mechanics/undeclared-error", "mechanics/undeclared-error", "mechanics/undeclared-requirement"]);
  });
});

describe("named callbacks (RFC 0019, section 10)", () => {
  const lines = `(error Missing {:sku String})
(service Catalog (: price (-> String (Effect Int [] []))))
(: price-line (-> String (Effect Int [Missing] [Catalog.price])))
(define price-line [sku] (Catalog.price sku))
(: not-effect (-> String Int))
(define not-effect [sku] 1)
(: two (-> String String (Effect Int)))
(define two [a b] (succeed 1))
`;

  test("for-each accepts a declared operation and reports what it needs", () => {
    expect(check(`${lines}(: all (-> (List String) (Effect (List Int) [Missing] [Catalog.price])))
(define all [skus] (for-each skus price-line))`)).toEqual([]);
    const [error] = check(`${lines}(: all (-> (List String) (Effect (List Int) [] [])))
(define all [skus] (for-each skus price-line))`);
    expect(error).toMatchObject({ code: "mechanics/undeclared-error", text: "price-line" });
  });

  test("an incompatible reference reports the expected and actual function types", () => {
    expect(check(`${lines}(: all (-> (List String) (Effect (List Int))))
(define all [skus] (for-each skus not-effect))`).map((d) => d.message)).toEqual([
      "Expected a function (-> String (Effect ...)), but this is (-> String Int).",
    ]);
    expect(check(`${lines}(: all (-> (List Int) (Effect (List Int))))
(define all [skus] (for-each skus price-line))`).map((d) => d.message)).toEqual([
      "Expected a function (-> Int (Effect ...)), but this is (-> String (Effect Int [Missing] [Catalog.price])).",
    ]);
    expect(check(`${lines}(: all (-> (List String) (Effect (List Int))))
(define all [skus] (for-each skus two))`).map((d) => d.code)).toEqual(["mechanics/type-mismatch"]);
  });
});

describe("refinement literals (RFC 0019, section 11)", () => {
  test("a literal out of range is rejected at the literal", () => {
    const source = `(type Cents (Int :min 0))
(type Bags (Brand (Int :min 1 :max 200)))
(type Code (String :min-length 2 :max-length 3))
(type Order {:cents Cents :code Code})
(: neg Cents)
(define neg -5)
(: bags (-> Int (Effect Bags)))
(define bags [n] (succeed (Bags 0)))
(: order (-> Int (Effect Order)))
(define order [n] (succeed {:cents 10 :code "abcd"}))`;
    expect(check(source).map((d) => [d.code, d.text, d.message])).toEqual([
      ["mechanics/refinement", "-5", "-5 must be at least 0, as (Int :min 0) requires."],
      ["mechanics/refinement", "0", "0 must be at least 1, as (Int :min 1 :max 200) requires."],
      ["mechanics/refinement", '"abcd"', '"abcd" must have at most 3 characters, as (String :min-length 2 :max-length 3) requires.'],
    ]);
  });

  test("literals in range and computed values are accepted", () => {
    expect(check(`(type Cents (Int :min 0))
(type Bags (Brand (Int :min 1 :max 200)))
(: ok Cents)
(define ok 0)
(: bags (-> Int (Effect Bags)))
(define bags [n] (succeed (Bags (+ n 1))))`)).toEqual([]);
  });
});
