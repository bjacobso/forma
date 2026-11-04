// The effect-go benchmark workloads on Effect-TS (effect@4.0.3, the
// version Forma generates against), for comparison in RFC 0023.
//
//   node prototypes/effect-go/bench/effect-ts.mjs
import { Data, Effect, Fiber } from "effect";

const steps = 1000;

class NotFound extends Data.TaggedError("NotFound") {}

let chain = Effect.succeed(0);
for (let i = 0; i < steps; i++) chain = Effect.flatMap(chain, (n) => Effect.sync(() => n + 1));

const gen = Effect.gen(function* () {
  let n = 0;
  for (let i = 0; i < steps; i++) n = yield* Effect.sync(() => n + 1);
  return n;
});

const items = Array.from({ length: steps }, (_, i) => i);
const forEach = (concurrency) => Effect.forEach(items, (i) => Effect.sync(() => i * 2), { concurrency });

const forkJoin = Effect.gen(function* () {
  const fibers = [];
  for (let i = 0; i < steps; i++) fibers.push(yield* Effect.forkChild(Effect.sync(() => i * 2)));
  let total = 0;
  for (const fiber of fibers) total += yield* Fiber.join(fiber);
  return total;
});

const failing = Effect.gen(function* () {
  return yield* Effect.fail(new NotFound());
});
const recovered = Effect.catchTag(failing, "NotFound", () => Effect.succeed(1));
const failures = Effect.gen(function* () {
  let total = 0;
  for (let i = 0; i < steps; i++) total += yield* recovered;
  return total;
});

const pure = () => {
  let acc = 0;
  for (let x = 0; x < steps; x++) acc += x * x;
  return acc;
};

async function measure(name, run, sync = true) {
  const iterations = 2000;
  for (let i = 0; i < 200; i++) sync ? run() : await run();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) sync ? run() : await run();
  const ns = Number(process.hrtime.bigint() - start) / iterations;
  console.log(`${name.padEnd(28)} ${(ns / 1000).toFixed(1).padStart(8)} µs/op ${(ns / steps).toFixed(1).padStart(8)} ns/step`);
}

console.log(`node ${process.version}, ${steps} steps per op`);
await measure("ChainFlatMap", () => Effect.runSync(chain));
await measure("ChainGen", () => Effect.runSync(gen));
await measure("FanOutForkJoin", () => Effect.runPromise(forkJoin), false);
await measure("FanOutForEachUnbounded", () => Effect.runPromise(forEach("unbounded")), false);
await measure("FanOutForEach16", () => Effect.runPromise(forEach(16)), false);
await measure("FailureGenCatchTag", () => Effect.runSync(failures));
await measure("PureHandWritten", pure);
