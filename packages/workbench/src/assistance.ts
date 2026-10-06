import { Schema as S } from "effect";

export const Suggestion = S.Struct({ name: S.String, kind: S.String, type: S.optional(S.String), doc: S.optional(S.String) });
export const Slot = S.Struct({ key: S.String, label: S.String, text: S.String, caret: S.Number, doc: S.optional(S.String) });
