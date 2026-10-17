import type { Model } from "../src/model.js";
import type { UpdateReturn } from "../src/update.js";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { sourceToOutline } from "@formalang/ts/syntax";
import { readSource } from "../src/source.js";
import { hostLayer } from "./support/program.js";

it("reconciles source edits without changing untouched node ids or layout", async () => {
  const source = "; keep this\n(define x  42)\n\n(+ x 1)\n";
  const initial = sourceToOutline(source);
  const edited = await Effect.runPromise(
    readSource(source.replace("42", "43"), {
      revision: 0,
      source,
      identity: initial.identity,
    }).pipe(Effect.provide(hostLayer())),
  );
  expect(edited.document.source).toBe(source.replace("42", "43"));
  expect(edited.rows[2]?.id).toBe(initial.items[2]?.id);
  expect(edited.errors).toEqual([]);
  const broken = await Effect.runPromise(
    readSource(source.slice(0, -2), {
      revision: 0,
      source,
      identity: initial.identity,
    }).pipe(Effect.provide(hostLayer())),
  );
  expect(broken.errors.length).toBeGreaterThan(0);
});

it("formats source with an atomic undoable edit and schedules reconciliation", async () => {
  const { init } = await import("../src/init.js");
  const { formatSourceText, editSource } = await import("../src/source-update.js");
  const { CodeEditor } = await import("@foldworks/code-editor");
  const source = "(define   x 42)\n\n(+ x   1)\n", initial = sourceToOutline(source);
  const model: Model = { ...init({ id: "format", title: "format.forma", source }).model, pane: "source" as const,
    document: { revision: 0, source, identity: initial.identity } };
  // The surface acknowledges native edit requests before its model changes.
  const acknowledge = (base: Model, requested: UpdateReturn): UpdateReturn => {
    const command = requested.commands?.find(c => c.name === "NativeEditorRequest");
    expect(command).toBeDefined();
    const request = command!.args!["request"] as {
      lease: string; session: number; revision: number; kind: string; groupId: number;
      edits: readonly { from: number; to: number; insert: string }[];
      selection: { anchor: number; head: number };
    };
    return editSource(base, CodeEditor.Message.Edited({ ...request, baseRevision: request.revision, before: base.source.selection, time: 0 }));
  };
  const formatted = acknowledge(model, formatSourceText(model));
  expect(formatted.model.source.document.text).toBe("(define x 42)\n\n(+ x 1)\n");
  expect(formatted.model.sourceDirty).toBe(true);
  expect(formatted.commands?.some(c => c.name === "ReadEditedFormaSource")).toBe(true);
  const undone = acknowledge(formatted.model, editSource(formatted.model, CodeEditor.execute(CodeEditor.Operation.Undo())));
  expect(undone.model.source.document.text).toBe(source);
});
