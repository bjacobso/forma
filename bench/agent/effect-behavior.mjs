import assert from "node:assert/strict";
import ts from "typescript";
import { Effect } from "effect";
import { generateMechanicsEffectTypeScriptModule } from "@formalang/ts/mechanics";

// Compile the checked declarations returned by the CLI, then exercise real
// Effect programs with in-memory services. No authored text is inspected.
export async function checkoutBehavior(declarations) {
  const generated = generateMechanicsEffectTypeScriptModule(declarations);
  const js = ts.transpileModule(generated.code, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText.replaceAll('from "effect"', `from ${JSON.stringify(import.meta.resolve("effect"))}`);
  const module = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const exported = prefix => {
    const matches = Object.entries(module).filter(([name]) => name === prefix || name.startsWith(`${prefix}Forma`) || name.startsWith(`${prefix}__forma_`));
    assert.equal(matches.length, 1, `generated export ${prefix}`);
    return matches[0][1];
  };
  const checkout = exported("checkout");
  const retryFree = exported("retryFree");
  const preview = exported("preview");
  const Payments = exported("Payments");
  const Audit = exported("Audit");
  const Declined = exported("Declined");
  assert.deepEqual(preview("zero", -1), {id: "zero", total: 0});
  assert.deepEqual(preview("positive", 5), {id: "positive", total: 5});
  const calls = [];
  const run = (effect, decline = false) => Effect.runPromise(effect.pipe(
    Effect.provideService(Payments, {charge: (id, total) => {
      calls.push(["charge", id, total]);
      return decline ? Effect.fail(new Declined({id})) : Effect.succeed({id: `${id}-receipt`, total});
    }}),
    Effect.provideService(Audit, {record: id => { calls.push(["audit", id]); return Effect.void; }}),
  ));
  assert.deepEqual(await run(checkout("ok", 120)), {id: "ok-receipt", total: 120});
  assert.deepEqual(calls.splice(0), [["charge", "ok", 120], ["audit", "ok-receipt"]]);
  await assert.rejects(run(checkout("negative", -1)));
  assert.deepEqual(calls.splice(0), []);
  assert.deepEqual(await run(retryFree("denied", 5), true), {id: "declined", total: 0});
  assert.deepEqual(calls.splice(0), [["charge", "denied", 5]]);
  assert.deepEqual(await run(retryFree("accepted", 0)), {id: "accepted-receipt", total: 0});
  assert.deepEqual(calls, [["charge", "accepted", 0], ["audit", "accepted-receipt"]]);
}
