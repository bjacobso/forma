import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { SExprTree } from "../components/SExprTree";
import { TargetCodeView } from "../components/TargetCodeView";
import { passOf, type SpanRange } from "../lib/artifacts";
import { EngineClient } from "../engine/client";
import type { RunResult } from "../engine/protocol";
import type { Analysis } from "../reading/protocol";
import { useDocumentMeta } from "../lib/documentMeta";
import { decodePreludeDemo, defaultPreludeDemo, type PreludeDemo } from "../lib/preludeShare";
import { MAX_SNAPSHOT_BYTES, readSnapshot } from "../lib/playgroundSnapshot";
import { HostThemeProvider } from "../lib/theme";
import { ReaderRoot, useReader } from "../reading/model";
import { ReaderWorkspace } from "../reading/FormaReader";
import { QuickOpen, ReaderInspector } from "../reading/parts";
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

type SideTab = "definition" | "result" | "ir" | "syntax" | "forms" | "maps" | "debug";
const sideTabs: readonly { id: SideTab; label: string; internal?: boolean }[] = [
  { id: "definition", label: "Definition" }, { id: "result", label: "Result" }, { id: "ir", label: "JSON" },
  { id: "syntax", label: "Syntax tree", internal: true }, { id: "forms", label: "Forms", internal: true },
  { id: "maps", label: "Source maps", internal: true }, { id: "debug", label: "Debug", internal: true },
];
/** The playground's files. The language definition is in scope for the program without an import. */
const PRELUDE_FILE = "prelude.lisp";
const PROGRAM_FILE = "example.lisp";

