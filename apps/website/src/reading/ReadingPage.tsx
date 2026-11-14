import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { closeBrackets } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter } from "@codemirror/language";
import { setDiagnostics } from "@codemirror/lint";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, type Command } from "@codemirror/view";
import { editorAppearance, lispSupport } from "@formalang/editor/codemirror";
import { ArrowDownToLine, ArrowUpFromLine, ChevronsLeftRight, ChevronsRightLeft, CornerLeftUp, Parentheses, Scissors } from "lucide-react";
import { useDocumentMeta } from "../lib/documentMeta";
import { useTheme } from "../lib/theme";
import { ReadingClient } from "./client";
import { readingExamples } from "./examples";
import { Inspector, type OutlineEntry, type Subject } from "./Inspector";
import type { Analysis, Inspection } from "./protocol";
import { currentAnalysis, describedAt, semantics, setAnalysis, setInlineTypes, typedFor } from "./semantics";
import { ancestry, formLabel, innermostForm, selectForm, structuralCommands, structure, topLevelForms, type Range } from "./structure";
import "./reading.css";

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = mac ? "⌘" : "Ctrl";
const ALT = mac ? "⌥" : "Alt";

const readerTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent" },
  ".cm-scroller": { fontFamily: "\"IBM Plex Mono\", ui-monospace, monospace", lineHeight: "1.75" },
  ".cm-content": { fontSize: "14.5px", padding: "20px 0 40vh" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-tooltip": { border: "none", backgroundColor: "transparent" },
  ".cm-tooltip-hover": { border: "none", backgroundColor: "transparent", boxShadow: "none" },
});

interface Breadcrumb extends Range { readonly label: string }

