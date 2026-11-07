import { createHash, randomBytes } from "node:crypto";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** Node host service for Smithers' pinned Effect version. */
export const nodeCrypto = Layer.succeed(Crypto.Crypto, Crypto.make({
  randomBytes: size => new Uint8Array(randomBytes(size)),
  digest: (algorithm, bytes) => Effect.sync(() =>
    new Uint8Array(createHash(algorithm.replaceAll("-", "").toLowerCase()).update(bytes).digest())),
}));
