import { useEffect, useMemo, useRef } from "react";
import { LispEditor, type LispEditorRef } from "@formalang/editor/react";
import { sameSpan, spanContains, spanSize, type SpanRange } from "../lib/artifacts";
import { useTheme } from "../lib/theme";
import type { PipelineContext } from "../pipelines/types";

export function SourcePane({
  source,
  readOnly = false,
  onChange,
  selectedSpan,
  selectedExcerpt,
  selectedType,
  selectableSpans = [],
  context,
  onSelectSpan,
}: {
  readonly source: string;
  readonly readOnly?: boolean;
  readonly onChange?: (source: string) => void;
  readonly selectedSpan?: SpanRange | null;
  readonly selectedExcerpt?: string | undefined;
  readonly selectedType?: string | undefined;
  readonly selectableSpans?: readonly SpanRange[];
  readonly context?: PipelineContext | undefined;
  readonly onSelectSpan?: (span: SpanRange | null) => void;
}) {
  const { theme } = useTheme();
  const editorRef = useRef<LispEditorRef | null>(null);
  const lastSelected = useRef<SpanRange | null>(null);
  const orderedSpans = useMemo(
    () => [...selectableSpans].sort((a, b) => spanSize(a) - spanSize(b)),
    [selectableSpans],
  );

  useEffect(() => {
    const view = editorRef.current?.getEditor();
    if (!view || !selectedSpan || sameSpan(selectedSpan, lastSelected.current)) return;
    lastSelected.current = selectedSpan;
    const from = Math.max(0, Math.min(selectedSpan[0], view.state.doc.length));
    const to = Math.max(from, Math.min(selectedSpan[1], view.state.doc.length));
    view.dispatch({
      selection: { anchor: from, head: to },
    });
  }, [selectedSpan]);

  useEffect(() => {
    const view = editorRef.current?.getEditor();
    if (!view || !onSelectSpan || orderedSpans.length === 0) return;
    const onMouseMove = (event: MouseEvent) => {
      const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (offset === null) return;
      onSelectSpan(orderedSpans.find((span) => spanContains(span, offset)) ?? null);
    };
    view.dom.addEventListener("mousemove", onMouseMove);
    return () => view.dom.removeEventListener("mousemove", onMouseMove);
  }, [onSelectSpan, orderedSpans]);

  return (
    <div className="source-pane">
      <LispEditor
        ariaLabel="Forma source"
        className="embedded-editor"
        key={theme}
        lineNumbers
        maxHeight={620}
        minHeight={360}
        onChange={onChange}
        ref={editorRef}
        readOnly={readOnly}
        showStatusBar={false}
        theme={theme === "dark" ? "app-dark" : "light"}
        value={source}
      />
      <div className="source-status" aria-live="polite">
        {selectedExcerpt ? (
          <>
            <code>{selectedExcerpt}</code>
            {selectedType ? (
              <>
                <span>:</span>
                <b>{selectedType}</b>
              </>
            ) : (
              <span>span {selectedSpan?.[0]}:{selectedSpan?.[1]}</span>
            )}
          </>
        ) : (
          <span>Hover an expression to inspect its span and type.</span>
        )}
      </div>
      {context ? (
        <aside className="source-context" aria-label={context.label}>
          <div className="pane-heading">
            <span>{context.label}</span>
          </div>
          <pre>{context.code}</pre>
        </aside>
      ) : null}
    </div>
  );
}
