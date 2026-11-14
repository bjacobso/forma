/**
 * Ready-made arrangements of the reader's parts:
 *
 * - <FormaReader files>: the full reader, with files, outline, tabs, structural
 *   tools, inspector, references, and generated code.
 * - <FormaSnippet source>: one file inline in prose, such as a blog post or a
 *   demo, sized to its code, with the caret's type under it and the inspector on
 *   demand.
 *
 * For any other layout, put the parts from ./parts inside a <ReaderRoot>.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ReaderRoot, useReader } from "./model";
import { CheckStatus, QuickOpen, ReaderEditor, ReaderInspector, ReaderPanel, ReaderSidebar, ReaderStatus, ReaderTabs, ReaderToolbar, RenameBar, TypeLine } from "./parts";
import type { SourceFile } from "./protocol";
import "./reading.css";

export interface FormaReaderProps {
  readonly files: readonly SourceFile[];
  /** Text to select in the first file at first, such as `(define older`. */
  readonly focus?: string | undefined;
  /** Open the files sidebar at first. */
  readonly sidebar?: boolean | undefined;
}

/** The sidebar starts open when there is room for it beside the code and the inspector. */
const roomy = () => typeof window !== "undefined" && window.innerWidth >= 1380;

export function FormaReader({ files, focus, sidebar = roomy() }: FormaReaderProps) {
  return <ReaderRoot className="rd-ide" files={files} focus={focus} sidebar={sidebar}>
    <IdeLayout />
    <QuickOpen />
  </ReaderRoot>;
}

function IdeLayout() {
  const reader = useReader();
  return <div className={`rd-workspace${reader.sidebar ? " with-sidebar" : ""}`}>
    {reader.sidebar ? <ReaderSidebar /> : null}
    <section className="rd-editor-pane">
      <ReaderTabs />
      <ReaderToolbar />
      <RenameBar />
      <ReaderEditor />
      <ReaderPanel />
      <ReaderStatus />
    </section>
    <aside aria-label="Selected form" className="rd-inspector"><ReaderInspector /></aside>
  </div>;
}

export interface FormaSnippetProps {
  readonly source: string;
  /** Text to select at first. */
  readonly focus?: string | undefined;
  /** Shown above the code, such as a file name. */
  readonly title?: string | undefined;
  /** Offer the full inspector under the code. Default true. */
  readonly details?: boolean | undefined;
}

/** A link that opens a source in the full reader. */
export function readerHref(source: string, focus?: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `/playground/read?source=${encoded}${focus ? `&focus=${encodeURIComponent(focus)}` : ""}`;
}

export function decodeSource(encoded: string): string | undefined {
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
  } catch {
    return undefined;
  }
}

export function FormaSnippet({ source, focus, title, details = true }: FormaSnippetProps) {
  return <ReaderRoot className="rd-snippet" files={[{ id: "main.lisp", source }]} focus={focus} focusAs="caret">
    <header className="rd-snippet-head">
      <span className="rd-snippet-title">{title ?? "Forma"}</span>
      <CheckStatus />
      <a className="rd-link rd-snippet-open" href={readerHref(source, focus)} target="_blank" rel="noreferrer">Open in the reader ↗</a>
    </header>
    <ReaderEditor fit="content" />
    <TypeLine />
    {details ? <SnippetDetails /> : null}
  </ReaderRoot>;
}

function SnippetDetails() {
  const [open, setOpen] = useState(false);
  return <div className={`rd-snippet-details${open ? " open" : ""}`}>
    <button aria-expanded={open} className="rd-snippet-toggle" onClick={() => setOpen(!open)} type="button">
      <ChevronDown size={13} />{open ? "Hide" : "Show"} the form's type, effect, prelude form, and lowering
    </button>
    {open ? <div className="rd-snippet-inspector"><ReaderInspector /></div> : null}
  </div>;
}
