import { Context, Effect, Schema, Stream } from "effect";

export const Reading = Schema.Struct({
  sensor: Schema.String,
  celsius: Schema.Number,
});
export type Reading = typeof Reading.Type;

export class SensorOffline extends Schema.TaggedError<SensorOffline>()("SensorOffline", {
  sensor: Schema.String,
}) {}

export class Sensors extends Context.Service<
  Sensors,
  {
    readonly read: (sensor: string) => Effect.Effect<Reading, SensorOffline>;
  }
>()("Sensors") {}

export class Sink extends Context.Service<
  Sink,
  {
    readonly write: (line: string) => Effect.Effect<void>;
  }
>()("Sink") {}

export const celsiusValues = (readings: ReadonlyArray<Reading>): Stream.Stream<number> =>
  Stream.map(Stream.fromIterable(readings), (reading) => reading.celsius);

export const hotReadings = (
  sensors: ReadonlyArray<string>,
  threshold: number,
): Effect.Effect<ReadonlyArray<Reading>, SensorOffline, Sensors> =>
  Effect.gen(function* () {
    const sensorsService = yield* Sensors;
    return yield* Stream.runCollect(Stream.filter(
      Stream.mapEffect(
        Stream.fromIterable(sensors),
        (sensor) => sensorsService.read(sensor),
        { concurrency: 2 },
      ),
      (reading) => reading.celsius > threshold,
    ));
  });

export const sumOfSquares = (n: number): Effect.Effect<number> =>
  Effect.gen(function* () {
    return yield* Stream.runFold(
      Stream.map(Stream.range(1, n), (i) => i * i),
      (): number => 0,
      (total, square) => total + square,
    );
  });

export const exportFirst = (
  sensors: ReadonlyArray<string>,
  limit: number,
): Effect.Effect<void, SensorOffline, Sensors | Sink> =>
  Effect.gen(function* () {
    const sensorsService = yield* Sensors;
    const sink = yield* Sink;
    return yield* Stream.runForEach(
      Stream.take(
        Stream.mapEffect(Stream.fromIterable(sensors), (sensor) => sensorsService.read(sensor)),
        limit,
      ),
      (reading) => sink.write(`${reading.sensor}=${reading.celsius}`),
    );
  });

export const average = (readings: ReadonlyArray<Reading>): Effect.Effect<number> =>
  Effect.gen(function* () {
    const total = yield* Stream.runFold(celsiusValues(readings), (): number => 0, (sum, value) => sum + value);
    return readings.length === 0 ? 0 : total / readings.length;
  });
