import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { generateEffectSystem, rpcExtension } from "../src/EffectSystem.js";

const bank = readFileSync(resolve(import.meta.dirname, "../../../conformance/effect-typescript/cases/effect-system-bank/program.lisp"), "utf8");

describe("Effect system linker", () => {
  test("describes services, operations, and every library's declarations in one graph", () => {
    const linked = generateEffectSystem(bank);
    expect(linked.diagnostics).toEqual([]);
    const edges = new Set(linked.system!.edges.map(e => `${e.from} ${e.kind} ${e.to}`));
    // Relations that cross libraries: the HTTP endpoint and the RPC share the
    // domain error, the endpoint's handler requires the Ledger service, and
    // each entity message is implemented by its own generated transition.
    for (const edge of [
      "endpoint:Bank/accounts/get-balance handled-by operation:lookup",
      "operation:lookup requires service:Ledger",
      "operation:lookup raises error:AccountNotFound",
      "rpc:LedgerRpc/GetBalance raises error:AccountNotFound",
      "endpoint:Bank/accounts/get-balance raises error:AccountNotFound",
      "rpc:LedgerRpc/GetBalance uses schema:Balance",
      "entity:Account contains message:Account/Deposit",
      "entity:Account state schema:AccountState",
      "message:Account/Deposit implemented-by operation:accountDeposit",
      "message:Account/Deposit uses schema:Deposit",
    ]) expect(edges).toContain(edge);
    const nodes = new Map(linked.system!.nodes.map(n => [n.id, n]));
    expect(nodes.get("message:Account/Deposit")?.data).toMatchObject({ kind: "command", delivery: "persisted", dedupeBy: "key" });
    expect(nodes.get("operation:lookup")?.data).toEqual({ capabilities: ["Ledger.find"] });
    // Every edge joins nodes that exist.
    for (const e of linked.system!.edges) expect(nodes.has(e.from) && nodes.has(e.to)).toBe(true);
  });

  test("rejects two libraries deriving the same export", () => {
    // Declared names differ; the HTTP group layer and the entity layer are
    // both derived as ShopUsersLive.
    const linked = generateEffectSystem(`
(: health (-> {} (Effect String)))
(define health [request] "ok")
(api Shop (group users (endpoint health :get "/health" :success String)))
(handle Shop users (handler health health))
(entity ShopUsers :state {:n Int} :initial {:n 0} :storage :memory :accept-state-loss true
  (query Count :success Int :reply state.n))`);
    expect(linked.ok).toBe(false);
    expect(linked.code).toBeUndefined();
    expect(linked.diagnostics.map(d => [d.code, d.message, d.span?.startLine])).toEqual([
      ["cluster/name-collision", "Generated name ShopUsersLive is already in use.", 6],
    ]);
  });

  test("accepts only the forms of the selected libraries", () => {
    const linked = generateEffectSystem(`(entity Account :state {:n Int} :initial {:n 0} (query N :success Int :reply state.n))`,
      { extensions: [rpcExtension] });
    expect(linked.ok).toBe(false);
    expect(linked.diagnostics.map(d => [d.code, d.message])).toEqual([["elaborate/unknown-form", "Unknown form 'entity'"]]);
  });
});
