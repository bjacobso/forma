import { NavLink } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader() {
  return (
    <header className="site-header">
      <a className="site-brand" href="/" aria-label="Forma home">
        <span className="site-brand-mark">( )</span>
        <span>Forma</span>
      </a>
      <nav aria-label="Main navigation" className="site-nav">
        <a href="/">Home</a>
        <NavLink to="/demo">Examples</NavLink>
        <a href="/workbench/demo/">Workbench</a>
        <a href="/vision">Vision</a>
        <a href="/language">Language</a>
      </nav>
      <ThemeToggle />
    </header>
  );
}
