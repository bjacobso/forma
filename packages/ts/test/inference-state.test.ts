import { describe, expect, test } from "vitest";
import { Effect, Ref } from "effect";
import * as Engine from "../src/Engine.js";
import { InferContext, makeInferContext, makeOwnedInferContext } from "../src/type/context.js";
import { inferExpr } from "../src/type/infer.js";
import { inferSource, inferSourceAll } from "../src/type/index.js";
import { analyzeLsp } from "../src/lsp/hm-lsp.js";
import { applyEnv, applyScheme, type Subst } from "../src/type/substitution.js";
import { unify, unifyRows, unifyERows } from "../src/type/unify.js";
import {
  Constraint, EEmpty, EExtend, EVar, REmpty, RExtend, RVar, Scheme,
  TCon, TFun, TRow, TVar, mono, showType, tBool, tStr,
  type Type, type Row, type ERow,
} from "../src/type/types.js";
import { CApp, CIf, CLit, CVar, LBool, LInt } from "../src/type/core-expr.js";

describe("scheme substitution ownership and quantifiers", () => {
  test("excludes every quantified key, including keys after an absent quantifier", () => {
    const s: Subst = {
      tvars: new Map<string, Type>([["a", tBool], ["b", tStr]]),
      rvars: new Map<string, Row>([["r", REmpty], ["s", REmpty]]),
      evars: new Map<string, ERow>([["e", EEmpty], ["f", EEmpty]]),
    };
    const type = TFun(
      TRow(RExtend("value", TVar("a"), RVar("r"))),
      TFun(TRow(RExtend("value", TVar("b"), RVar("s"))), TVar("a"), EVar("f")),
      EVar("e"),
    );
    const scheme = Scheme(["absent", "a", "b"], ["absent", "r", "s"], type, ["absent", "e", "f"]);
    expect(applyScheme(s, scheme)).toEqual(scheme);
    expect(applyScheme(s, mono(type)).type).toEqual(TFun(
      TRow(RExtend("value", tBool, REmpty)),
      TFun(TRow(RExtend("value", tStr, REmpty)), tBool, EEmpty),
      EEmpty,
    ));
  });

  // The same names deliberately occur in all three namespaces.
  test.each(Array.from({ length: 8 }, (_, bits) => [
    !!(bits & 1), !!(bits & 2), !!(bits & 4),
  ] as const))("type=%s row=%s effect=%s intersection", (bindType, bindRow, bindEffect) => {
    const s: Subst = {
      tvars: new Map<string, Type>([
        ["bound", tBool], ["free", TVar("bound")], ["alias", TCon("Int")],
      ]),
      rvars: new Map<string, Row>([
        ["bound", RExtend("end", tStr, REmpty)],
        ["free", RExtend("extra", TVar("alias"), RVar("bound"))],
      ]),
      evars: new Map<string, ERow>([
        ["bound", EEmpty], ["free", EExtend("IO", EVar("bound"))],
        ["alias", EVar("free")],
      ]),
    };
    const before = [new Map(s.tvars), new Map(s.rvars), new Map(s.evars)];
    const constraints = [Constraint("Eq", [TVar("bound"), TVar("free")])];
    const scheme = Scheme(
      [bindType ? "bound" : "absent"],
      [bindRow ? "bound" : "absent"],
      TFun(
        TRow(RExtend("value", TVar("bound"), RVar("bound"))),
        TFun(TRow(RExtend("value", TVar("free"), RVar("free"))), TVar("alias"), EVar("alias")),
        EVar("bound"),
        TVar("free"),
      ),
      [bindEffect ? "bound" : "absent"],
      constraints,
    );
    const boundType = bindType ? TVar("bound") : tBool;
    const boundRow = bindRow ? RVar("bound") : RExtend("end", tStr, REmpty);
    const boundEffect = bindEffect ? EVar("bound") : EEmpty;
    const result = applyScheme(s, scheme);
    expect(result.type).toEqual(TFun(
      TRow(RExtend("value", boundType, boundRow)),
      TFun(
        TRow(RExtend("value", boundType, RExtend("extra", TCon("Int"), boundRow))),
        TCon("Int"), EExtend("IO", boundEffect),
      ),
      boundEffect, boundType,
    ));
    expect(result.constraints).toBe(constraints);
    expect(result.tvars).toBe(scheme.tvars);
    expect(result.rvars).toBe(scheme.rvars);
    expect(result.evars).toBe(scheme.evars);
    expect([s.tvars, s.rvars, s.evars]).toEqual(before);

    // A following monomorphic binding must still see the excluded entries.
    const env = new Map([["polymorphic", scheme], ["monomorphic", mono(scheme.type)]]);
    const applied = applyEnv(s, env);
    expect(applied.get("polymorphic")).toEqual(result);
    expect(applied.get("monomorphic")).toEqual(applyScheme(s, mono(scheme.type)));
    expect(applied.get("monomorphic")?.type).toEqual(TFun(
      TRow(RExtend("value", tBool, RExtend("end", tStr, REmpty))),
      TFun(
        TRow(RExtend("value", tBool, RExtend("extra", TCon("Int"), RExtend("end", tStr, REmpty)))),
        TCon("Int"), EExtend("IO", EEmpty),
      ),
      EEmpty, tBool,
    ));
    expect(env.get("polymorphic")).toBe(scheme);
    expect([s.tvars, s.rvars, s.evars]).toEqual(before);
  });

  test("polymorphic functions and open records stay independent at different uses", () => {
    const result = Engine.typecheck({ source: `
      (define identity [x] x)
      (define field [r] r.value)
      (identity (field {:value 1 :extra true}))
      (identity (field {:value "text" :other 2}))
    `, sourceId: "polymorphic", result: "per-expression" });
    expect(result.diagnostics).toEqual([]);
    expect(result.expressionTypes?.slice(-2).map(t => t.display)).toEqual(["Int", "String"]);
  });
});

