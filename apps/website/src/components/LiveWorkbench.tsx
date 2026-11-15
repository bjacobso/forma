/**
 * The playground's workbench is the reader with a few examples to try. Each
 * example has one thing to try: break the program, or watch a mistake get typed
 * and repaired. Errors, types, and generated code are the reader's own.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, Play, RotateCcw, Square } from "lucide-react";
import { EngineClient } from "../engine/client";
import type { Diagnostic } from "../engine/protocol";
import { ReaderWorkspace } from "../reading/FormaReader";
import { ReaderRoot, useReader } from "../reading/model";
import { QuickOpen } from "../reading/parts";
import type { ReadingDiagnostic } from "../reading/protocol";
import { typingEdit, workbenchExamples, type WorkbenchExample } from "../workbench/examples";
import "../reading/reading.css";

export function LiveWorkbench({ initialExample = "contracts", initiallyBroken = false, embedded = false, compact = false }: {
  initialExample?: string; initiallyBroken?: boolean; embedded?: boolean; compact?: boolean;
}) {
  const initial = workbenchExamples.find(item => item.id === initialExample) ?? workbenchExamples[0]!;
  const [example, setExample] = useState<WorkbenchExample>(initial);
  const [source, setSource] = useState(initiallyBroken ? initial.broken : initial.source);
  // Select the first error once the reader reports it: after Introduce error, or a broken start.
  const [revealError, setRevealError] = useState(initiallyBroken);
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const replay = useRef(0);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const timeouts = useRef<Set<number>>(new Set());
  useEffect(() => () => { replay.current++; timeouts.current.forEach(timer => window.clearTimeout(timer)); }, []);

  // Email rules check against lanes the email linker declares, which the reader does not
  // see, so for them the reader shows the email compiler's diagnostics.
  const emailDiagnostics = useEmailDiagnostics(example, source);

  const replaceSource = (next: string) => { sourceRef.current = next; setSource(next); };
  const stopReplay = () => { replay.current++; setPlaying(false); setNote(null); };
  const watchTyping = async () => {
    const token = ++replay.current;
    setPlaying(true); setRevealError(false); replaceSource(example.source);
    const edit = typingEdit(example.source, example.broken);
    const wait = (ms: number) => new Promise<boolean>(resolve => {
      const timer = window.setTimeout(() => { timeouts.current.delete(timer); resolve(replay.current === token); }, ms);
      timeouts.current.add(timer);
    });
    setNote("The program checks. Now a mistake…");
    if (!(await wait(900))) return;
    replaceSource(example.broken); setRevealError(true);
    setNote("The checker points at the mistake. Hover it, or read it in the inspector.");
    if (!(await wait(2600))) return;
    setNote("Repairing it, one character at a time…");
    replaceSource(edit.prefix + edit.suffix);
    for (let index = 1; index <= edit.repair.length; index++) {
      if (!(await wait(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 65))) return;
      replaceSource(edit.prefix + edit.repair.slice(0, index) + edit.suffix);
    }
    if (!(await wait(650))) return;
    setNote(null); setPlaying(false);
  };
  const choose = (next: WorkbenchExample) => { stopReplay(); setRevealError(false); setExample(next); replaceSource(next.source); };
  const canBreak = example.source !== example.broken;

  return <section aria-label="Live Forma workbench" className={`wb${embedded ? " wb-embedded" : ""}${compact ? " wb-compact" : ""}`}>
    <ReaderRoot className="rd-ide wb-reader" diagnostics={emailDiagnostics ?? true} files={[{ id: example.file, source }]} key={example.id}
      preludes={example.dialect === "email" ? "email" : "effect"} onChange={(_, next) => {
        if (next === sourceRef.current) return;
        stopReplay(); replaceSource(next);
      }}>
      <SyncSource latest={sourceRef} revealError={revealError} onRevealed={() => setRevealError(false)} source={source} />
      {!compact ? <nav aria-label="Examples" className="rd-examples">
        {workbenchExamples.map(item => <button aria-pressed={item.id === example.id} className={item.id === example.id ? "active" : ""} key={item.id} onClick={() => choose(item)} type="button">{item.title}</button>)}
      </nav> : null}
      <div className="wb-try">
        <p aria-live="polite">{note ?? example.prompt}</p>
        {canBreak ? <button onClick={() => { stopReplay(); replaceSource(example.broken); setRevealError(true); }} type="button"><Bug size={14} />Introduce error</button> : null}
        {canBreak ? <button onClick={() => { if (playing) stopReplay(); else void watchTyping(); }} type="button">{playing ? <Square size={13} /> : <Play size={13} />}{playing ? "Stop" : "Watch typing"}</button> : null}
        <button onClick={() => { stopReplay(); setRevealError(false); replaceSource(example.source); }} type="button"><RotateCcw size={13} />Reset</button>
      </div>
      <ReaderWorkspace />
      <QuickOpen />
    </ReaderRoot>
  </section>;
}

/** The email compiler's diagnostics for an email example, in the reader's terms; undefined for other examples. */
function useEmailDiagnostics(example: WorkbenchExample, source: string): readonly ReadingDiagnostic[] | undefined {
  const client = useRef<EngineClient | null>(null);
  const [found, setFound] = useState<readonly Diagnostic[]>([]);
  const email = example.dialect === "email";
  useEffect(() => {
    if (!email) return;
    client.current ??= new EngineClient();
    let live = true;
    const timer = window.setTimeout(() => {
      client.current!.run(source, example.passes, example.file, example.dialect).then(result => { if (live) setFound(result.diagnostics); }).catch(() => undefined);
    }, 180);
    return () => { live = false; window.clearTimeout(timer); };
  }, [email, source, example]);
  useEffect(() => () => client.current?.dispose(), []);
  return useMemo(() => email ? found.flatMap((d): ReadingDiagnostic[] => d.span ? [{
    from: d.span.startOffset, to: d.span.endOffset, severity: d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "info", code: d.code, message: d.message,
  }] : []) : undefined, [email, found]);
}

/** Keeps the reader's text in step with the workbench's (Reset, Introduce error, Watch typing), and selects a revealed error. */
function SyncSource({ source, latest, revealError, onRevealed }: {
  source: string; latest: { readonly current: string }; revealError: boolean; onRevealed: () => void;
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
    if (!revealError || reader.checking) return;
    const error = reader.analysis?.diagnostics.find(d => d.severity === "error");
    if (!error) return;
    const view = reader.view();
    view?.dispatch({ selection: { anchor: error.from, head: error.to }, scrollIntoView: true });
    onRevealed();
  }, [revealError, reader.analysis, reader.checking]);
  return null;
}
