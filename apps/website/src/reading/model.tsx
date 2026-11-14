/**
 * The reader's state and actions, shared by its parts through context. A
 * <ReaderRoot> owns one set of files, one CodeMirror view, and a handle on the
 * shared analysis worker; parts such as the editor, tabs, sidebar, inspector,
 * and panels read and drive it with useReader(). Compose them freely: the full
 * reader, an inline snippet, and a demo layout are different arrangements.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { closeBrackets, snippet } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter } from "@codemirror/language";
import { setDiagnostics } from "@codemirror/lint";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, type Command } from "@codemirror/view";
import { editorAppearance, lispSupport } from "@formalang/editor/codemirror";
import { useTheme } from "../lib/theme";
import { ReadingClient } from "./client";
import type { OutlineEntry, Subject } from "./Inspector";
import {
  isPreludeFile, type Analysis, type FileSymbol, type Generated, type Inspection, type Location, type Problems, type References, type SnippetEntry, type SourceFile,
} from "./protocol";
import { currentAnalysis, describedAt, ensureLibraryImport, semantics, setAnalysis, setInlineTypes, typedFor } from "./semantics";
import { ancestry, formLabel, innermostForm, selectForm, structure, topLevelForms, type Range } from "./structure";

export const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = MAC ? "⌘" : "Ctrl";
export const ALT = MAC ? "⌥" : "Alt";

export interface Breadcrumb extends Range { readonly label: string }
interface Place { readonly file: string; readonly anchor: number; readonly head: number }
export type Panel = "references" | "output";

/** How the editor sizes itself: fill its container, or grow with its text (for inline snippets). */
export type EditorFit = "fill" | "content";

