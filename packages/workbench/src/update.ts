import { Option } from "effect";
import { CodeEditor } from "@foldworks/code-editor";
import { editSource, setPane, sourceAnalysis, sourceOperation } from "./source-update.js";
import { Command, Update } from "foldkit";
import { evo } from "foldkit/struct";
import { Outliner, type Policy } from "@foldworks/outliner";

import { ValueTree } from "@foldworks/ui";
import { completeAt, sourceOffsetAtRow } from "./adapter.js";
import { find } from "@foldworks/outliner";
import { valueRoot } from "./values.js";
import { AnalyzeProgram, ScheduleAnalysis, LoadValue, ReleaseAnalysis } from "./commands.js";
import { fromRows, toRows, sameRows } from "./document.js";
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
const followOutline = (before: Model, result: UpdateReturn): UpdateReturn => {
  if (result.model.outline.revision === before.outline.revision || result.model.document === null) return result;
  const rows = toRows(result.model.outline.items);
  const known = before.documents.find((entry) => sameRows(entry.rows, rows));
  const model = known === undefined ? result.model : { ...result.model, document: { ...known.document, revision: result.model.outline.revision } };
  return { ...result, model, commands: [...(result.commands ?? []), ScheduleAnalysis({ revision: model.outline.revision })] };
};

/** Keeps the newest analysis, and its document as the base for the next printing. */
const received = (model: Model, analysis: Analysis): UpdateReturn => {
  if (analysis.revision !== model.outline.revision) return {
    model, commands: analysis.valueSession === null ? [] : [ReleaseAnalysis({ sessionId: analysis.valueSession })],
  };
  const value = model.inspector === null ? null : analysis.values[model.inspector]?.value;
  const refreshed: Model = { ...model, analysis, document: analysis.document, failure: null,
    documents: [{ rows: toRows(model.outline.items), document: analysis.document }, ...model.documents.filter((entry) => !sameRows(entry.rows, toRows(model.outline.items)))],
    valueNodes: value == null ? [] : [valueRoot(value)], valueTree: ValueTree.init({ id: model.valueTree.id }),
  };
  const painted = sourceAnalysis(refreshed);
  return {
    ...painted,
    model: { ...painted.model, analysis, document: analysis.document, failure: null,
      valueNodes: value == null ? [] : [valueRoot(value)],
      valueTree: ValueTree.init({ id: model.valueTree.id }),
    },
    commands: [...(painted.commands ?? []), ...(model.analysis?.valueSession == null ? [] : [ReleaseAnalysis({ sessionId: model.analysis.valueSession })])],
  };
};

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SetPane: ({ pane }) => setPane(model, pane),
    GotSourceMessage: ({ message }) => editSource(model, message),
    ReadSource: ({ expected, document, rows, errors }) => {
      const current = CodeEditor.documentVersion(model.source.document);
      if (expected.session !== current.session || expected.revision !== current.revision) return { model };
      if (errors.length > 0) {
        const marked = sourceOperation(model, CodeEditor.Operation.SetDiagnostics({ ...current, languageId: "lisp", source: "Forma", diagnostics: errors }));
        return { ...marked, model: { ...marked.model, sourceError: errors[0]!.message } };
      }
      const replaced = foldOutliner(model, Outliner.Message.Replace({ items: fromRows(rows, model.outline.items), announcement: "Read source edits.", coalescingKey: `source-${current.session}` }));
      return analyze({ ...replaced.model, sourceDirty: false, sourceError: null, document: { ...document, revision: replaced.model.outline.revision } });
    },
    SetNotation: ({ notation }) => ({ model: { ...model, notation } }),
    Inspect: ({ id }) => {
      const value = model.analysis?.values[id]?.value;
      return { model: { ...model, inspector: id, valueTree: ValueTree.init({ id: model.valueTree.id }),
        valueNodes: value == null ? [] : [valueRoot(value)] } };
    },
    GotValueMessage: ({ message }) => {
      const child = ValueTree.update(model.valueTree, message, { nodes: model.valueNodes });
      return { model: { ...model, valueTree: child.model },
        commands: [ ...(child.commands ?? []).map((command) => Command.mapMessage(command, (event) => Message.GotValueMessage({ message: event }))),
          ...(child.outMessage === undefined || model.analysis?.valueSession == null ? [] : [LoadValue({ sessionId: model.analysis.valueSession, id: child.outMessage.id })]),
        ],
      };
    },
    LoadedValue: ({ sessionId, id, nodes }) => ({ model: sessionId !== model.analysis?.valueSession ? model : {
      ...model, valueNodes: model.valueNodes.map((node) => node.id === id ? { ...node, children: nodes, expandable: false } : node),
    } }),
    ReleasedAnalysis: () => ({ model }),
    GotOutlinerMessage: ({ message: event }) => {
      if (
        event._tag === "FilledPlaceholder" &&
        event.parentId !== null &&
        model.analysis?.revision === model.outline.revision
      ) {
        const slot = model.analysis.slots[event.parentId]?.find((slot) => slot.key === event.key);
        const parent = find(model.outline.items, event.parentId);
        if (slot?.inline && parent !== undefined) {
          const header = `${parent.text.trimEnd()} ${event.text}`;
          const replace = (rows: ReturnType<typeof toRows>): ReturnType<typeof toRows> =>
            rows.map((row) => ({
              ...row,
              text: row.id === parent.id ? header : row.text,
              children: replace(row.children),
            }));
          const changed = foldOutliner(
            model,
            Outliner.Message.Replace({
              items: fromRows(replace(toRows(model.outline.items)), model.outline.items),
              announcement: `Added ${slot.label}.`,
            }),
          );
          const focused = foldOutliner(changed.model, Outliner.Message.Reveal({ id: parent.id }));
          return followOutline(model, {
            ...focused,
            commands: [...(changed.commands ?? []), ...(focused.commands ?? [])],
          });
        }
      }
      if (event._tag === "RequestedCompletion" && model.analysis !== null) {
        const row = find(model.outline.items, event.id);
        const layout = model.analysis.rows.find((layout) => layout.id === event.id);
        if (row !== undefined && layout !== undefined && layout.text === row.text) {
          const answer = completeAt(model.analysis, row.text, event.start, sourceOffsetAtRow(layout, event.start));
          return foldOutliner(model, Outliner.Message.ShowCompletions({ id: event.id, ...answer }));
        }
      }
      return followOutline(model, foldOutliner(model, event));
    },
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
