export class FormaHost extends Context.Service<FormaHost, FormaHostService>()(
  "@formalang/workbench/FormaHost",
) {
  /** Opens a session on `host` for a workbench configured with `config`. */
  static layer(host: LanguageHost, config: WorkbenchConfig): Layer.Layer<FormaHost> {
    return Layer.effect(
      FormaHost,
      Effect.gen(function* () {
        const sessions = new Set<string>();
        yield* Effect.addFinalizer(() =>
          Effect.forEach([...sessions], (sessionId) =>
            call(() => host.closeSession({ sessionId })).pipe(Effect.ignore),
          ),
        );
        const { sessionId } = yield* Effect.promise(() =>
          host.openSession({ defaultStepLimit: config.stepLimit ?? 200_000 }),
        );
        sessions.add(sessionId);
        const sourceDiagnostics = yield* Effect.promise(() => configureSession(host, sessionId, config));
        // …
        return FormaHost.of({ host, sessionId, config, prelude, sessions, sourceDiagnostics });
      }),
    );
  }
}
