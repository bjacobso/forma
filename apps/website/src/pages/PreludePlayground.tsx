import { useEffect, useState, type CSSProperties } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { WorkbenchEditor } from "../components/WorkbenchEditor";
import { DiagnosticList } from "../components/DiagnosticList";
import { SExprTree } from "../components/SExprTree";
import { TargetCodeView } from "../components/TargetCodeView";
import { passOf, type SpanRange } from "../lib/artifacts";
import { EngineClient } from "../engine/client";
import type { RunResult } from "../engine/protocol";
import { useDocumentMeta } from "../lib/documentMeta";
import { decodePreludeDemo, defaultPreludeDemo, type PreludeDemo } from "../lib/preludeShare";
import { MAX_SNAPSHOT_BYTES, readSnapshot } from "../lib/playgroundSnapshot";
import { smithersPreludeDemo } from "../lib/smithersDemo";

export function PreludePlayground() {
  const { snapshotId } = useParams();
  const [search] = useSearchParams();
  const blank = search.get("new") === "1";
  const smithers = search.get("example") === "smithers";
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
  return <PreludeEditor key={snapshotId ?? (blank ? "new" : smithers ? "smithers" : "custom")} initialDemo={snapshotId ? loaded!.demo : blank ? { title: "Untitled playground", prelude: "", source: "" } : smithers ? smithersPreludeDemo : undefined} saved={Boolean(snapshotId)} />;
}

type InspectorTab = "ir" | "syntax" | "forms" | "maps" | "debug";
type SourceFile = "prelude" | "source";
const inspectorTabs: readonly { id: InspectorTab; label: string }[] = [
  { id: "ir", label: "Typed IR" }, { id: "syntax", label: "Syntax tree" },
  { id: "forms", label: "Forms" }, { id: "maps", label: "Source maps" }, { id: "debug", label: "Debug" },
];

