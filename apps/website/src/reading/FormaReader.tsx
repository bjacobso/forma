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
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ReaderRoot, useReader } from "./model";
import { CheckStatus, QuickOpen, ReaderEditor, ReaderInspector, ReaderPanel, ReaderScope, ReaderSidebar, ReaderStatus, ReaderTabs, ReaderToolbar, RenameBar, TypeLine } from "./parts";
import type { PreludeStack, SourceFile } from "./protocol";
import "./reading.css";

export interface FormaReaderProps {
  readonly files: readonly SourceFile[];
  /** Text to select in the first file at first, such as `(define older`. */
  readonly focus?: string | undefined;
  /** Open the files sidebar at first. */
  readonly sidebar?: boolean | undefined;
  /** The bundled preludes to check against. Default `effect`. */
  readonly preludes?: PreludeStack | undefined;
}

/** The sidebar starts open when there is room for it beside the code and the inspector. */
const roomy = () => typeof window !== "undefined" && window.innerWidth >= 1380;

export function FormaReader({ files, focus, sidebar = roomy(), preludes }: FormaReaderProps) {
  return <ReaderRoot className="rd-ide" files={files} focus={focus} preludes={preludes} sidebar={sidebar}>
    <ReaderWorkspace />
    <QuickOpen />
  </ReaderRoot>;
}

/**
 * The full reader's layout inside a <ReaderRoot>: files, the code, and the inspector beside it.
 * `inspector` replaces the right sidebar's content, such as a host's inspector with its own views.
 */
export function ReaderWorkspace({ inspector }: { readonly inspector?: ReactNode } = {}) {
  const reader = useReader();
  return <div className={`rd-workspace${reader.sidebar ? " with-sidebar" : ""}`}>
    {reader.sidebar ? <ReaderSidebar /> : null}
    <section className="rd-editor-pane">
      <ReaderTabs />
      <ReaderScope />
      <ReaderToolbar />
      <RenameBar />
      <ReaderEditor />
      <ReaderPanel />
      <ReaderStatus />
    </section>
    <aside aria-label="Selected form" className="rd-inspector">{inspector ?? <ReaderInspector />}</aside>
  </div>;
}

export interface FormaSnippetProps {
  readonly source: string;
  /** The snippet's file name, shown as its title. Default `main.lisp`. */
  readonly file?: string | undefined;
  /** Other files the snippet can import, such as the other blocks of a docs page that name their files. */
  readonly files?: readonly SourceFile[] | undefined;
  /** Text to select at first. */
  readonly focus?: string | undefined;
  /** Shown above the code, such as a file name. Default the file name. */
  readonly title?: string | undefined;
  /** Offer the full inspector under the code. Default true. */
  readonly details?: boolean | undefined;
  /** The bundled preludes to check against. Default `effect`. */
  readonly preludes?: PreludeStack | undefined;
  /** Code in scope and not shown, such as the earlier blocks of a docs page. */
  readonly before?: string | undefined;
  /**
   * `frame` draws the snippet's own card with a title bar. `bare` draws only the
   * code and a type line, for a host that frames code itself, such as a docs code block.
   */
  readonly chrome?: "frame" | "bare" | undefined;
}

/** A link that opens a source in the full reader. */
export function readerHref(source: string, focus?: string, preludes?: PreludeStack): string {
  const bytes = new TextEncoder().encode(source);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const query = new URLSearchParams({ source: encoded });
  if (focus) query.set("focus", focus);
  if (preludes && preludes !== "effect") query.set("preludes", preludes);
  return `/playground/read?${query}`;
}

export function decodeSource(encoded: string): string | undefined {
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
  } catch {
    return undefined;
  }
}

export function FormaSnippet({ source, file = "main.lisp", files = [], focus, title, details = true, preludes, before, chrome = "frame" }: FormaSnippetProps) {
  const all = [{ id: file, source }, ...files.filter(other => other.id !== file)];
  // The reader opens the code with what came before it, so the link carries both.
  const href = readerHref(before ? `${before.trimEnd()}\n\n${source}` : source, focus, preludes);
  // Inline types would add rows the host's static code did not have; hover and the type line show them.
  if (chrome === "bare") return <ReaderRoot before={before} className="rd-snippet rd-bare" files={all} focus={focus} focusAs="caret" inlineTypes={false} preludes={preludes}>
    <ReaderEditor fit="content" />
    <BareFoot details={details} href={href} />
  </ReaderRoot>;
  return <ReaderRoot before={before} className="rd-snippet" files={all} focus={focus} focusAs="caret" preludes={preludes}>
    <header className="rd-snippet-head">
      <span className="rd-snippet-title">{title ?? file}</span>
      <CheckStatus />
      <a className="rd-link rd-snippet-open" href={href} target="_blank" rel="noreferrer">Open in the reader ↗</a>
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

/** The bare snippet's one line under the code: the type, then whether it checks, the inspector, and the reader. */
function BareFoot({ details, href }: { readonly details: boolean; readonly href: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <TypeLine>
      <CheckStatus />
      {details ? <button aria-expanded={open} className="rd-bare-toggle" onClick={() => setOpen(!open)} title="The selected form's type, effect, prelude form, and lowering" type="button">Inspect<ChevronDown size={12} /></button> : null}
      <a aria-label="Open in the reader" className="rd-bare-open no-icon" href={href} target="_blank" rel="noreferrer" title="Open in the reader">↗</a>
    </TypeLine>
    {open ? <div className="rd-snippet-inspector"><ReaderInspector /></div> : null}
  </>;
}
