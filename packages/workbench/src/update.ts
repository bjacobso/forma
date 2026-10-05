import { Option } from "effect";
import { Update } from "foldkit";
import { evo } from "foldkit/struct";
import { Outliner, type Policy } from "@foldworks/outliner";

import { fromRows } from "./document.js";
import type { FormaHost } from "./host.js";
import { Message } from "./message.js";
import type { Model } from "./model.js";

export type UpdateReturn = Update.Return<Model, Message, FormaHost>;

/** The outline's rules. Rows are read only until the workbench edits programs. */
export const policy: Policy = { isReadOnly: () => true };

const foldOutliner = (model: Model, message: Outliner.Message): UpdateReturn =>
  Update.foldChild({
    update: (outline: Outliner.Model, event: Outliner.Message) =>
      Outliner.update(outline, event, policy),
    read: (parent: Model) => Option.some(parent.outline),
    write: (parent: Model, outline: Outliner.Model) => evo(parent, { outline: () => outline }),
    toParentMessage: (event: Outliner.Message) => Message.GotOutlinerMessage({ message: event }),
  })(model, message);

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    GotOutlinerMessage: ({ message: event }) => foldOutliner(model, event),
    LoadedProgram: ({ document, rows }) => {
      const loaded = foldOutliner(
        evo(model, { failure: () => null }),
        Outliner.Message.Load({ items: fromRows(rows) }),
      );
      // The document describes the outline's current revision.
      return {
        ...loaded,
        model: evo(loaded.model, {
          document: () => ({ ...document, revision: loaded.model.outline.revision }),
        }),
      };
    },
    FailedProgram: ({ reason }) => ({ model: evo(model, { failure: () => reason }) }),
  });
