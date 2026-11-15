import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { SnapshotControls, snapshotDraftKey, useSnapshotSession } from "../components/SnapshotSession";
import { useDocumentMeta } from "../lib/documentMeta";
import { snapshotPath, type ReaderSnapshot } from "../lib/playgroundSnapshot";
import { fetchSnapshot } from "../lib/shareSnapshot";
import { decodeSource, FormaReader } from "./FormaReader";
import { readingExamples } from "./examples";
import { useReader } from "./model";
import { isPreludeFile, isPreludeStack, type PreludeStack } from "./protocol";
import "./reading.css";

/** What the page opened: an example, a `?source=` link, or a published snapshot. Edits are drafts of it. */
interface ReaderBase {
  readonly draftKey: string;
  readonly snapshot: ReaderSnapshot;
  readonly blurb: string;
  readonly example?: string | undefined;
  readonly focus?: string | undefined;
  readonly sharedUrl?: string | undefined;
}

export function ReadingPage() {
  useDocumentMeta({ title: "Reading Forma", description: "Read Forma code with its types, effects, and prelude forms." });
  const [search, setSearch] = useSearchParams();
  const location = useLocation();
  const snapshotId = search.get("snapshot");
  const [loaded, setLoaded] = useState<{ readonly id: string; readonly snapshot?: ReaderSnapshot; readonly error?: string } | null>(null);
  useEffect(() => {
    if (!snapshotId) return;
    const controller = new AbortController();
    fetchSnapshot(snapshotId, "reader", controller.signal)
      .then(snapshot => setLoaded({ id: snapshotId, snapshot }))
      .catch((reason: unknown) => { if (!controller.signal.aborted) setLoaded({ id: snapshotId, error: reason instanceof Error ? reason.message : String(reason) }); });
    return () => controller.abort();
  }, [snapshotId]);

  const base = useMemo((): ReaderBase | null => {
    if (snapshotId) {
      if (loaded?.id !== snapshotId || !loaded.snapshot) return null;
      return { draftKey: snapshotDraftKey("reader", snapshotId), snapshot: loaded.snapshot, blurb: "Code shared from the reader.", sharedUrl: new URL(snapshotPath(snapshotId, loaded.snapshot), window.location.origin).href };
    }
    // ?source= opens a snippet from a link, such as a docs block's; ?example= one of the examples.
    const source = search.get("source");
    const shared = source ? decodeSource(source) : undefined;
    if (shared !== undefined) {
      const focus = search.get("focus") ?? undefined;
      const preludes: PreludeStack = isPreludeStack(search.get("preludes")) ? search.get("preludes") as PreludeStack : "effect";
      return {
        draftKey: `reader:link:${hash([source, focus, preludes].join("\n"))}`, blurb: "A snippet opened from a link.", focus,
        snapshot: { kind: "reader", preludes, files: [{ id: "main.lisp", source: shared }], active: "main.lisp" },
      };
    }
    const example = readingExamples.find(candidate => candidate.id === search.get("example")) ?? readingExamples[0]!;
    return {
      draftKey: `reader:example:${example.id}`, blurb: example.blurb, example: example.id, focus: example.focus,
      snapshot: { kind: "reader", preludes: "effect", files: example.files, active: example.files[0]!.id },
    };
  }, [location.key, loaded]);

  const examples = (current: string | undefined) => <nav aria-label="Examples" className="rd-examples">
    {readingExamples.map(candidate => <button aria-pressed={candidate.id === current} className={candidate.id === current ? "active" : ""} key={candidate.id} onClick={() => setSearch({ example: candidate.id })} type="button">{candidate.label}</button>)}
  </nav>;

  return <main className="rd-page">
    {base
      // A new navigation opens a new session; publishing replaces the link without one.
      ? <ReaderSession base={base} examples={examples(base.example)} key={location.key} />
      : <>
        <ReaderHeader blurb={loaded?.error ? "This shared code could not be opened." : "Opening shared code…"}>{examples(undefined)}</ReaderHeader>
        <p className="rd-page-message" role={loaded?.error ? "alert" : "status"}>{loaded?.error ?? "Loading the snapshot…"}</p>
      </>}
  </main>;
}

function ReaderHeader({ blurb, children }: { readonly blurb: string; readonly children: ReactNode }) {
  return <header className="rd-top">
    <div className="rd-title">
      <span className="rd-eyebrow">Prototype · reading editor</span>
      <h1>Read Forma with its types</h1>
      <p>{blurb} <Link className="rd-link" to="/read/snippets">Inline snippets and embeds →</Link></p>
    </div>
    <div className="rd-top-actions">{children}</div>
  </header>;
}

/** Edits to the files are drafts; switching tabs or opening a prelude is not an edit. */
const readerContent = (snapshot: ReaderSnapshot) => JSON.stringify(snapshot.files.filter(file => !isPreludeFile(file.id)).map(file => [file.id, file.source]));

function ReaderSession({ base, examples }: { readonly base: ReaderBase; readonly examples: ReactNode }) {
  const session = useSnapshotSession({ draftKey: base.draftKey, base: base.snapshot, sharedUrl: base.sharedUrl, content: readerContent });
  const start = session.start;
  return <>
    <ReaderHeader blurb={base.blurb}>
      {examples}
      <SnapshotControls contents="open files, the file you are viewing, and the prelude stack" session={session} />
    </ReaderHeader>
    <FormaReader
      active={start.active}
      files={start.files.flatMap(file => (file.source === undefined ? [] : [{ id: file.id, source: file.source }]))}
      focus={session.restoredAt === null ? base.focus : undefined}
      key={session.revision}
      preludeTabs={start.files.filter(file => file.source === undefined).map(file => file.id)}
      preludes={start.preludes}>
      <ReaderState onChange={session.update} preludes={start.preludes} />
    </FormaReader>
  </>;
}

/** Reports the reader's open files and active file after each change. Bundled preludes are kept by name, after the files. */
function ReaderState({ preludes, onChange }: { readonly preludes: PreludeStack; readonly onChange: (snapshot: ReaderSnapshot) => void }) {
  const reader = useReader();
  useEffect(() => {
    const files = reader.files();
    onChange({
      kind: "reader", preludes, active: reader.active,
      files: [...files.filter(file => !isPreludeFile(file.id)), ...files.filter(file => isPreludeFile(file.id)).map(file => ({ id: file.id }))],
    });
  });
  return null;
}

function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  return (value >>> 0).toString(16);
}