describe("inference annotations", () => {
  test("owned annotations do not change substitution snapshot or rollback behavior", () => {
    Effect.runSync(Effect.gen(function* () {
      const ctx = yield* makeOwnedInferContext();
      const before = yield* Ref.get(ctx.subst);
      const origin = { nodeId: "binding", kind: "test", span: { start: 0, end: 1 } };
      const bind = Effect.gen(function* () {
        yield* unify(TVar("a"), tBool, origin);
        yield* unifyRows(RVar("r"), RExtend("value", tStr, REmpty), origin);
        yield* unifyERows(EVar("e"), EExtend("IO", EEmpty), origin);
      });
      yield* Effect.provideService(bind, InferContext, ctx);
      yield* ctx.recordType("before-rollback", TFun(TVar("a"), TRow(RVar("r")), EVar("e")));
      expect([before.tvars.size, before.rvars.size, before.evars.size]).toEqual([0, 0, 0]);
      yield* Ref.set(ctx.subst, before);
      yield* ctx.recordType("after-rollback", TVar("a"));
      const annotations = yield* Ref.get(ctx.nodeTypes);
      expect(annotations.get("before-rollback")).toEqual(TFun(tBool, TRow(RExtend("value", tStr, REmpty)), EExtend("IO", EEmpty)));
      expect(annotations.get("after-rollback")).toEqual(TVar("a"));
    }));
  });

  test("public context reads remain snapshots, including overwritten node IDs", () => {
    Effect.runSync(Effect.gen(function* () {
      const ctx = yield* makeInferContext();
      const empty = yield* Ref.get(ctx.nodeTypes);
      yield* ctx.recordType("first", tBool);
      const first = yield* Ref.get(ctx.nodeTypes);
      yield* ctx.recordType("first", tStr);
      yield* ctx.recordType("second", TCon("Int"));
      expect(empty.size).toBe(0);
      expect(first).toEqual(new Map([["first", tBool]]));
      expect(yield* Ref.get(ctx.nodeTypes)).toEqual(new Map([["first", tStr], ["second", TCon("Int")]]));
    }));
  });

  test.each([makeInferContext, makeOwnedInferContext])("recordType recursively resolves type, row and effect substitutions", makeContext => {
    Effect.runSync(Effect.gen(function* () {
      const ctx = yield* makeContext();
      yield* Ref.set(ctx.subst, {
        tvars: new Map<string, Type>([["a", TVar("b")], ["b", TCon("Int")]]),
        rvars: new Map([["r", RExtend("value", TVar("a"), REmpty)]]),
        evars: new Map([["e", EExtend("IO", EEmpty)]]),
      });
      yield* ctx.recordType("resolved", TFun(TVar("a"), TRow(RVar("r")), EVar("e")));
      expect((yield* Ref.get(ctx.nodeTypes)).get("resolved")).toEqual(
        TFun(TCon("Int"), TRow(RExtend("value", TCon("Int"), REmpty)), EExtend("IO", EEmpty)),
      );
    }));
  });

  test.each([makeInferContext, makeOwnedInferContext])("numeric calls and both conditional branches retain complete annotations", makeContext => {
    Effect.runSync(Effect.gen(function* () {
      const ctx = yield* makeContext();
      const span = { start: 0, end: 1 };
      const condition = CLit(span, LBool(true));
      const fn = CVar(span, "+");
      const left = CLit(span, LInt(1));
      const right = CLit(span, LInt(2));
      const call = CApp(span, fn, [left, right]);
      const other = CLit(span, LInt(3));
      const root = CIf(span, condition, call, other);
      const result = yield* Effect.provideService(inferExpr(new Map(), root), InferContext, ctx);
      expect(showType(result)).toBe("Int");
      const annotations = yield* Ref.get(ctx.nodeTypes);
      expect([...annotations.keys()].sort()).toEqual([condition, left, right, call, other, root].map(n => n.id).sort());
      expect(annotations.has(fn.id)).toBe(false);
      for (const node of [left, right, call, other, root]) expect(showType(annotations.get(node.id)!)).toBe("Int");
      expect(showType(annotations.get(condition.id)!)).toBe("Bool");
    }));
  });

  test.each([makeInferContext, makeOwnedInferContext])("distinct contexts own distinct annotation maps", makeContext => {
    const operation = makeContext();
    const first = Effect.runSync(operation);
    const second = Effect.runSync(operation);
    Effect.runSync(first.recordType("same-id", tBool));
    Effect.runSync(second.recordType("same-id", tStr));
    const firstMap = Effect.runSync(Ref.get(first.nodeTypes));
    const secondMap = Effect.runSync(Ref.get(second.nodeTypes));
    expect(firstMap).toEqual(new Map([["same-id", tBool]]));
    expect(secondMap).toEqual(new Map([["same-id", tStr]]));
    secondMap.clear();
    expect(firstMap).toEqual(new Map([["same-id", tBool]]));
  });

  test.each([
    (source: string) => Effect.map(inferSource(source), r => r.nodeTypes),
    (source: string) => Effect.map(inferSourceAll(source), r => r.nodeTypes),
  ])("source results stay stable across reruns and failures", infer => {
    const operation = infer('(if true (+ 1 2) 3)');
    const first = Effect.runSync(operation);
    const before = new Map(first);
    // Numeric builtin calls annotate their arguments and result, not the head.
    expect(first.size).toBe(6);
    expect(() => Effect.runSync(infer('(+ 1 "bad")'))).toThrow();
    const second = Effect.runSync(operation);
    expect(second).toEqual(before);
    expect(second).not.toBe(first);
    const third = Effect.runSync(infer('"text"'));
    expect([...third.values()].map(showType)).toEqual(["String"]);
    second.clear();
    expect(first).toEqual(before);
    expect(Effect.runSync(operation)).toEqual(before);
  });

  test("a failed public check retains provenance and does not leak state into recovery", () => {
    const failed = Engine.typecheck({ source: '(define field [r] r.value)\n(+ 1 "bad")', sourceId: "failed.forma" });
    expect(failed.diagnostics).toHaveLength(1);
    expect(failed.diagnostics[0]?.span).toMatchObject({ sourceId: "failed.forma", startOffset: 27, endOffset: 38 });
    const fresh = Engine.typecheck({ source: "field", sourceId: "fresh.forma" });
    expect(fresh.diagnostics).toHaveLength(1);
    expect(fresh.diagnostics[0]?.span?.sourceId).toBe("fresh.forma");
    expect(Engine.typecheck({ source: '(define field [x] x) (field "ok")' }).display).toBe("String");
  });

  test("LSP annotations and diagnostics stay isolated after failed analysis", () => {
    const before = Effect.runSync(analyzeLsp('(if true (+ 1 2) 3)'));
    expect(before.success).toBe(true);
    expect(before.typedSpans).toHaveLength(6);
    expect(before.typedSpans.filter(s => s.exprTag === "App").map(s => s.typeString)).toEqual(["Int"]);
    const failed = Effect.runSync(analyzeLsp('(+ 1 "bad")'));
    expect(failed.success).toBe(false);
    expect(failed.typedSpans).toEqual([]);
    const after = Effect.runSync(analyzeLsp('"ok"'));
    expect(after.typedSpans.map(s => s.typeString)).toEqual(["String"]);
    expect(before.typedSpans).toHaveLength(6);
  });
});
