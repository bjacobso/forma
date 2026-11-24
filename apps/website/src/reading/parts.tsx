/** The reader's parts. Each reads the reader it is inside with useReader(), so layouts compose them freely. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { javascript } from "@codemirror/lang-javascript";
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, lineNumbers } from "@codemirror/view";
import { editorAppearance } from "@formalang/editor/codemirror";
import {
  ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Braces, ChevronsLeftRight, ChevronsRightLeft, CornerLeftUp, FileCode2, Lock, PanelBottom, PanelLeft,
  Parentheses, Plus, Scissors, Search, X,
} from "lucide-react";
import { useTheme } from "../lib/theme";
import { Inspector, TypeTokens } from "./Inspector";
import { ALT, MOD, useReader, type EditorFit } from "./model";
import { isPreludeFile, PRELUDE_STACKS, type FileSymbol, type Occurrence, type SnippetEntry } from "./protocol";
import { structuralCommands } from "./structure";
import { checkerOf, describeTag, effectOf, friendlyVars, parseType, printType, textOf } from "./types";

/** The CodeMirror editor. `fit="content"` grows with the text, for inline snippets. */
export function ReaderEditor({ fit = "fill" }: { readonly fit?: EditorFit }) {
  const reader = useReader();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => reader.mount(host.current!, fit), []);
  return <div className={`rd-editor rd-editor-${fit}`} ref={host} />;
}

/** Open files as tabs, with each file's problems, and the back button. */
export function ReaderTabs() {
  const reader = useReader();
  return <div className="rd-files" role="tablist" aria-label="Files">
    <button aria-label="Toggle the files sidebar" aria-pressed={reader.sidebar} className="rd-back" onClick={() => reader.setSidebar(!reader.sidebar)} title={`Files and outline (${MOD}B)`} type="button"><PanelLeft size={14} /></button>
    <button aria-label="Back" className="rd-back" disabled={!reader.canGoBack} onClick={reader.back} title="Back to where you came from" type="button"><ArrowLeft size={14} /></button>
    <div className="rd-files-scroll">
    {reader.fileIds.map(id => {
      const counts = reader.problems[id];
      const prelude = isPreludeFile(id);
      return <div aria-selected={id === reader.active} className={`rd-file${id === reader.active ? " active" : ""}${prelude ? " prelude" : ""}`} key={id} role="tab">
        <button onClick={() => reader.show(id)} type="button">
          {prelude ? <Lock size={11} /> : null}
          {id}
          {counts?.errors ? <span className="rd-file-count bad">{counts.errors}</span> : counts ? <span className="rd-file-ok" title="Types check" /> : null}
        </button>
        {reader.fileIds.length > 1 && !(reader.fixedFiles && !prelude) ? <button aria-label={`Close ${id}`} className="rd-file-close" onClick={() => reader.closeFile(id)} type="button"><X size={12} /></button> : null}
      </div>;
    })}
    {reader.fixedFiles ? null : <button aria-label="New file" className="rd-add-file" onClick={reader.addFile} title="New file" type="button"><Plus size={14} /></button>}
    </div>
    <button aria-label="Quick open" className="rd-back" onClick={() => reader.setQuickOpen(true)} title={`Go to a file or definition (${MOD}P)`} type="button"><Search size={14} /></button>
    <button aria-label="Toggle the bottom panel" aria-pressed={Boolean(reader.panel)} className="rd-back" onClick={() => reader.setPanel(reader.panel ? null : "output")} title="References and generated code (Ctrl-`)" type="button"><PanelBottom size={14} /></button>
  </div>;
}

/** The selected form's ancestry. One line high whatever it shows, so the code below never moves. */
export function Breadcrumbs() {
  const reader = useReader();
  const crumbs = reader.breadcrumbs;
  const nav = useRef<HTMLElement>(null);
  // Keep the innermost form in view when the path is wider than the row.
  useEffect(() => {
    const element = nav.current;
    if (!element) return;
    element.scrollLeft = element.scrollWidth;
    element.classList.toggle("overflowing", element.scrollWidth > element.clientWidth);
  }, [crumbs]);
  return <nav aria-label="Enclosing forms" className="rd-breadcrumbs" ref={nav}>
    {crumbs.length
      ? crumbs.map((crumb, index) => <button className={index === crumbs.length - 1 ? "current" : ""} key={`${crumb.from}:${crumb.to}`} onClick={() => reader.select(crumb)} type="button">{crumb.label}</button>)
      : <span className="rd-crumb-empty">{reader.readOnly ? "bundled prelude · read-only" : "top level"}</span>}
  </nav>;
}

