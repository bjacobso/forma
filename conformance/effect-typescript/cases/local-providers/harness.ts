import assert from "node:assert/strict";
import { Effect, Layer } from "effect";
import { Audit, auditedWrites, forwardReads, layered, lookup, NotFound, recordedWrites, stacked, Store } from "./expected.js";

export default async function check(): Promise<void> {
  // A recorder provided inline captures every set; nothing else is needed to run.
  assert.deepEqual(await Effect.runPromise(recordedWrites("Ada")), ["Ada"]);

  // Methods close over local values, and an inner provide overrides an outer one.
  assert.deepEqual(await Effect.runPromise(layered("outer")), ["outer a", "inner b"]);

  // A typed failure raised by an inline method reaches the caller's catch.
  assert.equal(await Effect.runPromise(lookup("color")), "missing color");

  const audit: string[] = [];
  const reads: string[] = [];
  const AuditLive = Layer.succeed(Audit, Audit.of({ record: (entry) => Effect.sync(() => { audit.push(entry); }) }));
  const StoreLive = Layer.succeed(Store, Store.of({
    get: (key) => Effect.sync(() => {
      reads.push(key);
      return `outer ${key}`;
    }),
    set: () => Effect.die("the outer set must not be called"),
  }));

  // :delegate forwards get to the outer Store; the defined set uses another service.
  const forwarded = await Effect.runPromise(Effect.provide(forwardReads("Ada"), Layer.merge(AuditLive, StoreLive)));
  assert.equal(forwarded, "outer user");
  assert.deepEqual(reads, ["user"]);
  assert.deepEqual(audit.splice(0), ["user=Ada"]);

  // An operation called from an inline method runs with the context captured when the layer is built.
  assert.equal(await Effect.runPromise(Effect.provide(auditedWrites("Grace"), AuditLive)), "Grace");
  assert.deepEqual(audit.splice(0), ["audited user=Grace"]);

  // Several layers in one provide: the later Audit serves the Store before it.
  assert.deepEqual(await Effect.runPromise(stacked("Ada")), ["user=Ada"]);

  // The outer Store is not consulted for members the inline layer defines.
  const failing = Layer.succeed(Store, Store.of({
    get: (key) => Effect.fail(new NotFound({ key })),
    set: () => Effect.die("unused"),
  }));
  assert.deepEqual(await Effect.runPromise(Effect.provide(recordedWrites("Lin"), failing)), ["Lin"]);
}
