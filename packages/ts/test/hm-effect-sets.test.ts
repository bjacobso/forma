import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import {
  inferSource,
  inferSourceAll,
  inferSourceStr,
  InferenceError,
  TApp,
  TCon,
  TFun,
  EEmpty,
  EVar,
  EExtend,
  showERow,
  flattenERow,
  buildERow,
  effectSetOf,
  unionEffectSets,
  coversRequirementKey,
  effectSetIncluded,
  showEffectSet,
  isSetVariableKey,
  setVariableKey,
  setVariableName,
  buildOperationalEffect,
  extractOperationalEffect,
  checkOperationalEffectAgainst,
  solveEffectCall,
  EffectSetSolver,
} from "../src/type/index.js";

const effectPrelude = `
(error Declined {:reason String})
(error AuditDown)
(error Timeout)
(service Stripe (: charge (-> Int (Effect String [Declined] []))))
(service Audit (: log (-> String (Effect Unit [AuditDown] []))))
(: charge (-> Int (Effect String [Declined] [Stripe.charge])))
(define charge [n] (Stripe.charge n))
(: log-event (-> Int (Effect Unit [AuditDown] [Audit.log])))
(define log-event [n] (Audit.log "event"))
(: lookup-cached (-> Int (Effect String)))
(define lookup-cached [n] (succeed "cached"))
(: with-audit (-> (-> Int (Effect a [e] [r])) Int (Effect a [e AuditDown] [r Audit.log])))
(define with-audit [f n] (do! [v (f n) _ (Audit.log "called")] v))
`;

function runInfer(source: string) {
  return Effect.runSync(Effect.result(inferSource(source)));
}

function expectFailure(source: string): InferenceError {
  const result = runInfer(source);
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure).toBeInstanceOf(InferenceError);
  return result.failure as InferenceError;
}

