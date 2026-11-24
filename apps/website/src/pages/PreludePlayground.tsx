import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ChevronDown, FileCode2, Lock } from "lucide-react";
import { SExprTree } from "../components/SExprTree";
import { TargetCodeView } from "../components/TargetCodeView";
import { passOf, type SpanRange } from "../lib/artifacts";
import { EngineClient } from "../engine/client";
import type { RunResult } from "../engine/protocol";
import { useDocumentMeta } from "../lib/documentMeta";
import { decodePreludeDemo, defaultPreludeDemo, type PreludeDemo } from "../lib/preludeShare";
import { MAX_SNAPSHOT_BYTES, readSnapshot } from "../lib/playgroundSnapshot";
import { HostThemeProvider } from "../lib/theme";
import { ReaderRoot, useReader } from "../reading/model";
import { QuickOpen, ReaderEditor, ReaderInspector, ReaderPanel, ReaderToolbar, RenameBar, TypeLine } from "../reading/parts";
import { ReadingClient } from "../reading/client";
import { PRELUDE_STACKS, type ReadingDiagnostic } from "../reading/protocol";
import "../reading/reading.css";

export function PreludePlayground({ embedded = false }: { embedded?: boolean }) {
  const { snapshotId } = useParams();
  const [search] = useSearchParams();
  const blank = search.get("new") === "1";
  const [loaded, setLoaded] = useState<{ id: string; demo: PreludeDemo } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!snapshotId) return;
    const controller = new AbortController();
    setLoadError(null);
    void fetch(`/playground/api/playgrounds/${snapshotId}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 404 ? "This playground could not be found." : "This playground could not be loaded. Try again shortly.");
      const demo = readSnapshot(await response.json());
      if (!demo) throw new Error("This playground has an unsupported snapshot format.");
      if (!controller.signal.aborted) setLoaded({ id: snapshotId, demo });
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason)); });
    return () => controller.abort();
  }, [snapshotId]);
  if (snapshotId && loaded?.id !== snapshotId) return <main className="demo-page"><p role={loadError ? "alert" : "status"}>{loadError ?? "Loading shared playground…"}</p></main>;
  return <PreludeEditor key={snapshotId ?? (blank ? "new" : "custom")} initialDemo={snapshotId ? loaded!.demo : blank ? { title: "Untitled playground", prelude: "", source: "" } : embedded ? { ...defaultPreludeDemo, source: '(workflow release\n  (step test "process.test")\n  (step approve "human.approve"))' } : undefined} saved={Boolean(snapshotId)} embedded={embedded} />;
}

type InspectorTab = "result" | "ir" | "syntax" | "forms" | "maps" | "debug";
type SourceFile = "prelude" | "source";
/** A file in the picker: one of the playground's own files, or a bundled prelude shown read-only. */
interface PlaygroundFile { readonly id: string; readonly role: string; readonly group: "Preludes" | "Program"; readonly key?: SourceFile }
type EditableFile = PlaygroundFile & { readonly key: SourceFile };
/** The picker lists these in order, grouped. A snapshot holds one language definition and one program today. */
const playgroundFiles: readonly PlaygroundFile[] = [
  { id: "prelude.lisp", role: "Language definition", group: "Preludes", key: "prelude" },
  ...PRELUDE_STACKS.core.map((name): PlaygroundFile => ({ id: `forma:${name}`, role: "Bundled · read-only", group: "Preludes" })),
  { id: "example.lisp", role: "Program", group: "Program", key: "source" },
];
const editableFiles = playgroundFiles.filter((entry): entry is EditableFile => Boolean(entry.key));
const baseName = (id: string) => id.replace(/^forma:/, "");
const editorIdOf = (entry: PlaygroundFile) => entry.key === "prelude" ? "prelude-editor" : entry.key === "source" ? "example-editor" : "bundled-editor";
/** The editable file a diagnostic belongs to; diagnostics without a known file belong to the program. */
const fileOf = (d: RunResult["diagnostics"][number]): EditableFile => editableFiles.find(entry => entry.id === d.span?.sourceId) ?? editableFiles.find(entry => entry.key === "source")!;
const inspectorTabs: readonly { id: InspectorTab; label: string }[] = [
  { id: "result", label: "Result" }, { id: "ir", label: "JSON" }, { id: "syntax", label: "Syntax tree" },
  { id: "forms", label: "Forms" }, { id: "maps", label: "Source maps" }, { id: "debug", label: "Debug" },
];

function PreludeEditor({ initialDemo, saved, embedded }: { readonly initialDemo?: PreludeDemo; readonly saved: boolean; readonly embedded: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark">(() => localStorage.getItem("forma-playground-appearance") === "light" ? "light" : "dark");
  const [initialHash] = useState(() => window.location.hash);
  const [original] = useState(() => initialDemo ?? decodePreludeDemo(initialHash) ?? defaultPreludeDemo);
  const [demo, setDemo] = useState(original);
  const [result, setResult] = useState<RunResult | null>(null);
  const [validating, setValidating] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmShare, setConfirmShare] = useState(false);
  const shareButton = useRef<HTMLButtonElement>(null);
  const [shareUrl, setShareUrl] = useState(saved ? window.location.href : "");
  const [sharedDemo, setSharedDemo] = useState(saved ? JSON.stringify(original) : "");
  const [tab, setTab] = useState<InspectorTab>("result");
  const [internals, setInternals] = useState(false);
  const [file, setFile] = useState<SourceFile>(original.prelude ? "source" : "prelude");
  const [bothFiles, setBothFiles] = useState(false);
  /** A bundled prelude open in the picker, shown read-only in place of the editors. */
  const [viewing, setViewing] = useState<string | null>(null);
  const [split, setSplit] = useState(56);
  const [reveal, setReveal] = useState<{ file: SourceFile; span: SpanRange } | null>(null);
  const debug = result?.preludeDebug;
  const diagnostics = result?.diagnostics ?? [];
  const errors = diagnostics.filter(d => d.severity === "error").length;
  const warnings = diagnostics.filter(d => d.severity === "warning").length;
  const unshared = sharedDemo !== JSON.stringify(demo);
  const tabs = inspectorTabs.filter(item => (!embedded && internals) || item.id === "result" || item.id === "ir");
  const payloads: readonly unknown[] = Array.isArray(result?.declarations) ? result.declarations : [];
  useDocumentMeta({ title: `${demo.title || "Your DSL"} - Forma`, description: "Define a prelude, try an example, and share your language." });

  useEffect(() => {
    if (!embedded) return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type === "forma-workbench-theme" && (event.data.theme === "light" || event.data.theme === "dark")) setTheme(event.data.theme);
    };
    const element = document.querySelector(".prelude-playground");
    const reportHeight = () => { if (element) window.parent.postMessage({ type: "forma-workbench-height", height: Math.ceil(element.getBoundingClientRect().height) }, window.location.origin); };
    const observer = new ResizeObserver(reportHeight);
    if (element) observer.observe(element);
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "forma-workbench-ready" }, window.location.origin);
    reportHeight();
    return () => { observer.disconnect(); window.removeEventListener("message", receive); };
  }, [embedded]);

  useEffect(() => {
    // Each edit cancels the previous worker, including a nonterminating hook.
    const client = new EngineClient();
    let active = true;
    setValidating(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void client.run(demo.source, ["typecheck"], "example.lisp", undefined, demo.prelude)
        .then(value => { if (active) { setResult(value); setValidating(false); } })
        .catch((reason: unknown) => { if (active) { setError(reason instanceof Error ? reason.message : String(reason)); setValidating(false); } });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); client.dispose(); };
  }, [demo.prelude, demo.source]);

  const edit = (next: PreludeDemo) => {
    if (next.source !== demo.source || next.prelude !== demo.prelude) { setValidating(true); setError(null); }
    setDemo(next); setShareStatus(""); setReveal(null); setConfirmShare(false);
  };
  const copyLink = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setShareStatus("Link copied. Anyone with it can open this snapshot."); }
    catch { setShareStatus("Snapshot saved. Select and copy the share link below."); }
  };
  const share = async () => {
    setSaving(true); setShareStatus("");
    try {
      const body = JSON.stringify({ version: 1, ...demo });
      if (new TextEncoder().encode(body).byteLength > MAX_SNAPSHOT_BYTES) throw new Error("Playgrounds must fit within 128 KiB.");
      const response = await fetch("/playground/api/playgrounds", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (!response.headers.get("Content-Type")?.includes("application/json")) throw new Error("Sharing requires the website Worker. The Vite server supports editing only.");
      const snapshot = await response.json() as { path?: string; error?: string };
      if (!response.ok || !snapshot.path) throw new Error(snapshot.error ?? "Could not save the playground. Try again.");
      const url = new URL(snapshot.path, window.location.origin).href;
      window.history.replaceState(null, "", url);
      setShareUrl(url); setSharedDemo(JSON.stringify(demo));
      await copyLink(url);
    } catch (reason) { setShareStatus(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); setConfirmShare(false); shareButton.current?.focus(); }
  };
  const revealSpan = (span: NonNullable<RunResult["diagnostics"][number]["span"]>) => {
    const target = fileOf({ span } as RunResult["diagnostics"][number]).key;
    setViewing(null); setFile(target); setReveal({ file: target, span: [span.startOffset, span.endOffset] });
  };
  const syntax = file === "prelude" ? debug?.preludeSyntax : passOf(result?.passResults ?? [], "parse");

  const fileName = (key: SourceFile) => editableFiles.find(entry => entry.key === key)!.id;
  const shownId = viewing ?? fileName(file);
  const pick = (entry: PlaygroundFile) => { if (entry.key) { setViewing(null); setFile(entry.key); } else setViewing(entry.id); };

  return <main className={`prelude-playground rd-page${embedded ? " studio-embedded" : ""}`} data-theme={theme} aria-label="Forma playground">
    {embedded ? <header className="studio-top studio-top-embedded">
      <span className="rd-eyebrow">Live domain language</span>
      <div className="studio-actions">
        <button className="studio-button" type="button" onClick={() => { setViewing(null); setFile("source"); edit({ ...demo, source: original.source.replace('"process.test"', "42") }); }}>Introduce error</button>
        <button className="studio-button" type="button" onClick={() => edit(original)}>Reset</button>
      </div>
    </header> : <>
    <header className="studio-top">
      <div className="studio-heading">
        <span className="rd-eyebrow">Playground · your own language</span>
        <label className="studio-title">Example title<input aria-label="Example title" value={demo.title} maxLength={160} onChange={event => edit({ ...demo, title: event.target.value })} /></label>
        <p>Define a vocabulary in the language definition, write a program with its forms, and read the data it checks to. Nothing is executed here. <span className="studio-save-state" data-unshared={unshared}>{unshared ? "Unshared changes" : "Saved snapshot"}</span></p>
      </div>
      <div className="studio-actions">
        <a className="studio-button" href="/playground/custom?new=1" target="_blank" rel="noopener noreferrer">New playground ↗</a>
        <button className="studio-button" type="button" onClick={() => { edit(original); }}>Reset</button>
        <label className="studio-theme">Theme<select aria-label="Playground appearance" value={theme} onChange={event => { const next = event.target.value as "light" | "dark"; setTheme(next); localStorage.setItem("forma-playground-appearance", next); }}><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <button ref={shareButton} className="studio-button primary studio-share" type="button" disabled={saving || !demo.title.trim()} aria-expanded={confirmShare} aria-controls="snapshot-confirmation" onClick={() => setConfirmShare(!confirmShare)}>{saving ? "Publishing…" : "Create public snapshot"}</button>
      </div>
    </header>
    <div className="studio-share-bar">
      {shareUrl ? <><label>Share link<input aria-label="Share link" readOnly value={shareUrl} onFocus={event => event.target.select()} /></label><button className="studio-button" type="button" onClick={() => void copyLink(shareUrl)}>Copy link</button></> : <span>Edits stay on this page until you create a public snapshot. Keep a copy before leaving.</span>}
      <span role="status">{shareStatus}</span>
    </div>
    {confirmShare ? <section id="snapshot-confirmation" className="studio-share-confirmation" aria-label="Public snapshot confirmation">
      <p>Your title, language definition and program will be publicly readable. Do not include secrets. Each snapshot is immutable; publishing later edits creates a new link.</p>
      <button className="studio-button primary" type="button" disabled={saving} onClick={() => void share()}>{saving ? "Publishing…" : "Publish snapshot"}</button>
      <button className="studio-button" type="button" disabled={saving} onClick={() => { setConfirmShare(false); shareButton.current?.focus(); }}>Cancel</button>
    </section> : null}
    </>}
    {initialHash && !decodePreludeDemo(initialHash) ? <p className="studio-alert" role="alert">This shared example could not be loaded. Showing the starter example.</p> : null}
    <div className="studio-main" style={{ "--studio-split": `${split}%` } as CSSProperties}>
      <section className="studio-source studio-card" aria-label="Source files" data-both={bothFiles}>
        <div className="studio-source-body">
          <nav className="studio-picker" aria-label="Files">
            <header>Files</header>
            <div className="studio-picker-files" role="tablist" aria-label="Source files" aria-orientation="vertical">
              {playgroundFiles.map((entry, index) => {
                const selected = entry.id === shownId;
                const checked = Boolean(entry.key && result && !validating && !error);
                const errorsIn = checked ? diagnostics.filter(d => d.severity === "error" && fileOf(d) === entry).length : 0;
                return <Fragment key={entry.id}>
                  {entry.group !== playgroundFiles[index - 1]?.group ? <div aria-hidden="true" className="studio-picker-group">{entry.group}</div> : null}
                  <button id={`source-tab-${index}`} role="tab" type="button" aria-label={entry.key ? entry.role : baseName(entry.id)} aria-selected={selected} tabIndex={selected ? 0 : -1} aria-controls={editorIdOf(entry)} data-bundled={entry.key ? undefined : ""} onClick={() => pick(entry)} onKeyDown={event => {
                    const step = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 } as Record<string, number>)[event.key];
                    const next = event.key === "Home" ? 0 : event.key === "End" ? playgroundFiles.length - 1 : step === undefined ? null : (index + step + playgroundFiles.length) % playgroundFiles.length;
                    if (next === null) return;
                    event.preventDefault(); pick(playgroundFiles[next]!); document.getElementById(`source-tab-${next}`)?.focus();
                  }}>
                    {entry.key ? <FileCode2 size={13} /> : <Lock size={12} />}
                    <span className="studio-picker-name">{baseName(entry.id)}</span>
                    {errorsIn ? <span className="rd-file-count bad">{errorsIn}</span> : checked ? <span className="rd-file-ok" title="Checks" /> : <span />}
                    <span className="studio-picker-role">{entry.role}</span>
                  </button>
                </Fragment>;
              })}
            </div>
            {!embedded ? <label className="studio-both-files"><input type="checkbox" checked={bothFiles} onChange={event => { setBothFiles(event.target.checked); setViewing(null); }} />Split files</label> : null}
          </nav>
          <div className={`studio-editors${bothFiles && !viewing ? " studio-editors-both" : ""}`}>
            {editableFiles.map(entry => <section key={entry.id} id={editorIdOf(entry)} className={`studio-file${!viewing && file === entry.key ? " studio-file-active" : ""}`} aria-label={entry.key === "prelude" ? "Prelude" : "Example"}>
              <div className="studio-file-heading">{entry.role}<code>{entry.id}</code></div>
              <StudioEditor before={entry.key === "source" ? demo.prelude : undefined} file={entry.id} label={entry.key === "prelude" ? "Prelude source" : "Example source"} source={demo[entry.key]} theme={theme} reveal={reveal?.file === entry.key ? reveal.span : null}
                diagnostics={validating || error ? [] : diagnostics.filter(d => fileOf(d) === entry)} onFocus={() => setFile(entry.key)} onChange={value => edit({ ...demo, [entry.key]: value })} />
            </section>)}
            {viewing ? <section id="bundled-editor" className="studio-file studio-file-active" aria-label={baseName(viewing)}>
              <div className="studio-file-heading studio-file-heading-bundled">Bundled prelude · read-only<code>{baseName(viewing)}</code></div>
              <BundledPrelude id={viewing} theme={theme} />
            </section> : null}
          </div>
        </div>
      </section>
      <div className="studio-divider" role="separator" aria-label="Resize editors" aria-orientation="vertical" aria-valuemin={40} aria-valuemax={78} aria-valuenow={split} tabIndex={0}
        onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setSplit(value => Math.max(40, Math.min(78, value + (event.key === "ArrowRight" ? 2 : -2)))); } }}
        onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const bounds = event.currentTarget.parentElement!.getBoundingClientRect(); setSplit(Math.max(40, Math.min(78, 100 * (event.clientX - bounds.left) / bounds.width))); }} />
      <div className="studio-side">
      <section className="studio-inspector studio-card" aria-label="Compiler output">
        <div className="studio-tabs-row">
          <div className="studio-tablist" id="studio-inspector-tabs" role="tablist" aria-label="Inspector views">{tabs.map((item, index) => <button key={item.id} id={`inspector-${item.id}`} type="button" role="tab" tabIndex={tab === item.id ? 0 : -1} aria-selected={tab === item.id} aria-controls="studio-output" onClick={() => setTab(item.id)} onKeyDown={event => {
            const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
            if (next === null) return; event.preventDefault(); setTab(tabs[next]!.id); document.getElementById(`inspector-${tabs[next]!.id}`)?.focus();
          }}>{item.label}</button>)}</div>
          {!embedded ? <button className="studio-tabs-aside studio-internals-toggle" type="button" aria-expanded={internals} aria-controls="studio-inspector-tabs" onClick={() => { setInternals(!internals); if (internals && tab !== "result" && tab !== "ir") setTab("result"); }}>Compiler internals</button> : null}
        </div>
        <div className="studio-validation" data-validating={validating} data-error={Boolean(error || errors)} role="status">{validating ? `Validating…${result ? " showing previous result" : ""}` : error ? `Validation failed${result ? " · previous result shown" : ""}` : errors ? "Check failed · fix the problems below" : "Program checks · results match the current source"}</div>
        {error ? <p className="studio-validation-error" role="alert">{error}</p> : null}
        <div className="studio-output" id="studio-output" role="tabpanel" aria-busy={validating} aria-labelledby={`inspector-${tab}`}>
          <div className="studio-output-snapshot" data-stale={Boolean(result && (validating || error))} inert={Boolean(result && (validating || error))}>
          {!result ? <p className="workbench-empty">{error ? "No previous result is available." : "Checking prelude and example…"}</p>
            : tab === "result" ? errors ? <p className="studio-output-note">Fix the diagnostics to inspect checked data. The JSON view keeps any partial compiler output available.</p> : <>
              <p className="studio-output-note">Data checked against your prelude. Your application interprets it; nothing is executed here.</p>
              {debug?.declarations.map((declaration, index) => <article className="studio-result" key={index}><h2>{declaration.name}<code>{declaration.resultType}</code></h2><CheckedData value={payloads[index]} /></article>)}
              {!payloads.length ? <p className="workbench-empty">No declarations yet. Define a form in the language definition and use it in your program.</p> : null}
            </>
            : tab === "ir" ? <><p className="studio-output-note">{errors ? "Partial output. Fix the problems below." : "No diagnostics. Typed output from your example."}</p><TargetCodeView code={JSON.stringify(result.declarations ?? [], null, 2)} language="json" mode={theme} /></>
            : tab === "syntax" ? <><p className="studio-output-note">Reading {fileName(file)}. Select a node to reveal its source.</p><SExprTree ast={syntax?.ast ?? []} selectedSpan={reveal?.file === file ? reveal.span : null} onSelectSpan={span => { if (span) setReveal({ file, span }); }} /></>
            : tab === "forms" ? <><p className="studio-output-note">Form definitions loaded from your prelude.</p>{debug?.forms.map(form => <details className="studio-form" key={form.name}><summary>{form.name}</summary><TargetCodeView code={JSON.stringify(form.definition, null, 2)} language="json" mode={theme} /></details>)}</>
            : tab === "maps" ? <><p className="studio-output-note">Select a payload path to reveal the authored source.</p>{debug?.declarations.map((declaration, index) => <article className="studio-mapping" key={index}><h2>{declaration.name} <code>{declaration.resultType}</code></h2>{declaration.sourceMap.map((entry, entryIndex) => <button type="button" key={entryIndex} onClick={() => revealSpan(entry.span)}><code>{entry.path || "/"}</code><span>{entry.span.startOffset}:{entry.span.endOffset}</span></button>)}</article>)}{!debug?.declarations.length ? <p className="workbench-empty">No declarations to map.</p> : null}</>
            : <><p className="studio-output-note">Measured compiler stages and declaration provenance. This playground elaborates forms; it does not execute a workflow runtime.</p><dl className="studio-timings">{debug?.timings.map(timing => <div key={timing.phase}><dt>{timing.phase}</dt><dd>{timing.durationMs.toFixed(1)} ms</dd></div>)}</dl><details className="studio-form"><summary>Complete debug data</summary><TargetCodeView code={JSON.stringify(debug, null, 2) ?? "{}"} language="json" mode={theme} /></details></>}
          </div>
        </div>
      </section>
      <section className="studio-problems studio-card" aria-label="Compiler diagnostics">
        <header className="studio-card-head"><h2>Problems</h2><span>{validating ? "Validating…" : error ? "Compiler unavailable" : `${errors} ${errors === 1 ? "error" : "errors"} · ${warnings} ${warnings === 1 ? "warning" : "warnings"}`}</span></header>
        <div className="studio-problems-list" data-stale={validating || Boolean(error)}>
          {diagnostics.length ? diagnostics.map((diagnostic, index) => <div className={`rd-problem rd-problem-${diagnostic.severity}`} key={index}>
            <button className="rd-problem-message" disabled={!diagnostic.span || validating || Boolean(error)} onClick={() => revealSpan(diagnostic.span!)} title={diagnostic.span ? "Select it in the code" : undefined} type="button">{diagnostic.message}</button>
            <code className="rd-problem-code">{diagnostic.code}{diagnostic.span ? ` · ${diagnostic.span.sourceId}:${diagnostic.span.startOffset}` : ""}</code>
          </div>) : <p className="rd-muted">No problems. Both files check.</p>}
        </div>
      </section>
      </div>
    </div>
  </main>;
}

/**
 * One file in the reader: types on hover, structural selection and edits, and the
 * type at the caret. The program is checked with the language definition in
 * scope; both show this playground's compiler diagnostics.
 */
function StudioEditor({ file, label, source, before, diagnostics, reveal, theme, onChange, onFocus }: {
  readonly file: string; readonly label: string; readonly source: string; readonly before: string | undefined;
  readonly diagnostics: RunResult["diagnostics"]; readonly reveal: SpanRange | null; readonly theme: "light" | "dark";
  readonly onChange: (source: string) => void; readonly onFocus: () => void;
}) {
  // The reader reads its file when it mounts, so a source it did not write (Reset, Introduce error) mounts a fresh one.
  const fromReader = useRef(source);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (source === fromReader.current) return;
    fromReader.current = source;
    setRevision(value => value + 1);
  }, [source]);
  const shown = diagnostics.flatMap((d): ReadingDiagnostic[] => d.span ? [{
    from: d.span.startOffset, to: d.span.endOffset, severity: d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "info", code: d.code, message: d.message,
  }] : []);
  return <div className="studio-reader-host" onFocus={onFocus}>
    <HostThemeProvider fixed={theme}>
      <ReaderRoot before={before} className="studio-reader" diagnostics={shown} files={[{ id: file, source }]} inlineTypes={false} key={revision} label={label} preludes="core"
        // Go to definition can show the language definition read-only in this editor; only this file's edits are the playground's.
        onChange={(id, next) => { if (id !== file) return; fromReader.current = next; onChange(next); }}>
        <ReaderToolbar />
        <RenameBar />
        <ReaderEditor />
        <ReaderPanel />
        <StudioTypeLine file={file} />
        <QuickOpen />
        <Reveal span={reveal} />
      </ReaderRoot>
    </HostThemeProvider>
  </div>;
}

/** A bundled prelude, read-only in the reader, with its types, forms, and go to definition. */
function BundledPrelude({ id, theme }: { readonly id: string; readonly theme: "light" | "dark" }) {
  const [source, setSource] = useState<{ readonly id: string; readonly text: string } | null>(null);
  useEffect(() => {
    const client = new ReadingClient({ preludes: "core" });
    let live = true;
    void client.prelude(id).then(text => { if (live) setSource({ id, text }); });
    return () => { live = false; client.dispose(); };
  }, [id]);
  if (source?.id !== id) return <p className="workbench-empty">Loading {baseName(id)}…</p>;
  return <div className="studio-reader-host">
    <HostThemeProvider fixed={theme}>
      <ReaderRoot className="studio-reader" files={[{ id, source: source.text }]} inlineTypes={false} key={id} label={`${baseName(id)} source`} preludes="core" readOnly>
        <ReaderToolbar edits={false} />
        <ReaderEditor />
        <StudioTypeLine file={id} />
        <QuickOpen />
      </ReaderRoot>
    </HostThemeProvider>
  </div>;
}

/** The type at the caret, with the reader's inspector for the selected form on demand, and a way back from another file. */
function StudioTypeLine({ file }: { readonly file: string }) {
  const reader = useReader();
  const [open, setOpen] = useState(false);
  return <>
    {open ? <div className="studio-reader-inspector"><ReaderInspector /></div> : null}
    <TypeLine>
      {reader.active !== file ? <button className="rd-bare-toggle" onClick={() => reader.show(file)} type="button">Back to {file}</button> : null}
      <button aria-expanded={open} className="rd-bare-toggle" onClick={() => setOpen(!open)} title="The selected form's type, prelude form and slots, name, and expansion" type="button">Inspect<ChevronDown size={12} /></button>
    </TypeLine>
  </>;
}

/** Selects a span the inspector or the problems list revealed. */
function Reveal({ span }: { readonly span: SpanRange | null }) {
  const reader = useReader();
  useEffect(() => { if (span) reader.select({ from: span[0], to: span[1] }); }, [span?.[0], span?.[1]]);
  return null;
}

/** Render the prelude's data without assuming domain-specific field names or behavior. */
function CheckedData({ value }: { readonly value: unknown }) {
  if (Array.isArray(value)) return value.length ? <ol className="studio-data-list">{value.map((item: unknown, index: number) => <li key={index}><CheckedData value={item} /></li>)}</ol> : <code>[]</code>;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length ? <dl className="studio-data-record">{entries.map(([key, item]) => <div key={key}><dt>{key}</dt><dd><CheckedData value={item} /></dd></div>)}</dl> : <code>{"{}"}</code>;
  }
  return <code>{JSON.stringify(value)}</code>;
}
