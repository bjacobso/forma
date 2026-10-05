import { Option } from "effect";
import { Update } from "foldkit";
import { evo } from "foldkit/struct";
import { Outliner, type Policy } from "@foldworks/outliner";

import { AnalyzeProgram, ScheduleAnalysis } from "./commands.js";
import { fromRows, toRows } from "./document.js";
import type { Analysis } from "./analysis.js";
import type { FormaHost } from "./host.js";
import { Message } from "./message.js";
import type { Model } from "./model.js";

export type UpdateReturn = Update.Return<Model, Message, FormaHost>;

/** The outline's rules. */
export const policy: Policy = {};

const foldOutliner = (model: Model, message: Outliner.Message): UpdateReturn =>
  Update.foldChild({
    update: (outline: Outliner.Model, event: Outliner.Message) =>
      Outliner.update(outline, event, policy),
    read: (parent: Model) => Option.some(parent.outline),
    write: (parent: Model, outline: Outliner.Model) => evo(parent, { outline: () => outline }),
    toParentMessage: (event: Outliner.Message) => Message.GotOutlinerMessage({ message: event }),
  })(model, message);

/** Analyzes the outline's current revision now. */
const analyze = (model: Model): UpdateReturn => ({
  model,
  commands: [
    AnalyzeProgram({
      revision: model.outline.revision,
      rows: toRows(model.outline.items),
      base: model.document,
    }),
  ],
});

/** After the outline changes, analyzes it once typing pauses. */
const followOutline = (before: Model, result: UpdateReturn): UpdateReturn =>
  result.model.outline.revision === before.outline.revision || result.model.document === null
    ? result
    : {
        ...result,
        commands: [
          ...(result.commands ?? []),
          ScheduleAnalysis({ revision: result.model.outline.revision }),
        ],
      };

/** Keeps the newest analysis, and its document as the base for the next printing. */
const received = (model: Model, analysis: Analysis): UpdateReturn =>
  model.analysis !== null && analysis.revision <= model.analysis.revision
    ? { model }
    : {
        model: evo(model, {
          analysis: () => analysis,
          document: (document) =>
            document === null || analysis.document.revision >= document.revision
              ? analysis.document
              : document,
          failure: () => null,
        }),
      };

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    GotOutlinerMessage: ({ message: event }) =>
      followOutline(model, foldOutliner(model, event)),
    LoadedProgram: ({ document, rows }) => {
      const loaded = foldOutliner(
        evo(model, { failure: () => null }),
        Outliner.Message.Load({ items: fromRows(rows) }),
      );
      // The document describes the outline's current revision.
      return analyze(
        evo(loaded.model, {
          document: () => ({ ...document, revision: loaded.model.outline.revision }),
        }),
      );
    },
    FailedProgram: ({ reason }) => ({ model: evo(model, { failure: () => reason }) }),
    // Only the latest revision is analyzed; earlier requests were overtaken by typing.
    AnalysisDue: ({ revision }) =>
      revision === model.outline.revision ? analyze(model) : { model },
    Analyzed: ({ analysis }) => received(model, analysis),
    FailedAnalysis: ({ revision, reason }) =>
      revision === model.outline.revision
        ? { model: evo(model, { failure: () => reason }) }
        : { model },
  });