describe("HM effect provenance sets (effect-sets.ts)", () => {
  test("encodes lowercase names as $-prefixed set variables and preserves concrete names", () => {
    const errors = effectSetOf(["e", "Declined", "e"]);
    expect([...errors.keys()]).toEqual(["$e", "Declined"]);
    expect(isSetVariableKey("$e")).toBe(true);
    expect(isSetVariableKey("Declined")).toBe(false);
    expect(setVariableKey("e")).toBe("$e");
    expect(setVariableName("$e")).toBe("e");
    expect(showEffectSet(errors)).toBe("e Declined");
  });

  test("coversRequirementKey matches exact capability or whole service, and variables only by identity", () => {
    const byService = effectSetOf(["Stripe", "r"]);
    expect(coversRequirementKey(byService, "Stripe")).toBe(true);
    expect(coversRequirementKey(byService, "Stripe.charge")).toBe(true);
    expect(coversRequirementKey(byService, "Audit.log")).toBe(false);
    expect(coversRequirementKey(byService, "$r")).toBe(true);
    expect(coversRequirementKey(byService, "$other")).toBe(false);

    const byMethod = effectSetOf(["Stripe.charge"]);
    expect(coversRequirementKey(byMethod, "Stripe.charge")).toBe(true);
    expect(coversRequirementKey(byMethod, "Stripe")).toBe(false);
  });

  test("effectSetIncluded enforces rigid identity unless allowVariableTarget is set", () => {
    const actual = effectSetOf(["e", "Declined"]);
    const closed = effectSetOf(["Declined", "AuditDown"]);
    const open = effectSetOf(["e", "Declined", "AuditDown"]);

    expect(effectSetIncluded(actual, closed, "error", false)).toBe(false);
    expect(effectSetIncluded(actual, open, "error", false)).toBe(true);
    expect(effectSetIncluded(effectSetOf(["Declined"]), effectSetOf(["e"]), "error", false)).toBe(false);
    expect(effectSetIncluded(effectSetOf(["Declined"]), effectSetOf(["e"]), "error", true)).toBe(true);
  });

  test("unionEffectSets preserves the earliest provenance span for each entry", () => {
    const s1 = { start: 10, end: 20 };
    const s2 = { start: 30, end: 40 };
    const merged = unionEffectSets(effectSetOf(["Declined"], s1), effectSetOf(["Declined", "AuditDown"], s2));
    expect(merged.get("Declined")).toEqual(s1);
    expect(merged.get("AuditDown")).toEqual(s2);
  });

  test("EffectSetSolver excludes names already listed in the parameter set and preserves spans", () => {
    const argSpan = { start: 100, end: 115 };
    const callSpan = { start: 200, end: 230 };
    const paramEffect = buildOperationalEffect(
      TCon("String"),
      effectSetOf(["e", "Declined"]),
      effectSetOf(["r"]),
    );
    const actualEffect = buildOperationalEffect(
      TCon("String"),
      effectSetOf(["Declined", "Timeout"]),
      effectSetOf(["Stripe.charge"]),
    );
    const solver = new EffectSetSolver();
    solver.match(paramEffect, actualEffect, argSpan);

    const solvedErrors = solver.solve(effectSetOf(["e", "AuditDown"]), "error", callSpan);
    // Declined was already listed in param's [e Declined], so only Timeout flowed into e.
    expect([...solvedErrors.keys()]).toEqual(["Timeout", "AuditDown"]);
    expect(solvedErrors.get("Timeout")).toEqual(argSpan);
    expect(solvedErrors.get("AuditDown")).toEqual(callSpan);
  });

  test("solveEffectCall instantiates and solves polymorphic wrappers independently", () => {
    const callee = TFun(
      TFun(TCon("Int"), buildOperationalEffect(TCon("String"), effectSetOf(["e"]), effectSetOf(["r"]))),
      TFun(
        TCon("Int"),
        buildOperationalEffect(
          TCon("String"),
          effectSetOf(["e", "AuditDown"]),
          effectSetOf(["r", "Audit.log"]),
        ),
      ),
    );
    const effectfulArg = TFun(
      TCon("Int"),
      buildOperationalEffect(TCon("String"), effectSetOf(["Declined"]), effectSetOf(["Stripe.charge"])),
    );
    const pureArg = TFun(TCon("Int"), buildOperationalEffect(TCon("String")));

    const solvedEffectful = solveEffectCall(callee, [effectfulArg, TCon("Int")]);
    expect([...solvedEffectful.effect!.errors.keys()]).toEqual(["Declined", "AuditDown"]);
    expect([...solvedEffectful.effect!.requirements.keys()]).toEqual(["Stripe.charge", "Audit.log"]);

    const solvedPure = solveEffectCall(callee, [pureArg, TCon("Int")]);
    expect([...solvedPure.effect!.errors.keys()]).toEqual(["AuditDown"]);
    expect([...solvedPure.effect!.requirements.keys()]).toEqual(["Audit.log"]);
  });

  test("checkOperationalEffectAgainst reports undeclared errors and requirements naming rigid variables", () => {
    const actual = extractOperationalEffect(
      buildOperationalEffect(TCon("String"), effectSetOf(["e"]), effectSetOf(["r"])),
    )!;
    const declared = extractOperationalEffect(buildOperationalEffect(TCon("String")))!;
    const diagnostics = checkOperationalEffectAgainst(actual, declared, "operation leaky");
    expect(diagnostics.map((d) => [d.code, d.message])).toEqual([
      ["mechanics/undeclared-error", "Operation leaky can fail with the errors of e, but its signature declares no errors."],
      ["mechanics/undeclared-requirement", "Operation leaky requires the requirements of r, but its signature declares no requirements."],
    ]);
  });
});

