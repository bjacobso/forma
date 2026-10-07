import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { LiveWorkbench } from "../components/LiveWorkbench";
import { useTheme } from "../lib/theme";

export function WorkbenchPage({ embedded = false }: { embedded?: boolean }) {
  const { exampleId } = useParams();
  const [search] = useSearchParams();
  const { setTheme } = useTheme();
  useEffect(() => {
    if (!embedded) return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type === "forma-workbench-theme" && (event.data.theme === "light" || event.data.theme === "dark")) setTheme(event.data.theme);
    };
    const element = document.querySelector(".live-workbench");
    const reportHeight = () => { if (element) window.parent.postMessage({ type: "forma-workbench-height", height: Math.ceil(element.getBoundingClientRect().height) }, window.location.origin); };
    const observer = new ResizeObserver(reportHeight);
    if (element) observer.observe(element);
    reportHeight();
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "forma-workbench-ready" }, window.location.origin);
    return () => { observer.disconnect(); window.removeEventListener("message", receive); };
  }, [embedded, setTheme]);
  return <main className={embedded ? "workbench-embed-page" : "workbench-page"}>
    <LiveWorkbench key={exampleId} initialExample={exampleId} initiallyBroken={search.get("broken") === "1"} embedded={embedded} />
  </main>;
}
