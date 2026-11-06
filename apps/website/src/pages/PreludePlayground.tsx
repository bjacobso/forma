import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { WorkbenchEditor } from "../components/WorkbenchEditor";
import { DiagnosticList } from "../components/DiagnosticList";
import { EngineClient } from "../engine/client";
import type { RunResult } from "../engine/protocol";
import { useDocumentMeta } from "../lib/documentMeta";
import { decodePreludeDemo, defaultPreludeDemo, type PreludeDemo } from "../lib/preludeShare";
import { MAX_SNAPSHOT_BYTES, readSnapshot } from "../lib/playgroundSnapshot";
import { useTheme } from "../lib/theme";

export function PreludePlayground() {
  const { snapshotId } = useParams();
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
  return <PreludeEditor key={snapshotId ?? "custom"} initialDemo={snapshotId ? loaded!.demo : undefined} />;
}

function PreludeEditor({ initialDemo }: { readonly initialDemo?: PreludeDemo }) {
  const { theme } = useTheme();
  const [initialHash] = useState(() => window.location.hash);
  const [original] = useState(() => initialDemo ?? decodePreludeDemo(initialHash) ?? defaultPreludeDemo);
  const [demo, setDemo] = useState(original);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState("");
  const [saving, setSaving] = useState(false);
  useDocumentMeta({ title: `${demo.title || "Your DSL"} - Forma`, description: "Define a prelude, try an example, and share your language." });

  useEffect(() => {
    // Each edit cancels the previous worker, including a nonterminating hook.
    const client = new EngineClient();
    let active = true;
    setResult(null);
    setError(null);
    const timer = window.setTimeout(() => {
      void client.run(demo.source, ["typecheck"], "example.forma", undefined, demo.prelude)
        .then(value => { if (active) setResult(value); })
        .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); client.dispose(); };
  }, [demo.prelude, demo.source]);

  return (
    <main className="demo-page prelude-playground">
      <header className="demo-header">
        <div>
          <span className="eyebrow">Your DSL</span>
          <h1>Define a language. Share an example.</h1>
          <p>Edit both files and inspect the typed IR. Runs in your browser.</p>
        </div>
        <div className="demo-toolbar">
          <button className="icon-button" type="button" disabled={saving} onClick={async () => {
            setSaving(true);
            setShareStatus("");
            try {
              const body = JSON.stringify({ version: 1, ...demo });
              if (new TextEncoder().encode(body).byteLength > MAX_SNAPSHOT_BYTES) throw new Error("Playgrounds must fit within 128 KiB.");
              const response = await fetch("/playground/api/playgrounds", { method: "POST", headers: { "Content-Type": "application/json" }, body });
              const saved = await response.json() as { path?: string; error?: string };
              if (!response.ok || !saved.path) throw new Error(saved.error ?? "Could not save the playground. Try again.");
              const url = new URL(saved.path, window.location.origin);
              window.history.replaceState(null, "", url);
              try {
                await navigator.clipboard.writeText(url.href);
                setShareStatus("Saved snapshot. Link copied.");
              } catch { setShareStatus("Saved snapshot. Copy the link from your address bar."); }
            } catch (reason) { setShareStatus(reason instanceof Error ? reason.message : String(reason)); }
            finally { setSaving(false); }
          }}>{saving ? "Saving…" : "Share playground"}</button>
          <button className="icon-button" type="button" onClick={() => {
            setDemo(original);
            setShareStatus("");
          }}>Reset</button>
        </div>
      </header>
      {initialHash && !decodePreludeDemo(initialHash) ? <p role="alert">This shared example could not be loaded. Showing the starter example.</p> : null}
      <label className="prelude-title">Example title
        <input value={demo.title} maxLength={160} onChange={event => {
          setDemo({ ...demo, title: event.target.value }); setShareStatus("");
        }} />
      </label>
      <p role="status">{shareStatus}</p>
      <div className="prelude-editors">
        <section className="pane" aria-label="Prelude">
          <h2 className="pane-heading">prelude.forma</h2>
          <WorkbenchEditor ariaLabel="Prelude source" source={demo.prelude} mode={theme} palette="forma" reveal={null} onInspect={() => {}} diagnostics={[]} onChange={prelude => { setDemo({ ...demo, prelude }); setShareStatus(""); }} />
        </section>
        <section className="pane" aria-label="Example">
          <h2 className="pane-heading">example.forma</h2>
          <WorkbenchEditor ariaLabel="Example source" source={demo.source} mode={theme} palette="forma" reveal={null} onInspect={() => {}} diagnostics={result?.diagnostics ?? []} onChange={source => { setDemo({ ...demo, source }); setShareStatus(""); }} />
        </section>
      </div>
      <section className="pane prelude-result" aria-label="Compiler output" aria-live="polite">
        <h2 className="pane-heading">Typed IR</h2>
        {error ? <p role="alert">{error}</p> : result ? <>
          <DiagnosticList diagnostics={result.diagnostics} />
          <pre>{JSON.stringify(result.declarations ?? [], null, 2)}</pre>
        </> : <p>Checking prelude and example…</p>}
      </section>
      <p>Sharing saves a public snapshot of both files. Anyone with the link can view and edit a copy. Share again after editing to save a new snapshot.</p>
    </main>
  );
}
