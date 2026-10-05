import { Schema as S } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { Outliner } from "@foldworks/outliner";

import { Document, OutlineRow } from "./document.js";

export const Message = defineMessageUnion({
  GotOutlinerMessage: { message: Outliner.Message },
  /** The host read the program's source as rows. */
  LoadedProgram: { document: Document, rows: S.Array(OutlineRow) },
  /** The host could not read the program. */
  FailedProgram: { reason: S.String },
});
export type Message = typeof Message.Type;
