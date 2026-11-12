// Shared source of truth for the blog index, sidebar and Atom feed.
import { readdirSync, readFileSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const blog = fileURLToPath(new URL("../docs/blog/", import.meta.url));
export const siteOrigin = "https://forma-lang.com";

export function loadPosts() {
  return readdirSync(blog, { recursive: true })
    .filter(file => file.endsWith(".md") && !file.endsWith("index.md"))
    .map(file => {
      const source = readFileSync(join(blog, file), "utf8");
      const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
      const field = name => frontmatter.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1];
      const date = field("date");
      const title = field("title");
      const description = field("description");
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !title || !description) {
        throw new Error(`Blog post needs title, description and ISO date: ${file}`);
      }
      const path = `/blog/${file.replace(/\.md$/, "")}`;
      return { title, description, date, path, url: `${siteOrigin}${path}` };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.path.localeCompare(a.path));
}

const xml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

export async function writeDiscovery(output) {
  const posts = loadPosts();
  const updated = `${posts[0].date}T00:00:00Z`;
  const entries = posts.map(post => `<entry><id>${post.url}</id><title>${xml(post.title)}</title><link href="${post.url}"/><published>${post.date}T00:00:00Z</published><updated>${post.date}T00:00:00Z</updated><summary>${xml(post.description)}</summary></entry>`).join("\n");
  await writeFile(join(output, "feed.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><id>${siteOrigin}/blog/</id><title>Forma blog</title><link href="${siteOrigin}/feed.xml" rel="self"/><link href="${siteOrigin}/blog/"/><updated>${updated}</updated><author><name>Ben Jacobson</name></author>\n${entries}\n</feed>\n`);
  const files = await readdir(output, { recursive: true });
  const routes = files.filter(file => file.endsWith(".html") && file !== "404.html")
    .map(file => `/${file.replace(/index\.html$/, "").replace(/\.html$/, "")}`);
  // Public tool entry points have Worker-rendered metadata rather than static HTML.
  routes.push("/playground", "/playground/custom", "/playground/demo");
  await writeFile(join(output, "sitemap.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(routes)].sort().map(path => `<url><loc>${xml(siteOrigin + path)}</loc></url>`).join("\n")}\n</urlset>\n`);
  await writeFile(join(output, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteOrigin}/sitemap.xml\n`);
}
