// The language host's work, as Foldkit commands. Each one reads the
// `FormaHost` resource and answers with a message.

import { Effect, Schema as S } from "effect";
import { Command } from "foldkit";
import type { LanguageHost } from "@formalang/host/types";

import { FormaHost } from "./host.js";
import { Message } from "./message.js";

/** A host service the workbench needs, or a failure naming the missing capability. */
export const required = <K extends keyof LanguageHost>(
  host: LanguageHost,
  name: K,
): Effect.Effect<NonNullable<LanguageHost[K]>, string> => {
  const service = host[name];
  return service === undefined
    ? Effect.fail(`The ${host.name} host does not implement ${String(name)}.`)
    : Effect.succeed((service as (...args: never) => unknown).bind(host) as NonNullable<LanguageHost[K]>);
};

const failure = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Reads a program's source as outline rows, with ids for every node. */
export const ReadProgram = Command.define("ReadFormaProgram", {
  args: { source: S.String },
  messages: [Message.LoadedProgram, Message.FailedProgram],
  execute: ({ source }) =>
    Effect.gen(function* () {
      const { host, config } = yield* FormaHost;
      const sourceToOutline = yield* required(host, "sourceToOutline");
      const read = yield* Effect.tryPromise({
        try: () => sourceToOutline({ sourceId: config.sourceId, source }),
        catch: failure,
      });
      return Message.LoadedProgram({
        document: { revision: 0, source, identity: read.identity },
        rows: read.items,
      });
    }).pipe(Effect.catch((reason) => Effect.succeed(Message.FailedProgram({ reason })))),
});
