import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import type { Command, KeyBinding } from "@codemirror/view";
import { formatSource, formattingEdits } from "@formalang/host/format";

type Language = "lisp" | "markdown";
/** One undoable transaction; unchanged text and invalid Lisp produce no edit. */
export function formattingTransaction(state: EditorState, language: Language = "lisp") {
  if (state.readOnly) return undefined;
  const source = state.doc.toString(), selection = state.selection.main;
  const result = formatSource({ source, language, ...(selection.empty ? {} : { range: { start: selection.from, end: selection.to } }) });
  if (!result.changed) return undefined;
  const spec: TransactionSpec = {
    changes: formattingEdits(source, result.text).map(e => ({ from: e.start, to: e.end, insert: e.text })),
    annotations: Transaction.userEvent.of("input.format"),
  };
  return state.update(spec);
}
const command = (language: Language): Command => view => {
  if (view.state.readOnly) return false;
  const transaction = formattingTransaction(view.state, language);
  if (transaction) view.dispatch(transaction);
  return true;
};
export const formatDocument = command("lisp");
export const formatMarkdownDocument = command("markdown");
export const formattingKeymap: readonly KeyBinding[] = [{ key: "Mod-Shift-f", run: formatDocument }];
export const markdownFormattingKeymap: readonly KeyBinding[] = [{ key: "Mod-Shift-f", run: formatMarkdownDocument }];