/** Breadcrumbs, structural selection and edits, snippets, and the inline types switch. */
export function ReaderToolbar({ edits = true }: { readonly edits?: boolean }) {
  const reader = useReader();
  const [menu, setMenu] = useState<readonly SnippetEntry[] | null>(null);
  const groups = useMemo(() => {
    const byGroup = new Map<string, SnippetEntry[]>();
    for (const entry of menu ?? []) byGroup.set(entry.group, [...(byGroup.get(entry.group) ?? []), entry]);
    return [...byGroup];
  }, [menu]);
  const readOnly = reader.readOnly;
  return <div className="rd-toolbar">
    <Breadcrumbs />
    <div className="rd-tools">
      <button onClick={reader.run(structuralCommands.widenSelection)} title={`Widen selection to the enclosing form (${ALT}↑)`} type="button"><ArrowUpFromLine size={14} /><span className="rd-tool-label">Widen</span></button>
      <button onClick={reader.run(structuralCommands.narrowSelection)} title={`Narrow selection (${ALT}↓)`} type="button"><ArrowDownToLine size={14} /><span className="rd-tool-label">Narrow</span></button>
      {edits ? <>
        <span className="rd-tool-gap" />
        <button disabled={readOnly} onClick={reader.run(structuralCommands.slurp)} title={`Slurp the next form into this list (${MOD}])`} type="button"><ChevronsLeftRight size={14} /><span className="rd-tool-label">Slurp</span></button>
        <button disabled={readOnly} onClick={reader.run(structuralCommands.barf)} title={`Barf the last form out of this list (${MOD}[)`} type="button"><ChevronsRightLeft size={14} /><span className="rd-tool-label">Barf</span></button>
        <button disabled={readOnly} onClick={reader.run(structuralCommands.raise)} title={`Replace the parent with this form (${ALT}R)`} type="button"><CornerLeftUp size={14} /><span className="rd-tool-label">Raise</span></button>
        <button disabled={readOnly} onClick={reader.run(structuralCommands.splice)} title={`Remove the enclosing brackets (${ALT}S)`} type="button"><Scissors size={14} /><span className="rd-tool-label">Splice</span></button>
        <button disabled={readOnly} onClick={reader.run(structuralCommands.wrap)} title={`Wrap this form in a new list (${ALT}W)`} type="button"><Parentheses size={14} /><span className="rd-tool-label">Wrap</span></button>
        <span className="rd-tool-gap" />
        <div className="rd-snippets">
          <button aria-expanded={Boolean(menu)} disabled={readOnly} onClick={() => (menu ? setMenu(null) : void reader.snippets().then(setMenu))} title="Insert a form from the preludes as a snippet; Tab moves between its fields" type="button"><Braces size={14} /><span className="rd-tool-label">Insert</span></button>
          {menu ? <div className="rd-snippet-menu" role="menu">
            {groups.map(([group, entries]) => <div className="rd-snippet-group" key={group}>
              <div className="rd-snippet-group-label">{group}</div>
              {entries.map(entry => <button key={entry.label} onClick={() => { reader.insertSnippet(entry, menu); setMenu(null); }} role="menuitem" type="button">
                <code>({entry.label} …)</code>
                {entry.doc ? <span>{entry.doc}</span> : null}
              </button>)}
            </div>)}
          </div> : null}
        </div>
      </> : null}
      <label className="rd-toggle"><input checked={reader.inlineTypes} onChange={event => reader.setInlineTypes(event.target.checked)} type="checkbox" />Inline types</label>
    </div>
  </div>;
}