const editorTheme = (fit: EditorFit) => EditorView.theme({
  "&": { height: fit === "fill" ? "100%" : "auto", backgroundColor: "transparent" },
  ".cm-scroller": { fontFamily: "\"IBM Plex Mono\", ui-monospace, monospace", lineHeight: "1.75" },
  ".cm-content": { fontSize: fit === "fill" ? "14.5px" : "14px", padding: fit === "fill" ? "20px 0 40vh" : "12px 0" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
  ".cm-tooltip": { border: "none", backgroundColor: "transparent" },
  ".cm-tooltip-hover": { border: "none", backgroundColor: "transparent", boxShadow: "none" },
});

/** Bundled preludes open read-only. */
const readOnlyState = [EditorState.readOnly.of(true), EditorState.transactionFilter.of(tr => (tr.docChanged ? [] : tr))];

export interface ReaderModel {
  readonly client: ReadingClient;
  readonly fileIds: readonly string[];
  readonly active: string;
  readonly readOnly: boolean;
  readonly files: () => readonly SourceFile[];
  readonly show: (id: string) => void;
  readonly open: (location: Location) => void;
  readonly openFile: (id: string) => Promise<void>;
  readonly back: () => void;
  readonly canGoBack: boolean;
  readonly addFile: () => void;
  readonly closeFile: (id: string) => void;

  readonly analysis: Analysis | null;
  readonly checking: boolean;
  readonly problems: Problems;
  readonly symbols: readonly FileSymbol[];
  readonly subject: Subject | null;
  readonly inspection: Inspection;
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly outline: readonly OutlineEntry[];

  readonly inlineTypes: boolean;
  readonly setInlineTypes: (on: boolean) => void;
  readonly sidebar: boolean;
  readonly setSidebar: (open: boolean) => void;
  readonly quickOpen: boolean;
  readonly setQuickOpen: (open: boolean) => void;
  readonly panel: Panel | null;
  readonly setPanel: (panel: Panel | null) => void;
  readonly references: References | null;
  readonly findReferences: (offset?: number) => void;
  readonly generated: Generated | null;
  readonly renaming: { readonly name: string; readonly offset: number; readonly count: number } | null;
  readonly renameError: string | null;
  readonly startRename: (offset?: number) => void;
  readonly commitRename: (name: string | null) => void;

  readonly mount: (host: HTMLElement, fit: EditorFit) => () => void;
  readonly view: () => EditorView | null;
  readonly run: (command: Command) => () => void;
  readonly select: (range: Range, file?: string) => void;
  readonly replace: (range: Range, text: string) => void;
  readonly goTo: (offset: number) => void;
  readonly jumpToName: (name: string) => boolean;
  readonly snippets: () => Promise<readonly SnippetEntry[]>;
  readonly insertSnippet: (entry: SnippetEntry, all: readonly SnippetEntry[]) => void;
}

const ReaderContext = createContext<ReaderModel | null>(null);

export function useReader(): ReaderModel {
  const model = useContext(ReaderContext);
  if (!model) throw new Error("Reader parts must be inside <ReaderRoot>.");
  return model;
}

export interface ReaderRootProps {
  readonly files: readonly SourceFile[];
  /** Text to select in the first file when the reader opens, such as `(define older`. */
  readonly focus?: string | undefined;
  /**
   * Select the focus form, dimming the rest of the code, or only put the caret at
   * its start, which suits a snippet in prose. Default "selection".
   */
  readonly focusAs?: "selection" | "caret" | undefined;
  /** Open the files sidebar at first. */
  readonly sidebar?: boolean | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/**
 * Owns one reader. Give it a `key` that changes with `files` to load another set:
 * the files are read when it mounts.
 */
export function ReaderRoot({ files: initialFiles, focus, focusAs = "selection", sidebar: initialSidebar = false, className, children }: ReaderRootProps) {
  const { theme } = useTheme();
  const client = useMemo(() => new ReadingClient(), []);
  useEffect(() => () => client.dispose(), [client]);

  const view = useRef<EditorView | null>(null);
  const appearance = useRef(new Compartment());
  const fitRef = useRef<EditorFit>("fill");
  const extensions = useRef<Extension[] | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const projectTimer = useRef<number | undefined>(undefined);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const filesRef = useRef<readonly SourceFile[]>(initialFiles);
  const activeRef = useRef<string>(initialFiles[0]!.id);
  const states = useRef(new Map<string, EditorState>());
  const [fileIds, setFileIds] = useState<readonly string[]>(initialFiles.map(f => f.id));
  const [active, setActive] = useState(activeRef.current);
  const [backStack, setBackStack] = useState<readonly Place[]>([]);
  const [problems, setProblems] = useState<Problems>({});
  const [symbols, setSymbols] = useState<readonly FileSymbol[]>([]);
  const [analysis, setAnalysisState] = useState<Analysis | null>(null);
  const [checking, setChecking] = useState(true);
  const [selection, setSelection] = useState(0);
  const [inspection, setInspection] = useState<Inspection>({});
  const [inlineTypes, setInlineTypesState] = useState(true);
  const inlineRef = useRef(inlineTypes);
  inlineRef.current = inlineTypes;
  const [sidebar, setSidebar] = useState(initialSidebar);
  const [quickOpen, setQuickOpen] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const [references, setReferences] = useState<References | null>(null);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [renaming, setRenaming] = useState<ReaderModel["renaming"]>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const appearanceOf = () => [editorAppearance(themeRef.current, "forma"), editorTheme(fitRef.current)];

  /** Problems per file, the project's definitions, and the generated code follow every edit, a little behind. */
  const refreshProject = useCallback(() => {
    window.clearTimeout(projectTimer.current);
    projectTimer.current = window.setTimeout(async () => {
      const files = filesRef.current;
      const [counts, found] = await Promise.all([client.problems(files), client.symbols(files)]);
      setProblems(counts);
      setSymbols(found);
      if (panelRef.current === "output") setGenerated(await client.generated(files, activeRef.current));
    }, 350);
  }, [client]);

  const analyze = useCallback((editor: EditorView) => {
    window.clearTimeout(timer.current);
    setChecking(true);
    timer.current = window.setTimeout(async () => {
      const file = activeRef.current;
      const result = await client.analyze(filesRef.current, file);
      if (view.current !== editor || activeRef.current !== file || editor.state.doc.toString() !== result.source) return;
      editor.dispatch(
        { effects: setAnalysis.of(result) },
        setDiagnostics(editor.state, result.diagnostics.map(d => ({ from: d.from, to: Math.max(d.to, Math.min(d.from + 1, editor.state.doc.length)), severity: d.severity, message: d.message, source: d.code }))),
      );
      setAnalysisState(result);
      setChecking(false);
    }, 120);
  }, [client]);

  const stateFor = useCallback((file: SourceFile) => EditorState.create({
    doc: file.source,
    extensions: [...extensions.current!, appearance.current.of(appearanceOf()), ...(isPreludeFile(file.id) ? readOnlyState : [])],
  }), []);

  /** Show a file in the editor, keeping the state of the one we leave. */
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
      if (panelRef.current === "output") void client.generated(filesRef.current, id).then(setGenerated);
    }
    editor.dispatch({ effects: [appearance.current.reconfigure(appearanceOf()), setInlineTypes.of(inlineRef.current)] });
    analyze(editor);
  }, [analyze, stateFor, client]);

  const addOpenFile = (file: SourceFile) => {
    if (filesRef.current.some(f => f.id === file.id)) return;
    filesRef.current = [...filesRef.current, file];
    setFileIds(filesRef.current.map(f => f.id));
  };

  const reveal = (editor: EditorView, range: Range) => {
    selectForm(editor, range);
    editor.dispatch({ effects: EditorView.scrollIntoView(range.from, { y: "center" }) });
    editor.focus();
  };

  const remember = () => {
    const editor = view.current;
    if (!editor) return;
    const { anchor, head } = editor.state.selection.main;
    // Read the file now: an updater would run after show() switches files.
    const place = { file: activeRef.current, anchor, head };
    setBackStack(stack => [...stack.slice(-30), place]);
  };

  /** Go to a definition, in this file, another open file, or a bundled prelude. */
  const open = useCallback((location: Location) => {
    const editor = view.current;
    if (!editor) return;
    remember();
    if (!filesRef.current.some(f => f.id === location.file)) {
      if (location.source === undefined) return;
      addOpenFile({ id: location.file, source: location.source });
    }
    show(location.file);
    reveal(editor, { from: location.formFrom, to: location.formTo });
  }, [show]);

  const openFile = useCallback(async (id: string) => {
    if (!filesRef.current.some(f => f.id === id)) {
      if (!isPreludeFile(id)) return;
      addOpenFile({ id, source: await client.prelude(id) });
    }
    remember();
    show(id);
    view.current?.focus();
  }, [show, client]);

  const select = (range: Range, file?: string) => {
    const editor = view.current;
    if (!editor) return;
    if (file && file !== activeRef.current) { remember(); show(file); }
    reveal(editor, range);
  };

  const back = () => {
    const editor = view.current;
    const place = backStack.at(-1);
    if (!editor || !place) return;
    setBackStack(stack => stack.slice(0, -1));
    show(place.file);
    editor.dispatch({ selection: EditorSelection.single(place.anchor, place.head), scrollIntoView: true });
    editor.focus();
  };

  const focusText = (editor: EditorView, text: string | undefined) => {
    const index = text ? editor.state.doc.toString().indexOf(text) : -1;
    if (index < 0) return;
    if (focusAs === "caret") { editor.dispatch({ selection: EditorSelection.cursor(index + 1) }); return; }
    let node = innermostForm(editor.state, index + 1);
    while (node && node.from !== index) node = node.parent;
    if (node) selectForm(editor, node);
  };

  const findReferences = useCallback((offset?: number) => {
    const editor = view.current;
    if (!editor) return;
    const at = offset ?? editor.state.selection.main.head;
    setPanel("references");
    void client.references(filesRef.current, activeRef.current, at).then(setReferences);
  }, [client]);

  const startRename = useCallback((offset?: number) => {
    const editor = view.current;
    if (!editor || isPreludeFile(activeRef.current)) return;
    const at = offset ?? editor.state.selection.main.head;
    setRenameError(null);
    void client.references(filesRef.current, activeRef.current, at).then(found => {
      if (!found?.name) return;
      if (!found.renamable) { setRenameError(found.kind === "definition" ? `${found.name} is defined in ${found.definedIn}, which is read-only.` : `Only names defined in these files can be renamed; ${found.name} is ${found.kind === "form" ? "a prelude form" : found.kind === "builtin" ? "a builtin" : "not defined here"}.`); return; }
      setRenaming({ name: found.name, offset: at, count: found.occurrences.length });
    });
  }, [client]);

  const commitRename = useCallback((name: string | null) => {
    const current = renaming;
    setRenaming(null);
    const editor = view.current;
    if (!current || !editor || name === null || name === current.name) { editor?.focus(); return; }
    void client.rename(filesRef.current, activeRef.current, current.offset, name).then(result => {
      if (!result.ok) { setRenameError(result.message); return; }
      for (const [id, edits] of Object.entries(result.edits)) {
        const changes = edits.map(edit => ({ from: edit.from, to: edit.to, insert: edit.insert }));
        if (id === activeRef.current) { editor.dispatch({ changes, userEvent: "input.rename" }); continue; }
        // Other files: update their kept editor state, so undo there reverts the rename too.
        const kept = states.current.get(id);
        const file = filesRef.current.find(f => f.id === id);
        if (!file) continue;
        const next = (kept ?? stateFor(file)).update({ changes, userEvent: "input.rename" }).state;
        states.current.set(id, next);
        filesRef.current = filesRef.current.map(f => (f.id === id ? { ...f, source: next.doc.toString() } : f));
      }
      analyze(editor);
      refreshProject();
      if (panelRef.current === "references") findReferences(current.offset);
      editor.focus();
    });
  }, [renaming, client, analyze, refreshProject, stateFor, findReferences]);

  const mount = useCallback((host: HTMLElement, fit: EditorFit) => {
    fitRef.current = fit;
    extensions.current = [
      lispSupport(),
      history(), bracketMatching(), closeBrackets(),
      ...(fit === "fill" ? [lineNumbers(), foldGutter({ openText: "⌄", closedText: "›" })] : []),
      structure(),
      semantics(client, { files: () => filesRef.current, file: () => activeRef.current, open: location => open(location) }),
      keymap.of([
        { key: "Shift-F12", run: editor => { findReferences(editor.state.selection.main.head); return true; } },
        { key: "F2", run: editor => { startRename(editor.state.selection.main.head); return true; } },
        ...defaultKeymap, ...historyKeymap,
      ]),
      EditorView.contentAttributes.of({ "aria-label": "Forma source", spellcheck: "false" }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          const source = update.state.doc.toString();
          filesRef.current = filesRef.current.map(f => (f.id === activeRef.current ? { ...f, source } : f));
          analyze(update.view);
          refreshProject();
        }
        if (update.docChanged || update.selectionSet) setSelection(version => version + 1);
      }),
    ];
    const editor = new EditorView({ parent: host, state: stateFor(filesRef.current.find(f => f.id === activeRef.current)!) });
    view.current = editor;
    editor.dispatch({ effects: setInlineTypes.of(inlineRef.current) });
    analyze(editor);
    refreshProject();
    focusText(editor, focus);
    return () => { editor.destroy(); if (view.current === editor) view.current = null; };
    // Mounted once per editor element; files, theme, and options reconfigure it.
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: appearance.current.reconfigure(appearanceOf()) });
  }, [theme]);

  useEffect(() => {
    view.current?.dispatch({ effects: setInlineTypes.of(inlineTypes) });
  }, [inlineTypes]);

  useEffect(() => {
    if (panel === "output") void client.generated(filesRef.current, activeRef.current).then(setGenerated);
  }, [panel, client]);

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
    if (!subject) { setInspection({}); return; }
    let live = true;
    void client.inspect(filesRef.current, activeRef.current, subject.from, subject.to).then(result => { if (live) setInspection(result); });
    return () => { live = false; };
  }, [subject?.from, subject?.to, subject?.text, analysis, client]);

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
  const replace = (range: Range, text: string) => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection: EditorSelection.cursor(range.from + text.length) });
    editor.focus();
  };
  const goTo = (offset: number) => {
    void client.definition(filesRef.current, activeRef.current, offset).then(location => { if (location) open(location); });
  };
  /** A type or service named in an Effect row: find its declaration in the open files. */
  const jumpToName = (name: string) => {
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
    const id = `untitled-${index}.lisp`;
    addOpenFile({ id, source });
    show(id);
    view.current?.dispatch({ selection: EditorSelection.cursor(source.length) });
    view.current?.focus();
    refreshProject();
  };

  const closeFile = (id: string) => {
    if (id === activeRef.current) show(filesRef.current.find(f => f.id !== id && !isPreludeFile(f.id))?.id ?? filesRef.current.find(f => f.id !== id)!.id);
    filesRef.current = filesRef.current.filter(f => f.id !== id);
    states.current.delete(id);
    setFileIds(filesRef.current.map(f => f.id));
    setBackStack(stack => stack.filter(place => place.file !== id));
    refreshProject();
  };

  const insertSnippet = (entry: SnippetEntry, all: readonly SnippetEntry[]) => {
    const editor = view.current;
    if (!editor || isPreludeFile(activeRef.current)) return;
    const { from, to } = editor.state.selection.main;
    const afterParen = editor.state.sliceDoc(from - 1, from) === "(";
    snippet(afterParen ? entry.template : `(${entry.template})`)(editor, null, from, to);
    ensureLibraryImport(editor, entry.group, all.filter(candidate => candidate.group === entry.group).map(candidate => candidate.label));
    editor.focus();
  };

  const model: ReaderModel = {
    client, fileIds, active, readOnly: isPreludeFile(active),
    files: () => filesRef.current, show, open, openFile, back, canGoBack: backStack.length > 0, addFile, closeFile,
    analysis, checking, problems, symbols, subject, inspection, breadcrumbs, outline,
    inlineTypes, setInlineTypes: setInlineTypesState, sidebar, setSidebar, quickOpen, setQuickOpen, panel, setPanel,
    references, findReferences, generated, renaming, renameError, startRename, commitRename,
    mount, view: () => view.current, run, select, replace, goTo, jumpToName,
    snippets: () => client.snippets(filesRef.current, activeRef.current), insertSnippet,
  };

  // Reader-wide keys, wherever focus is inside the reader.
  const onKeyDown = (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.shiftKey && event.key.toLowerCase() === "p") { event.preventDefault(); setQuickOpen(true); }
    else if (mod && !event.shiftKey && event.key.toLowerCase() === "b") { event.preventDefault(); setSidebar(open => !open); }
    // Ctrl-` as in VS Code: browsers keep Ctrl-J for their downloads.
    else if (event.ctrlKey && event.key === "`") { event.preventDefault(); setPanel(current => (current ? null : "output")); }
    else if (event.key === "Escape" && (quickOpen || renaming)) { setQuickOpen(false); if (renaming) commitRename(null); }
  };

  return <ReaderContext.Provider value={model}>
    <div className={`rd-reader${className ? ` ${className}` : ""}`} onKeyDown={onKeyDown}>{children}</div>
  </ReaderContext.Provider>;
}
