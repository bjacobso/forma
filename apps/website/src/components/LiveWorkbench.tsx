/**
 * The playground's workbench: the reader, with the compiler around it. The code is
 * the reader (types on hover, structural selection and edits, the type at the caret);
 * the lens beside it follows the selected form; the stages under it are the
 * compiler's passes, and the problems link back into the code.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, FileCode2, Play, RotateCcw, Square } from "lucide-react";
import { EngineClient } from "../engine/client";
import type { Diagnostic, RunResult } from "../engine/protocol";
import { astToSource, passOf, type SpanRange } from "../lib/artifacts";
import { FORMA_WORKBENCH_URL } from "../lib/workbenchLocation";
import { readerHref } from "../reading/FormaReader";
import { TypeTokens } from "../reading/Inspector";
import { ReaderRoot, useReader } from "../reading/model";
import { Breadcrumbs, GeneratedCode, QuickOpen, ReaderEditor, ReaderInspector, ReaderToolbar, TypeLine } from "../reading/parts";
import type { ReadingDiagnostic } from "../reading/protocol";
import { friendlyVars, parseType, printType } from "../reading/types";
import { typingEdit, workbenchExamples, type WorkbenchExample } from "../workbench/examples";
import { TargetCodeView } from "./TargetCodeView";
import "../reading/reading.css";

const noDiagnostics: readonly Diagnostic[] = [];
type Lens = "form" | "contracts" | "generated" | "ir" | "expand" | "value";
type Status = "compiling" | "ready" | "failed";

export function LiveWorkbench({ initialExample = "contracts", initiallyBroken = false, embedded = false, compact = false }: {
  initialExample?: string; initiallyBroken?: boolean; embedded?: boolean; compact?: boolean;
}) {
  const initial = workbenchExamples.find(item => item.id === initialExample) ?? workbenchExamples[0]!;
  const [example, setExample] = useState<WorkbenchExample>(initial);
  const [source, setSource] = useState(initiallyBroken ? initial.broken : initial.source);
  const [lens, setLens] = useState<Lens>("form");
  const [result, setResult] = useState<RunResult | null>(null);
  const [status, setStatus] = useState<Status>("compiling");
  const [failure, setFailure] = useState<string | null>(null);
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

  // The engine runs the example's passes over the source, a little behind each edit.
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
  const replaceSource = (next: string) => {
    if (next === sourceRef.current) return;
    revision.current++;
    setResult(null); setFailure(null); setStatus("compiling");
    sourceRef.current = next; setSource(next);
  };
  const watchTyping = async () => {
    const token = ++replay.current;
    setPlaying(true); replaceSource(example.source);
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
    setReplayNote("The program checks again. Select a form to read its type, contract, and output.");
    setPlaying(false);
  };
  const choose = (next: WorkbenchExample) => {
    stopReplay(); setExample(next); replaceSource(next.source); setReveal(null);
  };

  const diagnostics = result?.diagnostics ?? noDiagnostics;
  const errors = diagnostics.filter(d => d.severity === "error").length;
  const warnings = diagnostics.filter(d => d.severity === "warning").length;
  // Email rules check against lanes the email linker declares, which the reader does not see,
  // so the code shows the engine's diagnostics for them.
  const engineDiagnostics = useMemo(() => diagnostics.flatMap((d): ReadingDiagnostic[] => d.span ? [{
    from: d.span.startOffset, to: d.span.endOffset, severity: d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "info", code: d.code, message: d.message,
  }] : []), [diagnostics]);

  const lenses: { id: Lens; label: string }[] = [
    { id: "form", label: "Selected form" },
    { id: "contracts", label: example.dialect ? "Contracts" : "Inferred types" },
    ...(example.dialect ? [{ id: "generated" as const, label: "Effect TypeScript" }, ...(!compact ? [{ id: "ir" as const, label: "Typed IR" }] : [])] : []),
    ...(!compact && !example.dialect ? [{ id: "expand" as const, label: "Expand" }, ...(example.passes.includes("evaluate") ? [{ id: "value" as const, label: "Value" }] : [])] : []),
  ];
  const activeLens = lenses.some(item => item.id === lens) ? lens : "form";

  return <section aria-label="Live Forma workbench" className={`wb${embedded ? " wb-embedded" : ""}${compact ? " wb-compact" : ""}`}>
    <ReaderRoot className="wb-reader" diagnostics={example.dialect === "email" ? engineDiagnostics : true} files={[{ id: example.file, source }]} inlineTypes={false} key={example.id}
      preludes={example.dialect === "email" ? "email" : "effect"} onChange={(_, next) => {
        if (next === sourceRef.current) return;
        stopReplay(); replaceSource(next);
      }}>
      <SyncSource focusOnReveal={focusOnReveal} latest={sourceRef} reveal={reveal} source={source} />
      <header className="wb-head">
        <span className="wb-brand"><span aria-hidden="true" className="wb-mark">( )</span><span className="wb-brand-name">Forma workbench</span></span>
        {!compact ? <nav aria-label="Examples" className="wb-examples">
          {workbenchExamples.map(item => <button aria-pressed={item.id === example.id} key={item.id} onClick={() => choose(item)} type="button">{item.title}</button>)}
        </nav> : <span className="wb-flex" />}
        <span className={`wb-status ${status === "compiling" ? "busy" : failure || errors ? "bad" : "good"}`} role="status">
          {status === "compiling" ? "Checking…" : failure ? "Compiler unavailable" : `${errors} ${errors === 1 ? "error" : "errors"} · ${warnings} ${warnings === 1 ? "warning" : "warnings"}`}
        </span>
      </header>
      <div className="wb-story">
        <p aria-live="polite">{replayNote ?? example.prompt}</p>
        <div className="wb-actions">
          {example.source !== example.broken ? <button type="button" onClick={() => { stopReplay(); pendingErrorReveal.current = true; replaceSource(example.broken); }}><Bug size={14} />Introduce error</button> : null}
          {example.source !== example.broken ? <button type="button" onClick={() => { if (playing) stopReplay(); else void watchTyping(); }}>{playing ? <Square size={13} /> : <Play size={13} />}{playing ? "Stop typing" : "Watch typing"}</button> : null}
          <button type="button" onClick={() => { stopReplay(); replaceSource(example.source); setReveal(null); }}><RotateCcw size={13} />Reset</button>
        </div>
      </div>
      <div className="wb-panes">
        <div className="wb-code">
          <div className="wb-code-head">
            <span className="wb-file"><FileCode2 size={13} />{example.file}</span>
            {compact ? <Breadcrumbs /> : <ReaderToolbar breadcrumbs={false} />}
          </div>
          {compact ? null : <div className="wb-crumbs"><Breadcrumbs /></div>}
          <div className="wb-editor"><ReaderEditor fit="content" /></div>
          <TypeLine />
        </div>
        <div className="wb-lens">
          <LensTabs active={activeLens} lenses={lenses} onChange={setLens} />
          <div aria-labelledby={`wb-tab-${activeLens}`} className="wb-lens-body" id="wb-lens-panel" role="tabpanel">
            {activeLens === "form" ? <ReaderInspector />
              : activeLens === "contracts" ? <ContractsLens result={result} status={status} />
              : activeLens === "generated" ? <GeneratedLens blocked={errors > 0} code={result?.generatedCode} dialect={example.dialect} status={status} />
              : status !== "ready" ? <p className="wb-empty">{failure ?? "Compiling the current source…"}</p>
              : activeLens === "ir" ? <TargetCodeView code={JSON.stringify(result?.declarations ?? [], null, 2)} language="json" />
              : activeLens === "expand" ? <pre className="wb-pre">{astToSource(passOf(result?.passResults ?? [], "expand")?.ast) || "Expansion has not completed."}</pre>
              : <pre className="wb-pre">{passOf(result?.passResults ?? [], "evaluate")?.printed ?? "Evaluation is blocked until the program checks."}</pre>}
          </div>
        </div>
      </div>
      <Stages example={example} failure={failure} lenses={lenses} result={result} status={status} onLens={setLens} />
      <Problems diagnostics={diagnostics} example={example} source={source} status={status} />
      <footer className="wb-foot">
        <span>Runs in your browser · @forma-language/forma{example.dialect === "email" ? " · email.lisp · Effect checker" : example.dialect ? " · Effect checker" : ""}</span>
        <span className="wb-flex" />
        <a href={readerHref(source)} target={embedded ? "_top" : undefined}>Open in the reader ↗</a>
        {!compact ? <a href={FORMA_WORKBENCH_URL} target={embedded ? "_top" : undefined}>Structural workbench in Foldworks ↗</a> : null}
      </footer>
      {!compact ? <QuickOpen /> : null}
    </ReaderRoot>
  </section>;
}

/** Keeps the reader's text in step with the workbench's (Reset, Introduce error, Watch typing) and shows revealed spans. */
function SyncSource({ source, latest, reveal, focusOnReveal }: {
  source: string; latest: { readonly current: string }; reveal: SpanRange | null; focusOnReveal: boolean;
}) {
  const reader = useReader();
  useEffect(() => {
    // Compare with the workbench's latest text, not this render's prop: a render that began
    // before the reader reported an edit can commit after it, and must not undo the edit.
    const target = latest.current;
    const view = reader.view();
    const current = view?.state.doc.toString();
    if (!view || current === undefined || current === target) return;
    // Replace only the changed middle, so the caret and scroll stay put while the replay types.
    let from = 0;
    while (from < current.length && from < target.length && current[from] === target[from]) from++;
    let end = 0;
    while (end < current.length - from && end < target.length - from && current[current.length - 1 - end] === target[target.length - 1 - end]) end++;
    view.dispatch({ changes: { from, to: current.length - end, insert: target.slice(from, target.length - end) } });
  }, [source, reader, latest]);
  useEffect(() => {
    const view = reader.view();
    if (!reveal || !view) return;
    if (focusOnReveal) reader.select({ from: reveal[0], to: reveal[1] });
    else view.dispatch({ selection: { anchor: reveal[0], head: reveal[1] }, scrollIntoView: true });
  }, [reveal]);
  return null;
}

