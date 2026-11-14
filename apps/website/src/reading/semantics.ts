/**
 * The checker's answers inside the editor: hover cards, the hovered form's
 * outline, and each top-level definition's type at the end of its first line.
 */
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, hoverTooltip, type Tooltip } from "@codemirror/view";
import type { ReadingClient } from "./client";
import type { Analysis, TypedForm } from "./protocol";
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

function hover(client: ReadingClient): Extension {
  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    const described = describedAt(view.state, pos);
    const source = view.state.doc.toString();
    // A prelude form's head describes the form, not a value.
    const list = innermostForm(view.state, pos);
    const head = list?.name === "List" ? listHead(view.state, list) : undefined;
    const onHead = head && head.from <= pos && pos <= head.to ? head : undefined;
    const inspection = onHead ? await client.inspect(source, onHead.from, onHead.from) : {};
    const form = inspection.form && inspection.form.from === list!.from ? inspection.form : undefined;
    if (!described && !form) return null;
    const range = form ? onHead! : described!.range;
    return {
      pos: range.from,
      end: range.to,
      above: true,
      create() {
        const dom = element("div", "rd-hover");
        if (form) {
          const head = element("div", "rd-hover-head");
          head.append(element("span", "rd-hover-kind", "prelude form"), element("span", "rd-hover-source", form.prelude ?? "prelude"));
          dom.append(head, tokenDom([{ text: "(", cls: "punct" }, { text: form.name, cls: "type" }, { text: " …)", cls: "punct" }, ...(form.produces ? [{ text: "  ⇒ ", cls: "punct" as const }, { text: form.produces, cls: "type" as const }] : [])], "rd-hover-type"));
          if (form.doc) dom.append(element("p", "rd-hover-doc", firstSentence(form.doc)));
          return { dom };
        }
        const { typed } = described!;
        const head = element("div", "rd-hover-head");
        head.append(element("span", "rd-hover-kind", describeTag(typed.tag)), element("span", "rd-hover-source", checkerOf(typed.tag)));
        dom.append(head, tokenDom(typeTokens(typed.type, 56), "rd-hover-type"));
        const effect = effectOf(parseType(typed.type));
        if (effect) {
          dom.append(chipRow("fails with", effect.errors.map(e => textOf(printType(e))), "error"));
          dom.append(chipRow("requires", effect.reqs.map(r => textOf(printType(r))), "req"));
        }
        dom.append(element("div", "rd-hover-hint", "Alt-click to select · Alt-↑ to widen"));
        return { dom };
      },
    };
  }, { hoverTime: 220 });
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

export function semantics(client: ReadingClient): Extension {
  return [analysisField, inlineTypesField, hover(client), hoverOutline, inlineTypes];
}
