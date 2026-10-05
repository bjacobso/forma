import type { Html } from "foldkit/html";
import { defineView } from "foldkit/submodel";
import { Outliner, walk, type RowDecoration } from "@foldworks/outliner";

import { lexicalTokens, spansOf } from "./decorations.js";
import { Message } from "./message.js";
import type { Model } from "./model.js";
import { policy } from "./update.js";

const outlineMessage = (message: Outliner.Message): Message => Message.GotOutlinerMessage({ message });

const decorations = (model: Model): Readonly<Record<string, RowDecoration>> => {
  const result: Record<string, RowDecoration> = {};
  for (const node of walk(model.outline.items)) {
    result[node.id] = { spans: spansOf(node.text, lexicalTokens(node.text)) };
  }
  return result;
};

export const view = defineView<Model, Message>((model, h): Html => {
  const rows = walk(model.outline.items).length;
  return h.div(
    [h.Class("wb"), h.DataAttribute("workbench", model.id)],
    [
      h.section(
        [h.Class("wb__window"), h.AriaLabel("Program")],
        [
          h.header(
            [h.Class("wb__titlebar")],
            [
              h.span([h.Class("wb__name")], [model.title]),
              h.span(
                [h.Class("wb__stats")],
                [model.document === null ? "Reading…" : `${rows} ${rows === 1 ? "row" : "rows"}`],
              ),
            ],
          ),
          ...(model.failure === null
            ? []
            : [h.p([h.Class("wb-error"), h.Role("alert")], [model.failure])]),
          h.div(
            [h.Class("wb__page")],
            [
              h.submodel({
                slotId: `${model.id}-outline`,
                model: model.outline,
                view: Outliner.view,
                viewInputs: {
                  ...policy,
                  label: "Program",
                  spellcheck: false,
                  decorations: decorations(model),
                },
                toParentMessage: outlineMessage,
              }),
            ],
          ),
        ],
      ),
    ],
  );
});
