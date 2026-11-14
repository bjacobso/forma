/**
 * The checker's answers inside the editor: hover cards, the hovered form's
 * outline, and each top-level definition's type at the end of its first line.
 */
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { autocompletion, snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { Decoration, EditorView, ViewPlugin, WidgetType, hoverTooltip, keymap, type Tooltip } from "@codemirror/view";
import type { ReadingClient } from "./client";
import type { Analysis, FormInfo, Location, SlotInfo, SourceFile, TypedForm } from "./protocol";
import { innermostForm, isForm, listHead, setHoveredForm, topLevelForms, type FormNode, type Range } from "./structure";
import { checkerOf, describeTag, effectOf, friendlyVars, parseType, printType, textOf, type Token } from "./types";

export const setAnalysis = StateEffect.define<Analysis>();
export const setInlineTypes = StateEffect.define<boolean>();

export const analysisField = StateField.define<Analysis | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setAnalysis)) return effect.value;
    return value;
  },
});

const inlineTypesField = StateField.define<boolean>({
  create: () => true,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setInlineTypes)) return effect.value;
    return value;
  },
});

/** The analysis of exactly this text, so offsets line up. */
export function currentAnalysis(state: EditorState): Analysis | null {
  const analysis = state.field(analysisField, false) ?? null;
  return analysis && analysis.source.length === state.doc.length && analysis.source === state.doc.toString() ? analysis : null;
}

/** The type recorded for exactly this range, else for the smallest typed form around it. */
export function typedFor(analysis: Analysis, range: Range): { readonly typed: TypedForm; readonly exact: boolean } | undefined {
  const exact = analysis.typed.find(t => t.from === range.from && t.to === range.to);
  if (exact) return { typed: exact, exact: true };
  let best: TypedForm | undefined;
  for (const t of analysis.typed) if (t.from <= range.from && range.to <= t.to && (!best || t.to - t.from < best.to - best.from)) best = t;
  return best ? { typed: best, exact: false } : undefined;
}

/** The form a pointer describes: the innermost form at it that has a type. */
export function describedAt(state: EditorState, pos: number): { readonly range: Range; readonly typed: TypedForm } | undefined {
  const analysis = currentAnalysis(state);
  if (!analysis) return undefined;
  for (let node: FormNode | null = innermostForm(state, pos); node; node = node.parent) {
    if (!isForm(node)) continue;
    const typed = analysis.typed.find(t => t.from === node!.from && t.to === node!.to);
    if (typed) return { range: { from: node.from, to: node.to }, typed };
  }
  return undefined;
}

export function typeTokens(display: string, width?: number): Token[] {
  return printType(friendlyVars(parseType(display)), width);
}

