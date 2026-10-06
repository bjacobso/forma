import { Badge } from "../components/Badge";
import { PipelineGrid } from "../components/PipelineGrid";
import { useDocumentMeta } from "../lib/documentMeta";
import { galleryDescription } from "../lib/siteCopy";

export function DemoGallery({ compact = false }: { readonly compact?: boolean }) {
  useDocumentMeta({
    title: "Forma Examples",
    description: galleryDescription,
  });

  return (
    <main className={compact ? "gallery gallery-compact" : "gallery"}>
      <nav className="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><span>Examples</span></nav>
      <div className="section-heading">
        <span>Examples</span>
        {!compact ? <h1>Choose a program to inspect.</h1> : <h2>Choose a program to inspect.</h2>}
        <p>
          Start with a domain language, then look at the core it runs on. Live examples recompile
          in your browser as you edit; preview examples say where their pinned output comes from.
        </p>
      </div>
      <section className="pipeline-group workbench-demo" aria-labelledby="workbench-demo-heading">
        <div className="pipeline-group-heading">
          <span>Structural editing</span>
          <h3 id="workbench-demo-heading">The outline is the program.</h3>
          <p>Edit an onboarding workflow with live values, types, and diagnostics on every row.</p>
        </div>
        <div className="pipeline-grid">
          <a className="pipeline-card" href="/workbench/demo/">
            <div className="pipeline-card-top">
              <Badge badge="live" />
              <span>Open</span>
            </div>
            <h3>Forma Workbench</h3>
            <p>
              Switch between outline and source, review assistant proposals, and approve sample
              capabilities before they run.
            </p>
            <div className="mini-stages">
              <code>Outline</code><code>Source</code><code>Inspector</code>
            </div>
          </a>
        </div>
      </section>
      <PipelineGrid />
    </main>
  );
}