export function CheckStatus() {
  const { analysis, checking } = useReader();
  const errors = analysis?.diagnostics.filter(d => d.severity === "error").length ?? 0;
  const warnings = analysis?.diagnostics.filter(d => d.severity === "warning").length ?? 0;
  return <span className={`rd-check ${checking ? "busy" : errors ? "bad" : "good"}`}>
    <span className="rd-dot" />
    {checking ? "Checking…" : errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : "Types check"}
    {warnings ? ` · ${warnings} ${warnings === 1 ? "warning" : "warnings"}` : ""}
    {analysis && !checking ? <span className="rd-muted"> · {Math.max(1, Math.round(analysis.durationMs))} ms</span> : null}
  </span>;
}

export function ReaderStatus() {
  return <footer className="rd-status">
    <CheckStatus />
    <span className="rd-keys">
      <kbd>{MOD}-click</kbd> definition <kbd>⇧F12</kbd> references <kbd>F2</kbd> rename <kbd>{ALT}↑</kbd><kbd>{ALT}↓</kbd> widen · narrow <kbd>{MOD}P</kbd> go to
    </span>
  </footer>;
}

export function ReaderInspector() {
  const reader = useReader();
  return <Inspector
    analysis={reader.analysis} inspection={reader.inspection} outline={reader.outline} subject={reader.subject}
    onFindReferences={reader.findReferences} onGoTo={reader.goTo} onJumpToName={reader.jumpToName} onReplace={reader.replace} onSelect={range => reader.select(range)}
  />;
}

/** One line under an inline snippet: the type of the form under the caret, and its Effect rows. */
/** The type of the form under the caret or pointer, on one line; `children` go at its end. */
export function TypeLine({ children }: { readonly children?: ReactNode }) {
  const { subject, analysis, inspection } = useReader();
  const typed = subject?.typed;
  const ty = typed ? friendlyVars(parseType(typed.type)) : undefined;
  const effect = ty ? effectOf(ty) : undefined;
  const form = inspection.form && subject && inspection.form.from === subject.from ? inspection.form : undefined;
  return <div className="rd-typeline">
    {!analysis ? <span className="rd-muted">Loading the checker…</span>
      : ty ? <>
        <span className="rd-typeline-kind">{describeTag(typed!.tag)}</span>
        <TypeTokens className="rd-type rd-type-inline" tokens={printType(ty, Infinity)} />
        {effect ? <>
          {effect.errors.map(e => <span className="rd-chip rd-chip-error" key={textOf(printType(e))}>{textOf(printType(e))}</span>)}
          {effect.reqs.map(r => <span className="rd-chip rd-chip-req" key={textOf(printType(r))}>{textOf(printType(r))}</span>)}
        </> : null}
        <span className="rd-typeline-source">{checkerOf(typed!.tag)}</span>
      </>
      : form ? <><span className="rd-typeline-kind">prelude form</span><code>({form.name} …)</code>{form.produces ? <span className="rd-muted">produces <code>{form.produces}</code></span> : null}</>
      : <span className="rd-muted">Hover or click a form to see its type.</span>}
    {children ? <span className="rd-typeline-aside">{children}</span> : null}
  </div>;
}

// -----------------------------------------------------------------------------
// Sidebar: files, preludes, and the active file's definitions
// -----------------------------------------------------------------------------

export function ReaderSidebar() {
  const reader = useReader();
  const project = reader.fileIds.filter(id => !isPreludeFile(id));
  const mine = reader.symbols.filter(symbol => symbol.file === reader.active);
  return <aside aria-label="Files and outline" className="rd-sidebar">
    <section>
      <header><h3>Files</h3>{reader.fixedFiles ? null : <button aria-label="New file" className="rd-icon" onClick={reader.addFile} title="New file" type="button"><Plus size={13} /></button>}</header>
      <ul className="rd-tree">
        {project.map(id => <li key={id}>
          <button aria-current={id === reader.active} onClick={() => reader.show(id)} type="button">
            <FileCode2 size={13} /><span className="rd-tree-name">{id}</span>
            {reader.problems[id]?.errors ? <span className="rd-file-count bad">{reader.problems[id]!.errors}</span> : reader.problems[id] ? <span className="rd-file-ok" /> : null}
          </button>
        </li>)}
      </ul>
      <h4>Bundled preludes</h4>
      <ul className="rd-tree">
        {PRELUDE_STACKS[reader.client.setup.preludes].map(name => <li key={name}>
          <button aria-current={`forma:${name}` === reader.active} onClick={() => void reader.openFile(`forma:${name}`)} type="button"><Lock size={12} /><span className="rd-tree-name">{name}</span></button>
        </li>)}
      </ul>
    </section>
    <section className="rd-sidebar-outline">
      <header><h3>Outline</h3><span className="rd-section-aside">{reader.active}</span></header>
      {mine.length ? <ul className="rd-symbols">
        {mine.map(symbol => <li key={`${symbol.file}:${symbol.from}`}><SymbolRow symbol={symbol} onOpen={() => reader.select({ from: symbol.formFrom, to: symbol.formTo }, symbol.file)} onUses={() => { reader.select({ from: symbol.from, to: symbol.to }, symbol.file); reader.findReferences(symbol.from); }} /></li>)}
      </ul> : <p className="rd-muted rd-sidebar-empty">{isPreludeFile(reader.active) ? "Prelude definitions are listed from the files that use them." : "No top-level definitions yet."}</p>}
    </section>
  </aside>;
}

