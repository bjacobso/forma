import { Link } from "react-router-dom";
import { Dfn } from "../components/Dfn";
import { useDocumentMeta } from "../lib/documentMeta";
import { aboutDescription } from "../lib/siteCopy";

export function About() {
  useDocumentMeta({
    title: "About Forma",
    description: aboutDescription,
  });

  return (
    <main className="about-page">
      <header className="about-hero">
        <a className="back-link" href="/">Home</a>
        <h1>A typed Lisp for building domain languages.</h1>
        <p>
          Define keywords like <code>define-entity</code> in a prelude. Forma checks the
          programs that use them, keeps diagnostics on the author's source, and emits typed
          artifacts that other systems consume.
        </p>
        <div className="hero-actions">
          <Link className="primary-action" to="/demo/entities">
            See a keyword defined in a prelude
          </Link>
          <a className="secondary-action" href="/">
            Docs
          </a>
        </div>
      </header>

      <section className="about-grid">
        <article>
          <span>Extension</span>
          <h2>The keyword is library code.</h2>
          <p>
            Preludes register forms with <code>define-form</code>: slots, bindings, validation,
            result types, and the hook that builds output. The compiler does not know what an
            entity, endpoint, or policy is.
          </p>
        </article>
        <article>
          <span>Contracts</span>
          <h2>The type says what code can do.</h2>
          <p>
            Operations infer <code>Effect&lt;A, E, R&gt;</code>: the result, a closed set of
            failures, and a closed set of required capabilities. Leave one out of a signature
            and the operation does not compile.
          </p>
        </article>
        <article>
          <span>Artifacts</span>
          <h2>The output is a typed description.</h2>
          <p>
            <Dfn term="elaboration">Elaboration</Dfn> produces canonical IR that another system
            validates, reviews, and executes, or a generated target such as Effect TypeScript.
          </p>
        </article>
      </section>

      <section className="story-band about-story">
        <h2>Where it stands</h2>
        <p>
          One TypeScript engine implements the language. It is built for embedding, runs this
          playground, and backs the editor tooling and the <code>forma</code> CLI. Conformance
          fixtures with stored, reviewed outputs pin its behavior.
        </p>
        <p>
          The playground labels what it computes. Live pipelines run in this tab. Preview
          pipelines say where their target output comes from, so pinned output never passes for
          something the browser computed.
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
