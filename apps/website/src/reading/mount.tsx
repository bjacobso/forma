import { createRoot } from "react-dom/client";
import { HostThemeProvider, type SiteTheme } from "../lib/theme";
import { FormaSnippet, type FormaSnippetProps } from "./FormaReader";
import readerStyles from "./reading.css?inline";

export interface MountOptions extends FormaSnippetProps {
  /** Keep this theme instead of following the page's `dark` class. */
  readonly theme?: SiteTheme | undefined;
}

/**
 * Renders a reader snippet into an element of another site. The snippet lives in
 * a shadow root with its own styles, so the host's element rules (VitePress's
 * `.vp-doc code` and `a`, for example) cannot reach it. Returns the unmount.
 */
export function mountSnippet(element: HTMLElement, { theme, ...props }: MountOptions): () => void {
  const shadow = element.shadowRoot ?? element.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = readerStyles;
  const container = document.createElement("div");
  shadow.replaceChildren(style, container);
  const root = createRoot(container);
  root.render(<HostThemeProvider fixed={theme}><FormaSnippet {...props} /></HostThemeProvider>);
  return () => root.unmount();
}