function SymbolRow({ symbol, onOpen, onUses }: { readonly symbol: FileSymbol; readonly onOpen: () => void; readonly onUses: () => void }) {
  return <div className="rd-symbol">
    <button className="rd-symbol-main" onClick={onOpen} type="button">
      <span className="rd-symbol-head"><code className="rd-symbol-form">{symbol.form}</code> <code className="rd-symbol-name">{symbol.name}</code></span>
      {symbol.type ? <TypeTokens className="rd-type rd-type-inline rd-symbol-type" tokens={printType(friendlyVars(parseType(symbol.type)), 30)} /> : null}
    </button>
    <button className={`rd-uses${symbol.uses ? "" : " none"}`} onClick={onUses} title="Find references" type="button">{symbol.uses} {symbol.uses === 1 ? "use" : "uses"}</button>
  </div>;
}

// -----------------------------------------------------------------------------
// Quick open
// -----------------------------------------------------------------------------

/** Subsequence match, earlier and tighter matches first. */
function score(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 1000 - t.length;
  const at = t.indexOf(q);
  if (at >= 0) return 500 - at;
  let index = 0;
  for (const char of t) if (char === q[index]) index++;
  return index === q.length ? 100 - t.length : -1;
}

export function QuickOpen() {
  const reader = useReader();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (reader.quickOpen) { setQuery(""); setCursor(0); setTimeout(() => input.current?.focus(), 0); } }, [reader.quickOpen]);
  const items = useMemo(() => {
    const files = [...reader.fileIds.filter(id => !isPreludeFile(id)), ...PRELUDE_STACKS[reader.client.setup.preludes].map(name => `forma:${name}`)]
      .map(id => ({ key: `file:${id}`, label: id, detail: isPreludeFile(id) ? "bundled prelude" : "file", type: undefined as string | undefined, go: () => void reader.openFile(id) }));
    const symbols = reader.symbols.map(symbol => ({
      key: `symbol:${symbol.file}:${symbol.from}`, label: symbol.name, detail: `${symbol.form} · ${symbol.file}`, type: symbol.type,
      go: () => reader.select({ from: symbol.formFrom, to: symbol.formTo }, symbol.file),
    }));
    return [...symbols, ...files].map(item => ({ ...item, score: score(query, item.label) })).filter(item => item.score >= 0).sort((a, b) => b.score - a.score).slice(0, 40);
  }, [query, reader.symbols, reader.fileIds]);
  if (!reader.quickOpen) return null;
  const choose = (index: number) => { const item = items[index]; reader.setQuickOpen(false); item?.go(); };
  return <div className="rd-palette-backdrop" onMouseDown={() => reader.setQuickOpen(false)}>
    <div aria-label="Go to a file or definition" className="rd-palette" onMouseDown={event => event.stopPropagation()} role="dialog">
      <input
        aria-label="Search files and definitions" onChange={event => { setQuery(event.target.value); setCursor(0); }} placeholder="Go to a file or definition…" ref={input} value={query}
        onKeyDown={event => {
          if (event.key === "ArrowDown") { event.preventDefault(); setCursor(at => Math.min(items.length - 1, at + 1)); }
          else if (event.key === "ArrowUp") { event.preventDefault(); setCursor(at => Math.max(0, at - 1)); }
          else if (event.key === "Enter") { event.preventDefault(); choose(cursor); }
          else if (event.key === "Escape") { event.preventDefault(); reader.setQuickOpen(false); }
        }}
      />
      <ul role="listbox">
        {items.map((item, index) => <li aria-selected={index === cursor} key={item.key} role="option">
          <button onClick={() => choose(index)} onMouseMove={() => setCursor(index)} type="button">
            <code className="rd-palette-label">{item.label}</code>
            <span className="rd-palette-detail">{item.detail}</span>
            {item.type ? <span className="rd-palette-type">{textOf(printType(friendlyVars(parseType(item.type)), Infinity))}</span> : null}
          </button>
        </li>)}
        {items.length ? null : <li className="rd-muted rd-palette-empty">Nothing matches.</li>}
      </ul>
    </div>
  </div>;
}

