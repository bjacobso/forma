import assert from "node:assert/strict";
import { reversed, root, appended, concatenated, collected, quotient } from "./expected.js";

export default async function check(): Promise<void> {
  const xs = [3, 1, 2];
  assert.deepEqual(reversed(xs), [2, 1, 3]);
  assert.deepEqual(xs, [3, 1, 2]);
  assert.deepEqual(reversed([]), []);
  assert.equal(root(9), 3);
  assert.equal(root(2.25), 1.5);
  assert.deepEqual(appended([3, 1], 2), [3, 1, 2]);
  assert.deepEqual(appended([], 2), [2]);
  assert.deepEqual(concatenated([3, 1], [2, 4]), [3, 1, 2, 4]);
  assert.deepEqual(concatenated([], xs), xs);
  assert.deepEqual(concatenated(xs, []), xs);
  assert.deepEqual(collected([], xs), xs);
  assert.deepEqual(collected([7], []), [7]);
  assert.equal(quotient(-7, 3), -2);
  assert.equal(quotient(7, -3), -2);
  assert.equal(quotient(-7, -3), 2);
  assert.throws(() => quotient(1, 0), /safe integer|nonzero/);
}