function tokenDom(tokens: readonly Token[], className: string): HTMLElement {
  const pre = document.createElement("pre");
  pre.className = className;
  for (const token of tokens) {
    const span = document.createElement("span");
    span.textContent = token.text;
    if (token.cls) span.className = `rd-t-${token.cls}`;
    pre.append(span);
  }
  return pre;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function chipRow(label: string, items: readonly string[], kind: "error" | "req"): HTMLElement {
  const row = element("div", "rd-hover-row");
  row.append(element("span", "rd-hover-label", label));
  if (items.length === 0) row.append(element("span", "rd-chip rd-chip-none", "none"));
  for (const item of items) row.append(element("span", `rd-chip rd-chip-${kind}`, item));
  return row;
}

function firstSentence(doc: string): string {
  const match = /^.*?[.!?](\s|$)/s.exec(doc.replace(/\s+/g, " "));
  return (match ? match[0] : doc).trim();
}

/** What the editor needs to reach other files: the open set, the shown file, and a way to open a location. */
export interface ReadingWorkspace {
  readonly files: () => readonly SourceFile[];
  readonly file: () => string;
  readonly open: (location: Location) => void;
}

function formCard(form: FormInfo): HTMLElement {
  const dom = element("div", "rd-hover rd-hover-form");
  const head = element("div", "rd-hover-head");
  head.append(element("span", "rd-hover-kind", "prelude form"), element("span", "rd-hover-source", form.prelude ?? "prelude"));
  dom.append(head);
  dom.append(element("pre", "rd-hover-pattern", form.pattern ?? `(${form.name} …)`));
  if (form.produces) {
    const produces = element("div", "rd-hover-produces");
    produces.append(element("span", "rd-hover-label", "produces"), element("code", "rd-t-type", form.produces));
    dom.append(produces);
  }
  for (const paragraph of form.doc?.split("\n\n") ?? []) dom.append(element("p", "rd-hover-doc", paragraph));
  const required = form.slots.filter(slot => slot.required);
  const optional = form.slots.filter(slot => !slot.required);
  if (form.slots.length) {
    const table = element("div", "rd-hover-slots");
    for (const slot of [...required, ...optional]) {
      const row = element("div", `rd-hover-slot${slot.required ? " required" : ""}`);
      row.append(element("code", "rd-hover-slot-name", `:${slot.name}${slot.many ? " …" : ""}`), element("code", "rd-hover-slot-type", slot.type ?? ""));
      table.append(row);
    }
    dom.append(table);
  }
  if (form.example) {
    dom.append(element("div", "rd-hover-label rd-hover-example-label", "example"));
    dom.append(element("pre", "rd-hover-example", form.example));
  }
  dom.append(element("div", "rd-hover-hint", `${MOD}-click to open in ${form.prelude ?? "the prelude"}`));
  return dom;
}

function slotCard(form: FormInfo, slot: SlotInfo): HTMLElement {
  const dom = element("div", "rd-hover");
  const head = element("div", "rd-hover-head");
  head.append(element("span", "rd-hover-kind", `slot of ${form.name}`), element("span", "rd-hover-source", slot.required ? "required" : "optional"));
  dom.append(head, element("pre", "rd-hover-type", `:${slot.name}  ${slot.type ?? ""}`));
  if (slot.doc) dom.append(element("p", "rd-hover-doc", slot.doc));
  if (form.doc) dom.append(element("p", "rd-hover-doc rd-hover-faint", firstSentence(form.doc)));
  return dom;
}

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

function hover(client: ReadingClient, workspace: ReadingWorkspace): Extension {
  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    const described = describedAt(view.state, pos);
    const files = workspace.files();
    const file = workspace.file();
    const node = innermostForm(view.state, pos);
    // A prelude form's head describes the form; a slot keyword describes the slot.
    // Heads such as `entity` are specialized out of the tree, so the list itself can be innermost.
    const list = node?.name === "List" ? node : node?.parent?.name === "List" ? node.parent : undefined;
    const head = list ? listHead(view.state, list) : undefined;
    const onHead = head && head.from <= pos && pos <= head.to ? head : undefined;
    const keyword = node?.name === "Keyword" && node.parent?.name === "List" ? node : undefined;
    const probe = onHead?.from ?? keyword?.from;
    const inspection = probe !== undefined ? await client.inspect(files, file, probe, probe) : {};
    const form = onHead && inspection.form?.from === list!.from ? inspection.form : undefined;
    const slot = keyword && inspection.form?.from === keyword.parent!.from
      ? inspection.form.slots.find(candidate => candidate.name === view.state.sliceDoc(keyword.from + 1, keyword.to)) : undefined;
    if (form && onHead) return { pos: onHead.from, end: onHead.to, above: true, create: () => ({ dom: formCard(form) }) };
    if (slot && keyword) return { pos: keyword.from, end: keyword.to, above: true, create: () => ({ dom: slotCard(inspection.form!, slot) }) };
    if (!described) return null;
    const { typed, range } = described;
    return {
      pos: range.from,
      end: range.to,
      above: true,
      create() {
        const dom = element("div", "rd-hover");
        const head = element("div", "rd-hover-head");
        head.append(element("span", "rd-hover-kind", describeTag(typed.tag)), element("span", "rd-hover-source", checkerOf(typed.tag)));
        dom.append(head, tokenDom(typeTokens(typed.type, 56), "rd-hover-type"));
        const effect = effectOf(parseType(typed.type));
        if (effect) {
          dom.append(chipRow("fails with", effect.errors.map(e => textOf(printType(e))), "error"));
          dom.append(chipRow("requires", effect.reqs.map(r => textOf(printType(r))), "req"));
        }
        dom.append(element("div", "rd-hover-hint", `Alt-click to select · ${MOD}-click to go to definition`));
        return { dom };
      },
    };
  }, { hoverTime: 220 });
}

/** Go to definition: Mod-click or F12 on a name, including prelude form heads. */
function goToDefinition(client: ReadingClient, workspace: ReadingWorkspace): Extension {
  const go = async (view: EditorView, pos: number) => {
    const location = await client.definition(workspace.files(), workspace.file(), pos);
    if (location) workspace.open(location);
    return Boolean(location);
  };
  return [
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        event.preventDefault();
        void go(view, pos);
        return true;
      },
    }),
    keymap.of([{ key: "F12", run: view => { void go(view, view.state.selection.main.head); return true; } }]),
  ];
}

/** The import that selects each Effect library's prelude forms. */
const EFFECT_LIBRARIES: Readonly<Record<string, string>> = {
  "rpc.lisp": "forma:effect/rpc",
  "http-api.lisp": "forma:effect/http-api",
  "cluster.lisp": "forma:effect/cluster",
};

