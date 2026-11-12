import assert from "node:assert/strict";
import test from "node:test";
import { openLanguage } from "./index.mjs";

test("checks forms and runs only granted capabilities", async () => {
  const calls = [];
  const lang = await openLanguage(value => calls.push(value));
  try {
    assert.equal((await lang.check('(notify "Hello")')).ok, true);
    assert.deepEqual(calls, []);
    const result = await lang.run('(notify "Hello")');
    assert.equal(result.ok, true);
    assert.equal(result.value, "Hello");
    assert.deepEqual(calls, ["Hello"]);
    assert.equal((await lang.run('(ungranted "Hello")')).ok, false);
    assert.equal((await lang.run('(notify "Blocked") (+ 1 true)')).ok, false);
    assert.equal((await lang.emit('(greeting welcome "Hello")')).ok, true);
    const invalid = await lang.emit('(greeting welcome "")');
    assert.equal(invalid.ok, false);
    assert(invalid.diagnostics.some(d => d.code === "greeting/empty"));
    assert.deepEqual(calls, ["Hello"]);
    assert.equal(lang.describe().forms[0].name, "greeting");
  } finally { await lang.close(); }
});
