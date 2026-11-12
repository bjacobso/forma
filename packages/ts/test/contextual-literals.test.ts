import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluate, typecheck } from "../src/Engine.js";
import { generateEffectProgram } from "../src/Mechanics.js";

describe("contextual literal checking", () => {
  it("contextualizes mechanics list literals on either side of a generic call", () => {
    const source = `(type Role (Union "manager" "finance"))
(: roles (List Role)) (define roles ["manager" "finance"])
(: select (-> a a a)) (define select [actual expected] actual)
(: forward (List Role)) (define forward (select roles ["manager" "finance"]))
(: backward (List Role)) (define backward (select ["manager" "finance"] roles))`;
    expect(generateEffectProgram(source).diagnostics).toEqual([]);
  });

  it("keeps mechanics Option schema fields optional and wraps field reads", () => {
    const source = `(type Details {:vendor (Option String) :asset-tag (Option String)})
(: valid? (-> Details Bool))
(define valid? [details] (match details.vendor (Some vendor) (= vendor "Acme") None false))
(: request Details) (define request {})
(: valid Bool) (define valid (valid? {:vendor "Acme"}))`;
    const generated = generateEffectProgram(source);
    expect(generated.diagnostics).toEqual([]);
    expect(generated.code).toContain("Option.fromUndefinedOr");
  });

  it.each(["generic-union-literals", "contextual-option-record"])("checks and runs %s", async name => {
    const source = readFileSync(new URL(`../../../conformance/check-run/seeds/${name}.lisp`, import.meta.url), "utf8");
    expect((await typecheck({ source })).diagnostics).toEqual([]);
    expect(await evaluate({ source })).toMatchObject({ diagnostics: [], value: [true, true] });
  });

  it.each([
    '(: d Details) (define d {:vendor "Acme"}) d',
    '(: {:vendor "Acme"} Details)',
    '(: make (-> Bool Details)) (define make [yes] (if yes {:vendor "Acme"} {})) (make true)',
    '(: ds (List Details)) (define ds [{:vendor "Acme"}]) (first ds)',
  ])("normalizes known record literals: %s", async expression => {
    const source = `(type Details {:vendor (Option String) :asset-tag (Option String)}) ${expression}`;
    expect((await typecheck({ source })).diagnostics).toEqual([]);
    const result = await evaluate({ source });
    expect(result.diagnostics).toEqual([]);
    expect(result.printed).toContain(':asset-tag');
    expect(result.printed).toContain('Some');
  });

  it("checks keyword list members through a generic parameter", async () => {
    const source = `(type Role (Union :manager :finance))
(: roles (List Role)) (define roles [:manager :finance])
(: same? (-> a a Bool)) (define same? [a b] (= a b))
(same? roles [:manager :finance])`;
    expect((await typecheck({ source })).diagnostics).toEqual([]);
  });

  it.each(['["intruder"]', '(let [role "manager"] [role])'])("rejects a nonmember or widened String: %s", async actual => {
    const source = `(type Role (Union "manager" "finance"))
(: roles (List Role)) (define roles ["manager"])
(: same? (-> a a Bool)) (define same? [a b] (= a b))
(same? roles ${actual})`;
    expect((await typecheck({ source })).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", code: "typecheck/type-mismatch" }),
    ]));
  });
});
