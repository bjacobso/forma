import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
const cli = './node_modules/.bin/forma';
function forma(...args) {
  const result = spawnSync(cli, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}
const tests = forma('run', 'src/policy-test.lisp', '--json');
assert.equal(tests.status, 0, tests.stderr || tests.stdout);
assert.equal(JSON.parse(tests.stdout).value.result.printed, '[]');
const declarations = forma('file', 'declarations', 'src/expenses-valid.lisp');
assert.equal(declarations.status, 0, declarations.stdout);
const expenses = JSON.parse(declarations.stdout).value.filter(d => d.summary?.kind === 'FormApplication');
assert.equal(expenses.length, 6);
assert.equal(expenses.find(d => d.summary.name === 'laptop').payload.amount, 250001);
const rejected = forma('check', 'src/expenses.lisp', '--json');
assert.equal(rejected.status, 1);
const diagnostics = JSON.parse(rejected.stdout).diagnostics;
assert.deepEqual(diagnostics.map(d => d.code), [
  'expense/vendor-required', 'expense/asset-required', 'expense/self-approval', 'expense/self-approval',
]);
assert.deepEqual(diagnostics.map(d => d.span.startLine), [4, 5, 6, 7]);
const mutationPath = 'src/policy-test-mutated.lisp';
try {
  const source = readFileSync('src/policy-test.lisp', 'utf8');
  const mutated = source.replace('(sample 7500 "meals")) [])', '(sample 7500 "meals")) manager-only)');
  assert.notEqual(mutated, source);
  writeFileSync(mutationPath, mutated);
  const result = forma('run', mutationPath, '--json');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).value.result.printed, '["meal at threshold"]');
} finally {
  unlinkSync(mutationPath);
}
console.log('Verified: 20 policy cases; mutation detected; six IR records; four located rejections.');