describe("HM operational Effect sets end-to-end (RFC 0023 stage 5)", () => {
  test("closed error and requirement sets check subset inclusion and reject undeclared entries", () => {
    const ok = runInfer(`${effectPrelude}
(: wide (-> Int (Effect String [Declined AuditDown] [Stripe Audit.log])))
(define wide [n] (charge n))`);
    expect(ok._tag).toBe("Success");

    const badErr = expectFailure(`${effectPrelude}
(: narrow (-> Int (Effect String [] [Stripe.charge])))
(define narrow [n] (charge n))`);
    expect(badErr.details["code"]).toBe("mechanics/undeclared-error");
    expect(badErr.message).toContain("Declined");

    const badReq = expectFailure(`${effectPrelude}
(: narrow-req (-> Int (Effect String [Declined] [])))
(define narrow-req [n] (charge n))`);
    expect(badReq.details["code"]).toBe("mechanics/undeclared-requirement");
    expect(badReq.message).toContain("Stripe.charge");
  });

  test("polymorphic wrapper instantiates [e]/[r] independently for effectful and pure callbacks", () => {
    const ok = runInfer(`${effectPrelude}
(: charged (-> Int (Effect String [Declined AuditDown] [Stripe.charge Audit.log])))
(define charged [n] (with-audit charge n))
(: free (-> Int (Effect String [AuditDown] [Audit.log])))
(define free [n] (with-audit lookup-cached n))`);
    expect(ok._tag).toBe("Success");
  });

  test("polymorphic wrapper accepts lambda callbacks and solves their effect sets", () => {
    const ok = runInfer(`${effectPrelude}
(: charged-lambda (-> Int (Effect String [Declined AuditDown] [Stripe.charge Audit.log])))
(define charged-lambda [n] (with-audit (fn [m] (charge m)) n))`);
    expect(ok._tag).toBe("Success");
  });

  test("caller of a polymorphic wrapper is rejected when omitting the callback's error or requirement", () => {
    const err = expectFailure(`${effectPrelude}
(: free (-> Int (Effect String [AuditDown] [Audit.log])))
(define free [n] (with-audit charge n))`);
    expect(err.details["code"]).toBe("mechanics/undeclared-error");
    expect(err.message).toContain("Declined");

    const reqErr = expectFailure(`${effectPrelude}
(: missing-req (-> Int (Effect String [Declined AuditDown] [Audit.log])))
(define missing-req [n] (with-audit charge n))`);
    expect(reqErr.details["code"]).toBe("mechanics/undeclared-requirement");
    expect(reqErr.message).toContain("Stripe.charge");
  });

  test("union of two callbacks ([e1 e2] / [r1 r2]) combines both callbacks' sets", () => {
    const bothDef = `${effectPrelude}
(: run-both (-> (-> Int (Effect a [e1] [r1])) (-> Int (Effect b [e2] [r2])) Int (Effect b [e1 e2] [r1 r2])))
(define run-both [f g n] (do! [_ (f n) res (g n)] res))
`;
    const ok = runInfer(`${bothDef}
(: combined (-> Int (Effect Unit [Declined AuditDown] [Stripe.charge Audit.log])))
(define combined [n] (run-both charge log-event n))
(: half-pure (-> Int (Effect String [Declined] [Stripe.charge])))
(define half-pure [n] (run-both charge lookup-cached n))
(: all-pure (-> Int (Effect String [] [])))
(define all-pure [n] (run-both lookup-cached lookup-cached n))`);
    expect(ok._tag).toBe("Success");

    const missingSecond = expectFailure(`${bothDef}
(: incomplete (-> Int (Effect Unit [Declined] [Stripe.charge Audit.log])))
(define incomplete [n] (run-both charge log-event n))`);
    expect(missingSecond.details["code"]).toBe("mechanics/undeclared-error");
    expect(missingSecond.message).toContain("AuditDown");
  });

  test("rigid set variables cannot escape into closed or mismatched result sets", () => {
    const leakEmpty = expectFailure(`${effectPrelude}
(: leaky (-> (-> Int (Effect a [e] [r])) Int (Effect a [] [])))
(define leaky [f n] (f n))`);
    expect(leakEmpty.details["code"]).toBe("mechanics/undeclared-error");
    expect(leakEmpty.message).toBe(
      "Operation leaky can fail with the errors of e, but its signature declares no errors.",
    );

    const leakReq = expectFailure(`${effectPrelude}
(: leaky-req (-> (-> Int (Effect a [e] [r])) Int (Effect a [e] [])))
(define leaky-req [f n] (f n))`);
    expect(leakReq.details["code"]).toBe("mechanics/undeclared-requirement");
    expect(leakReq.message).toBe(
      "Operation leaky-req requires the requirements of r, but its signature declares no requirements.",
    );

    // Equal-length set mismatch (1 vs 1): rigid variable `e` must not unify with `AuditDown`.
    const leakSameLen = expectFailure(`${effectPrelude}
(: leaky-same-len (-> (-> Int (Effect a [e] [r])) Int (Effect a [AuditDown] [Audit.log])))
(define leaky-same-len [f n] (f n))`);
    expect(leakSameLen.details["code"]).toBe("mechanics/undeclared-error");
    expect(leakSameLen.message).toBe(
      "Operation leaky-same-len can fail with the errors of e, but its signature declares only [AuditDown].",
    );
  });

  test("nested polymorphic wrapper passes rigid variables through inner polymorphic call", () => {
    const ok = runInfer(`${effectPrelude}
(: double-audit (-> (-> Int (Effect a [e2] [r2])) Int (Effect a [e2 AuditDown] [r2 Audit.log])))
(define double-audit [g n] (with-audit g n))`);
    expect(ok._tag).toBe("Success");

    const escaped = expectFailure(`${effectPrelude}
(: bad-outer (-> (-> Int (Effect a [e2] [r2])) Int (Effect a [AuditDown] [Audit.log])))
(define bad-outer [g n] (with-audit g n))`);
    expect(escaped.details["code"]).toBe("mechanics/undeclared-error");
    expect(escaped.message).toContain("the errors of e2");
  });

  test("rejects unbound set variables with typo suggestions, kind conflicts, higher-rank positions, and service methods", () => {
    const unboundErr = expectFailure(`${effectPrelude}
(: unbound (-> Int (Effect Int [declined] [])))
(define unbound [n] (succeed n))`);
    expect(unboundErr.details["code"]).toBe("mechanics/unbound-set-variable");
    expect(unboundErr.message).toContain("Did you mean the error Declined?");

    const unboundSvc = expectFailure(`${effectPrelude}
(: unbound-svc (-> Int (Effect Int [] [audit])))
(define unbound-svc [n] (succeed n))`);
    expect(unboundSvc.details["code"]).toBe("mechanics/unbound-set-variable");
    expect(unboundSvc.message).toContain("Did you mean the service Audit?");

    const bothKinds = expectFailure(`${effectPrelude}
(: both-kinds (-> (-> Int (Effect a [e] [e])) Int (Effect a [e] [e])))
(define both-kinds [f n] (f n))`);
    expect(bothKinds.details["code"]).toBe("mechanics/set-variable-kind");
    expect(bothKinds.message).toContain("both an error set and a requirement set");

    const typeAndSet = expectFailure(`${effectPrelude}
(: type-and-set (-> (-> Int (Effect a [a] [r])) Int (Effect a [a] [r])))
(define type-and-set [f n] (f n))`);
    expect(typeAndSet.details["code"]).toBe("mechanics/set-variable-kind");
    expect(typeAndSet.message).toContain("as both a set variable and a type variable");

    const higherRank = expectFailure(`${effectPrelude}
(: inside (-> (-> (-> Int (Effect a [e] [])) Int) (Effect Int [] [])))
(define inside [f] (succeed 1))`);
    expect(higherRank.details["code"]).toBe("mechanics/set-variable-position");
    expect(higherRank.message).toContain("higher-rank");

    const serviceMethod = expectFailure(`(service Bad (: run (-> Int (Effect Unit [e] []))))`);
    expect(serviceMethod.details["code"]).toBe("mechanics/set-variable-position");
  });

  test("inferSourceAll also supports effect-polymorphic wrappers", () => {
    const result = Effect.runSync(
      inferSourceAll(`${effectPrelude}
(: charged (-> Int (Effect String [Declined AuditDown] [Stripe.charge Audit.log])))
(define charged [n] (with-audit charge n))
(: free (-> Int (Effect String [AuditDown] [Audit.log])))
(define free [n] (with-audit lookup-cached n))`),
    );
    expect(result.types.length).toBeGreaterThan(0);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("preserves existing HM effect-row (ERow) polymorphism and helpers", () => {
    const inferred = Effect.runSync(inferSourceStr("(fn [f x] (f (f x)))"));
    expect(inferred).toMatch(/-\{e\d+\}->/);

    const row = buildERow(new Set(["io", "net"]), EVar("e0"));
    expect(showERow(row)).toBe("io, net | e0");
    const flat = flattenERow(row);
    expect([...flat.labels].sort()).toEqual(["io", "net"]);
    expect(flat.tail).toEqual(EVar("e0"));

    expect(showERow(EExtend("fs", EEmpty))).toBe("fs");
    expect(TApp(TCon("Effect"), [TCon("Int"), TApp(TCon("ErrorSet"), []), TApp(TCon("RequirementSet"), [])])._tag).toBe("TApp");
  });
});