function PreludeEditor({ initialDemo, saved, embedded }: { readonly initialDemo?: PreludeDemo; readonly saved: boolean; readonly embedded: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark">(() => localStorage.getItem("forma-playground-appearance") === "light" ? "light" : "dark");
  const [initialHash] = useState(() => window.location.hash);
  const [original] = useState(() => initialDemo ?? decodePreludeDemo(initialHash) ?? defaultPreludeDemo);
  const [demo, setDemo] = useState(original);
  // Result, JSON, and the reader's status all show the reader's one analysis of the program.
  const [check, setCheck] = useState<ProgramCheck>({ analysis: null, checking: true, failure: null, preludeErrors: 0, preludeDiagnostics: [] });
  // The compiler internals come from the engine's own run, made only while one of them is shown.
  const [internalState, setInternalState] = useState<{ readonly run: RunResult | null; readonly loading: boolean; readonly error: string | null }>({ run: null, loading: false, error: null });
  const [shareStatus, setShareStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmShare, setConfirmShare] = useState(false);
  const shareButton = useRef<HTMLButtonElement>(null);
  const [shareUrl, setShareUrl] = useState(saved ? window.location.href : "");
  const [sharedDemo, setSharedDemo] = useState(saved ? JSON.stringify(original) : "");
  const [tab, setTab] = useState<SideTab>("definition");
  const [internals, setInternals] = useState(false);
  const [activeFile, setActiveFile] = useState(original.prelude ? PROGRAM_FILE : PRELUDE_FILE);
  const [reveal, setReveal] = useState<{ file: string; span: SpanRange } | null>(null);
  // The reader reads its files when it mounts, so text it did not write (Reset, Introduce error) mounts a fresh one.
  const fromReader = useRef({ prelude: original.prelude, source: original.source });
  const [revision, setRevision] = useState(0);
  const internalRun = internalState.run;
  const debug = internalRun?.preludeDebug;
  const result = check.analysis;
  const validating = check.checking;
  const error = check.failure;
  const diagnostics = result?.diagnostics ?? [];
  const errors = diagnostics.filter(d => d.severity === "error").length + check.preludeErrors;
  const unshared = sharedDemo !== JSON.stringify(demo);
  const tabs = sideTabs.filter(item => !item.internal || (!embedded && internals));
  const payloads = result?.declarations.map(declaration => declaration.payload) ?? [];
  const internalTab = Boolean(sideTabs.find(item => item.id === tab)?.internal);
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
    if (!internalTab) return;
    // Each edit cancels the previous worker, including a nonterminating hook.
    const client = new EngineClient();
    let active = true;
    setInternalState(current => ({ ...current, loading: true, error: null }));
    const timer = window.setTimeout(() => {
      void client.run(demo.source, ["typecheck"], PROGRAM_FILE, undefined, demo.prelude)
        .then(value => { if (active) setInternalState({ run: value, loading: false, error: null }); })
        .catch((reason: unknown) => {
          if (active) setInternalState({ run: null, loading: false, error: reason instanceof Error ? reason.message : String(reason) });
        });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); client.dispose(); };
  }, [demo.prelude, demo.source, internalTab]);

  useEffect(() => {
    if (demo.prelude === fromReader.current.prelude && demo.source === fromReader.current.source) return;
    fromReader.current = { prelude: demo.prelude, source: demo.source };
    setRevision(value => value + 1);
  }, [demo.prelude, demo.source]);

  const edit = (next: PreludeDemo) => {
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
    setReveal({ file: span.sourceId === PRELUDE_FILE ? PRELUDE_FILE : PROGRAM_FILE, span: [span.startOffset, span.endOffset] });
  };
  const syntax = activeFile === PRELUDE_FILE ? debug?.preludeSyntax : passOf(internalRun?.passResults ?? [], "parse");
  const stale = validating || Boolean(error);
  const problemRows = <>
    {check.preludeDiagnostics.length
      ? check.preludeDiagnostics.map((diagnostic, index) => <div className={`rd-problem rd-problem-${diagnostic.severity}`} key={`prelude-${index}`}>
          <button className="rd-problem-message" disabled={stale} onClick={() => setReveal({ file: PRELUDE_FILE, span: [diagnostic.from, diagnostic.to] })} title="Select it in the language definition" type="button">{diagnostic.message}</button>
          <code className="rd-problem-code">{diagnostic.code} · {PRELUDE_FILE}:{diagnostic.from}</code>
        </div>)
      : check.preludeErrors ? <div className="rd-problem rd-problem-error">
          <button className="rd-problem-message" disabled={stale} onClick={() => setReveal({ file: PRELUDE_FILE, span: [0, 0] })} title="Open the language definition" type="button">The language definition has {check.preludeErrors} {check.preludeErrors === 1 ? "problem" : "problems"}.</button>
          <code className="rd-problem-code">{PRELUDE_FILE}</code>
        </div> : null}
    {diagnostics.map((diagnostic, index) => <div className={`rd-problem rd-problem-${diagnostic.severity}`} key={index}>
      <button className="rd-problem-message" disabled={stale} onClick={() => setReveal({ file: PROGRAM_FILE, span: [diagnostic.from, diagnostic.to] })} title="Select it in the code" type="button">{diagnostic.message}</button>
      <code className="rd-problem-code">{diagnostic.code} · {PROGRAM_FILE}:{diagnostic.from}</code>
    </div>)}
  </>;

  /** The reader's right sidebar: the selected form's definition, then the checked data and compiler views. */
  const side = <section className="studio-side" aria-label="Compiler output">
    <div className="studio-tabs-row">
      <div className="studio-tablist" id="studio-inspector-tabs" role="tablist" aria-label="Inspector views">{tabs.map((item, index) => <button key={item.id} id={`inspector-${item.id}`} type="button" role="tab" tabIndex={tab === item.id ? 0 : -1} aria-selected={tab === item.id} aria-controls="studio-output" onClick={() => setTab(item.id)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
        if (next === null) return; event.preventDefault(); setTab(tabs[next]!.id); document.getElementById(`inspector-${tabs[next]!.id}`)?.focus();
      }}>{item.label}{item.id === "result" && errors && !validating ? <span className="rd-file-count bad">{errors}</span> : null}</button>)}</div>
      {!embedded ? <button className="studio-tabs-aside studio-internals-toggle" type="button" aria-expanded={internals} aria-controls="studio-inspector-tabs" title="Compiler internals" onClick={() => { setInternals(!internals); if (internals && sideTabs.find(item => item.id === tab)?.internal) setTab("result"); }}>Internals</button> : null}
    </div>
    {tab === "definition" ? <div className="studio-definition" id="studio-output" role="tabpanel" aria-labelledby="inspector-definition"><ReaderInspector /></div> : <>
    <div className="studio-validation" data-validating={validating} data-error={Boolean(error || errors)} role="status">{validating ? `Validating…${result ? " showing previous result" : ""}` : error ? `Validation failed${result ? " · previous result shown" : ""}` : errors ? "Check failed · fix the problems below" : "Program checks · results match the current source"}</div>
    {error ? <p className="studio-validation-error" role="alert">{error}</p> : null}
    <div className="studio-output" id="studio-output" role="tabpanel" aria-busy={validating} aria-labelledby={`inspector-${tab}`}>
      <div className="studio-output-snapshot" data-stale={Boolean(result && stale)} inert={Boolean(result && stale)}>
      {internalTab && internalState.error ? <p className="studio-validation-error" role="alert">Could not load compiler internals: {internalState.error}</p>
        : internalTab && (!internalRun || internalState.loading) ? <p className="workbench-empty">Running the compiler…</p>
        : !result && !internalTab ? <p className="workbench-empty">{error ? "No previous result is available." : "Checking prelude and example…"}</p>
        : tab === "result" ? errors ? <><p className="studio-output-note">Fix the diagnostics to inspect checked data. The JSON view keeps any partial compiler output available.</p><div className="studio-problems-list">{problemRows}</div></> : <>
          <p className="studio-output-note">Data checked against your prelude. Your application interprets it; nothing is executed here.</p>
          {result!.declarations.map((declaration, index) => <article className="studio-result" key={index}><h2>{declaration.name}<code>{declaration.resultType}</code></h2><CheckedData value={declaration.payload} /></article>)}
          {!payloads.length ? <p className="workbench-empty">No declarations yet. Define a form in the language definition and use it in your program.</p> : null}
        </>
        : tab === "ir" ? <><p className="studio-output-note">{errors ? "Partial output. Fix the problems in the Result tab." : "No diagnostics. Typed output from your example."}</p><TargetCodeView code={JSON.stringify(payloads, null, 2)} language="json" mode={theme} /></>
        : tab === "syntax" ? <><p className="studio-output-note">Reading {activeFile}. Select a node to reveal its source.</p><SExprTree ast={syntax?.ast ?? []} selectedSpan={reveal?.file === activeFile ? reveal.span : null} onSelectSpan={span => { if (span) setReveal({ file: activeFile, span }); }} /></>
        : tab === "forms" ? <><p className="studio-output-note">Form definitions loaded from your prelude.</p>{debug?.forms.map(form => <details className="studio-form" key={form.name}><summary>{form.name}</summary><TargetCodeView code={JSON.stringify(form.definition, null, 2)} language="json" mode={theme} /></details>)}</>
        : tab === "maps" ? <><p className="studio-output-note">Select a payload path to reveal the authored source.</p>{debug?.declarations.map((declaration, index) => <article className="studio-mapping" key={index}><h2>{declaration.name} <code>{declaration.resultType}</code></h2>{declaration.sourceMap.map((entry, entryIndex) => <button type="button" key={entryIndex} onClick={() => revealSpan(entry.span)}><code>{entry.path || "/"}</code><span>{entry.span.startOffset}:{entry.span.endOffset}</span></button>)}</article>)}{!debug?.declarations.length ? <p className="workbench-empty">No declarations to map.</p> : null}</>
        : <><p className="studio-output-note">Measured compiler stages and declaration provenance. This playground elaborates forms; it does not execute a workflow runtime.</p><dl className="studio-timings">{debug?.timings.map(timing => <div key={timing.phase}><dt>{timing.phase}</dt><dd>{timing.durationMs.toFixed(1)} ms</dd></div>)}</dl><details className="studio-form"><summary>Complete debug data</summary><TargetCodeView code={JSON.stringify(debug, null, 2) ?? "{}"} language="json" mode={theme} /></details></>}
      </div>
    </div>
    </>}
  </section>;

  return <main className={`prelude-playground rd-page${embedded ? " studio-embedded" : ""}`} data-theme={theme} aria-label="Forma playground">
    {embedded ? <header className="studio-top studio-top-embedded">
      <span className="rd-eyebrow">Live domain language</span>
      <div className="studio-actions">
        <button className="studio-button" type="button" onClick={() => { setActiveFile(PROGRAM_FILE); edit({ ...demo, source: original.source.replace('"process.test"', "42") }); }}>Introduce error</button>
        <button className="studio-button" type="button" onClick={() => edit(original)}>Reset</button>
      </div>
    </header> : <>
    <header className="studio-top">
      <div className="studio-heading">
        <span className="rd-eyebrow">Playground · your own language</span>
        <label className="studio-title">Example title<input aria-label="Example title" value={demo.title} maxLength={160} onChange={event => edit({ ...demo, title: event.target.value })} /></label>
        <p>Define a vocabulary in <code>prelude.lisp</code>, write a program with its forms in <code>example.lisp</code>, and read the data it checks to. Nothing is executed here. <span className="studio-save-state" data-unshared={unshared}>{unshared ? "Unshared changes" : "Saved snapshot"}</span></p>
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
    <HostThemeProvider fixed={theme}>
      <ReaderRoot className="rd-ide studio-reader-ide" key={revision} preludes="core" fixedFiles implicit={[PRELUDE_FILE]} inlineTypes={false}
        files={[{ id: PRELUDE_FILE, source: demo.prelude }, { id: PROGRAM_FILE, source: demo.source }]} active={activeFile}
        sidebar={!embedded && window.innerWidth >= 1100}
        onChange={(id, next) => {
          if (id === PRELUDE_FILE) { fromReader.current = { ...fromReader.current, prelude: next }; edit({ ...demo, prelude: next }); }
          else if (id === PROGRAM_FILE) { fromReader.current = { ...fromReader.current, source: next }; edit({ ...demo, source: next }); }
        }}>
        <ReaderWorkspace inspector={side} />
        <QuickOpen />
        <FollowActive onActive={setActiveFile} />
        <FollowProgram onCheck={setCheck} />
        <Reveal target={reveal} />
      </ReaderRoot>
    </HostThemeProvider>
  </main>;
}

