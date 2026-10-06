import type { Html } from "foldkit/html";
import { CodeEditor } from "@foldworks/code-editor";
import { ValueTree } from "@foldworks/ui";
import { preview } from "./values.js";
import { defineView } from "foldkit/submodel";
import { Outliner, walk, type RowDecoration } from "@foldworks/outliner";

import { brackets } from "./notation.js";
import { hoverContent } from "./intelligence-view.js";
import { summary, viewOf, hoverFact, sourceOffsetAtRow } from "./adapter.js";
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
  if (model.notation === "Brackets") {
    const markers = brackets(model.outline.items, { scopeId: model.outline.scopeId, focusId: model.outline.focus?.id ?? null });
    for (const [id, decoration] of markers) result[id] = { ...result[id], ...decoration };
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
    [h.Class("wb"), h.DataAttribute("workbench", model.id), h.DataAttribute("source-dirty", String(model.sourceDirty))],
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
          h.nav([h.Class("wb__toolbar"), h.AriaLabel("Notation")], [
            h.button([h.Type("button"), h.OnClick(Message.SetPane({ pane: model.pane === "outline" ? "source" : "outline" }))], [model.pane === "outline" ? "Source" : "Back to outline"]),
            ...(["Outline", "Brackets"] as const).map((notation) => h.button([h.Type("button"), h.AriaPressed(String(model.notation === notation)), h.OnClick(Message.SetNotation({ notation }))], [notation])),
          ]),
          ...(model.failure === null
            ? []
            : [h.p([h.Class("wb-error"), h.Role("alert")], [model.failure])]),
          h.div(
            [h.Class("wb__page")],
            [
              ...(model.pane === "source" ? [CodeEditor.view({
                model: model.source, label: "Forma source", showToolbar: false, showInspector: false,
                toParentMessage: (message) => Message.GotSourceMessage({ message }),
                hover: ({ offset, document }) => {
                  if (model.analysis === null || document.text !== model.analysis.document.source) return null;
                  const fact = hoverFact(model.analysis, offset);
                  return fact === null ? null : { from: fact.from, to: fact.to, content: hoverContent(fact, h) };
                },
              }, h), ...(model.sourceError === null ? [] : [h.p([h.Role("alert"), h.Class("wb-error")], [model.sourceError])])]
              : [h.submodel({
                slotId: `${model.id}-outline`,
                model: model.outline,
                view: Outliner.view,
                viewInputs: {
                  ...policy,
                  label: "Program",
                  spellcheck: false,
                  decorations: decorations(model),
                  hover: ({ id, offset, text }) => {
                    const analysis = model.analysis;
                    const layout = analysis?.rows.find((layout) => layout.id === id);
                    if (analysis == null || layout == null || layout.text !== text) return null;
                    const fact = hoverFact(analysis, sourceOffsetAtRow(layout, offset));
                    if (fact === null) return null;
                    const node = layout.nodes.find((node) => node.nodeId === fact.nodeId);
                    return { from: node?.from ?? 0, to: node?.to ?? text.length, content: hoverContent(fact, h) };
                  },
                  placeholders: (parentId) => parentId === null || model.analysis?.revision !== model.outline.revision ? [] : model.analysis.slots[parentId] ?? [],
                  rowAccessory: (row) => {
                    if (model.analysis?.rows.find((layout) => layout.id === row.id)?.text !== row.text) return null;
                    const observed = model.analysis?.values[row.id];
                    const type = model.analysis?.types[row.id];
                    if (observed?.value == null && type === undefined) return null;
                    return h.button([h.Class("wb__value"), h.Type("button"), h.OnClick(Message.Inspect({ id: row.id })), h.AriaLabel(`Inspect ${row.text}`)], [
                      ...(observed?.value == null ? [] : [h.span([], [preview(observed.value) + (observed.count > 1 ? ` ×${observed.count}` : "")])]),
                      ...(type === undefined ? [] : [h.small([h.Class("wb__type")], [type])]),
                    ]);
                  },
                },
                toParentMessage: outlineMessage,
              })]),
            ],
          ),
          ...(model.inspector === null ? [] : [h.aside([h.Class("wb__inspector"), h.AriaLabel("Inspector")], [
            h.h2([], ["Inspector"]),
            h.code([], [model.analysis?.rows.find((row) => row.id === model.inspector)?.text ?? "Form"]),
            h.p([], [model.analysis?.types[model.inspector] ?? "Type unavailable"]),
            h.p([], [model.analysis?.values[model.inspector]?.failure ?? `${model.analysis?.values[model.inspector]?.count ?? 0} evaluations`]),
            ValueTree.view({ model: model.valueTree, nodes: model.valueNodes, label: "Value", toParentMessage: (message) => Message.GotValueMessage({ message }) }, h),
          ])]),
        ],
      ),
    ],
  );
});
