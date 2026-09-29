import type { PipelinePreview, PipelineTarget } from "../pipelines/types";
import type { TimedPassResult } from "../engine/protocol";
import { TargetCodeView } from "./TargetCodeView";

export function TargetPane({ preview, target, evaluation }: {
  readonly preview: PipelinePreview | undefined;
  readonly target: PipelineTarget | undefined;
  readonly evaluation: Extract<TimedPassResult, { readonly pass: "evaluate" }> | null;
}) {
  if (target) {
    if (!evaluation || evaluation.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return <p className="empty-state">The target is available after evaluation succeeds.</p>;
    }
    return (
      <div className="target-pane">
        <div className="preview-banner"><strong>LIVE PROJECTION</strong><span>{target.notice}</span></div>
        <div className="pane-heading"><span>{target.targetLabel}</span><code>{target.language}</code></div>
        <TargetCodeView code={JSON.stringify(toJsonValue(evaluation.value), null, 2)} language={target.language} />
      </div>
    );
  }
  if (!preview) return <p className="empty-state">No target configured for this pipeline.</p>;
  return (
    <div className="target-pane">
      <div className="preview-banner">
        <strong>PREVIEW</strong>
        <span>{preview.notice ?? "This target fixture is checked in; the earlier live passes ran in this tab."}</span>
      </div>
      <div className="pane-heading">
        <span>{preview.targetLabel}</span>
        <code>{preview.language}</code>
      </div>
      <TargetCodeView code={preview.output} language={preview.language} />
    </div>
  );
}

function toJsonValue(value: unknown): unknown {
  if (value instanceof Map) {
    return Object.fromEntries(Array.from(value, ([key, item]) => [key.replace(/^:/, ""), toJsonValue(item)]));
  }
  if (Array.isArray(value)) return value.map(toJsonValue);
  return value;
}
