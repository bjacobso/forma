import { Link } from "react-router-dom";
import { pipelines } from "../pipelines";
import { stageLabels } from "../pipelines/types";
import { Badge } from "./Badge";

export function PipelineGrid() {
  return (
    <div className="pipeline-grid">
      {pipelines.map((pipeline) => (
        <Link className="pipeline-card" key={pipeline.id} to={`/demo/${pipeline.id}`}>
          <div className="pipeline-card-top">
            <Badge badge={pipeline.badge} />
            <span>Open</span>
          </div>
          <h3>{pipeline.title}</h3>
          <p>{pipeline.tagline}</p>
          <div className="mini-stages">
            <code>Source</code>
            {pipeline.passes.map((pass) => (
              <code key={pass}>{stageLabels[pass]}</code>
            ))}
            {pipeline.preview || pipeline.target ? <code>Target</code> : null}
          </div>
        </Link>
      ))}
    </div>
  );
}
