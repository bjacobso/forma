/**
 * Forms as the reader sees them, from the editor's Lezer tree: the form at a
 * position, widening and narrowing a selection by structure, siblings, and a
 * small set of structural edits.
 */
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, Prec, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, type Command, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { barfForwardAtOffset, raiseAtOffset, slurpForwardAtOffset, spliceAtOffset, type StructuralEditResult } from "@formalang/ts/editor";

export type FormNode = ReturnType<typeof syntaxTree>["topNode"];
export interface Range { readonly from: number; readonly to: number }

const NOT_FORMS = new Set(["Program", "(", ")", "[", "]", "{", "}", "Apostrophe", "Backtick", "Tilde", "TildeAt", "LineComment", "⚠"]);
const CONTAINERS = new Set(["List", "Vector", "Map"]);

export const isForm = (node: FormNode) => !NOT_FORMS.has(node.name) && node.parent !== null;

function formParent(node: FormNode): FormNode | null {
  let parent = node.parent;
  while (parent && !isForm(parent)) parent = parent.parent;
  return parent;
}

/** The smallest form covering `from..to`; a caret touching a form's edge counts. */
export function innermostForm(state: EditorState, from: number, to = from): FormNode | null {
  const tree = syntaxTree(state);
  let best: FormNode | null = null;
  for (const side of [-1, 1] as const) {
    let node: FormNode | null = tree.resolveInner(from, side);
    while (node && !(isForm(node) && node.from <= from && to <= node.to)) node = node.parent;
    if (node && (!best || node.to - node.from < best.to - best.from)) best = node;
  }
  return best;
}

/** The smallest form strictly larger than the selection. */
export function enclosingForm(state: EditorState, from: number, to: number): FormNode | null {
  let node = innermostForm(state, from, to);
  while (node && node.from === from && node.to === to) node = formParent(node);
  return node;
}

export function childForms(node: FormNode): FormNode[] {
  const children: FormNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) if (isForm(child)) children.push(child);
  return children;
}

export function topLevelForms(state: EditorState): FormNode[] {
  const children: FormNode[] = [];
  for (let child = syntaxTree(state).topNode.firstChild; child; child = child.nextSibling) if (isForm(child)) children.push(child);
  return children;
}

/** A short label for a form: its head for a list, otherwise its text. */
export function formLabel(state: EditorState, node: FormNode): string {
  if (node.name === "List") {
    const head = listHead(state, node);
    return head ? `(${head.text} …)` : "( … )";
  }
  if (node.name === "Vector") return "[ … ]";
  if (node.name === "Map") return "{ … }";
  const text = state.sliceDoc(node.from, node.to).replace(/\s+/g, " ");
  return text.length > 24 ? `${text.slice(0, 23)}…` : text;
}

