/** One Effect system from several prelude-defined libraries.
 * RPC groups, HTTP APIs, and Cluster entities share one elaboration, one
 * mechanics check, and one generated module. The result also describes the
 * system as data: its services, layers, operations, library declarations, and
 * the relations between them.
 */
import { clusterExtension } from "./Cluster.js";
import { httpApiExtension } from "./HttpApi.js";
import { rpcExtension } from "./Rpc.js";
import { linkEffectSystem, type EffectExtension, type LinkedEffectSystem } from "./effect-system/link.js";

export type { EffectExtension, EffectSystemGraph, SystemEdge, SystemNode } from "./effect-system/link.js";
export { clusterExtension, httpApiExtension, rpcExtension };

/** The libraries `generateEffectSystem` combines by default. */
export const effectExtensions: readonly EffectExtension[] = [rpcExtension, httpApiExtension, clusterExtension];

export interface EffectSystemOptions {
  readonly sourceId?: string;
  /** Libraries whose forms the source may use. Defaults to RPC, HTTP API, and Cluster. */
  readonly extensions?: readonly EffectExtension[];
}

export type EffectSystemResult = LinkedEffectSystem;

/** Check and generate one module from a program mixing Effect declarations and
 * library forms. `system` is present when generation succeeds.
 */
export function generateEffectSystem(source: string, options: EffectSystemOptions = {}): EffectSystemResult {
  return linkEffectSystem(source, options.extensions ?? effectExtensions, {
    sourceId: options.sourceId ?? "system.lisp", namespace: "effect-system",
  });
}