/** Reports the file the reader shows, so the compiler views read the same file. */
function FollowActive({ onActive }: { readonly onActive: (file: string) => void }) {
  const { active } = useReader();
  useEffect(() => { if (active === PRELUDE_FILE || active === PROGRAM_FILE) onActive(active); }, [active]);
  return null;
}

interface ProgramCheck {
  /** The latest analysis of the program, kept while the next one runs. */
  readonly analysis: Analysis | null;
  readonly checking: boolean;
  readonly failure: string | null;
  readonly preludeErrors: number;
  readonly preludeDiagnostics: readonly Analysis["diagnostics"][number][];
}

/**
 * Reports the reader's check of the program. While the program is shown, that is the reader's own
 * analysis; while the language definition is shown, the program is analyzed after it, in the same
 * workspace and from the same files.
 */
function FollowProgram({ onCheck }: { readonly onCheck: (check: ProgramCheck) => void }) {
  const reader = useReader();
  const shown = reader.active === PROGRAM_FILE;
  const [other, setOther] = useState<Omit<ProgramCheck, "preludeErrors" | "preludeDiagnostics">>({ analysis: null, checking: true, failure: null });
  const [fetchedPreludeDiagnostics, setFetchedPreludeDiagnostics] = useState<readonly Analysis["diagnostics"][number][]>([]);
  const last = useRef<Analysis | null>(null);
  useEffect(() => {
    if (shown || reader.checking) { setOther(current => ({ ...current, checking: true })); return; }
    let live = true;
    reader.client.analyze(reader.files(), PROGRAM_FILE).then(
      analysis => { if (live) setOther({ analysis, checking: false, failure: null }); },
      (reason: unknown) => { if (live) setOther(current => ({ ...current, checking: false, failure: reason instanceof Error ? reason.message : String(reason) })); },
    );
    return () => { live = false; };
  }, [shown, reader.checking, reader.analysis, reader.failure]);
  const preludeErrors = reader.problems[PRELUDE_FILE]?.errors ?? 0;
  useEffect(() => {
    if (!shown || preludeErrors === 0 || reader.checking) {
      if (preludeErrors === 0) setFetchedPreludeDiagnostics([]);
      return;
    }
    let live = true;
    reader.client.analyze(reader.files(), PRELUDE_FILE).then(
      analysis => { if (live) setFetchedPreludeDiagnostics(analysis.diagnostics.filter(d => d.severity === "error")); },
      () => { if (live) setFetchedPreludeDiagnostics([]); },
    );
    return () => { live = false; };
  }, [shown, preludeErrors, reader.checking, reader.analysis]);
  const current = shown ? { analysis: reader.analysis, checking: reader.checking, failure: reader.failure } : other;
  if (current.analysis) last.current = current.analysis;
  const preludeDiagnostics = shown
    ? fetchedPreludeDiagnostics
    : (reader.analysis?.diagnostics.filter(d => d.severity === "error") ?? []);
  useEffect(() => {
    onCheck({ analysis: current.analysis ?? last.current, checking: current.checking, failure: current.failure, preludeErrors, preludeDiagnostics });
  }, [current.analysis, current.checking, current.failure, preludeErrors, preludeDiagnostics]);
  return null;
}

/** Selects a span a compiler view or problem revealed, in its file. */
function Reveal({ target }: { readonly target: { readonly file: string; readonly span: SpanRange } | null }) {
  const reader = useReader();
  useEffect(() => { if (target) reader.select({ from: target.span[0], to: target.span[1] }, target.file); }, [target]);
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
