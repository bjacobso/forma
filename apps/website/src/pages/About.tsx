import { Link } from "react-router-dom";
import { Dfn } from "../components/Dfn";
import { useDocumentMeta } from "../lib/documentMeta";

export function About() {
  useDocumentMeta({
    title: "About Forma",
    description:
      "Forma is a Lisp-shaped authoring surface for typed ontology, runtime, and deployment artifacts.",
  });

  return (
    <main className="about-page">
      <header className="about-hero">
        <a className="back-link" href="/">Home</a>
        <h1>Notes toward one ontology, many front ends, many targets.</h1>
        <p>
          Forma is a typed Lisp for building domain-specific languages: author
          a system once, check it as a program, then elaborate it into portable
          runtime and deployment artifacts.
        </p>
        <div className="hero-actions">
          <Link className="primary-action" to="/demo/effect-schema">
            Inspect schema elaboration
          </Link>
          <a
            className="secondary-action"
            href="https://github.com/bjacobso/forma-lang/tree/main/docs"
            rel="noreferrer"
            target="_blank"
          >
            Specs
          </a>
        </div>
      </header>

      <section className="about-grid">
        <article>
          <span>Authoring</span>
          <h2>Programs stay small enough to inspect.</h2>
          <p>
            Forma source is S-expression data. Macros can extend the surface, but
            the demo keeps showing the rewritten form so the abstraction stays
            accountable.
          </p>
        </article>
        <article>
          <span>Checking</span>
          <h2>Types are inferred before target code exists.</h2>
          <p>
            The browser demo runs the same engine package as the monorepo. Its
            type table is not mock data; it is the compiler exposing each
            expression the inference pass understands.
          </p>
        </article>
        <article>
          <span>Elaboration</span>
          <h2>The output can be a description, not just a value.</h2>
          <p>
            <Dfn term="elaboration">Elaboration</Dfn> lets a program become an
            ontology, Effect-flavored TypeScript, or infrastructure declarations
            while preserving the earlier passes as inspectable evidence.
          </p>
        </article>
      </section>

      <section className="story-band about-story">
        <h2>Where it fits</h2>
        <p>
          The long-term direction is a shared IR: Forma, TypeScript builders, and
          plain blueprint data all construct the same ontology shape. Runtime
          layers and deployment targets then bind that shape to Convex,
          Cloudflare, Node, or another target without changing the source idea.
        </p>
        <p>
          The website is intentionally honest about what exists today. Live
          pipelines are computed in the tab. Preview pipelines are labelled as
          target-roadmap artifacts, so the imagined last arrow never hides the
          real compiler passes before it.
        </p>
      </section>

      <footer className="site-footer">
        <span>Research project. APIs unstable.</span>
        <nav>
          <Link to="/demo">Demo gallery</Link>
          <a href="https://github.com/bjacobso/forma-lang" rel="noreferrer" target="_blank">
            GitHub
          </a>
        </nav>
      </footer>
    </main>
  );
}
