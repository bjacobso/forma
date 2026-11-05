import { resolve } from "node:path";

import { defineConfig, type DefaultTheme } from "vitepress";

import { groupTitles, loadPreludes, type PreludeGroup } from "./preludes.ts";
import { FORMA_WORKBENCH_URL } from "../../apps/website/src/lib/workbenchLocation.ts";

const preludeSidebar: DefaultTheme.SidebarItem[] = [
  { text: "Preludes", items: [{ text: "Catalog", link: "/preludes/" }] },
  ...(Object.keys(groupTitles) as PreludeGroup[]).map((group) => ({
    text: groupTitles[group],
    items: loadPreludes()
      .filter((prelude) => prelude.group === group)
      .map((prelude) => ({ text: prelude.slug, link: `/preludes/${prelude.slug}` })),
  })),
];

export default defineConfig({
  lang: "en-US",
  title: "Forma",
  titleTemplate: ":title · Forma",
  description: "A programmable type system for Lisp.",
  cleanUrls: true,
  // RFCs are design records for the repository, not site pages.
  srcExclude: ["rfcs/**"],
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
      light: "github-dark-high-contrast",
      dark: "github-dark-high-contrast",
    },
    languages: ["json", "lisp", "scheme", "sh", "ts"],
    // `.forma` modules are Forma source; highlight them as the Lisp they are.
    languageAlias: { forma: "lisp" },
  },
  transformPageData(pageData) {
    // Generated prelude pages carry their metadata as route params.
    const params = pageData.params;
    if (!params?.slug || !pageData.relativePath.startsWith("preludes/")) return;
    pageData.title = String(params.title);
    pageData.description = String(params.description);
    pageData.frontmatter.outline = params.outline;
  },
  themeConfig: {
    siteTitle: "forma",
    nav: [
      {
        text: "Learn",
        items: [
          { text: "Language guide", link: "/language" },
          { text: "Structure and interpretation", link: "/structure-and-interpretation" },
          { text: "Domain modeling", link: "/domain-modeling" },
          { text: "Writing a form", link: "/writing-a-form" },
          { text: "Clojure spellings", link: "/clojure" },
          { text: "File modules", link: "/modules" },
          { text: "Vision", link: "/vision" },
          { text: "Architecture", link: "/architecture" },
          { text: "Roadmap", link: "/roadmap" },
        ],
      },
      { text: "Preludes", link: "/preludes/", activeMatch: "^/(preludes|effect|elm|email|clojure)" },
      { text: "Examples", link: "/playground/demo", target: "_self", rel: "" },
      { text: "Workbench (Foldworks)", link: FORMA_WORKBENCH_URL, target: "_self", rel: "" },
      { text: "Playground", link: "/playground", target: "_self", rel: "" },
    ],
    sidebar: {
      "/preludes/": preludeSidebar,
      "/": [
        {
          text: "Start",
          items: [
            { text: "Preludes", link: "/preludes/" },
            { text: "Vision", link: "/vision" },
            { text: "Language", link: "/language" },
            { text: "Structure and interpretation", link: "/structure-and-interpretation" },
            { text: "Domain modeling", link: "/domain-modeling" },
            { text: "Writing a form", link: "/writing-a-form" },
            { text: "Forma for Effect", link: "/effect" },
            { text: "Effect reference", link: "/effect/reference" },
            { text: "Prelude HTTP API spike", link: "/effect/http-api" },
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
            { text: "File modules", link: "/modules" },
            { text: "Workbench vision", link: "/workbench-vision" },
            { text: "Workbench", link: "/workbench" },
          ],
        },
        {
          text: "Project",
          items: [
            { text: "For agents", link: "/agents" },
            { text: "Roadmap", link: "/roadmap" },
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
    footer: {
      message: "Released under the MIT License.",
      copyright: "© 2026 Ben Jacobson",
    },
  },
});