// -----------------------------------------------------------------------------
// Rename
// -----------------------------------------------------------------------------

export function RenameBar() {
  const reader = useReader();
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (reader.renaming) { setValue(reader.renaming.name); setTimeout(() => input.current?.select(), 0); } }, [reader.renaming]);
  if (reader.renaming) {
    return <form className="rd-rename" onSubmit={event => { event.preventDefault(); reader.commitRename(value.trim()); }}>
      <span>Rename <code>{reader.renaming.name}</code> in {reader.renaming.count} {reader.renaming.count === 1 ? "place" : "places"} to</span>
      <input aria-label="New name" onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === "Escape") reader.commitRename(null); }} ref={input} spellCheck={false} value={value} />
      <button className="rd-link" type="submit">Rename</button>
      <button className="rd-link rd-muted" onClick={() => reader.commitRename(null)} type="button">Cancel</button>
    </form>;
  }
  return reader.renameError ? <div className="rd-rename rd-rename-error">{reader.renameError}</div> : null;
}

// -----------------------------------------------------------------------------
// Bottom panel: references, and the generated TypeScript
// -----------------------------------------------------------------------------

export function ReaderPanel() {
  const reader = useReader();
  if (!reader.panel) return null;
  return <section aria-label={reader.panel === "references" ? "References" : "Generated TypeScript"} className="rd-panel">
    <header className="rd-panel-tabs" role="tablist">
      <button aria-selected={reader.panel === "references"} onClick={() => reader.setPanel("references")} role="tab" type="button">
        References{reader.references?.name ? <> · <code>{reader.references.name}</code> <span className="rd-panel-count">{reader.references.occurrences.length}</span></> : null}
      </button>
      <button aria-selected={reader.panel === "output"} onClick={() => reader.setPanel("output")} role="tab" type="button">Generated TypeScript</button>
      <span className="rd-files-gap" />
      <button aria-label="Close the panel" className="rd-icon" onClick={() => reader.setPanel(null)} type="button"><X size={13} /></button>
    </header>
    <div className="rd-panel-body">{reader.panel === "references" ? <ReferencesList /> : <GeneratedCode />}</div>
  </section>;
}

function ReferencesList() {
  const reader = useReader();
  const found = reader.references;
  if (!found) return <p className="rd-muted rd-panel-empty">Put the caret on a name and press <kbd>⇧F12</kbd>, or click a definition's uses in the outline.</p>;
  if (!found.name) return <p className="rd-muted rd-panel-empty">No name at the caret.</p>;
  const byFile = new Map<string, Occurrence[]>();
  for (const occurrence of found.occurrences) byFile.set(occurrence.file, [...(byFile.get(occurrence.file) ?? []), occurrence]);
  const what = found.kind === "form" ? "uses of the prelude form" : found.kind === "builtin" ? "uses of the builtin" : "references to";
  return <div className="rd-refs">
    <p className="rd-refs-summary">{found.occurrences.length} {what} <code>{found.name}</code>{found.definedIn ? <> · defined in <code>{found.definedIn}</code></> : null}{found.renamable ? <> · <button className="rd-link" onClick={() => reader.startRename()} type="button">Rename (F2)</button></> : null}</p>
    {[...byFile].map(([file, occurrences]) => <div className="rd-refs-file" key={file}>
      <div className="rd-refs-file-name"><FileCode2 size={12} />{file}<span className="rd-panel-count">{occurrences.length}</span></div>
      {occurrences.map(o => <button className="rd-ref" key={`${o.file}:${o.from}`} onClick={() => reader.select({ from: o.from, to: o.to }, o.file)} type="button">
        <span className="rd-ref-line">{o.line}</span>
        <code className="rd-ref-preview">
          {/* Keep the match in view: start a long line shortly before it. */}
          {o.column > 36 ? `…${o.preview.slice(o.column - 28, o.column)}` : o.preview.slice(0, o.column).trimStart()}<mark>{o.preview.slice(o.column, o.column + o.to - o.from)}</mark>{o.preview.slice(o.column + o.to - o.from)}
        </code>
        <span className={`rd-ref-role ${o.role}`}>{o.role === "definition" ? "definition" : o.role === "module" ? "import/export" : ""}</span>
      </button>)}
    </div>)}
  </div>;
}

