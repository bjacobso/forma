/** Bundled import identities. Thunks avoid initializing adapters during module loading. */
import { rpcExtension } from "../Rpc.js";
import { httpApiExtension } from "../HttpApi.js";
import { clusterExtension } from "../Cluster.js";

export const effectLibraries = {
  "forma:effect/rpc": () => rpcExtension,
  "forma:effect/http-api": () => httpApiExtension,
  "forma:effect/cluster": () => clusterExtension,
} as const;
export type EffectLibrary = keyof typeof effectLibraries;
export const isEffectLibrary = (id: string): id is EffectLibrary => Object.hasOwn(effectLibraries, id);
