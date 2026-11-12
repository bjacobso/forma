import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export function useDocumentMeta({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  const location = useLocation();
  useEffect(() => {
    document.title = title;
    setMeta("description", description);
    setMeta("og:title", title, "property");
    setMeta("og:description", description, "property");
    const url = `https://forma-lang.com${window.location.pathname.replace(/\/$/, "")}`;
    setMeta("og:url", url, "property");
    setMeta("og:image", "https://forma-lang.com/og-image.png", "property");
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = url;
  }, [description, title, location.pathname]);
}

function setMeta(name: string, content: string, attribute: "name" | "property" = "name") {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, name);
    document.head.appendChild(element);
  }
  element.content = content;
}