const SYMBOL = /[^\s()[\]{}"';`~]+/y;

/**
 * The head symbol of a list. Read from the text: the grammar specializes
 * heads such as `define` and `entity` into tokens the tree does not expose.
 */
export function listHead(state: EditorState, list: Range): { readonly from: number; readonly to: number; readonly text: string } | undefined {
  const text = state.sliceDoc(list.from, Math.min(list.to, list.from + 200));
  let start = 1;
  while (/\s/.test(text[start] ?? "")) start++;
  SYMBOL.lastIndex = start;
  const match = SYMBOL.exec(text);
  return match ? { from: list.from + start, to: list.from + start + match[0].length, text: match[0] } : undefined;
}

/** The forms around a range, outermost first. */
export function ancestry(state: EditorState, from: number, to: number): FormNode[] {
  const path: FormNode[] = [];
  for (let node = innermostForm(state, from, to); node; node = formParent(node)) path.unshift(node);
  return path;
}

// -----------------------------------------------------------------------------
// Structural selection: Alt-Up widens, Alt-Down retraces, Alt-Left/Right step.
// -----------------------------------------------------------------------------

const pushSelection = StateEffect.define<Range>();
const popSelection = StateEffect.define<null>();
const markStructural = StateEffect.define<null>();

interface StructuralState { readonly history: readonly Range[]; readonly active: boolean }

/** Selections made by structure, so narrowing retraces widening and the rest of the code dims. */
export const structuralSelection = StateField.define<StructuralState>({
  create: () => ({ history: [], active: false }),
  update(value, tr) {
    let next = value;
    let touched = false;
    for (const effect of tr.effects) {
      if (effect.is(pushSelection)) { next = { history: [...next.history, effect.value], active: true }; touched = true; }
      else if (effect.is(popSelection)) { next = { history: next.history.slice(0, -1), active: true }; touched = true; }
      else if (effect.is(markStructural)) { next = { ...next, active: true }; touched = true; }
    }
    if (!touched && (tr.selection || tr.docChanged)) return { history: [], active: false };
    return next;
  },
});

function select(view: EditorView, node: Range, effect: StateEffect<unknown>): true {
  view.dispatch({ selection: EditorSelection.single(node.from, node.to), effects: [effect, EditorView.scrollIntoView(node.from, { y: "nearest", yMargin: 48 })] });
  return true;
}

export const widenSelection: Command = view => {
  const { from, to } = view.state.selection.main;
  const node = enclosingForm(view.state, from, to);
  return node ? select(view, node, pushSelection.of({ from, to })) : false;
};

export const narrowSelection: Command = view => {
  const { history } = view.state.field(structuralSelection);
  const previous = history.at(-1);
  if (previous) return select(view, previous, popSelection.of(null));
  const { from, to } = view.state.selection.main;
  const node = innermostForm(view.state, from, to);
  const first = node && node.from === from && node.to === to ? childForms(node)[0] : undefined;
  return first ? select(view, first, pushSelection.of({ from, to })) : false;
};

function stepSibling(direction: 1 | -1): Command {
  return view => {
    const { from, to } = view.state.selection.main;
    const node = innermostForm(view.state, from, to);
    if (!node) return false;
    const siblings = node.parent ? (node.parent.name === "Program" ? topLevelForms(view.state) : childForms(node.parent)) : [];
    const index = siblings.findIndex(sibling => sibling.from === node.from && sibling.to === node.to);
    const next = siblings[index + direction];
    return next ? select(view, next, markStructural.of(null)) : false;
  };
}

/** Select a range as a structural selection, such as from the inspector. */
export function selectForm(view: EditorView, range: Range): void {
  select(view, range, markStructural.of(null));
}

// -----------------------------------------------------------------------------
// Structural edits. Slurp, barf, raise, and splice are the engine's transforms.
// -----------------------------------------------------------------------------

function applyEdit(view: EditorView, result: StructuralEditResult | null): boolean {
  if (!result) return false;
  const current = view.state.doc.toString();
  let start = 0;
  while (start < current.length && start < result.source.length && current[start] === result.source[start]) start++;
  let end = 0;
  while (end < current.length - start && end < result.source.length - start && current[current.length - 1 - end] === result.source[result.source.length - 1 - end]) end++;
  view.dispatch({
    changes: { from: start, to: current.length - end, insert: result.source.slice(start, result.source.length - end) },
    selection: EditorSelection.single(result.selectionStart, result.selectionEnd),
    effects: markStructural.of(null),
    userEvent: "input.structure",
    scrollIntoView: true,
  });
  return true;
}

const atSelection = (transform: (source: string, offset: number) => StructuralEditResult | null): Command => view => {
  const { from, head, empty } = view.state.selection.main;
  return applyEdit(view, transform(view.state.doc.toString(), empty ? head : from));
};

export const slurp = atSelection(slurpForwardAtOffset);
export const barf = atSelection(barfForwardAtOffset);
export const raise = atSelection(raiseAtOffset);
export const splice = atSelection(spliceAtOffset);

/** Wrap the selected form in a new list, leaving the caret where its head goes. */
export const wrap: Command = view => {
  const { from, to, empty } = view.state.selection.main;
  const node = empty ? innermostForm(view.state, from) : { from, to };
  if (!node) return false;
  view.dispatch({
    changes: [{ from: node.from, insert: "( " }, { from: node.to, insert: ")" }],
    selection: EditorSelection.cursor(node.from + 1),
    userEvent: "input.structure",
  });
  return true;
};

export const structuralCommands = { widenSelection, narrowSelection, slurp, barf, raise, splice, wrap } as const;

// -----------------------------------------------------------------------------
// Decorations: rainbow brackets, the hovered form, and focus dimming.
// -----------------------------------------------------------------------------

const BRACKETS = new Set(["(", ")", "[", "]", "{", "}"]);
const bracketMarks = [0, 1, 2, 3].map(depth => Decoration.mark({ class: `rd-bracket rd-bracket-${depth}` }));

const rainbowBrackets = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) this.decorations = this.build(update.view);
  }
  build(view: EditorView): DecorationSet {
    const marks: ReturnType<typeof bracketMarks[number]["range"]>[] = [];
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({ from, to, enter: ref => {
        if (!BRACKETS.has(ref.name)) return;
        let depth = -1;
        for (let parent = ref.node.parent; parent; parent = parent.parent) if (CONTAINERS.has(parent.name)) depth++;
        marks.push(bracketMarks[Math.max(0, depth) % 4]!.range(ref.from, ref.to));
      } });
    }
    return Decoration.set(marks, true);
  }
}, { decorations: plugin => plugin.decorations });

