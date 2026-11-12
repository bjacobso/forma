import navigation from "../../../../docs/.vitepress/navigation.json";
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
        {navigation.map(item => <a key={item.text} href={item.link}>{item.text}</a>)}
      </nav>
      <ThemeToggle />
    </header>
  );
}
