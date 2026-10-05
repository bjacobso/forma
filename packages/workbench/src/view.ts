import type { Html } from "foldkit/html";
import { defineView } from "foldkit/submodel";
import { Outliner, walk, type RowDecoration } from "@foldworks/outliner";

import { summary, viewOf } from "./adapter.js";
import { lexicalTokens, spansOf } from "./decorations.js";
import { Message } from "./message.js";
import type { Model } from "./model.js";
import { policy } from "./update.js";

const outlineMessage = (message: Outliner.Message): Message => Message.GotOutlinerMessage({ message });

/**
 * Each row's highlighting and problems. A row shows the analysis while its
 * text is the text that was analyzed, and its syntax alone otherwise.
 */
const decorations = (model: Model): Readonly<Record<string, RowDecoration>> => {
  const rows = model.analysis === null ? undefined : viewOf(model.analysis).rows;
  const result: Record<string, RowDecoration> = {};
  for (const node of walk(model.outline.items)) {
    const row = rows?.get(node.id);
    result[node.id] =
      row === undefined || row.layout.text !== node.text
        ? { spans: spansOf(node.text, lexicalTokens(node.text)) }
        : {
            spans: spansOf(node.text, row.tokens),
            ...(row.diagnostics.length === 0 ? {} : { diagnostics: row.diagnostics }),
            ...(row.tone === undefined ? {} : { tone: row.tone }),
          };
  }
  return result;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const stats = (model: Model): string => {
  if (model.analysis === null) return model.document === null ? "Reading…" : "Analyzing…";
  const { forms, errors, warnings } = summary(model.analysis);
  return [plural(forms, "form"), plural(errors, "error"), plural(warnings, "warning")].join(" · ");
};

export const view = defineView<Model, Message>((model, h): Html => {
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
              h.span([h.Class("wb__stats"), h.AriaLive("polite")], [stats(model)]),
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