const setHovered = StateEffect.define<Range | null>();
const hoveredMark = Decoration.mark({ class: "rd-form-hover" });

export const hoveredForm = StateField.define<Range | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setHovered)) return effect.value;
    return value && tr.docChanged ? null : value;
  },
  provide: field => EditorView.decorations.from(field, range => range && range.to > range.from ? Decoration.set([hoveredMark.range(range.from, range.to)]) : Decoration.none),
});

export function setHoveredForm(view: EditorView, range: Range | null): void {
  const current = view.state.field(hoveredForm);
  if (current?.from === range?.from && current?.to === range?.to) return;
  view.dispatch({ effects: setHovered.of(range) });
}

const dimmed = Decoration.mark({ class: "rd-dimmed" });
const focused = Decoration.mark({ class: "rd-form-selected" });

const focusDimming = EditorView.decorations.compute(["selection", structuralSelection], state => {
  const { from, to, empty } = state.selection.main;
  if (empty || !state.field(structuralSelection).active) return Decoration.none;
  const ranges = [];
  if (from > 0) ranges.push(dimmed.range(0, from));
  ranges.push(focused.range(from, to));
  if (to < state.doc.length) ranges.push(dimmed.range(to, state.doc.length));
  return Decoration.set(ranges);
});

/** Alt-click selects the form under the pointer. */
const altClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!event.altKey || event.button !== 0) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    const node = pos == null ? null : innermostForm(view.state, pos);
    if (!node) return false;
    event.preventDefault();
    selectForm(view, node);
    return true;
  },
});

export function structure(): Extension {
  return [
    structuralSelection,
    hoveredForm,
    rainbowBrackets,
    focusDimming,
    altClick,
    Prec.high(keymap.of([
      { key: "Alt-ArrowUp", run: widenSelection },
      { key: "Alt-ArrowDown", run: narrowSelection },
      { key: "Alt-ArrowLeft", run: stepSibling(-1) },
      { key: "Alt-ArrowRight", run: stepSibling(1) },
      { key: "Mod-]", run: view => (slurp(view), true) },
      { key: "Mod-[", run: view => (barf(view), true) },
      { key: "Alt-r", run: raise },
      { key: "Alt-s", run: splice },
      { key: "Alt-w", run: wrap },
    ])),
  ];
}
