import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useTheme } from "../lib/theme";
import { decodeSource, FormaSnippet } from "./FormaReader";
import { readingExamples } from "./examples";
import "./reading.css";

/**
 * A snippet for an iframe on another site: ?source= (base64url) or
 * ?example=, with optional ?focus= and ?title=. It follows the parent's theme and
 * reports its height, with the same messages as the workbench embed.
 */
export function ReaderEmbedPage() {
  const [search] = useSearchParams();
  const { setTheme } = useTheme();
  const root = useRef<HTMLElement>(null);
  const example = readingExamples.find(candidate => candidate.id === search.get("example"));
  const source = (search.get("source") ? decodeSource(search.get("source")!) : undefined) ?? example?.files[0]?.source ?? "";
  const focus = search.get("focus") ?? example?.focus;

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type === "forma-workbench-theme" && (event.data.theme === "light" || event.data.theme === "dark")) setTheme(event.data.theme, false);
    };
    const element = root.current;
    const report = () => { if (element) window.parent.postMessage({ type: "forma-reader-height", height: Math.ceil(element.getBoundingClientRect().height) }, window.location.origin); };
    const observer = new ResizeObserver(report);
    if (element) observer.observe(element);
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "forma-workbench-ready" }, window.location.origin);
    return () => { observer.disconnect(); window.removeEventListener("message", receive); };
  }, [setTheme]);

  return <main className="rd-embed" ref={root}>
    <FormaSnippet focus={focus} source={source} title={search.get("title") ?? example?.files[0]?.id} />
  </main>;
}
