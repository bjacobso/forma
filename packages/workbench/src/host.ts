// The language host as a Foldkit resource. An application provides
// `FormaHost.layer(host, config)` through the runtime's `resources`, which
// builds it once and shares it with every command, so the host never enters
// the model. The layer opens the workbench's session and loads its preludes.

import { Context, Effect, Layer } from "effect";
import type { LanguageHost } from "@formalang/host/types";
import {
  bootstrapFromSources,
  type BootstrappedPrelude,
} from "@formalang/ts/descriptor";
import { preludeSource } from "@formalang/ts/preludes";

import { hostBuiltinOf, type WorkbenchConfig } from "./config.js";

export interface FormaHostService {
  readonly host: LanguageHost;
  /** The workbench's session, with the preludes loaded and the capabilities configured. */
  readonly sessionId: string;
  readonly config: WorkbenchConfig;
  /** Descriptors and elaboration hooks, when the configuration has preludes. */
  readonly prelude: BootstrappedPrelude | undefined;
}

export class FormaHost extends Context.Service<FormaHost, FormaHostService>()(
  "@formalang/workbench/FormaHost",
) {
  /** Opens a session on `host` for a workbench configured with `config`. */
  static layer(host: LanguageHost, config: WorkbenchConfig): Layer.Layer<FormaHost> {
    return Layer.effect(
      FormaHost,
      Effect.gen(function* () {
        const { sessionId } = yield* Effect.promise(() =>
          host.openSession({ defaultStepLimit: config.stepLimit ?? 200_000 }),
        );
        yield* Effect.promise(() => configureSession(host, sessionId, config));
        const [domain, ...additional] = (config.preludes ?? []).map((document) => document.source);
        const prelude =
          domain === undefined
            ? undefined
            : bootstrapFromSources(preludeSource("compiler.lisp"), domain, ...additional);
        return FormaHost.of({ host, sessionId, config, prelude });
      }),
    );
  }
}

/** Loads the preludes and configures the capabilities, as after `resetSession`. */
export const configureSession = async (
  host: LanguageHost,
  sessionId: string,
  config: WorkbenchConfig,
): Promise<void> => {
  const preludes = config.preludes ?? [];
  if (preludes.length > 0) {
    await host.loadSourceBundle({
      sessionId,
      sources: preludes.map((document) => ({ ...document, kind: "prelude" as const })),
    });
  }
  await host.configureSession({
    sessionId,
    hostBuiltins: (config.capabilities ?? []).map(hostBuiltinOf),
  });
};