function LensTabs({ lenses, active, onChange }: { lenses: readonly { id: Lens; label: string }[]; active: Lens; onChange: (lens: Lens) => void }) {
  return <div aria-label="Lens" className="wb-tabs" role="tablist">
    {lenses.map((item, index) => <button aria-controls="wb-lens-panel" aria-selected={active === item.id} id={`wb-tab-${item.id}`} key={item.id} role="tab" tabIndex={active === item.id ? 0 : -1} type="button"
      onClick={() => onChange(item.id)}
      onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % lenses.length : event.key === "ArrowLeft" ? (index + lenses.length - 1) % lenses.length : event.key === "Home" ? 0 : event.key === "End" ? lenses.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); onChange(lenses[next]!.id);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      }}>{item.label}</button>)}
  </div>;
}

/** A checker type, laid out like the reader's; anything it cannot parse prints as written. */
function TypeText({ display }: { display: string }) {
  try {
    return <TypeTokens tokens={printType(friendlyVars(parseType(display)), 46)} />;
  } catch {
    return <pre className="rd-type">{display}</pre>;
  }
}

/** Each operation's declared signature beside what its body infers, and every expression's type. */
function ContractsLens({ result, status }: { result: RunResult | null; status: Status }) {
  const reader = useReader();
  if (status !== "ready" || !result) return <p className="wb-empty">Compiling the current source…</p>;
  const types = passOf(result.passResults, "typecheck");
  const parsed = passOf(result.passResults, "parse");
  const expressions = (types?.expressionTypes ?? []).map(item => ({ ...item, span: item.span ?? parsed?.ast[item.formIndex]?.span }))
    .filter(item => item.span);
  const contracts = result.contracts ?? [];
  return <div className="wb-contracts">
    {contracts.length ? contracts.map(contract => <article className="wb-contract" key={contract.name}>
      <button className="wb-contract-name" onClick={() => reader.jumpToName(contract.name)} title="Select its definition" type="button">{contract.name}</button>
      <span>Declared signature</span>
      <TypeText display={contract.declared} />
      <span>Inferred from the body</span>
      <TypeText display={contract.inferred} />
    </article>) : <article className="wb-contract">
      <span>Inferred from the program</span>
      {types?.display ? <TypeText display={types.display} /> : <p className="wb-muted">Type inference is blocked by an earlier problem.</p>}
    </article>}
    {expressions.length ? <section className="wb-expressions">
      <h4>Every expression <span>{expressions.length}</span></h4>
      {expressions.map(item => <button key={item.expressionId} onClick={() => reader.select({ from: item.span!.startOffset, to: item.span!.endOffset })} type="button">
        <code>{reader.files()[0]?.source.slice(item.span!.startOffset, item.span!.endOffset)}</code>
        <b>{item.display}</b>
      </button>)}
    </section> : null}
  </div>;
}

