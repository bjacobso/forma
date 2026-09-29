import { Link } from "react-router-dom";
import { Dfn } from "../components/Dfn";
import { PipelineGrid } from "../components/PipelineGrid";
import { useDocumentMeta } from "../lib/documentMeta";

export function Home() {
  useDocumentMeta({
    title: "Forma Playground",
    description: "Edit a Forma program and inspect every compiler pass from source to target.",
  });

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">FORMA / LIVE LANGUAGE LAB</span>
          <h1>Explore every <em>transformation.</em></h1>
          <p>Edit a Forma program and follow it from source text to a checked value or target artifact. Every pass runs in your browser.</p>
          <div className="hero-actions">
            <Link className="primary-action" to="/demo/full-pipeline">Try the full pipeline ↗</Link>
            <Link className="secondary-action" to="/demo">Browse examples →</Link>
          </div>
        </div>
        <div className="hero-specimen">
          <span>EXPERIMENT 01 / FULL PIPELINE</span>
          <pre>{`(define grade (fn [score]
  (cond (>= score 90) "A"
        (>= score 80) "B"
        :else "C")))

(map grade [95 82 75])`}</pre>
          <div>Source → Read → Expand → Typecheck → Eval → Target</div>
          <strong>["A", "B", "C"]</strong>
        </div>
      </section>

      <section className="claim-row">
        <Link to="/demo/full-pipeline">The complete pipeline ↗</Link>
        <Link to="/demo/pipes">Explore macros ↗</Link>
        <Link to="/demo/types">Inspect types ↗</Link>
      </section>

      <section className="gallery gallery-compact">
        <div className="section-heading">
          <span>EXAMPLES / CHOOSE A PATH</span>
          <h2>Start with a program. Follow the evidence.</h2>
        </div>
        <PipelineGrid />
      </section>

      <section className="story-band">
        <h2>See what the compiler knows.</h2>
        <p>Forma exposes the artifact at each stage, from the S-expression tree to the final value or target projection.</p>
        <p>A <Dfn term="macro">macro</Dfn> can rewrite a program; <Dfn term="elaboration">elaboration</Dfn> can turn it into an artifact another system uses. The examples keep both visible.</p>
      </section>

      <footer className="site-footer"><span>Research project. APIs unstable.</span><nav><a href="/">Home</a><Link to="/demo">All examples</Link></nav></footer>
    </main>
  );
}
