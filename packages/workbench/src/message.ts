import { Schema as S } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { ValueTree } from "@foldworks/ui";
import { ValueNodeSchema } from "./values.js";
import { Outliner } from "@foldworks/outliner";

import { Analysis } from "./analysis.js";
import { Document, OutlineRow } from "./document.js";

export const Message = defineMessageUnion({
  Inspect: { id: S.String },
  GotValueMessage: { message: ValueTree.Message },
  LoadedValue: { sessionId: S.String, id: S.String, nodes: S.Array(ValueNodeSchema) },
  ReleasedAnalysis: {},
  GotOutlinerMessage: { message: Outliner.Message },
  /** The host read the program's source as rows. */
  LoadedProgram: { document: Document, rows: S.Array(OutlineRow) },
  /** The host could not read the program. */
  FailedProgram: { reason: S.String },
  /** Typing paused long enough to analyze this revision. */
  AnalysisDue: { revision: S.Number },
  Analyzed: { analysis: Analysis },
  FailedAnalysis: { revision: S.Number, reason: S.String },
});
export type Message = typeof Message.Type;
