import { Link } from "react-router-dom";
import { pipelines } from "../pipelines";
import { pipelineGroups, stageLabels } from "../pipelines/types";
import { Badge } from "./Badge";
import { InlineCodeText } from "./Dfn";

export function PipelineGrid() {
  return (
    <div className="pipeline-groups">
      {pipelineGroups.map((group) => (
        <section className="pipeline-group" aria-labelledby={`group-${group.id}`} key={group.id}>
          <div className="pipeline-group-heading">
            <span>{group.label}</span>
            <h3 id={`group-${group.id}`}>{group.title}</h3>
            <p>{group.description}</p>
          </div>
          <div className="pipeline-grid">
            {pipelines
              .filter((pipeline) => pipeline.group === group.id)
              .map((pipeline) => (
                <Link className="pipeline-card" key={pipeline.id} to={`/demo/${pipeline.id}`}>
                  <div className="pipeline-card-top">
                    <Badge badge={pipeline.badge} />
                    <span>Open</span>
                  </div>
                  <h3>{pipeline.title}</h3>
                  <p>
                    <InlineCodeText text={pipeline.tagline} />
                  </p>
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
        </section>
      ))}
    </div>
  );
}
