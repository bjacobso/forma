import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLanguage } from '@forma-language/forma';

const policy = await readFile(new URL('./src/policy.lisp', import.meta.url), 'utf8');
// The facade loads a legacy prelude, not a file module; omit only its export list.
const prelude = policy.replace(/^\(export [^\n]*\)\s*$/m, '');
assert.notEqual(prelude, policy, 'expected the policy module export list');
const source = await readFile(new URL('./src/agent.lisp', import.meta.url), 'utf8');
const notifications = [];
const lang = await createLanguage({
  preludes: [{ id: 'policy.lisp', source: prelude }],
  capabilities: {
    notify: {
      arity: 1,
      handler: async (message) => {
        notifications.push(message);
        return { ok: true, value: `Notified: ${message}` };
      },
    },
  },
});
try {
  const checked = await lang.check(source, { sourceId: 'agent.lisp' });
  assert.equal(checked.ok, true, JSON.stringify(checked.diagnostics));
  assert.equal(notifications.length, 0, 'checking must not call capabilities');
  console.log('check:', JSON.stringify(checked));
  const result = await lang.run(source, {
    sourceId: 'agent.lisp', limits: { steps: 100_000, timeoutMs: 2_000 },
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(notifications, ['Expense needs 2 approvals.']);
  assert.equal(result.value, 'Notified: Expense needs 2 approvals.');
  console.log('run:', JSON.stringify(result));
  const rejected = await lang.run('(do (notify "must not execute") (ungranted "x"))');
  assert.equal(rejected.ok, false);
  assert.equal(notifications.length, 1, 'failed checking must prevent capability calls');
  console.log('ungranted capability rejected:', JSON.stringify(rejected.diagnostics));
} finally {
  await lang.close();
}
