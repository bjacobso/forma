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
      { text: "Examples", link: "/playground/demo", target: "_self", rel: "" },
      { text: "Workbench", link: "/workbench/demo/", target: "_self", rel: "" },
      { text: "Vision", link: "/vision" },
      { text: "Language", link: "/language" },
      { text: "Effect", link: "/effect" },
      { text: "Architecture", link: "/architecture" },
    ],
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Vision", link: "/vision" },
          { text: "Language", link: "/language" },
          { text: "Writing a form", link: "/writing-a-form" },
          { text: "Forma for Effect", link: "/effect" },
          { text: "Effect reference", link: "/effect/reference" },
          { text: "Prelude HTTP API spike", link: "/effect/http-api" },
        ],
      },
      {
        text: "Design",
        items: [
          { text: "Architecture", link: "/architecture" },
          { text: "Design decisions", link: "/design-decisions" },
          { text: "Language services", link: "/language-services" },
          { text: "File modules", link: "/modules" },
          { text: "Workbench vision", link: "/workbench-vision" },
          { text: "Workbench", link: "/workbench" },
        ],
      },
      {
        text: "RFCs",
        items: [
          { text: "0001: One language, one syntax", link: "/rfcs/0001-unified-syntax" },
          { text: "0002: Modules and packages", link: "/rfcs/0002-modules-and-packages" },
          { text: "0003: Direct-style effects", link: "/rfcs/0003-direct-style-effects" },
          { text: "0004: One analysis architecture", link: "/rfcs/0004-one-analysis-architecture" },
          { text: "0005: Record type operations", link: "/rfcs/0005-row-operations" },
          { text: "0006: Qualified rows", link: "/rfcs/0006-qualified-rows" },
          { text: "0007: Shared type normalization", link: "/rfcs/0007-type-normalization" },
          { text: "0008: Typed form results", link: "/rfcs/0008-typed-form-results" },
          { text: "0009: Field names and row map", link: "/rfcs/0009-field-names-and-row-map" },
          { text: "0010: Live sessions", link: "/rfcs/0010-live-sessions" },
          { text: "0011: Signatures as contracts", link: "/rfcs/0011-signatures-as-contracts" },
          { text: "0012: Checked evaluation", link: "/rfcs/0012-checked-evaluation" },
          { text: "0013: A runnable host", link: "/rfcs/0013-runnable-host" },
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
