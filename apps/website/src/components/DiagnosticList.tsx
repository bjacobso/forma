import type { Diagnostic } from "@formalang/ts/engine";

export function DiagnosticList({
  diagnostics,
}: {
  readonly diagnostics: readonly Diagnostic[];
}) {
  if (diagnostics.length === 0) {
    return <p className="empty-state">No diagnostics.</p>;
  }
  return (
    <div className="diagnostic-list">
      {diagnostics.map((diagnostic, index) => (
        <article className={`diagnostic diagnostic-${diagnostic.severity}`} key={index}>
          <div className="diagnostic-meta">
            <span>{diagnostic.severity}</span>
            <code>{diagnostic.code}</code>
            {diagnostic.span ? (
              <span>
                {diagnostic.span.startOffset}:{diagnostic.span.endOffset}
              </span>
            ) : null}
          </div>
          <p>{diagnostic.message}</p>
        </article>
      ))}
    </div>
  );
}
