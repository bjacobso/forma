import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { closeBrackets, snippet } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter } from "@codemirror/language";
import { setDiagnostics } from "@codemirror/lint";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, type Command } from "@codemirror/view";
import { editorAppearance, lispSupport } from "@formalang/editor/codemirror";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Braces, ChevronsLeftRight, ChevronsRightLeft, CornerLeftUp, Lock, Parentheses, Plus, Scissors, X } from "lucide-react";
import { useDocumentMeta } from "../lib/documentMeta";
import { useTheme } from "../lib/theme";
import { ReadingClient } from "./client";
import { readingExamples } from "./examples";
import { Inspector, type OutlineEntry, type Subject } from "./Inspector";
import { isPreludeFile, type Analysis, type Inspection, type Location, type Problems, type SnippetEntry, type SourceFile } from "./protocol";
import { currentAnalysis, describedAt, ensureLibraryImport, semantics, setAnalysis, setInlineTypes, typedFor } from "./semantics";
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

/** Bundled preludes open read-only. */
const readOnlyPrelude = [EditorState.readOnly.of(true), EditorState.transactionFilter.of(tr => (tr.docChanged ? [] : tr))];

const tabLabel = (id: string) => id;

interface Breadcrumb extends Range { readonly label: string }
interface Place { readonly file: string; readonly anchor: number; readonly head: number }

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
  const problemsTimer = useRef<number | undefined>(undefined);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // Open files, the shown file, each file's editor state (keeps undo), and where go to definition came from.
  const filesRef = useRef<readonly SourceFile[]>(example.files);
  const activeRef = useRef<string>(example.files[0]!.id);
  const states = useRef(new Map<string, EditorState>());
  const [fileIds, setFileIds] = useState<readonly string[]>(example.files.map(f => f.id));
  const [active, setActive] = useState(activeRef.current);
  const [backStack, setBackStack] = useState<readonly Place[]>([]);
  const [problems, setProblems] = useState<Problems>({});

  const [analysis, setAnalysisState] = useState<Analysis | null>(null);
  const [checking, setChecking] = useState(true);
  const [selection, setSelection] = useState(0);
  const [inspection, setInspection] = useState<Inspection>({});
  const [inlineTypes, setInlineTypesState] = useState(true);
  const inlineRef = useRef(inlineTypes);
  inlineRef.current = inlineTypes;
  const [snippetMenu, setSnippetMenu] = useState<readonly SnippetEntry[] | null>(null);

  const refreshProblems = useCallback(() => {
    window.clearTimeout(problemsTimer.current);
    problemsTimer.current = window.setTimeout(async () => {
      if (client.current) setProblems(await client.current.problems(filesRef.current));
    }, 400);
  }, []);

  const analyze = useCallback((editor: EditorView) => {
    window.clearTimeout(timer.current);
    setChecking(true);
    timer.current = window.setTimeout(async () => {
      const file = activeRef.current;
      const result = await client.current!.analyze(filesRef.current, file);
      if (view.current !== editor || activeRef.current !== file || editor.state.doc.toString() !== result.source) return;
      editor.dispatch(
        { effects: setAnalysis.of(result) },
        setDiagnostics(editor.state, result.diagnostics.map(d => ({ from: d.from, to: Math.max(d.to, Math.min(d.from + 1, editor.state.doc.length)), severity: d.severity, message: d.message, source: d.code }))),
      );
      setAnalysisState(result);
      setChecking(false);
    }, 120);
  }, []);

  const stateFor = useCallback((file: SourceFile) => EditorState.create({
    doc: file.source,
    extensions: [...extensions.current!, appearance.current.of([editorAppearance(themeRef.current, "forma"), readerTheme]), ...(isPreludeFile(file.id) ? readOnlyPrelude : [])],
  }), []);

  /** Show a file in the editor, keeping the one we leave. */
  const show = useCallback((id: string) => {
    const editor = view.current;
    if (!editor) return;
    if (id !== activeRef.current) {
      states.current.set(activeRef.current, editor.state);
      const file = filesRef.current.find(f => f.id === id);
      if (!file) return;
      editor.setState(states.current.get(id) ?? stateFor(file));
      activeRef.current = id;
      setActive(id);
      setAnalysisState(null);
      setInspection({});
    }
    editor.dispatch({ effects: [appearance.current.reconfigure([editorAppearance(themeRef.current, "forma"), readerTheme]), setInlineTypes.of(inlineRef.current)] });
    analyze(editor);
  }, [analyze, stateFor]);

  const reveal = (editor: EditorView, range: Range) => {
    selectForm(editor, range);
    editor.dispatch({ effects: EditorView.scrollIntoView(range.from, { y: "center" }) });
    editor.focus();
  };

  /** Go to a definition, in this file, another open file, or a bundled prelude. */
  const open = useCallback((location: Location) => {
    const editor = view.current;
    if (!editor) return;
    const { anchor, head } = editor.state.selection.main;
    // Read the file now: the updater runs after show() switches files.
    const place = { file: activeRef.current, anchor, head };
    setBackStack(stack => [...stack.slice(-30), place]);
    if (!filesRef.current.some(f => f.id === location.file)) {
      if (location.source === undefined) return;
      filesRef.current = [...filesRef.current, { id: location.file, source: location.source }];
      setFileIds(filesRef.current.map(f => f.id));
    }
    show(location.file);
    reveal(editor, { from: location.formFrom, to: location.formTo });
  }, [show]);

  const back = () => {
    const editor = view.current;
    const place = backStack.at(-1);
    if (!editor || !place) return;
    setBackStack(stack => stack.slice(0, -1));
    show(place.file);
    editor.dispatch({ selection: EditorSelection.single(place.anchor, place.head), scrollIntoView: true });
    editor.focus();
  };

  const focusExample = useCallback((editor: EditorView, focus: string | undefined) => {
    const index = focus ? editor.state.doc.toString().indexOf(focus) : -1;
    if (index < 0) return;
    let node = innermostForm(editor.state, index + 1);
    while (node && node.from !== index) node = node.parent;
    if (node) selectForm(editor, node);
  }, []);

  const loadExample = useCallback((editor: EditorView) => {
    filesRef.current = example.files;
    activeRef.current = example.files[0]!.id;
    states.current.clear();
    setFileIds(example.files.map(f => f.id));
    setActive(activeRef.current);
    setBackStack([]);
    setProblems({});
    setAnalysisState(null);
    setInspection({});
    editor.setState(stateFor(example.files[0]!));
    editor.dispatch({ effects: setInlineTypes.of(inlineRef.current) });
    analyze(editor);
    refreshProblems();
    focusExample(editor, example.focus);
  }, [example, analyze, stateFor, focusExample, refreshProblems]);

  useEffect(() => {
    client.current = new ReadingClient();
    extensions.current = [
      lispSupport(),
      history(), bracketMatching(), closeBrackets(), lineNumbers(), foldGutter({ openText: "⌄", closedText: "›" }),
      structure(),
      semantics(client.current, { files: () => filesRef.current, file: () => activeRef.current, open: location => open(location) }),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({ "aria-label": "Forma source", spellcheck: "false" }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          const source = update.state.doc.toString();
          filesRef.current = filesRef.current.map(f => (f.id === activeRef.current ? { ...f, source } : f));
          analyze(update.view);
          refreshProblems();
        }
        if (update.docChanged || update.selectionSet) setSelection(version => version + 1);
      }),
    ];
    const editor = new EditorView({ parent: host.current! });
    view.current = editor;
    loadExample(editor);
    return () => { editor.destroy(); view.current = null; client.current?.dispose(); client.current = null; };
    // The editor is created once; examples, files, and theme reconfigure it.
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor || filesRef.current === example.files) return;
    loadExample(editor);
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
    if (!subject || !client.current) { setInspection({}); return; }
    let live = true;
    void client.current.inspect(filesRef.current, activeRef.current, subject.from, subject.to).then(result => { if (live) setInspection(result); });
    return () => { live = false; };
  }, [subject?.from, subject?.to, subject?.text, analysis]);

  const outline = useMemo((): OutlineEntry[] => {
    const editor = view.current;
    if (!editor || !analysis || analysis.source !== editor.state.doc.toString()) return [];
    return topLevelForms(editor.state).map(node => ({
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
  const onGoTo = (offset: number) => {
    void client.current?.definition(filesRef.current, activeRef.current, offset).then(location => { if (location) open(location); });
  };
  /** A type or service named in an Effect row: find its declaration in the open files. */
  const onJumpToName = (name: string) => {
    const pattern = new RegExp(`\\((?:type|error|service|define)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s)]`);
    const ordered = [...filesRef.current].sort((a, b) => Number(b.id === activeRef.current) - Number(a.id === activeRef.current));
    for (const file of ordered) {
      const match = pattern.exec(file.source);
      if (!match) continue;
      const editor = view.current;
      if (!editor) return false;
      const start = match.index;
      open({ file: file.id, from: start, to: start, formFrom: start, formTo: start });
      let form = innermostForm(editor.state, start + 1);
      while (form && form.from !== start) form = form.parent;
      if (form) reveal(editor, form);
      return true;
    }
    return false;
  };

  const addFile = () => {
    let index = 1;
    while (filesRef.current.some(f => f.id === `untitled-${index}.lisp`)) index++;
    // Start by importing from the file that exports the most names, such as a domain module.
    const exportsOf = (file: SourceFile) => file.source.match(/^\(export\s+([^)]*)\)/m)?.[1]?.trim().split(/\s+/) ?? [];
    const exporting = filesRef.current.filter(f => !isPreludeFile(f.id)).sort((a, b) => exportsOf(b).length - exportsOf(a).length)[0];
    const names = exporting && exportsOf(exporting).length ? exportsOf(exporting).join(" ") : undefined;
    const source = exporting && names
      ? `(import "./${exporting.id}" [${names}])\n\n`
      : `; A new file. Import names from another file with (import "./other.lisp" [Name]).\n\n`;
    filesRef.current = [...filesRef.current, { id: `untitled-${index}.lisp`, source }];
    setFileIds(filesRef.current.map(f => f.id));
    show(`untitled-${index}.lisp`);
    view.current?.dispatch({ selection: EditorSelection.cursor(source.length) });
    view.current?.focus();
    refreshProblems();
  };

  const closeFile = (id: string) => {
    if (id === activeRef.current) show(filesRef.current.find(f => f.id !== id && !isPreludeFile(f.id))?.id ?? filesRef.current[0]!.id);
    filesRef.current = filesRef.current.filter(f => f.id !== id);
    states.current.delete(id);
    setFileIds(filesRef.current.map(f => f.id));
    setBackStack(stack => stack.filter(place => place.file !== id));
    refreshProblems();
  };

  const toggleSnippets = async () => {
    if (snippetMenu) { setSnippetMenu(null); return; }
    setSnippetMenu(await client.current!.snippets(filesRef.current, activeRef.current));
  };
  const insertSnippet = (entry: SnippetEntry) => {
    const editor = view.current;
    const all = snippetMenu ?? [];
    setSnippetMenu(null);
    if (!editor || isPreludeFile(activeRef.current)) return;
    const { from, to } = editor.state.selection.main;
    const afterParen = editor.state.sliceDoc(from - 1, from) === "(";
    snippet(afterParen ? entry.template : `(${entry.template})`)(editor, null, from, to);
    ensureLibraryImport(editor, entry.group, all.filter(candidate => candidate.group === entry.group).map(candidate => candidate.label));
    editor.focus();
  };
  const snippetGroups = useMemo(() => {
    const groups = new Map<string, SnippetEntry[]>();
    for (const entry of snippetMenu ?? []) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
    return [...groups];
  }, [snippetMenu]);

  const errors = analysis?.diagnostics.filter(d => d.severity === "error").length ?? 0;
  const warnings = analysis?.diagnostics.filter(d => d.severity === "warning").length ?? 0;
  const readOnly = isPreludeFile(active);

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
        <div className="rd-files" role="tablist" aria-label="Files">
          <button className="rd-back" disabled={!backStack.length} onClick={back} title="Back to where you came from" type="button"><ArrowLeft size={14} /></button>
          {fileIds.map(id => {
            const counts = problems[id];
            const prelude = isPreludeFile(id);
            return <div aria-selected={id === active} className={`rd-file${id === active ? " active" : ""}${prelude ? " prelude" : ""}`} key={id} role="tab">
              <button onClick={() => show(id)} type="button">
                {prelude ? <Lock size={11} /> : null}
                {tabLabel(id)}
                {counts?.errors ? <span className="rd-file-count bad">{counts.errors}</span> : counts ? <span className="rd-file-ok" title="Types check" /> : null}
              </button>
              {fileIds.length > 1 ? <button aria-label={`Close ${tabLabel(id)}`} className="rd-file-close" onClick={() => closeFile(id)} type="button"><X size={12} /></button> : null}
            </div>;
          })}
          <button className="rd-add-file" onClick={addFile} title="New file" type="button"><Plus size={14} /></button>
        </div>
        <div className="rd-toolbar">
          <nav aria-label="Enclosing forms" className="rd-breadcrumbs">
            {breadcrumbs.length ? breadcrumbs.map((crumb, index) => <button className={index === breadcrumbs.length - 1 ? "current" : ""} key={`${crumb.from}:${crumb.to}`} onClick={() => onSelect(crumb)} type="button">{crumb.label}</button>) : <span className="rd-muted">{readOnly ? "bundled prelude · read-only" : "top level"}</span>}
          </nav>
          <div className="rd-tools">
            <button onClick={run(structuralCommands.widenSelection)} title={`Widen selection to the enclosing form (${ALT}↑)`} type="button"><ArrowUpFromLine size={14} />Widen</button>
            <button onClick={run(structuralCommands.narrowSelection)} title={`Narrow selection (${ALT}↓)`} type="button"><ArrowDownToLine size={14} />Narrow</button>
            <span className="rd-tool-gap" />
            <button disabled={readOnly} onClick={run(structuralCommands.slurp)} title={`Slurp the next form into this list (${MOD}])`} type="button"><ChevronsLeftRight size={14} />Slurp</button>
            <button disabled={readOnly} onClick={run(structuralCommands.barf)} title={`Barf the last form out of this list (${MOD}[)`} type="button"><ChevronsRightLeft size={14} />Barf</button>
            <button disabled={readOnly} onClick={run(structuralCommands.raise)} title={`Replace the parent with this form (${ALT}R)`} type="button"><CornerLeftUp size={14} />Raise</button>
            <button disabled={readOnly} onClick={run(structuralCommands.splice)} title={`Remove the enclosing brackets (${ALT}S)`} type="button"><Scissors size={14} />Splice</button>
            <button disabled={readOnly} onClick={run(structuralCommands.wrap)} title={`Wrap this form in a new list (${ALT}W)`} type="button"><Parentheses size={14} />Wrap</button>
            <span className="rd-tool-gap" />
            <div className="rd-snippets">
              <button aria-expanded={Boolean(snippetMenu)} disabled={readOnly} onClick={() => void toggleSnippets()} title="Insert a form from the preludes as a snippet; Tab moves between its fields" type="button"><Braces size={14} />Insert</button>
              {snippetMenu ? <div className="rd-snippet-menu" role="menu">
                {snippetGroups.map(([group, entries]) => <div className="rd-snippet-group" key={group}>
                  <div className="rd-snippet-group-label">{group}</div>
                  {entries.map(entry => <button key={entry.label} onClick={() => insertSnippet(entry)} role="menuitem" type="button">
                    <code>({entry.label} …)</code>
                    {entry.doc ? <span>{entry.doc}</span> : null}
                  </button>)}
                </div>)}
              </div> : null}
            </div>
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
            <kbd>{MOD}-click</kbd><kbd>F12</kbd> definition <kbd>{ALT}-click</kbd> select form <kbd>{ALT}↑</kbd><kbd>{ALT}↓</kbd> widen · narrow <kbd>{MOD}]</kbd><kbd>{MOD}[</kbd> slurp · barf
          </span>
        </footer>
      </section>
      <aside aria-label="Selected form" className="rd-inspector">
        <Inspector analysis={analysis} inspection={inspection} onGoTo={onGoTo} onJumpToName={onJumpToName} onReplace={onReplace} onSelect={onSelect} outline={outline} subject={subject} />
      </aside>
    </div>
  </main>;
}