export function ReadingPage() {
  useDocumentMeta({ title: "Reading Forma", description: "Read Forma code with its types, effects, and prelude forms." });
  const { theme } = useTheme();
  const [search, setSearch] = useSearchParams();
  const exampleId = readingExamples.some(example => example.id === search.get("example")) ? search.get("example")! : readingExamples[0]!.id;
  const example = readingExamples.find(candidate => candidate.id === exampleId)!;

  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const client = useRef<ReadingClient | null>(null);
  const appearance = useRef(new Compartment());
  const extensions = useRef<Extension[] | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const [analysis, setAnalysisState] = useState<Analysis | null>(null);
  const [checking, setChecking] = useState(true);
  const [selection, setSelection] = useState<{ readonly from: number; readonly to: number; readonly version: number }>({ from: 0, to: 0, version: 0 });
  const [inspection, setInspection] = useState<Inspection>({});
  const [inlineTypes, setInlineTypesState] = useState(true);

  const analyze = useCallback((editor: EditorView) => {
    window.clearTimeout(timer.current);
    setChecking(true);
    timer.current = window.setTimeout(async () => {
      const source = editor.state.doc.toString();
      const result = await client.current!.analyze(source);
      if (view.current !== editor || editor.state.doc.toString() !== result.source) return;
      editor.dispatch(
        { effects: setAnalysis.of(result) },
        setDiagnostics(editor.state, result.diagnostics.map(d => ({ from: d.from, to: Math.max(d.to, Math.min(d.from + 1, editor.state.doc.length)), severity: d.severity, message: d.message, source: d.code }))),
      );
      setAnalysisState(result);
      setChecking(false);
    }, 120);
  }, []);

  const stateFor = useCallback((source: string) => EditorState.create({ doc: source, extensions: extensions.current! }), []);

  const focusExample = useCallback((editor: EditorView, focus: string | undefined) => {
    const index = focus ? editor.state.doc.toString().indexOf(focus) : -1;
    if (index < 0) return;
    let node = innermostForm(editor.state, index + 1);
    while (node && node.from !== index) node = node.parent;
    if (node) selectForm(editor, node);
  }, []);

  useEffect(() => {
    client.current = new ReadingClient();
    extensions.current = [
      lispSupport(),
      appearance.current.of([editorAppearance(theme, "forma"), readerTheme]),
      history(), bracketMatching(), closeBrackets(), lineNumbers(), foldGutter({ openText: "⌄", closedText: "›" }),
      structure(),
      semantics(client.current),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({ "aria-label": "Forma source", spellcheck: "false" }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) analyze(update.view);
        if (update.docChanged || update.selectionSet) {
          const { from, to } = update.state.selection.main;
          setSelection(previous => ({ from, to, version: previous.version + 1 }));
        }
      }),
    ];
    const editor = new EditorView({ parent: host.current!, state: stateFor(example.source) });
    view.current = editor;
    analyze(editor);
    focusExample(editor, example.focus);
    return () => { editor.destroy(); view.current = null; client.current?.dispose(); client.current = null; };
    // The editor is created once; examples and theme reconfigure it.
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === example.source) return;
    editor.setState(stateFor(example.source));
    editor.dispatch({ effects: setInlineTypes.of(inlineTypes) });
    setAnalysisState(null);
    setInspection({});
    analyze(editor);
    focusExample(editor, example.focus);
  }, [example]);

  useEffect(() => {
    view.current?.dispatch({ effects: appearance.current.reconfigure([editorAppearance(theme, "forma"), readerTheme]) });
  }, [theme]);

  useEffect(() => {
    view.current?.dispatch({ effects: setInlineTypes.of(inlineTypes) });
  }, [inlineTypes]);

  // The subject is the selected form, or the typed form at the caret.
  const [subject, setSubject] = useState<Subject | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<readonly Breadcrumb[]>([]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const state = editor.state;
    const fresh = currentAnalysis(state);
    if (!fresh) return;
    const { from, to, empty, head } = state.selection.main;
    const range = empty ? describedAt(state, head)?.range ?? (() => { const node = innermostForm(state, head); return node && node.from < head && head < node.to ? node : undefined; })() : { from, to };
    if (!range) { setSubject(null); setBreadcrumbs([]); return; }
    const found = typedFor(fresh, range);
    setSubject({ from: range.from, to: range.to, text: state.sliceDoc(range.from, range.to), typed: found?.typed, exact: found?.exact ?? false });
    setBreadcrumbs(ancestry(state, range.from, range.to).map(node => ({ from: node.from, to: node.to, label: formLabel(state, node) })));
  }, [selection, analysis]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || !subject || !client.current) { setInspection({}); return; }
    let live = true;
    void client.current.inspect(editor.state.doc.toString(), subject.from, subject.to).then(result => { if (live) setInspection(result); });
    return () => { live = false; };
  }, [subject?.from, subject?.to, subject?.text, analysis]);

  const outline = useMemo((): OutlineEntry[] => {
    const editor = view.current;
    if (!editor || !analysis || analysis.source !== editor.state.doc.toString()) return [];
    return topLevelForms(editor.state).filter(node => node.name !== "LineComment").map(node => ({
      from: node.from,
      to: node.to,
      label: formLabel(editor.state, node).replace(" …)", ` ${editor.state.sliceDoc(node.from, node.to).match(/^\(\S+\s+([^\s()[\]{}]+)/)?.[1] ?? "…"})`),
      type: analysis.typed.find(t => t.from === node.from && t.to === node.to && t.tag !== "TypeDef")?.type,
    }));
  }, [analysis]);

  const run = (command: Command) => () => { const editor = view.current; if (editor) { command(editor); editor.focus(); } };
  const onSelect = (range: Range) => { const editor = view.current; if (editor) { selectForm(editor, range); editor.focus(); } };
  const onReplace = (range: Range, text: string) => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection: EditorSelection.cursor(range.from + text.length) });
    editor.focus();
  };
  const onJumpToName = (name: string) => {
    const editor = view.current;
    if (!editor) return false;
    const match = new RegExp(`\\((?:type|error|service|define)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s)]`).exec(editor.state.doc.toString());
    if (!match) return false;
    const node = innermostForm(editor.state, match.index + 1);
    let form = node;
    while (form && form.from !== match.index) form = form.parent;
    if (form) onSelect(form);
    return Boolean(form);
  };

  const errors = analysis?.diagnostics.filter(d => d.severity === "error").length ?? 0;
  const warnings = analysis?.diagnostics.filter(d => d.severity === "warning").length ?? 0;

  return <main className="rd-page">
    <header className="rd-top">
      <div className="rd-title">
        <span className="rd-eyebrow">Prototype · reading editor</span>
        <h1>Read Forma with its types</h1>
        <p>{example.blurb}</p>
      </div>
      <nav aria-label="Examples" className="rd-examples">
        {readingExamples.map(candidate => <button aria-pressed={candidate.id === exampleId} className={candidate.id === exampleId ? "active" : ""} key={candidate.id} onClick={() => setSearch({ example: candidate.id })} type="button">{candidate.label}</button>)}
      </nav>
    </header>

    <div className="rd-workspace">
      <section className="rd-editor-pane">
        <div className="rd-toolbar">
          <nav aria-label="Enclosing forms" className="rd-breadcrumbs">
            {breadcrumbs.length ? breadcrumbs.map((crumb, index) => <button className={index === breadcrumbs.length - 1 ? "current" : ""} key={`${crumb.from}:${crumb.to}`} onClick={() => onSelect(crumb)} type="button">{crumb.label}</button>) : <span className="rd-muted">top level</span>}
          </nav>
          <div className="rd-tools">
            <button onClick={run(structuralCommands.widenSelection)} title={`Widen selection to the enclosing form (${ALT}↑)`} type="button"><ArrowUpFromLine size={14} />Widen</button>
            <button onClick={run(structuralCommands.narrowSelection)} title={`Narrow selection (${ALT}↓)`} type="button"><ArrowDownToLine size={14} />Narrow</button>
            <span className="rd-tool-gap" />
            <button onClick={run(structuralCommands.slurp)} title={`Slurp the next form into this list (${MOD}])`} type="button"><ChevronsLeftRight size={14} />Slurp</button>
            <button onClick={run(structuralCommands.barf)} title={`Barf the last form out of this list (${MOD}[)`} type="button"><ChevronsRightLeft size={14} />Barf</button>
            <button onClick={run(structuralCommands.raise)} title={`Replace the parent with this form (${ALT}R)`} type="button"><CornerLeftUp size={14} />Raise</button>
            <button onClick={run(structuralCommands.splice)} title={`Remove the enclosing brackets (${ALT}S)`} type="button"><Scissors size={14} />Splice</button>
            <button onClick={run(structuralCommands.wrap)} title={`Wrap this form in a new list (${ALT}W, or type "(" over a selection)`} type="button"><Parentheses size={14} />Wrap</button>
            <span className="rd-tool-gap" />
            <label className="rd-toggle"><input checked={inlineTypes} onChange={event => setInlineTypesState(event.target.checked)} type="checkbox" />Inline types</label>
          </div>
        </div>
        <div className="rd-editor" ref={host} />
        <footer className="rd-status">
          <span className={`rd-check ${checking ? "busy" : errors ? "bad" : "good"}`}>
            <span className="rd-dot" />
            {checking ? "Checking…" : errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : "Types check"}
            {warnings ? ` · ${warnings} ${warnings === 1 ? "warning" : "warnings"}` : ""}
            {analysis && !checking ? <span className="rd-muted"> · {Math.max(1, Math.round(analysis.durationMs))} ms</span> : null}
          </span>
          <span className="rd-keys">
            <kbd>{ALT}-click</kbd> select form <kbd>{ALT}↑</kbd><kbd>{ALT}↓</kbd> widen · narrow <kbd>{ALT}←</kbd><kbd>{ALT}→</kbd> siblings <kbd>{MOD}]</kbd><kbd>{MOD}[</kbd> slurp · barf
          </span>
        </footer>
      </section>
      <aside aria-label="Selected form" className="rd-inspector">
        <Inspector analysis={analysis} inspection={inspection} onJumpToName={onJumpToName} onReplace={onReplace} onSelect={onSelect} outline={outline} subject={subject} />
      </aside>
    </div>
  </main>;
}
