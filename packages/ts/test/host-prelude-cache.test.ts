import { describe, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { Env } from "../src/Env.js";
import { defaultBuiltins } from "../src/builtins/index.js";
import { bootstrapFromSources } from "../src/descriptor/bootstrap.js";
import { elaborateProgram } from "../src/descriptor/elaborate.js";
import * as evaluator from "../src/evaluator/eval.js";
import { buildKernelExpansionEnv } from "../src/evaluator/frontend.js";
import { parse, toSExprMany } from "../src/reader/index.js";

describe("host prelude expansion caches", () => {
  test("fresh host builtins share the kernel prelude and still execute their own macros", () => {
    const first = { ...defaultBuiltins, "host/value": () => Effect.succeed(17) };
    const second = { ...defaultBuiltins, "host/value": () => Effect.succeed(29) };
    const shared = buildKernelExpansionEnv({ builtins: first });
    expect(buildKernelExpansionEnv({ builtins: second })).toBe(shared);
    const exprs = toSExprMany(parse('(macro (host-number) (host/value)) (unless false (host-number))').redTree);
    expect(Effect.runSync(evaluator.evaluateExprs(exprs, { builtins: first, stepLimit: 10_000 })).value).toBe(17);
    expect(Effect.runSync(evaluator.evaluateExprs(exprs, { builtins: second, stepLimit: 10_000 })).value).toBe(29);

    const explicit = Env.empty();
    expect(buildKernelExpansionEnv({ builtins: first, preludeEnv: explicit })).toBe(explicit);
    expect(buildKernelExpansionEnv({ builtins: first, env: explicit, includePrelude: false })).toBe(explicit);
    expect(buildKernelExpansionEnv({ includePrelude: false }).lookup("unless")).toBeUndefined();
  });

  test("a second elaboration reuses hook expansions with identical results and fresh hole values", () => {
    const source = `(type ProbeIR {:kind "Probe" :name Symbol :label String})
      (define label [n] (if (not (= n 0)) (str "value-" n) "zero"))
      (form (probe name number expression) :types {:name (Declares Probe) :number Int :expression (Expr Int)}
        :scope {:expression (fn [holes] {:local (quote Int) :size (quote (-> (List a) Int))})}
        :check (fn [{:keys [number]}]
          (if (> number 1) [{:severity :warning :code "probe/large" :message "large number" :slot :number}] []))
        :type (fn [holes] (quote Int))
        :ir ProbeIR {:kind "Probe" :name name :label (label number)})`;
    const prelude = bootstrapFromSources('', source);
    const program = '(probe one 1 (+ local (size ["x"]))) (probe two 2 (size [local]))';
    const expansion = vi.spyOn(evaluator, "expandExprs");
    try {
      const cold = elaborateProgram(program, { prelude, sourceId: 'cache.lisp' });
      expect(cold.ok).toBe(true);
      expect(cold.diagnostics.map(d => [d.code, d.severity])).toEqual([['probe/large', 'warning']]);
      expect(cold.declarations.map(d => d.payload)).toEqual([
        { kind: 'Probe', name: 'one', label: 'value-1' },
        { kind: 'Probe', name: 'two', label: 'value-2' },
      ]);
      const initialExpansions = expansion.mock.calls.length;
      expect(initialExpansions).toBeGreaterThan(0);
      expect(elaborateProgram(program, { prelude, sourceId: 'cache.lisp' })).toEqual(cold);
      expect(expansion).toHaveBeenCalledTimes(initialExpansions);

      const edited = elaborateProgram('(probe edited 0 local)', { prelude });
      expect(edited.diagnostics).toEqual([]);
      expect(edited.declarations[0]?.payload).toEqual({ kind: 'Probe', name: 'edited', label: 'zero' });
      expect(expansion).toHaveBeenCalledTimes(initialExpansions);

      const fresh = bootstrapFromSources('', source);
      expect(elaborateProgram(program, { prelude: fresh, sourceId: 'cache.lisp' })).toEqual(cold);
      expect(expansion.mock.calls.length).toBeGreaterThan(initialExpansions);
    } finally {
      expansion.mockRestore();
    }
  });
});
