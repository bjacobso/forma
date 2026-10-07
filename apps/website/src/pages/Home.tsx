import { Link } from "react-router-dom";
import { Dfn } from "../components/Dfn";
import { LiveWorkbench } from "../components/LiveWorkbench";
import { PipelineGrid } from "../components/PipelineGrid";
import { useDocumentMeta } from "../lib/documentMeta";
import { playgroundDescription } from "../lib/siteCopy";

export function Home() {
  useDocumentMeta({
    title: "Forma Playground",
    description: playgroundDescription,
  });

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Forma playground</span>
          <h1>Watch a domain language compile.</h1>
          <p>
            Forma is a typed Lisp for building your own domain language. Each example takes one
            program through the compiler and shows every pass, from source text to typed output.
          </p>
          <div className="hero-actions">
            <Link className="primary-action" to="/demo/entities">
              Start with entities
            </Link>
            <Link className="secondary-action" to="/demo">
              Browse examples
            </Link>
          </div>
        </div>

      </section>

      <LiveWorkbench />

      <section className="claim-row">
        <Link to="/demo/entities">Keywords are library code</Link>
        <Link to="/demo/contracts">The type says what code can do</Link>
        <Link to="/demo/effect-ts">Contracts generate Effect TypeScript</Link>
      </section>

      <section className="gallery gallery-compact">
        <div className="section-heading">
          <span>Examples</span>
          <h2>Start with a program. Follow the evidence.</h2>
        </div>
        <PipelineGrid />
      </section>

      <section className="story-band">
        <h2>What you are looking at</h2>
        <p>
          Each example is one source program and the passes it goes through: read,{" "}
          <Dfn term="macro">macro</Dfn> expansion, <Dfn term="typecheck">typecheck</Dfn>,
          evaluation, and a target. Pick a stage to see its output, or click an expression in the
          source to see its inferred type.
        </p>
        <p>
          <strong>Live</strong> examples run <code>@formalang/ts</code> in a Web Worker, so edits
          recompile as you type. <strong>Preview</strong> examples also show a target that is not
          recomputed from your edits, and the target pane says where it comes from. The entities
          example, for instance, shows the OCaml engine's pinned{" "}
          <Dfn term="elaboration">elaboration</Dfn> output.
        </p>
        <p>Forma is pre-alpha. APIs, syntax, and artifact formats will change.</p>
      </section>

      <footer className="site-footer">
        <span>Research project. APIs unstable.</span>
        <nav>
          <a href="/">Home</a>
          <Link to="/demo">All examples</Link>
          <Link to="/about">About</Link>
        </nav>
      </footer>
    </main>
  );
}
