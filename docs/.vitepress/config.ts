import navigation from "./navigation.json" with { type: "json" };
import { loadPosts, siteOrigin, writeDiscovery } from "../../scripts/site-content.mjs";
import { resolve } from "node:path";

import { defineConfig, type DefaultTheme, type HeadConfig, type PageData } from "vitepress";

import { groupTitles, loadPreludes, type PreludeGroup } from "./preludes.ts";

// Static samples use the editor's restrained dark syntax palette in both page themes.
const codeTheme = {
  name: "forma-code",
  type: "dark" as const,
  settings: [
    { settings: { background: "#111613", foreground: "#eef0ea" } },
    { scope: ["comment", "punctuation"], settings: { foreground: "#b5bcb4" } },
    { scope: ["keyword", "storage", "constant.language"], settings: { foreground: "#d2bbef" } },
    { scope: ["string"], settings: { foreground: "#b0d7b5" } },
    { scope: ["constant.numeric", "entity.name.function", "entity.name.type", "support", "constant.other"], settings: { foreground: "#9bbaf5" } },
  ],
};

const preludeSidebar: DefaultTheme.SidebarItem[] = [
  { text: "Preludes", items: [{ text: "Catalog", link: "/preludes/" }] },
  ...(Object.keys(groupTitles) as PreludeGroup[]).map((group) => ({
    text: groupTitles[group],
    items: loadPreludes()
      .filter((prelude) => prelude.group === group)
      .map((prelude) => ({ text: prelude.slug, link: `/preludes/${prelude.slug}` })),
  })),
];

const blogSidebar: DefaultTheme.SidebarItem[] = [{
  text: "Blog",
  items: [
    { text: "All posts", link: "/blog/" },
    { text: "From Lists to Languages", link: "/blog/in-the-beginning/" },
    ...loadPosts().map(post => ({ text: `${post.date} · ${post.title}`, link: post.path })),
  ],
}];

function pageMetadata(pageData: PageData): HeadConfig[] {
  const path = "/" + pageData.relativePath.replace(/index\.md$/, "").replace(/\.md$/, "");
  const url = siteOrigin + path;
  const description = pageData.description || "Define your domain. Check its programs.";
  return [
    ["link", { rel: "canonical", href: url }],
    ["meta", { property: "og:url", content: url }],
    ["meta", { property: "og:title", content: pageData.title === "Forma" ? "Forma" : `${pageData.title} · Forma` }],
    ["meta", { property: "og:description", content: description }],
    ["meta", { property: "og:image", content: `${siteOrigin}/og-image.png` }],
  ];
}

export default defineConfig({
  lang: "en-US",
  title: "Forma",
  titleTemplate: ":title · Forma",
  description: "A programmable type system for Lisp.",
  cleanUrls: true,
  appearance: { initialValue: "auto", storageKey: "forma-theme" },
  async buildEnd(config) { await writeDiscovery(config.outDir); },
  // RFCs are design records for the repository, not site pages.
  srcExclude: ["rfcs/**", "proposals/**"],
  lastUpdated: true,
  outDir: resolve(import.meta.dirname, "../../dist-docs"),
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/mark.svg" }],
    ["meta", { name: "theme-color", content: "#faf8f3" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Forma" }],
  ],
  markdown: {
    theme: {
      light: codeTheme,
      dark: codeTheme,
    },
    languages: ["json", "lisp", "scheme", "sh", "ts"],
    // `.lisp` modules are Forma source; highlight them as the Lisp they are.
    languageAlias: { forma: "lisp" },
  },
  transformPageData(pageData) {
    // Generated prelude pages carry their metadata as route params.
    const params = pageData.params;
    if (params?.slug && pageData.relativePath.startsWith("preludes/")) {
      pageData.title = String(params.title);
      pageData.description = String(params.description);
      pageData.frontmatter.outline = params.outline;
    }
    pageData.frontmatter.head = [...(pageData.frontmatter.head ?? []), ...pageMetadata(pageData)];
  },
  transformHead({ pageData }) {
    // VitePress synthesizes its 404 without calling transformPageData.
    return pageData.frontmatter.head?.some(([tag, attrs]) => tag === "link" && attrs.rel === "canonical")
      ? [] : pageMetadata(pageData);
  },
  themeConfig: {
    siteTitle: "forma",
    nav: navigation.map(item => ({ ...item, target: "_self", rel: "" })),
    sidebar: {
      "/preludes/": preludeSidebar,
      "/blog/": blogSidebar,
      "/": [
        {
          text: "Start",
          items: [
            { text: "Preludes", link: "/preludes/" },
            { text: "Vision", link: "/vision" },
            { text: "Language", link: "/language" },
            { text: "Core cheat sheet", link: "/cheatsheet" },
            { text: "Authoring your own program", link: "/authoring" },
            { text: "Structure and interpretation", link: "/structure-and-interpretation" },
            { text: "Roots of Lisp crib sheet", link: "/roots-of-lisp" },
            { text: "Domain modeling", link: "/domain-modeling" },
            { text: "Writing a form", link: "/writing-a-form" },
            { text: "Forma for Effect", link: "/effect" },
            { text: "Effect reference", link: "/effect/reference" },
            { text: "Prelude HTTP API spike", link: "/effect/http-api" },
            { text: "Prelude-defined RPC", link: "/effect/rpc" },
            { text: "Prelude-defined Cluster entities", link: "/effect/cluster" },
            { text: "One Effect system", link: "/effect/system" },
            { text: "Forma for Elm-style apps", link: "/elm" },
            { text: "Elm prototype reference", link: "/elm/reference" },
            { text: "Forma for email automation", link: "/email" },
            { text: "Clojure spellings", link: "/clojure" },
          ],
        },
        {
          text: "Design",
          items: [
            { text: "Architecture", link: "/architecture" },
            { text: "Design decisions", link: "/design-decisions" },
            { text: "Retiring the OCaml engine", link: "/engine-consolidation" },
            { text: "Language services", link: "/language-services" },
            { text: "Embedding Forma", link: "/embedding" },
            { text: "File modules", link: "/modules" },
          ],
        },
        {
          text: "Project",
          items: [
            { text: "For agents", link: "/agents" },
            { text: "MCP server", link: "/mcp" },
            { text: "Roadmap", link: "/roadmap" },
            { text: "Publishing", link: "/publishing" },
            { text: "Consumer upgrade notes", link: "/consumer-upgrade-1317204" },
            { text: "Workbench", link: "/workbench" },
            { text: "Workbench embeds", link: "/workbench-embeds" },
            { text: "Workbench vision", link: "/workbench-vision" },
          ],
        },
      ],
    },
    search: {
      provider: "local",
      options: { detailedView: true },
    },
    outline: { level: [2, 3], label: "On this page" },
    socialLinks: [
      { icon: "github", link: "https://github.com/bjacobso/forma" },
    ],
    editLink: {
      pattern: "https://github.com/bjacobso/forma/edit/main/docs/:path",
      text: "Edit this page",
    },
    lastUpdated: { text: "Last updated" },
    docFooter: { prev: "Previous", next: "Continue" },
    externalLinkIcon: true,

  },
});