function PreludeEditor({ initialDemo, saved }: { readonly initialDemo?: PreludeDemo; readonly saved: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark">(() => localStorage.getItem("forma-playground-appearance") === "light" ? "light" : "dark");
  const [initialHash] = useState(() => window.location.hash);
  const [original] = useState(() => initialDemo ?? decodePreludeDemo(initialHash) ?? defaultPreludeDemo);
  const [demo, setDemo] = useState(original);
  const [result, setResult] = useState<RunResult | null>(null);
  const [validating, setValidating] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [shareUrl, setShareUrl] = useState(saved ? window.location.href : "");
  const [sharedDemo, setSharedDemo] = useState(saved ? JSON.stringify(original) : "");
  const [tab, setTab] = useState<InspectorTab>("ir");
  const [file, setFile] = useState<SourceFile>("source");
  const [bothFiles, setBothFiles] = useState(true);
  const [split, setSplit] = useState(64);
  const [reveal, setReveal] = useState<{ file: SourceFile; span: SpanRange } | null>(null);
  const debug = result?.preludeDebug;
  const diagnostics = result?.diagnostics ?? [];
  const errors = diagnostics.filter(d => d.severity === "error").length;
  const warnings = diagnostics.filter(d => d.severity === "warning").length;
  const unshared = sharedDemo !== JSON.stringify(demo);
  useDocumentMeta({ title: `${demo.title || "Your DSL"} - Forma`, description: "Define a prelude, try an example, and share your language." });

  useEffect(() => {
    // Each edit cancels the previous worker, including a nonterminating hook.
    const client = new EngineClient();
    let active = true;
    setValidating(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void client.run(demo.source, ["typecheck"], "example.forma", undefined, demo.prelude)
        .then(value => { if (active) { setResult(value); setValidating(false); } })
        .catch((reason: unknown) => { if (active) { setError(reason instanceof Error ? reason.message : String(reason)); setValidating(false); } });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); client.dispose(); };
  }, [demo.prelude, demo.source]);

  const edit = (next: PreludeDemo) => {
    if (next.source !== demo.source || next.prelude !== demo.prelude) { setValidating(true); setError(null); }
    setDemo(next); setShareStatus(""); setReveal(null);
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
    finally { setSaving(false); }
  };
  const revealSpan = (span: NonNullable<RunResult["diagnostics"][number]["span"]>) => {
    const target = span.sourceId === "prelude.forma" ? "prelude" : "source";
    setFile(target); setReveal({ file: target, span: [span.startOffset, span.endOffset] });
  };
  const syntax = file === "prelude" ? debug?.preludeSyntax : passOf(result?.passResults ?? [], "parse");

  return <main className="prelude-playground live-workbench" data-theme={theme} aria-label="Forma playground">
    <header className="studio-toolbar">
      <a className="studio-brand" href="/">(forma)</a>
      <h1>Playground</h1>
      <label className="studio-title">Example title<input aria-label="Example title" value={demo.title} maxLength={160} onChange={event => edit({ ...demo, title: event.target.value })} /></label>
      <span className="studio-save-state">{unshared ? "Unshared changes" : "Saved snapshot"}</span>
      <div className="studio-actions">
        <a href="/playground/custom?example=smithers" target="_blank" rel="noopener noreferrer">Smithers example</a>
        <a href="/playground/custom?new=1" target="_blank" rel="noopener noreferrer">New playground ↗</a>
        <button type="button" onClick={() => { edit(original); }}>Reset</button>
        <button className="studio-share" type="button" disabled={saving || !demo.title.trim()} onClick={() => void share()}>{saving ? "Saving…" : "Share playground"}</button>
        <label className="studio-theme">Theme<select aria-label="Playground appearance" value={theme} onChange={event => { const next = event.target.value as "light" | "dark"; setTheme(next); localStorage.setItem("forma-playground-appearance", next); }}><option value="light">Light</option><option value="dark">Dark</option></select></label>
      </div>
    </header>
    <div className="studio-share-bar">
      {shareUrl ? <><label>Share link<input aria-label="Share link" readOnly value={shareUrl} onFocus={event => event.target.select()} /></label><button type="button" onClick={() => void copyLink(shareUrl)}>Copy link</button></> : <span>Build a prelude, write an example, then share a link. Each save creates a public snapshot.</span>}
      <span role="status">{shareStatus}</span>
    </div>
    {initialHash && !decodePreludeDemo(initialHash) ? <p role="alert">This shared example could not be loaded. Showing the starter example.</p> : null}
    <div className="studio-main" style={{ "--studio-split": `${split}%` } as CSSProperties}>
      <section className="studio-source" aria-label="Source files">
        <div className="studio-file-tabs" role="tablist" aria-label="Source files">
          <button role="tab" aria-selected={file === "prelude"} aria-controls="prelude-editor" type="button" onClick={() => setFile("prelude")}>prelude.forma</button>
          <button role="tab" aria-selected={file === "source"} aria-controls="example-editor" type="button" onClick={() => setFile("source")}>example.forma</button>
          <label className="studio-both-files"><input type="checkbox" checked={bothFiles} onChange={event => setBothFiles(event.target.checked)} />Both files</label>
        </div>
        <div className={`studio-editors ${bothFiles ? "studio-editors-both" : ""}`}>
          {(["prelude", "source"] as const).map(key => <section key={key} id={key === "prelude" ? "prelude-editor" : "example-editor"} className={`studio-file ${file === key ? "studio-file-active" : ""}`} aria-label={key === "prelude" ? "Prelude" : "Example"}>
            <div className="studio-file-heading">{key === "prelude" ? "prelude.forma" : "example.forma"}<span>Editable</span></div>
            <WorkbenchEditor ariaLabel={key === "prelude" ? "Prelude source" : "Example source"} source={key === "prelude" ? demo.prelude : demo.source} mode={theme} palette="ocean" reveal={reveal?.file === key ? reveal.span : null} onInspect={() => {}} diagnostics={validating || error ? [] : diagnostics.filter(d => key === "prelude" ? d.span?.sourceId === "prelude.forma" : d.span?.sourceId !== "prelude.forma")} onChange={value => edit({ ...demo, [key]: value })} />
          </section>)}
        </div>
      </section>
      <div className="studio-divider" role="separator" aria-label="Resize editors" aria-orientation="vertical" aria-valuemin={40} aria-valuemax={78} aria-valuenow={split} tabIndex={0}
        onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setSplit(value => Math.max(40, Math.min(78, value + (event.key === "ArrowRight" ? 2 : -2)))); } }}
        onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const bounds = event.currentTarget.parentElement!.getBoundingClientRect(); setSplit(Math.max(40, Math.min(78, 100 * (event.clientX - bounds.left) / bounds.width))); }} />
      <section className="studio-inspector" aria-label="Compiler output">
        <div className="workbench-tabs" role="tablist" aria-label="Inspector views">{inspectorTabs.map(item => <button key={item.id} id={`inspector-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls="studio-output" onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
        <div className="studio-validation" data-validating={validating} role="status">{validating ? `Validating…${result ? " showing previous result" : ""}` : error ? `Validation failed${result ? " · previous result shown" : ""}` : "Validated · results match the current source"}</div>
        {error ? <p className="studio-validation-error" role="alert">{error}</p> : null}
        <div className="studio-output" id="studio-output" role="tabpanel" aria-busy={validating} aria-labelledby={`inspector-${tab}`}>
          <div className="studio-output-snapshot" data-stale={Boolean(result && (validating || error))} inert={Boolean(result && (validating || error))}>
          {!result ? <p className="workbench-empty">{error ? "No previous result is available." : "Checking prelude and example…"}</p>
            : tab === "ir" ? <><p className="studio-output-note">{errors ? "Partial output. Fix the diagnostics below." : "No diagnostics. Typed output from your example."}</p><TargetCodeView code={JSON.stringify(result.declarations ?? [], null, 2)} language="json" mode={theme} palette="ocean" /></>
            : tab === "syntax" ? <><p className="studio-output-note">Reading {file === "prelude" ? "prelude.forma" : "example.forma"}. Select a node to reveal its source.</p><SExprTree ast={syntax?.ast ?? []} selectedSpan={reveal?.file === file ? reveal.span : null} onSelectSpan={span => { if (span) setReveal({ file, span }); }} /></>
            : tab === "forms" ? <><p className="studio-output-note">Form definitions loaded from your prelude.</p>{debug?.forms.map(form => <details className="studio-form" key={form.name}><summary>{form.name}</summary><TargetCodeView code={JSON.stringify(form.definition, null, 2)} language="json" mode={theme} palette="ocean" /></details>)}</>
            : tab === "maps" ? <><p className="studio-output-note">Select a payload path to reveal the authored source.</p>{debug?.declarations.map((declaration, index) => <article className="studio-mapping" key={index}><h2>{declaration.name} <code>{declaration.resultType}</code></h2>{declaration.sourceMap.map((entry, entryIndex) => <button type="button" key={entryIndex} onClick={() => revealSpan(entry.span)}><code>{entry.path || "/"}</code><span>{entry.span.startOffset}:{entry.span.endOffset}</span></button>)}</article>)}{!debug?.declarations.length ? <p className="workbench-empty">No declarations to map.</p> : null}</>
            : <><p className="studio-output-note">Measured compiler stages and declaration provenance. This playground elaborates forms; it does not execute a workflow runtime.</p><dl className="studio-timings">{debug?.timings.map(timing => <div key={timing.phase}><dt>{timing.phase}</dt><dd>{timing.durationMs.toFixed(1)} ms</dd></div>)}</dl><details className="studio-form"><summary>Complete debug data</summary><TargetCodeView code={JSON.stringify(debug, null, 2) ?? "{}"} language="json" mode={theme} palette="ocean" /></details></>}
          </div>
        </div>
      </section>
    </div>
    <section className="studio-problems" aria-label="Compiler diagnostics">
      <div className="studio-problems-heading"><strong>Problems</strong><span>{validating ? "Validating…" : error ? "Compiler unavailable" : `${errors} ${errors === 1 ? "error" : "errors"} · ${warnings} warnings`}</span><span>{debug?.timings.map(timing => `${timing.phase} ${Math.round(timing.durationMs)} ms`).join(" · ")}</span></div>
      <div className="studio-problems-list" data-stale={validating || Boolean(error)}><DiagnosticList diagnostics={diagnostics} />{diagnostics.filter(d => d.span).map((diagnostic, index) => <button className="studio-reveal" key={index} type="button" disabled={validating || Boolean(error)} onClick={() => revealSpan(diagnostic.span!)}>Reveal {diagnostic.span!.sourceId}:{diagnostic.span!.startOffset}</button>)}</div>
    </section>
    <footer className="studio-footer"><span>Runs in your browser · Prelude → example → typed IR</span><span>Share saves a snapshot; edit and share again to create a new link.</span></footer>
  </main>;
}
