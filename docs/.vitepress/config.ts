import { resolve } from "node:path";

import { defineConfig, type DefaultTheme } from "vitepress";

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

// Unpublished parts are listed without links so the series shows its whole arc.
const blogSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: "Blog",
    items: [
      { text: "All posts", link: "/blog/" },
      { text: "The Reader Is the Bottleneck", link: "/blog/reader-is-the-bottleneck" },
    ],
  },
  {
    text: "From Lists to Languages",
    items: [
      { text: "About the series", link: "/blog/in-the-beginning/" },
      { text: "01 · Start with a List", link: "/blog/in-the-beginning/01-the-list" },
      { text: "02 · Giving the List a Schema", link: "/blog/in-the-beginning/02-list-became-schema" },
      { text: "03 · Errors Are Not Exceptions", link: "/blog/in-the-beginning/03-errors-are-not-exceptions" },
      { text: "04 · The Environment Is Not the World", link: "/blog/in-the-beginning/04-environment-is-not-the-world" },
      { text: "05 · Types Before Execution", link: "/blog/in-the-beginning/05-types-before-execution" },
      { text: "06 · The Interpreter Becomes a Compiler", link: "/blog/in-the-beginning/06-interpreter-becomes-compiler" },
      { text: "07 · Macros Are Programs About Programs", link: "/blog/in-the-beginning/07-macros" },
      { text: "08 · The Prelude Is the Language", link: "/blog/in-the-beginning/08-prelude-is-the-language" },
      { text: "09 · Effects Are Part of the Type", link: "/blog/in-the-beginning/09-effects-are-part-of-the-type" },
      { text: "10 · One Program, Many Interpretations", link: "/blog/in-the-beginning/10-many-interpretations" },
      { text: "11 · The Agent Can Read the Language", link: "/blog/in-the-beginning/11-agent-can-read-the-language" },
      { text: "12 · A Language for Building Languages", link: "/blog/in-the-beginning/12-let-there-be-languages" },
    ],
  },
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
          { text: "Core cheat sheet", link: "/cheatsheet" },
          { text: "Authoring your own program", link: "/authoring" },
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
      { text: "Blog", link: "/blog/", activeMatch: "^/blog/" },
      { text: "Examples", link: "/playground/demo", target: "_self", rel: "" },
      { text: "Playground", link: "/playground", target: "_self", rel: "" },
    ],
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
