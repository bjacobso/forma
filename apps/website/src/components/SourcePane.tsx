/**
 * An example's source in the reader: types on hover, structural selection and
 * edits, and the type at the caret under the code. The selection follows the
 * stage panels, and the panels follow the selection.
 */
import { useEffect, useRef, useState } from "react";
import type { Diagnostic } from "../engine/protocol";
import { sameSpan, type SpanRange } from "../lib/artifacts";
import type { PipelineContext } from "../pipelines/types";
import { ReaderRoot, useReader } from "../reading/model";
import { Breadcrumbs, CheckStatus, ReaderEditor, TypeLine } from "../reading/parts";
import type { PreludeStack, ReadingDiagnostic } from "../reading/protocol";
import "../reading/reading.css";

export function SourcePane({ source, file, preludes, diagnostics, onChange, selectedSpan, onSelectSpan, context }: {
  readonly source: string;
  readonly file: string;
  readonly preludes?: PreludeStack | undefined;
  /** The engine's diagnostics, so the code agrees with the stages beside it. */
  readonly diagnostics: readonly Diagnostic[];
  readonly onChange: (source: string) => void;
  readonly selectedSpan: SpanRange | null;
  readonly onSelectSpan: (span: SpanRange | null) => void;
  readonly context?: PipelineContext | undefined;
}) {
  // The reader reads its files when it mounts, so a source the reader did not
  // write (Reset, another variant) mounts a fresh one.
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

  return <div className="source-pane">
    <ReaderRoot className="rd-snippet source-reader" diagnostics={shown} files={[{ id: file, source }]} inlineTypes={false} key={revision} preludes={preludes}
      onChange={(_, next) => { fromReader.current = next; onChange(next); }}>
      <header className="rd-snippet-head"><Breadcrumbs /><CheckStatus /></header>
      <ReaderEditor fit="content" />
      <TypeLine />
      <FollowSelection selectedSpan={selectedSpan} onSelectSpan={onSelectSpan} />
    </ReaderRoot>
    {context ? <aside className="source-context" aria-label={context.label}>
      <div className="pane-heading"><span>{context.label}</span></div>
      <ReaderRoot className="rd-snippet rd-bare" diagnostics={false} files={[{ id: "context.lisp", source: context.code }]} inlineTypes={false} preludes={preludes} readOnly>
        <ReaderEditor fit="content" />
      </ReaderRoot>
    </aside> : null}
  </div>;
}

/** Selects the span a stage panel picked, and reports the form the reader selects. */
function FollowSelection({ selectedSpan, onSelectSpan }: { readonly selectedSpan: SpanRange | null; readonly onSelectSpan: (span: SpanRange | null) => void }) {
  const reader = useReader();
  const last = useRef<SpanRange | null>(null);
  useEffect(() => {
    const view = reader.view();
    if (!view || !selectedSpan || sameSpan(selectedSpan, last.current)) return;
    last.current = selectedSpan;
    const from = Math.min(selectedSpan[0], view.state.doc.length);
    view.dispatch({ selection: { anchor: from, head: Math.min(Math.max(from, selectedSpan[1]), view.state.doc.length) }, scrollIntoView: true });
  }, [selectedSpan, reader]);
  const subject = reader.subject;
  useEffect(() => {
    const span: SpanRange | null = subject ? [subject.from, subject.to] : null;
    if (sameSpan(span, last.current)) return;
    last.current = span;
    if (span) onSelectSpan(span);
  }, [subject?.from, subject?.to]);
  return null;
}
