import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type SiteTheme = "light" | "dark";

interface SiteThemeContext {
  readonly theme: SiteTheme;
  readonly setTheme: (theme: SiteTheme) => void;
  readonly toggleTheme: () => void;
}

const ThemeContext = createContext<SiteThemeContext | null>(null);

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const [theme, setThemeState] = useState<SiteTheme>(() => initialTheme());

  const value = useMemo<SiteThemeContext>(
    () => ({
      theme,
      setTheme: (nextTheme) => {
        setThemeState(nextTheme);
        window.localStorage.setItem("forma-theme", nextTheme);
      },
      toggleTheme: () => {
        setThemeState((currentTheme) => {
          const nextTheme = currentTheme === "light" ? "dark" : "light";
          window.localStorage.setItem("forma-theme", nextTheme);
          return nextTheme;
        });
      },
    }),
    [theme],
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Follows the host page's `dark` class instead of setting it, for components
 * mounted into another site, such as reader snippets in the docs. A `fixed`
 * theme ignores the page, such as for code blocks that are dark in both themes.
 */
export function HostThemeProvider({ fixed, children }: { readonly fixed?: SiteTheme | undefined; readonly children: ReactNode }) {
  const hostTheme = (): SiteTheme => fixed ?? (document.documentElement.classList.contains("dark") ? "dark" : "light");
  const [theme, setTheme] = useState<SiteTheme>(hostTheme);
  useEffect(() => {
    if (fixed) return;
    const observer = new MutationObserver(() => setTheme(hostTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [fixed]);
  const value = useMemo<SiteThemeContext>(() => ({ theme, setTheme: () => {}, toggleTheme: () => {} }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): SiteThemeContext {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}

function initialTheme(): SiteTheme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("forma-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