const setLinked = StateEffect.define<readonly { from: number; to: number }[]>();
const linkedMark = Decoration.line({ class: "rd-out-linked" });
const linkedField = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setLinked)) continue;
      const builder = new RangeSetBuilder<Decoration>();
      for (const range of effect.value) {
        for (let pos = range.from; pos <= range.to;) {
          const line = tr.state.doc.lineAt(pos);
          builder.add(line.from, line.from, linkedMark);
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});

/**
 * The file's generated Effect TypeScript. The statements generated from the form at
 * the caret are highlighted; clicking a statement selects the form it came from.
 * The reader generates it while its panel is `output`.
 */
export function GeneratedCode() {
  const reader = useReader();
  const { theme } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const appearance = useRef(new Compartment());
  const generated = reader.generated;
  const generatedRef = useRef(generated);
  generatedRef.current = generated;
  const selectRef = useRef(reader.select);
  selectRef.current = reader.select;

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: "", extensions: [javascript({ typescript: true }), lineNumbers(), EditorView.lineWrapping, EditorState.readOnly.of(true), EditorView.editable.of(false), linkedField, appearance.current.of(editorAppearance(theme, "forma")),
        EditorView.domEventHandlers({
          mousedown(event, editor) {
            const output = generatedRef.current;
            const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY });
            if (!output || pos == null) return false;
            const chunk = output.chunks.find(c => c.from <= pos && pos <= c.to);
            const declaration = chunk?.declaration !== undefined ? output.declarations[chunk.declaration] : undefined;
            if (declaration) selectRef.current({ from: declaration.from, to: declaration.to });
            return false;
          },
        })] }),
    });
    view.current = editor;
    return () => editor.destroy();
  }, []);

  useEffect(() => { view.current?.dispatch({ effects: appearance.current.reconfigure(editorAppearance(theme, "forma")) }); }, [theme]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const code = generated?.ok ? generated.code : "";
    if (editor.state.doc.toString() !== code) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: code } });
  }, [generated]);

  // Link the subject to the statements generated from the declarations around it.
  useEffect(() => {
    const editor = view.current;
    const subject = reader.subject;
    if (!editor || !generated?.ok) return;
    const around = subject ? generated.declarations.map((d, index) => ({ d, index })).filter(({ d }) => d.from <= subject.from && subject.to <= d.to) : [];
    const smallest = around.sort((a, b) => (a.d.to - a.d.from) - (b.d.to - b.d.from))[0]?.d;
    const indexes = new Set(around.filter(({ d }) => smallest && d.from === smallest.from && d.to === smallest.to).map(({ index }) => index));
    const ranges = generated.chunks.filter(chunk => chunk.declaration !== undefined && indexes.has(chunk.declaration)).map(chunk => ({ from: chunk.from, to: Math.max(chunk.from, chunk.to - 1) }));
    editor.dispatch({ effects: [setLinked.of(ranges), ...(ranges[0] ? [EditorView.scrollIntoView(ranges[0].from, { y: "start", yMargin: 24 })] : [])] });
  }, [reader.subject?.from, reader.subject?.to, generated]);

  return <div className="rd-output">
    {generated && !generated.ok ? <p className="rd-muted rd-panel-empty">{generated.message}</p> : null}
    {!generated ? <p className="rd-muted rd-panel-empty">Generating…</p> : null}
    <div className="rd-output-code" hidden={!generated?.ok} ref={host} />
  </div>;
}
