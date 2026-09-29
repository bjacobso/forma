import { PipelineGrid } from "../components/PipelineGrid";
import { useDocumentMeta } from "../lib/documentMeta";

export function DemoGallery({ compact = false }: { readonly compact?: boolean }) {
  useDocumentMeta({
    title: "Forma Pipeline Gallery",
    description: "Choose a Forma compiler pipeline and inspect each pass from source to output.",
  });

  return (
    <main className={compact ? "gallery gallery-compact" : "gallery"}>
      <nav className="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>/</span><span>Examples</span></nav>
      <div className="section-heading">
        <span>FORMA / EXAMPLE PLAYGROUND</span>
        {!compact ? <h1>Choose a program to inspect.</h1> : <h2>Choose a program to inspect.</h2>}
        <p>Each example opens the real compiler. Edit the source and step through its passes.</p>
      </div>
      <PipelineGrid />
    </main>
  );
}
