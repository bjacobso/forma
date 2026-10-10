/** Keeps the newest analysis, and its document as the base for the next printing. */
const received = (model: Model, analysis: Analysis): UpdateReturn => {
  if (analysis.revision !== model.outline.revision)
    return {
      model,
      commands:
        analysis.valueSession === null
          ? []
          : [ReleaseAnalysis({ sessionId: analysis.valueSession })],
    };
  // …
    // Only the latest revision is analyzed; earlier requests were overtaken by typing.
    AnalysisDue: ({ revision }) =>
      revision === model.outline.revision ? analyze(model) : { model },
    Analyzed: ({ analysis }) => received(model, analysis),
