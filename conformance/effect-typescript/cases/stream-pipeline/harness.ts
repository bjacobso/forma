import assert from "node:assert/strict";
import { Effect, Layer, Stream } from "effect";
import { average, celsiusValues, exportFirst, hotReadings, Sensors, SensorOffline, Sink, sumOfSquares } from "./expected.js";

export default async function check(): Promise<void> {
  const temperatures: Readonly<Record<string, number>> = { kitchen: 24.5, attic: 31, cellar: 12, garage: 28 };
  let inFlight = 0;
  let maxInFlight = 0;
  const reads: string[] = [];
  const SensorsTest = Layer.succeed(
    Sensors,
    Sensors.of({
      read: (sensor) =>
        Effect.gen(function* () {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          reads.push(sensor);
          yield* Effect.sleep(5);
          const celsius = temperatures[sensor];
          if (celsius === undefined) return yield* Effect.fail(new SensorOffline({ sensor }));
          return { sensor, celsius };
        }).pipe(Effect.ensuring(Effect.sync(() => { inFlight--; }))),
    }),
  );
  const written: string[] = [];
  const SinkTest = Layer.succeed(Sink, Sink.of({ write: (line) => Effect.sync(() => { written.push(line); }) }));
  const run = <A, E>(effect: Effect.Effect<A, E, Sensors | Sink>) =>
    Effect.runPromise(Effect.provide(effect, Layer.mergeAll(SensorsTest, SinkTest)));

  const hot = await run(hotReadings(["kitchen", "attic", "cellar", "garage"], 25));
  assert.deepEqual(hot.map((reading) => reading.sensor), ["attic", "garage"]);
  assert.equal(maxInFlight, 2);

  const offline = await run(Effect.flip(hotReadings(["kitchen", "roof"], 0)));
  assert.ok(offline instanceof SensorOffline);
  assert.equal(offline.sensor, "roof");

  assert.equal(await Effect.runPromise(sumOfSquares(4)), 30);

  reads.length = 0;
  await run(exportFirst(["kitchen", "attic", "cellar", "garage"], 2));
  assert.deepEqual(written, ["kitchen=24.5", "attic=31"]);
  // take stops pulling: sensors after the limit are never read.
  assert.deepEqual(reads, ["kitchen", "attic"]);

  const readings = [{ sensor: "a", celsius: 10 }, { sensor: "b", celsius: 15 }];
  assert.equal(await Effect.runPromise(average(readings)), 12.5);
  assert.equal(await Effect.runPromise(average([])), 0);
  assert.deepEqual(await Effect.runPromise(Stream.runCollect(celsiusValues(readings))), [10, 15]);
}
