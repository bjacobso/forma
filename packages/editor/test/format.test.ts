import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { expect, test } from "vitest";
import { formattingTransaction } from "../src/codemirror/format.js";

test("formatting maps the cursor and can be undone in one step", () => {
  const source = "(define   answer  42)\nanswer\n";
  const state = EditorState.create({ doc: source, selection: { anchor: source.lastIndexOf("answer") }, extensions: [history()] });
  const transaction = formattingTransaction(state)!;
  expect(transaction.state.doc.toString()).toBe("(define answer 42)\nanswer\n");
  expect(transaction.state.selection.main.head).toBe(transaction.state.doc.toString().lastIndexOf("answer"));
  let undone = "";
  expect(undo({ state: transaction.state, dispatch: t => { undone = t.state.doc.toString(); } })).toBe(true);
  expect(undone).toBe(source);
});

test("selection formatting uses whole forms and respects read-only editors", () => {
  const state = EditorState.create({ doc: "(a   b)\n(c   d)\n", selection: { anchor: 2, head: 4 } });
  expect(formattingTransaction(state)!.state.doc.toString()).toBe("(a b)\n(c   d)\n");
  expect(formattingTransaction(EditorState.create({ doc: "(a   b)", extensions: [EditorState.readOnly.of(true)] }))).toBeUndefined();
  expect(formattingTransaction(EditorState.create({ doc: "(a" }))).toBeUndefined();
});

test("Markdown formatting leaves prose and other fences untouched", () => {
  const source = "prose  \n```lisp\n(a   b)\n```\n```js\nx   y\n```\n";
  expect(formattingTransaction(EditorState.create({ doc: source }), "markdown")!.state.doc.toString()).toBe(source.replace("(a   b)", "(a b)"));
});
