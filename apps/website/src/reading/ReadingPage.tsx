import { Link, useSearchParams } from "react-router-dom";
import { useDocumentMeta } from "../lib/documentMeta";
import { decodeSource, FormaReader } from "./FormaReader";
import { readingExamples, type ReadingExample } from "./examples";
import "./reading.css";

export function ReadingPage() {
  useDocumentMeta({ title: "Reading Forma", description: "Read Forma code with its types, effects, and prelude forms." });
  const [search, setSearch] = useSearchParams();
  // ?source= opens a shared or embedded snippet; ?example= one of the examples.
  const shared = search.get("source") ? decodeSource(search.get("source")!) : undefined;
  const exampleId = readingExamples.some(example => example.id === search.get("example")) ? search.get("example")! : readingExamples[0]!.id;
  const example: ReadingExample = shared !== undefined
    ? { id: "shared", label: "Shared", blurb: "A snippet opened from a link.", files: [{ id: "main.lisp", source: shared }], focus: search.get("focus") ?? undefined }
    : readingExamples.find(candidate => candidate.id === exampleId)!;

  return <main className="rd-page">
    <header className="rd-top">
      <div className="rd-title">
        <span className="rd-eyebrow">Prototype · reading editor</span>
        <h1>Read Forma with its types</h1>
        <p>{example.blurb} <Link className="rd-link" to="/read/snippets">Inline snippets and embeds →</Link></p>
      </div>
      <nav aria-label="Examples" className="rd-examples">
        {readingExamples.map(candidate => <button aria-pressed={candidate.id === example.id} className={candidate.id === example.id ? "active" : ""} key={candidate.id} onClick={() => setSearch({ example: candidate.id })} type="button">{candidate.label}</button>)}
      </nav>
    </header>
    <FormaReader files={example.files} focus={example.focus} key={shared !== undefined ? `shared:${search.get("source")}` : example.id} />
  </main>;
}
