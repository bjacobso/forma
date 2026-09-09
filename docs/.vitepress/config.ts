import { resolve } from "node:path";

import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "en-US",
  title: "Forma",
  titleTemplate: ":title · Forma",
  description: "A typed language for building domain-specific languages.",
  cleanUrls: true,
  lastUpdated: true,
  outDir: resolve(import.meta.dirname, "../../dist-docs"),
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/mark.svg" }],
    ["meta", { name: "theme-color", content: "#101418" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Forma" }],
  ],
  markdown: {
    theme: {
      light: "github-dark-high-contrast",
      dark: "github-dark-high-contrast",
    },
    languages: ["json", "lisp", "scheme", "sh", "ts"],
  },
  themeConfig: {
    logo: { src: "/mark.svg", alt: "Forma" },
    siteTitle: "Forma",
    nav: [
      { text: "Playground", link: "/playground", target: "_self", rel: "" },
      { text: "Vision", link: "/vision" },
      { text: "Language", link: "/language" },
      { text: "Architecture", link: "/architecture" },
    ],
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Vision", link: "/vision" },
          { text: "Language", link: "/language" },
        ],
      },
      {
        text: "Design",
        items: [
          { text: "Architecture", link: "/architecture" },
          { text: "Design decisions", link: "/design-decisions" },
        ],
      },
      {
        text: "Project",
        items: [{ text: "Roadmap", link: "/roadmap" }],
      },
    ],
    search: {
      provider: "local",
      options: { detailedView: true },
    },
    outline: { level: [2, 3], label: "On this page" },
    socialLinks: [
      { icon: "github", link: "https://github.com/bjacobso/forma-lang" },
    ],
    editLink: {
      pattern: "https://github.com/bjacobso/forma-lang/edit/main/docs/:path",
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