/**
 * Effect programs show the reader's linked output: select a form to see what it
 * generates, click the TypeScript to select its source. Other generators show the
 * engine's output as it is.
 */
function GeneratedLens({ dialect, code, blocked, status }: { dialect: WorkbenchExample["dialect"]; code: string | undefined; blocked: boolean; status: Status }) {
  const reader = useReader();
  useEffect(() => {
    if (dialect !== "effect") return;
    reader.setPanel("output");
    return () => reader.setPanel(null);
  }, [dialect]);
  if (status === "compiling") return <p className="wb-empty">Compiling the current source…</p>;
  if (blocked) return <p className="wb-empty">Generation is blocked until the program checks. Fix the problems below.</p>;
  if (dialect === "effect" && reader.generated?.ok !== false) return <div className="wb-generated">
    <p className="wb-note">Select a form to light up the TypeScript it generates. Click the TypeScript to find its source.</p>
    <GeneratedCode />
  </div>;
  return code ? <TargetCodeView code={code} language="typescript" /> : <p className="wb-empty">This example does not generate code.</p>;
}

const STAGE_LABELS: Record<string, string> = { parse: "Read", expand: "Expand", typecheck: "Check", evaluate: "Run" };
const STAGE_LENS: Record<string, Lens> = { parse: "form", expand: "expand", typecheck: "contracts", evaluate: "value", emit: "generated" };