/**
 * A module (a file with imports) must import the Effect library whose forms it
 * uses. After inserting such a form, add the import below the last one.
 */
export function ensureLibraryImport(view: EditorView, prelude: string, names: readonly string[]): void {
  const library = EFFECT_LIBRARIES[prelude];
  const source = view.state.doc.toString();
  const imports = [...source.matchAll(/^\(import\s[^\n]*\)[ \t]*$/gm)];
  if (!library || !imports.length || source.includes(`"${library}"`)) return;
  const last = imports.at(-1)!;
  view.dispatch({ changes: { from: last.index + last[0].length, insert: `\n(import "${library}" [${names.join(" ")}])` } });
}

/** Completion from the workspace, with snippets for kernel forms and prelude forms. */
function completion(client: ReadingClient, workspace: ReadingWorkspace): Extension {
  const source = async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/[^\s()[\]{}"';`~]*/);
    if (!context.explicit && (!word || word.from === word.to)) return null;
    const result = await client.complete(workspace.files(), workspace.file(), context.pos);
    if (!result) return null;
    return {
      from: result.from,
      validFor: /^[^\s()[\]{}"';`~]*$/,
      options: result.entries.map((entry): Completion => {
        const base = { label: entry.label, type: entry.kind === "form" ? "keyword" : entry.kind, boost: entry.boost ?? 0, ...(entry.detail ? { detail: entry.detail } : {}), ...(entry.info ? { info: entry.info } : {}) };
        if (!entry.template) return base;
        const completion = snippetCompletion(entry.template, base);
        const prelude = entry.detail?.startsWith("form · ") ? entry.detail.slice("form · ".length) : undefined;
        if (!prelude) return completion;
        const names = result.entries.filter(other => other.detail === entry.detail).map(other => other.label);
        const insert = completion.apply as (view: EditorView, completion: Completion, from: number, to: number) => void;
        return { ...completion, apply: (view, applied, from, to) => { insert(view, applied, from, to); ensureLibraryImport(view, prelude, names); } };
      }),
    };
  };
  return autocompletion({ override: [source], icons: false });
}

/** Outline the form the pointer describes, so the hover card's subject is visible. */
const hoverOutline = ViewPlugin.define(view => {
  const move = (event: MouseEvent) => {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    const described = describedAt(view.state, pos);
    setHoveredForm(view, described?.range ?? null);
  };
  const leave = () => setHoveredForm(view, null);
  view.contentDOM.addEventListener("mousemove", move);
  view.contentDOM.addEventListener("mouseleave", leave);
  return { destroy() { view.contentDOM.removeEventListener("mousemove", move); view.contentDOM.removeEventListener("mouseleave", leave); } };
});

class InlineType extends WidgetType {
  constructor(readonly text: string, readonly full: string) { super(); }
  eq(other: InlineType) { return other.text === this.text; }
  toDOM() {
    const span = element("span", "rd-inline-type", this.text);
    span.title = this.full;
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  ignoreEvent() { return false; }
}

const INLINE_TAGS = new Set(["Def", "Let", "App", "Mechanics.Declaration", "DSLForm"]);

const inlineTypes = EditorView.decorations.compute(["doc", analysisField, inlineTypesField], state => {
  const analysis = currentAnalysis(state);
  if (!analysis || !state.field(inlineTypesField)) return Decoration.none;
  const widgets = [];
  let signed: string | undefined;
  for (const node of topLevelForms(state)) {
    const text = state.sliceDoc(node.from, Math.min(node.to, node.from + 120));
    // A (: name type) just above already states the type.
    const repeats = signed !== undefined && new RegExp(`^\\(\\S+\\s+${signed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s[]`).test(text);
    signed = /^\(:\s+([^\s()]+)/.exec(text)?.[1];
    const typed = analysis.typed.find(t => t.from === node.from && t.to === node.to && INLINE_TAGS.has(t.tag));
    if (!typed || repeats) continue;
    const type = textOf(typeTokens(typed.type, Infinity));
    const shown = type.length > 64 ? `${type.slice(0, 63)}…` : type;
    widgets.push(Decoration.widget({ widget: new InlineType(shown, type), side: 1 }).range(state.doc.lineAt(node.from).to));
  }
  return Decoration.set(widgets, true);
});

export function semantics(client: ReadingClient, workspace: ReadingWorkspace): Extension {
  return [analysisField, inlineTypesField, hover(client, workspace), hoverOutline, inlineTypes, goToDefinition(client, workspace), completion(client, workspace)];
}
