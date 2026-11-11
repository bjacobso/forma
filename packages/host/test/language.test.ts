import { describe, expect, it, vi } from "vitest";
import { createLanguage, type LanguageJson } from "../src/index.js";

const prelude = `(type ItemIR {:kind "Item" :id String :value String})
(form (item id value {:keys [doc]})
  :types {:id (Declares Item String) :value String :doc (Option String)}
  :ir ItemIR {:kind "Item" :id id :value value})`;

describe("experimental embedding facade", () => {
  it("checks without evaluating and refuses to run a failed check", async () => {
    const handler = vi.fn(() => ({ ok: true as const, value: 1 }));
    const lang = await createLanguage({ capabilities: { touch: { arity: 0, handler } } });
    try {
      expect(await lang.check("(touch)")).toMatchObject({ ok: true });
      const source = '(touch) (if true 1 "bad")';
      const checked = await lang.check(source, { sourceId: "main.lisp" });
      expect(checked).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ severity: "error", span: expect.objectContaining({ sourceId: "main.lisp" }) })] });
      expect(await lang.run(source)).toMatchObject({ ok: false });
      expect(handler).not.toHaveBeenCalled();
    } finally { await lang.close(); }
  });

  it("returns a pure value, printed representation and checked type", async () => {
    const lang = await createLanguage();
    try {
      expect(await lang.run("(+ 20 22)")).toMatchObject({ ok: true, value: 42, printed: "42", type: { display: "Int" }, diagnostics: [] });
    } finally { await lang.close(); }
  });

  it("drives repeated capabilities with plain JSON arguments and results", async () => {
    const handler = vi.fn(async (value: unknown) => ({ ok: true as const, value: value as LanguageJson }));
    const lang = await createLanguage({ capabilities: { echo: { arity: 1, handler } } });
    try {
      expect(await lang.run('(echo (echo {"name" "Ada" "scores" [1 2]}))')).toMatchObject({ ok: true, value: { name: "Ada", scores: [1, 2] } });
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith({ name: "Ada", scores: [1, 2] });
    } finally { await lang.close(); }
  });

  it("reports an ungranted capability as a diagnostic", async () => {
    const lang = await createLanguage();
    try {
      expect(await lang.run('(lookup-vendor "Acme")')).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: expect.any(String), severity: "error" })] });
    } finally { await lang.close(); }
  });

  it("reports explicit handler failures and catches thrown exceptions", async () => {
    const lang = await createLanguage({ capabilities: {
      denied: { arity: 0, handler: () => ({ ok: false, diagnostics: [{ code: "host-effect/failed", severity: "error", message: "Vendor unavailable" }] }) },
      broken: { arity: 0, handler: () => { throw new Error("private implementation detail"); } },
    } });
    try {
      expect(await lang.run("(denied)")).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "host-effect/failed", message: "Vendor unavailable" })] });
      expect(await lang.run("(broken)")).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "host-effect/failed" })] });
    } finally { await lang.close(); }
  });

  it("enforces the engine step limit", async () => {
    const lang = await createLanguage();
    try {
      expect(await lang.run("(+ 1 (+ 2 3))", { limits: { steps: 1 } })).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ severity: "error" })] });
    } finally { await lang.close(); }
  });

  it("aborts a suspended evaluation without waiting for its handler", async () => {
    const lang = await createLanguage({ capabilities: { wait: { arity: 0, handler: () => new Promise(() => {}) } } });
    try {
      expect(await lang.run("(wait)", { limits: { timeoutMs: 10 } })).toMatchObject({ ok: false, diagnostics: [{ code: "evaluation/aborted" }] });
      expect(await lang.run("42")).toMatchObject({ ok: true, value: 42 });
    } finally { await lang.close(); }
  });

  it("rejects invalid host values as diagnostics", async () => {
    const lang = await createLanguage({ capabilities: {
      invalid: { arity: 0, handler: () => ({ ok: true, value: NaN }) },
      empty: { arity: 0, handler: () => ({ ok: false, diagnostics: [] }) },
    } });
    try {
      for (const source of ["(invalid)", "(empty)"]) {
        expect(await lang.run(source)).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: "host-effect/failed" })] });
      }
    } finally { await lang.close(); }
  });

  it("exposes prelude initialization diagnostics", async () => {
    await expect(createLanguage({ preludes: [{ id: "bad.lisp", source: '(define bad (if true 1 "bad"))' }] })).rejects.toMatchObject({
      name: "LanguageInitializationError", diagnostics: [expect.objectContaining({ severity: "error" })],
    });
  });

  it("rejects invalid deadlines and closes idempotently", async () => {
    const lang = await createLanguage();
    try {
      await expect(lang.run("42", { limits: { timeoutMs: NaN } })).rejects.toThrow(RangeError);
    } finally { await lang.close(); }
    await lang.close();
    await expect(lang.check("42")).rejects.toThrow("closed");
  });

  it("loads prelude bindings, describes forms, and emits their canonical IR", async () => {
    const lang = await createLanguage({ preludes: [{ id: "items.lisp", source: prelude + "\n(define answer 42)" }] });
    try {
      expect(await lang.run("answer")).toMatchObject({ ok: true, value: 42, type: { display: "Int" } });
      expect(lang.describe()).toMatchObject({ forms: [{ name: "item", slots: [expect.objectContaining({ name: "value" }), expect.objectContaining({ name: "doc" })] }] });
      expect(await lang.emit('(item "first" "value")', { sourceId: "main.lisp" })).toMatchObject({ ok: true, artifacts: [{ content: { declarationCount: 1, declarations: [expect.objectContaining({ payload: { kind: "Item", id: "first", value: "value" } })] } }] });
    } finally { await lang.close(); }
  });
});