/** The compiler's passes as a strip: each one's time and outcome, and the lens that shows its output. */
function Stages({ example, result, status, failure, lenses, onLens }: {
  example: WorkbenchExample; result: RunResult | null; status: Status; failure: string | null; lenses: readonly { id: Lens }[]; onLens: (lens: Lens) => void;
}) {
  const errors = result?.diagnostics.some(d => d.severity === "error") ?? false;
  const ran = new Map((result?.passResults ?? []).map(pass => [pass.pass, pass.durationMs] as const));
  const last = [...ran.keys()].at(-1);
  const failed = result?.stoppedAt ?? (errors ? last : undefined);
  const stages = [
    ...example.passes.map(pass => ({ id: pass, label: STAGE_LABELS[pass] ?? pass, ms: ran.get(pass),
      state: status !== "ready" ? "busy" : pass === failed ? "bad" : ran.has(pass) ? "good" : "skip" })),
    ...(example.dialect ? [{ id: "emit", label: "Emit", ms: undefined, state: status !== "ready" ? "busy" : result?.generatedCode && !errors ? "good" : "skip" }] : []),
  ];
  const total = [...ran.values()].reduce((sum, ms) => sum + ms, 0);
  return <nav aria-label="Compiler stages" className="wb-stages">
    {stages.map((stage, index) => {
      const lens = STAGE_LENS[stage.id];
      const available = lenses.some(item => item.id === lens);
      return <span className="wb-stage-wrap" key={stage.id}>
        {index ? <span aria-hidden="true" className="wb-stage-arrow" /> : null}
        <button className={`wb-stage ${stage.state}`} disabled={!available} onClick={() => lens && onLens(lens)} type="button"
          title={stage.state === "bad" ? "Problems stopped the program here" : stage.state === "skip" ? "Did not run" : undefined}>
          <span className="wb-stage-dot" />{stage.label}{stage.ms !== undefined ? <span className="wb-stage-ms">{stage.ms < 1 ? "<1" : Math.round(stage.ms)} ms</span> : null}
        </button>
      </span>;
    })}
    <span className="wb-flex" />
    <span className="wb-stage-total">{failure ? "compiler unavailable" : status === "ready" ? `${Math.round(total)} ms in a Web Worker` : "compiling…"}</span>
  </nav>;
}

function Problems({ diagnostics, example, source, status }: { diagnostics: readonly Diagnostic[]; example: WorkbenchExample; source: string; status: Status }) {
  const reader = useReader();
  const errors = diagnostics.filter(d => d.severity === "error").length;
  return <section aria-label="Compiler diagnostics" className="wb-problems">
    {diagnostics.map((diagnostic, index) => {
      const span = diagnostic.span;
      const lineStart = span ? source.lastIndexOf("\n", span.startOffset - 1) + 1 : 0;
      const nextNewline = span ? source.indexOf("\n", span.startOffset) : -1;
      const lineEnd = nextNewline === -1 ? source.length : nextNewline;
      const line = span ? source.slice(0, span.startOffset).split("\n").length : null;
      return <button className={`wb-problem ${diagnostic.severity}`} disabled={!span} key={index} type="button"
        onClick={() => { if (span) reader.select({ from: span.startOffset, to: span.endOffset }); }}>
        <span className="wb-problem-meta"><strong>{diagnostic.code}</strong><span>{span ? `${example.file}:${line}:${span.startOffset - lineStart + 1}` : "no source location"}</span></span>
        <span className="wb-problem-message">{diagnostic.message}</span>
        {span ? <span className="wb-problem-source"><span aria-hidden="true">{line}</span><code>{source.slice(lineStart, span.startOffset)}<mark>{source.slice(span.startOffset, Math.min(span.endOffset, lineEnd)) || " "}</mark>{source.slice(Math.max(span.startOffset, Math.min(span.endOffset, lineEnd)), lineEnd)}</code></span> : null}
      </button>;
    })}
    {errors > 0 ? <details className="wb-guidance"><summary>Example guidance <span>Authored, not an automatic fix</span></summary><p>{example.prompt}</p><p>Reset restores the original example; it does not apply a compiler-suggested repair.</p></details> : null}
    {status === "ready" && !diagnostics.length ? <p className="wb-clean">No problems. Everything in the lens comes from this source.</p> : null}
  </section>;
}
