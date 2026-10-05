import { Schema as S } from "effect";
import { Outliner } from "@foldworks/outliner";

import { Analysis } from "./analysis.js";
import { Document } from "./document.js";

export const Model = S.Struct({
  /** Prefixes element ids and the ids of rows the outliner creates. Unique on the page. */
  id: S.String,
  /** Names the program in the title bar. */
  title: S.String,
  outline: Outliner.Model,
  /** The outline printed as source, once the host has read the program. */
  document: S.NullOr(Document),
  /** The latest analysis. Rows show its facts while their text is the text it analyzed. */
  analysis: S.NullOr(Analysis),
  failure: S.NullOr(S.String),
});
export type Model = typeof Model.Type;

export const domIds = (id: string) => ({
  outline: `${id}-outline`,
});
