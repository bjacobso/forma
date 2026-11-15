import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { LiveWorkbench } from "../components/LiveWorkbench";
import { SnapshotControls, snapshotDraftKey, useSnapshotSession } from "../components/SnapshotSession";
import { useDocumentMeta } from "../lib/documentMeta";
import { snapshotPath, type WorkbenchSnapshot } from "../lib/playgroundSnapshot";
import { fetchSnapshot } from "../lib/shareSnapshot";
import { playgroundDescription } from "../lib/siteCopy";
import { useTheme } from "../lib/theme";
import { workbenchExamples } from "../workbench/examples";

/** What the page opened: an example, or a published snapshot. */
interface WorkbenchBase {
  readonly draftKey: string;
  readonly snapshot: WorkbenchSnapshot;
  readonly broken: boolean;
  readonly sharedUrl?: string | undefined;
}

export function WorkbenchPage({ embedded = false }: { embedded?: boolean }) {
  const { exampleId } = useParams();
  useDocumentMeta({ title: "Live Forma workbench", description: playgroundDescription });
  const [search] = useSearchParams();
  const location = useLocation();
  const { setTheme } = useTheme();
  useEffect(() => {
    if (!embedded) return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type === "forma-workbench-theme" && (event.data.theme === "light" || event.data.theme === "dark")) setTheme(event.data.theme, false);
    };
    const element = document.querySelector(".wb");
    const reportHeight = () => { if (element) window.parent.postMessage({ type: "forma-workbench-height", height: Math.ceil(element.getBoundingClientRect().height) }, window.location.origin); };
    const observer = new ResizeObserver(reportHeight);
    if (element) observer.observe(element);
    reportHeight();
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "forma-workbench-ready" }, window.location.origin);
    return () => { observer.disconnect(); window.removeEventListener("message", receive); };
  }, [embedded, setTheme]);

  const snapshotId = search.get("snapshot");
  const [loaded, setLoaded] = useState<{ readonly id: string; readonly snapshot?: WorkbenchSnapshot; readonly error?: string } | null>(null);
  useEffect(() => {
    if (!snapshotId) return;
    const controller = new AbortController();
    fetchSnapshot(snapshotId, "workbench", controller.signal)
      .then(snapshot => setLoaded(workbenchExamples.some(item => item.id === snapshot.example) ? { id: snapshotId, snapshot } : { id: snapshotId, error: "This snapshot's example is no longer in the workbench." }))
      .catch((reason: unknown) => { if (!controller.signal.aborted) setLoaded({ id: snapshotId, error: reason instanceof Error ? reason.message : String(reason) }); });
    return () => controller.abort();
  }, [snapshotId]);

  const base = useMemo((): WorkbenchBase | null => {
    if (snapshotId) {
      if (loaded?.id !== snapshotId || !loaded.snapshot) return null;
      return { draftKey: snapshotDraftKey("workbench", snapshotId), snapshot: loaded.snapshot, broken: false, sharedUrl: new URL(snapshotPath(snapshotId, loaded.snapshot), window.location.origin).href };
    }
    const example = workbenchExamples.find(item => item.id === exampleId) ?? workbenchExamples[0]!;
    const broken = search.get("broken") === "1";
    return { draftKey: `workbench:example:${example.id}${broken ? ":broken" : ""}`, broken, snapshot: { kind: "workbench", example: example.id, source: broken ? example.broken : example.source } };
  }, [location.key, loaded]);

  return <main className={embedded ? "workbench-embed-page" : "workbench-page"}>
    {!base ? <p className="workbench-page-message" role={loaded?.error ? "alert" : "status"}>{loaded?.error ?? "Loading the shared workbench…"}</p>
      // Embeds are demos inside other pages: they keep no drafts and have no Share button.
      : embedded ? <LiveWorkbench embedded initialExample={base.snapshot.example} initialSource={base.snapshot.source} initiallyBroken={base.broken} key={location.key} />
      : <WorkbenchSession base={base} key={location.key} />}
  </main>;
}

/** Changing the example or its source is a draft. */
const workbenchContent = (snapshot: WorkbenchSnapshot) => `${snapshot.example}\n${snapshot.source}`;

function WorkbenchSession({ base }: { readonly base: WorkbenchBase }) {
  const session = useSnapshotSession({ draftKey: base.draftKey, base: base.snapshot, sharedUrl: base.sharedUrl, content: workbenchContent });
  return <LiveWorkbench
    actions={<SnapshotControls contents="example and its source" session={session} />}
    initialExample={session.start.example}
    initialSource={session.start.source}
    initiallyBroken={base.broken && session.start === base.snapshot}
    key={session.revision}
    onStateChange={state => session.update({ kind: "workbench", ...state })} />;
}
