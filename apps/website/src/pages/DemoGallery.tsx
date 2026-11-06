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
      <PipelineGrid />
    </main>
  );
}
