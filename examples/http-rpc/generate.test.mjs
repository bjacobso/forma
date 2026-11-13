import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compile } from "./generate.mjs";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
test("bad HTTP links and malformed RPC contracts do not generate", () => {
  assert.throws(() => compile(undefined, read("http.lisp").replace("(handler reserve-seats reserve)", "(handler reserve-seats lookup)")), /handler-request/);
  assert.throws(() => compile(undefined, undefined, read("rpc.lisp").replace(/\(rpc-group[\s\S]*/, '(rpc-group WorkshopRpc (rpc "Bad" :payload Reserve))')), /success/);
  assert.throws(() => compile(undefined, undefined, read("rpc.lisp").replace('"ReserveSeats"', '"GetWorkshop"')), /Duplicate RPC/);
});
