import assert from "node:assert/strict";
import { Runtime } from "foldkit";
import { PureCounter, init, update } from "./expected.js";

export const mount = (container: HTMLElement) => Runtime.makeElement({ ...PureCounter, container });

export default async function check(): Promise<void> {
  const initial = init();
  assert.deepEqual(initial, { model: { count: 0 }, commands: [] });
  const bumped = update(initial.model, { _tag: "Bump" });
  assert.deepEqual(bumped, { model: { count: 1 }, commands: [] });
  assert.deepEqual(update(bumped.model, { _tag: "Reset" }), initial);
  assert.deepEqual(update(initial.model, { _tag: "Reset" }), initial);
}
