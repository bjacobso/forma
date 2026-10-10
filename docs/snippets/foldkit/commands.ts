/** Waits for typing to pause, then asks for an analysis of a revision. */
export const ScheduleAnalysis = Command.define("ScheduleFormaAnalysis", {
  args: { revision: S.Number },
  messages: [Message.AnalysisDue],
  execute: ({ revision }) =>
    Effect.sleep(ANALYSIS_DELAY).pipe(Effect.as(Message.AnalysisDue({ revision }))),
});

/** Prints a revision of the outline against the previous document and analyzes it. */
export const AnalyzeProgram = Command.define("AnalyzeFormaProgram", {
  args: { revision: S.Number, rows: S.Array(OutlineRow), base: S.NullOr(Document) },
  messages: [Message.Analyzed, Message.FailedAnalysis],
  execute: (input) =>
    analyzeProgram(input).pipe(
      Effect.map((analysis) => Message.Analyzed({ analysis })),
      Effect.catch((reason) =>
        Effect.succeed(Message.FailedAnalysis({ revision: input.revision, reason })),
      ),
    ),
});
