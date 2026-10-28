import { NavLink } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader() {
  return (
    <header className="site-header">
      <a className="site-brand" href="/" aria-label="Forma home">
        <span className="site-brand-paren" aria-hidden="true">(</span>
        <span>forma</span>
        <span className="site-brand-paren" aria-hidden="true">)</span>
      </a>
      <nav aria-label="Main navigation" className="site-nav">
        <a href="/language">Learn</a>
        <a href="/preludes/">Preludes</a>
        <NavLink to="/demo">Examples</NavLink>
        <a href="/workbench/demo/">Workbench</a>
        <NavLink className="site-nav-cta" end to="/">Playground</NavLink>
      </nav>
      <ThemeToggle />
    </header>
  );
}
