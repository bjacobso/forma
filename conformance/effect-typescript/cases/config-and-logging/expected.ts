import { Config, Effect, Schema } from "effect";

export const ServerSettings = Schema.Struct({
  host: Schema.String,
  port: Schema.Int,
  debug: Schema.Boolean,
  ratio: Schema.Number,
});
export type ServerSettings = typeof ServerSettings.Type;

export class Misconfigured extends Schema.TaggedError<Misconfigured>()("Misconfigured", {
  reason: Schema.String,
}) {}

export const settings: Effect.Effect<ServerSettings, Config.ConfigError> =
  Effect.gen(function* () {
    const host = yield* Config.string("HOST");
    const port = yield* Config.withDefault(Config.int("PORT"), 8080);
    const debug = yield* Config.withDefault(Config.boolean("DEBUG"), false);
    const ratio = yield* Config.withDefault(Config.number("SAMPLE_RATIO"), 0.5);
    yield* Effect.log("loaded settings for", host);
    return { host, port, debug, ratio };
  });

export const validatedSettings: Effect.Effect<ServerSettings, Misconfigured> =
  Effect.gen(function* () {
    const loaded = yield* Effect.catchTag(
      settings,
      "ConfigError",
      () => Effect.fail(new Misconfigured({ reason: "HOST is required" })),
    );
    if (loaded.port > 0 && loaded.port < 65536) {
      return loaded;
    } else {
      return yield* Effect.fail(new Misconfigured({ reason: `port ${loaded.port} is out of range` }));
    }
  });

export const baseUrl: Effect.Effect<string, Misconfigured> =
  Effect.gen(function* () {
    const current = yield* validatedSettings;
    return `${current.debug ? "http" : "https"}://${current.host}:${current.port}`;
  });
