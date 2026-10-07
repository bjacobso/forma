import { useEffect, useRef, useState } from "react";
import type { SyntaxPalette } from "@formalang/editor/codemirror";
import { EngineClient } from "../engine/client";
import type { Diagnostic, RunResult } from "../engine/protocol";
import { astToSource, passOf, type SpanRange } from "../lib/artifacts";
import { useTheme } from "../lib/theme";
import { typingEdit, workbenchExamples, type WorkbenchExample } from "../workbench/examples";
import { TargetCodeView } from "./TargetCodeView";
import { WorkbenchEditor } from "./WorkbenchEditor";

const noDiagnostics: readonly Diagnostic[] = [];
type OutputTab = "types" | "generated" | "read" | "expand" | "value" | "ir";

export function LiveWorkbench({ initialExample = "contracts", initiallyBroken = false, embedded = false }: {
  initialExample?: string; initiallyBroken?: boolean; embedded?: boolean;
}) {
  const initial = workbenchExamples.find(item => item.id === initialExample) ?? workbenchExamples[0]!;
  const [example, setExample] = useState<WorkbenchExample>(initial);
  const [source, setSource] = useState(initiallyBroken ? initial.broken : initial.source);
  const [palette, setPalette] = useState<SyntaxPalette>(() => {
    const stored = localStorage.getItem("forma-syntax-palette");
    return stored === "ocean" || stored === "orchid" ? stored : "forma";
  });
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<OutputTab>("types");
  const [result, setResult] = useState<RunResult | null>(null);
  const [status, setStatus] = useState<"compiling" | "ready" | "failed">("compiling");
  const [failure, setFailure] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [reveal, setReveal] = useState<SpanRange | null>(null);
  const [focusOnReveal, setFocusOnReveal] = useState(false);
  const pendingErrorReveal = useRef(initiallyBroken);
  const [playing, setPlaying] = useState(false);
  const [replayNote, setReplayNote] = useState<string | null>(null);
  const client = useRef<EngineClient | null>(null);
  const revision = useRef(0);
  const replay = useRef(0);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const timeouts = useRef<Set<number>>(new Set());

  useEffect(() => {
    client.current ??= new EngineClient();
    const token = ++revision.current;
    setStatus("compiling");
    setFailure(null);
    setResult(null);
    const timer = window.setTimeout(() => {
      client.current!.run(source, example.passes, example.file, example.dialect).then(next => {
        if (token !== revision.current) return;
        setResult(next); setStatus("ready");
        if (pendingErrorReveal.current) {
          pendingErrorReveal.current = false;
          const span = next.diagnostics.find(diagnostic => diagnostic.severity === "error" && diagnostic.span)?.span;
          if (span) { setFocusOnReveal(false); setReveal([span.startOffset, span.endOffset]); }
        }
      }).catch((error: Error) => {
        if (token !== revision.current) return;
        setFailure(error.message); setStatus("failed");
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [source, example]);
  useEffect(() => () => {
    revision.current++; replay.current++;
    timeouts.current.forEach(timer => window.clearTimeout(timer));
    client.current?.dispose();
  }, []);

  const stopReplay = () => { pendingErrorReveal.current = false; replay.current++; setPlaying(false); setReplayNote(null); };
  const replaceSource = (next: string) => { sourceRef.current = next; setSource(next); };
  const watchTyping = async () => {
    const token = ++replay.current;
    setPlaying(true); setTab("types"); replaceSource(example.source);
    const edit = typingEdit(example.source, example.broken);
    const wait = (ms: number) => new Promise<boolean>(resolve => {
      const timer = window.setTimeout(() => { timeouts.current.delete(timer); resolve(replay.current === token); }, ms);
      timeouts.current.add(timer);
    });
    setReplayNote("The signature checks. Now introduce a mistake…");
    if (!(await wait(900))) return;
    setFocusOnReveal(false);
    setReveal([edit.from, edit.validEnd]);
    replaceSource(example.broken);
    setReplayNote("The compiler reports the mistake at its source. The generated output is blocked.");
    if (!(await wait(2600))) return;
    setReplayNote("Repairing the signature, one character at a time…");
    replaceSource(edit.prefix + edit.suffix);
    for (let index = 1; index <= edit.repair.length; index++) {
      if (!(await wait(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 65))) return;
      replaceSource(edit.prefix + edit.repair.slice(0, index) + edit.suffix);
    }
    if (!(await wait(650))) return;
    setReplayNote("The program checks again. Explore the inferred types or generated output.");
    setPlaying(false);
  };

  const diagnostics = result?.diagnostics ?? noDiagnostics;
  const errors = diagnostics.filter(d => d.severity === "error").length;
  const types = passOf(result?.passResults ?? [], "typecheck");
  const parsed = passOf(result?.passResults ?? [], "parse");
  const expanded = passOf(result?.passResults ?? [], "expand");
  const evaluated = passOf(result?.passResults ?? [], "evaluate");
  const expressionTypes = (types?.expressionTypes ?? []).map(item => ({
    ...item, span: item.span ?? parsed?.ast[item.formIndex]?.span,
  }));
  const inspected = expressionTypes.filter(item => item.span && item.span.startOffset <= offset && offset <= item.span.endOffset)
    .sort((a, b) => (a.span!.endOffset - a.span!.startOffset) - (b.span!.endOffset - b.span!.startOffset))[0];
  const tabs: { id: OutputTab; label: string }[] = [
    { id: "types", label: "Inferred types" },
    ...(example.dialect ? [{ id: "generated" as const, label: "Effect TypeScript" }, { id: "ir" as const, label: "Typed IR" }] : []),
    { id: "read", label: "Read" },
    ...(!example.dialect ? [{ id: "expand" as const, label: "Expand" }, { id: "value" as const, label: "Value" }] : []),
  ];
  const activeTab = tabs.some(item => item.id === tab) ? tab : "types";
  const revealSpan = (span: Diagnostic["span"]) => { if (span) { setFocusOnReveal(true); setReveal([span.startOffset, span.endOffset]); } };

  return <section className={`live-workbench ${embedded ? "live-workbench-embedded" : ""}`} aria-label="Live Forma workbench">
    <header className="workbench-toolbar">
      <div className="workbench-title"><span className={`workbench-dot ${errors || failure ? "has-error" : ""}`} /><strong>Forma workbench</strong><span>Live compiler</span></div>
      <div className="workbench-settings">
        <label>Appearance<select aria-label="Workbench appearance" value={theme} onChange={event => setTheme(event.target.value as "light" | "dark")}><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label>Syntax<select aria-label="Syntax palette" value={palette} onChange={event => { const next = event.target.value as SyntaxPalette; setPalette(next); localStorage.setItem("forma-syntax-palette", next); }}><option value="forma">Forma</option><option value="ocean">Ocean</option><option value="orchid">Orchid</option></select></label>
      </div>
    </header>
    <div className="workbench-example-bar">
      <label>Example<select aria-label="Workbench example" value={example.id} onChange={event => {
        stopReplay(); const next = workbenchExamples.find(item => item.id === event.target.value)!;
        setExample(next); replaceSource(next.source); setReveal(null); setOffset(0); setTab("types");
      }}>{workbenchExamples.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="workbench-actions">
        {example.source !== example.broken ? <button type="button" onClick={() => { stopReplay(); pendingErrorReveal.current = true; replaceSource(example.broken); setTab("types"); }}>Introduce error</button> : null}
        {example.source !== example.broken ? <button type="button" onClick={() => { if (playing) stopReplay(); else void watchTyping(); }}>{playing ? "Stop typing" : "Watch typing"}</button> : null}
        <button type="button" onClick={() => { stopReplay(); replaceSource(example.source); setReveal(null); }}>Reset</button>
      </div>
    </div>
    <p className="workbench-prompt">{replayNote ?? example.prompt} <span>You can edit the source at any time.</span></p>
    <div className="workbench-panes">
      <div className="workbench-input">
        <div className="workbench-file"><span>{example.file}</span><span>Editable</span></div>
        <WorkbenchEditor source={source} mode={theme} palette={palette} diagnostics={diagnostics} reveal={reveal} focusOnReveal={focusOnReveal} onInspect={setOffset} onChange={next => {
          if (next === sourceRef.current) return;
          stopReplay(); replaceSource(next);
        }} />
      </div>
      <div className="workbench-output">
        <div className="workbench-tabs" role="tablist" aria-label="Compiler output">{tabs.map(item => <button id={`tab-${item.id}`} role="tab" aria-selected={activeTab === item.id} aria-controls="workbench-output-panel" key={item.id} type="button" onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
        <div className="workbench-output-content" id="workbench-output-panel" role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
          {status === "compiling" ? <p className="workbench-empty">Compiling current source…</p> : failure ? <p className="workbench-empty">{failure}</p> : activeTab === "types" ? <>
            {(result?.contracts?.length ?? 0) > 0 ? result!.contracts!.map(contract => <article className="workbench-contract" key={contract.name}><strong>{contract.name}</strong><span>Declared signature</span><code>{contract.declared}</code><span>Inferred from the body</span><code>{contract.inferred}</code></article>) : <article className="workbench-contract"><span>Inferred from the program</span><code>{types?.display ?? "Type inference is blocked by an earlier diagnostic."}</code></article>}
            <div className="workbench-inspection"><span>At your cursor / hover</span><code>{inspected?.display ?? "Hover an expression in the source to inspect its type."}</code></div>
            {expressionTypes.length ? <details><summary>{expressionTypes.length} expression types</summary><div className="workbench-type-list">{expressionTypes.map(item => <button key={item.expressionId} type="button" onClick={() => revealSpan(item.span)}><code>{item.span ? source.slice(item.span.startOffset, item.span.endOffset) : `Form ${item.formIndex + 1}`}</code><b>{item.display}</b></button>)}</div></details> : null}
          </> : activeTab === "generated" ? result?.generatedCode ? <TargetCodeView code={result.generatedCode} language="typescript" palette={palette} /> : <p className="workbench-empty">Generation is blocked until the program checks. Fix the diagnostics below.</p>
            : activeTab === "ir" ? <TargetCodeView code={JSON.stringify(result?.declarations ?? [], null, 2)} language="json" palette={palette} />
            : activeTab === "read" ? <pre>{astToSource(parsed?.ast) || "Reading is blocked by a syntax error."}</pre>
            : activeTab === "expand" ? <pre>{astToSource(expanded?.ast) || "Expansion has not completed."}</pre>
            : <pre>{evaluated?.printed ?? (example.passes.includes("evaluate") ? "Evaluation is blocked until the program checks." : "This example demonstrates inference; it does not evaluate a function.")}</pre>}
        </div>
      </div>
    </div>
    <div className="workbench-diagnostics" aria-label="Compiler diagnostics">
      <div className="workbench-diagnostic-heading"><strong>Problems</strong><span role="status">{status === "compiling" ? "Checking…" : failure ? "Compiler unavailable" : `${errors} ${errors === 1 ? "error" : "errors"} · ${diagnostics.filter(d => d.severity === "warning").length} warnings`}</span><span>{result ? `${Math.round(result.passResults.reduce((sum, pass) => sum + pass.durationMs, 0))} ms` : ""}</span></div>
      {diagnostics.map((diagnostic, index) => <button className={`workbench-diagnostic ${diagnostic.severity}`} key={index} type="button" onClick={() => revealSpan(diagnostic.span)}><span>{diagnostic.severity === "error" ? "×" : "!"}</span><div><p>{diagnostic.message}</p><small>{diagnostic.phase} · {diagnostic.code}{diagnostic.span ? ` · ${example.file}:${diagnostic.span.startLine ?? source.slice(0, diagnostic.span.startOffset).split("\n").length}` : ""}</small></div></button>)}
      {status === "ready" && !diagnostics.length ? <p className="workbench-clean">Program checks. All output above comes from this source.</p> : null}
    </div>
    <footer className="workbench-footer"><span>Runs in your browser · @formalang/ts{example.dialect ? " · Effect checker" : ""}</span><a href="/workbench/demo/" target={embedded ? "_top" : undefined}>Explore the structural workbench ↗</a></footer>
  </section>;
}
