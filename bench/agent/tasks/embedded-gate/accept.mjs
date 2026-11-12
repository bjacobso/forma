import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createLanguage } from "../../../../packages/host/dist/language.mjs";
import { forma, detail } from "../../accept-support.mjs";
export async function accept(dir) {
 const reasons = [];
 const main = forma(dir, "evaluate", "main.lisp");
 if (!main.ok || main.value.result.printed !== '"manager"') reasons.push(`entry: ${detail(main)}`);
 let gate, low;
 try {
  const {openGate} = await import(pathToFileURL(join(dir, "gate.mjs")));
  const calls = [];
  let options;
  const factory = async config => { options = config; return createLanguage(config); };
  gate = await openGate(factory, {steps:10000, notify: async text => { calls.push(text); return `sent:${text}`; }});
  assert(options.modules?.length > 0 && !options.preludes?.length, "load isolated modules");
  assert(options.capabilities?.notify?.typeScheme, "typed capability required");
  assert.equal((await gate.check('(notify (message 250001))')).ok, true);
  assert.deepEqual(calls, []);
  const bad = await gate.run('(let [sent (notify "unsafe")] (+ 1 "bad"))');
  assert.equal(bad.ok, false);
  assert(bad.diagnostics.some(d => d.code === "typecheck/type-mismatch" && d.span?.startLine === 1));
  assert.deepEqual(calls, [], "reject before any host effects");
  const wrong = await gate.run('(notify 42)');
  assert.equal(wrong.ok, false);
  assert(wrong.diagnostics.some(d => d.code === "typecheck/type-mismatch" && d.span?.startLine === 1 && d.span?.startColumn === 9));
  const good = await gate.run('(notify (message 7501))');
  assert.equal(good.ok, true);
  assert.equal(good.value, "sent:manager");
  assert.deepEqual(calls, ["manager"]);
  assert.equal((await gate.run('(define local-only 1) local-only')).ok, true);
  assert.equal((await gate.check('local-only')).ok, false, "runs must not share definitions");
  await gate.close();
  await assert.rejects(async () => gate.check("1"), "close must release the facade");
  low = await openGate(createLanguage, {steps:1, notify: async x => x});
  const limited = await low.run('(message 300000)');
  assert.equal(limited.ok, false, "step budget must reach the evaluator");
  assert(limited.diagnostics.some(d => d.code === "StepLimitExceeded"));
 } catch (error) { reasons.push(`embedding: ${error.message}`); }
 finally { await gate?.close(); await low?.close(); }
 return {pass:reasons.length===0,reasons};
}
