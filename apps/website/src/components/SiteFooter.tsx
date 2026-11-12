import family from "../../../../docs/.vitepress/family.json";
import navigation from "../../../../docs/.vitepress/navigation.json";

export function SiteFooter() {
  return <>
    <aside className="family-strip" aria-label="WorldVM family">
      {family.map(project => <a key={project.name} href={project.site} data-tier={project.tier}>
        <strong>{project.name}</strong><span>{project.pitch}</span>
      </a>)}
    </aside>
    <footer className="shared-footer">
      <nav aria-label="Footer navigation">
        {navigation.map(item => <a key={item.text} href={item.link}>{item.text}</a>)}
        <a href="/feed.xml">Atom feed</a>
      </nav>
      <p><a href="https://worldvm.com">Part of the WorldVM family</a></p>
      <p>Released under the MIT License. © 2026 Ben Jacobson</p>
    </footer>
  </>;
}
