// Prelude reference pages are generated from the prelude sources. This reads
// top-level forms, docstrings, `(: name type)` signatures, and the comments
// directly above each form. The shared browser-safe extractor scans brackets;
// the source text it shows is the authored text.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractPreludeReference, type Entry } from "@formalang/ts/descriptor";
export type { Entry, Slot } from "@formalang/ts/descriptor";

const root = resolve(import.meta.dirname, "../..");
const preludeDir = resolve(root, "preludes");
const examplesDir = resolve(root, "examples");
export const sourceBase = "https://github.com/bjacobso/forma/blob/main";

export type PreludeGroup = "domain" | "core" | "protocol";
export type PreludeTone = "live" | "stored" | "core" | "plain";

interface Manifest {
  readonly title: string;
  readonly group: PreludeGroup;
  readonly status: string;
  readonly tone: PreludeTone;
  readonly summary: string;
  readonly order: number;
  readonly guide?: { readonly text: string; readonly link: string };
  readonly playground?: { readonly text: string; readonly link: string };
  readonly embed?: { readonly example: string; readonly file: string; readonly title: string };
  readonly note?: string;
  readonly examples?: boolean;
}

// Curated status and copy. Everything else on a page comes from the source.
const manifest: Record<string, Manifest> = {
  email: {
    title: "Email automation rules",
    group: "domain",
    status: "Prototype",
    tone: "live",
    order: 1,
    summary: "Who gets an email, when, and how fast. Closed lanes, one decision per contact, and typed delivery recovery.",
    guide: { text: "Forma for email automation", link: "/email" },
    embed: { example: "email-rule", file: "warmup.lisp", title: "Live email rule: lanes are a closed type" },
    note: "The TypeScript engine checks rules and generates Effect TypeScript. Scheduling, rate enforcement, and dry runs are not implemented.",
  },
  "http-api": {
    title: "Effect HttpApi",
    group: "domain",
    status: "Spike",
    tone: "live",
    order: 2,
    summary: "APIs, groups, endpoints, and handlers that emit a typed Effect 4 HttpApi and builder.",
    guide: { text: "Prelude HTTP API spike", link: "/effect/http-api" },
    note: "Bootstrap it with compiler.lisp, separately from the ontology's older api form.",
  },
  rpc: {
    title: "Effect RPC",
    group: "domain",
    status: "Prototype",
    tone: "live",
    order: 2.5,
    summary: "Unary RPC contracts and named groups that emit native Effect 4 schemas and registrations.",
    guide: { text: "Prelude-defined RPC", link: "/effect/rpc" },
    note: "Handlers and transports remain native Effect code. No RPC execution kernel is generated.",
  },
  elm: {
    title: "Elm-style applications",
    group: "domain",
    status: "Prototype",
    tone: "live",
    order: 3,
    summary: "Messages, update, commands, and Hiccup views, checked against closed vocabularies and lowered to Foldkit.",
    guide: { text: "Forma for Elm-style apps", link: "/elm" },
    embed: { example: "elm-command", file: "counter-command.lisp", title: "Live Elm command recovery" },
    note: "Shared HttpApi client generation remains proposed. See the Elm prototype reference for current limits.",
  },
  ontology: {
    title: "Domain ontology",
    group: "domain",
    status: "Stored output",
    tone: "stored",
    order: 4,
    summary: "Entities, relations, queries, documents, processes, and permissions, elaborated into canonical IR.",
    playground: { text: "Open the entities example", link: "/playground/demo/entities" },
    note: "The conformance fixtures and example corpus load this stack. The browser playground does not run ontology elaboration yet; its ontology example shows a stored canonical IR golden.",
    examples: true,
  },
  ui: {
    title: "Interface components",
    group: "domain",
    status: "Conformance corpus",
    tone: "plain",
    order: 5,
    summary: "Typed projections for layouts, cards, tables, inputs, and charts, plus constant renderer configuration.",
  },
  viewspec: {
    title: "Ontology-aware views",
    group: "domain",
    status: "Conformance corpus",
    tone: "plain",
    order: 6,
    summary: "Entity browsers, pickers, query consoles, and action buttons for hosted ViewSpec UI.",
  },
  system: {
    title: "Platform self-description",
    group: "domain",
    status: "Conformance corpus",
    tone: "plain",
    order: 7,
    summary: "The platform described in its own ontology vocabulary: system entities and attributes.",
  },
  kernel: {
    title: "Kernel macros",
    group: "core",
    status: "Core",
    tone: "core",
    order: 10,
    summary: "The control-flow and threading sugar every program uses, written as ordinary Forma macros.",
    playground: { text: "Open the pipe operator example", link: "/playground/demo/pipes" },
    note: "modules/kernel.lisp is the same library as an exported file module, regenerated from kernel.lisp.",
  },
  compiler: {
    title: "Descriptor helpers",
    group: "core",
    status: "Core",
    tone: "core",
    order: 11,
    summary: "Shared reflection and diagnostics helpers for form projections.",
  },
  "ontology-ir": {
    title: "Ontology IR protocol",
    group: "protocol",
    status: "Generated",
    tone: "plain",
    order: 20,
    summary: "The canonical IR types of the ontology forms, derived from ontology.lisp.",
  },
  "query-protocol": { title: "QueryPlan protocol", group: "protocol", status: "Protocol", tone: "plain", order: 21, summary: "Hosted QueryPlan descriptors." },
  "action-protocol": { title: "ActionPlan protocol", group: "protocol", status: "Protocol", tone: "plain", order: 22, summary: "Hosted ActionPlan descriptors." },
  "content-protocol": { title: "Content protocol", group: "protocol", status: "Protocol", tone: "plain", order: 23, summary: "Hosted ContentProtocol descriptors." },
  "viewspec-protocol": { title: "ViewSpec protocol", group: "protocol", status: "Protocol", tone: "plain", order: 24, summary: "Hosted ViewSpec descriptors that are not component nodes." },
  "canonical-runtime-protocol": { title: "CanonicalRuntime protocol", group: "protocol", status: "Protocol", tone: "plain", order: 25, summary: "Hosted CanonicalRuntime descriptors." },
};

export const groupTitles: Record<PreludeGroup, string> = {
  domain: "Domain languages",
  core: "Core",
  protocol: "Host protocols",
};

export interface Example {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly link: string;
}

export interface Prelude extends Manifest {
  readonly slug: string;
  readonly file: string;
  readonly lines: number;
  readonly header: readonly string[];
  readonly entries: readonly Entry[];
  readonly counts: Record<Entry["kind"], number>;
  readonly vocabulary: readonly string[];
  readonly exampleList: readonly Example[];
}

function frontmatter(source: string): Record<string, string | string[]> {
  const match = /^---\n([\s\S]*?)\n---/u.exec(source);
  const result: Record<string, string | string[]> = {};
  if (!match) return result;
  let list: string[] | undefined;
  for (const line of match[1].split("\n")) {
    const item = /^\s+-\s+(.+)$/u.exec(line);
    if (item && list) { list.push(item[1].trim()); continue; }
    const pair = /^([\w-]+):\s*(.*)$/u.exec(line);
    if (!pair) continue;
    if (pair[2]) result[pair[1]] = pair[2].trim();
    else result[pair[1]] = list = [];
  }
  return result;
}

// The example corpus declares its prelude stack in front matter. Every stack
// it names today is built on the ontology prelude.
function loadExamples(): Example[] {
  const examples: Example[] = [];
  for (const id of readdirSync(examplesDir, { withFileTypes: true })) {
    if (!id.isDirectory() || id.name === "shared") continue;
    let source: string;
    try {
      source = readFileSync(resolve(examplesDir, id.name, "README.md"), "utf8");
    } catch {
      continue;
    }
    const meta = frontmatter(source);
    if (!Array.isArray(meta.preludes)) continue;
    const body = source.replace(/^---\n[\s\S]*?\n---\n/u, "");
    const title = /^# (.+)$/mu.exec(body)?.[1] ?? id.name;
    const summary = body.split(/\n\s*\n/u).map((part) => part.trim())
      .find((part) => part && !part.startsWith("#") && !part.startsWith("```")) ?? "";
    examples.push({
      id: id.name,
      title,
      summary: summary.replace(/\s+/gu, " "),
      link: `${sourceBase}/examples/${id.name}/README.md`,
    });
  }
  return examples.sort((a, b) => a.title.localeCompare(b.title));
}

export function loadPreludes(): Prelude[] {
  const examples = loadExamples();
  const files = readdirSync(preludeDir).filter((file) => file.endsWith(".lisp"));
  return files.map((file) => {
    const slug = file.replace(/\.lisp$/u, "");
    // A new prelude still gets a page before anyone writes catalog copy for it.
    const info: Manifest = manifest[slug] ?? {
      title: slug,
      group: "domain",
      status: "Uncatalogued",
      tone: "plain",
      order: 99,
      summary: "Add catalog copy for this prelude in docs/.vitepress/preludes.ts.",
    };
    const source = readFileSync(resolve(preludeDir, file), "utf8");
    const { header, entries } = extractPreludeReference(file, source);
    const counts = { form: 0, macro: 0, type: 0, function: 0, declaration: 0 };
    for (const entry of entries) counts[entry.kind]++;
    const vocabulary = entries.filter((entry) => entry.kind === "form" || entry.kind === "macro")
      .map((entry) => entry.name);
    return {
      ...info,
      slug,
      file,
      lines: source.trimEnd().split("\n").length,
      header,
      entries,
      counts,
      vocabulary: vocabulary.length
        ? vocabulary
        : entries.filter((entry) => entry.kind === "function").map((entry) => entry.name),
      exampleList: info.examples ? examples : [],
    };
  }).sort((a, b) => a.order - b.order);
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function countsLabel(prelude: Prelude): string {
  const { form, macro, type, function: fn, declaration } = prelude.counts;
  return [
    form && plural(form, "form"),
    macro && plural(macro, "macro"),
    type && plural(type, "type"),
    fn && plural(fn, "function"),
    declaration && plural(declaration, "declaration"),
  ].filter(Boolean).join(" · ");
}

function escape(text: string): string {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

function prose(text: string): string {
  return escape(text).replace(/`([^`]+)`/gu, "<code>$1</code>");
}

function fence(code: string): string {
  const ticks = code.includes("```") ? "````" : "```";
  return `${ticks}lisp\n${code}\n${ticks}`;
}

function sourceLink(prelude: Prelude, line: number): string {
  return `<a class="fp-src ignore-header" href="${sourceBase}/preludes/${prelude.file}#L${line}">${prelude.file}:${line}</a>`;
}

function renderEntry(prelude: Prelude, entry: Entry): string {
  const parts: string[] = [];
  const title = entry.kind === "form" || entry.kind === "macro"
    ? `<span><span class="fp-head">(${escape(entry.name)}</span>${escape((entry.pattern ?? "").replace(/^\([^\s)]+/u, ""))}</span>`
    : `<span><span class="fp-head">${escape(entry.name)}</span></span>`;
  parts.push(`<div class="fp-entry">\n<h3 id="${entry.id}" v-pre>${title}${sourceLink(prelude, entry.line)}</h3>`);
  if (entry.doc) parts.push(`<p v-pre>${prose(entry.doc)}</p>`);
  if (entry.kind === "form" && entry.slots?.length) {
    const rows = entry.slots.map((slot) => `<tr><td>${escape(slot.name)}</td><td><code>${escape(slot.type)}</code></td></tr>`);
    parts.push(`<table class="fp-slots" v-pre><thead><tr><th>Slot</th><th>Type</th></tr></thead><tbody>${rows.join("")}</tbody></table>`);
  }
  if (entry.kind === "form") {
    const ir = [entry.ir && `produces <code>${escape(entry.ir)}</code>`, entry.emits && "has a TypeScript <code>:emit</code> hook"]
      .filter(Boolean).join(" · ");
    if (ir) parts.push(`<p class="fp-ir" v-pre>${ir.charAt(0).toUpperCase()}${ir.slice(1)}</p>`);
  }
  if (entry.examples?.length) {
    parts.push(`<p class="fp-ir" v-pre>Example</p>\n\n${entry.examples.map(fence).join("\n\n")}\n`);
  }
  if (entry.kind === "function") {
    parts.push(`<pre class="fp-sig" v-pre>${escape(entry.signature ?? entry.pattern ?? entry.name)}</pre>`);
  }
  parts.push("</div>");
  if (entry.kind === "type" || entry.kind === "declaration") {
    // The type is the documentation; show it as authored.
    return `${parts.slice(0, -1).join("\n")}\n\n${fence(entry.source)}\n\n</div>`;
  }
  return parts.join("\n");
}

const sections: { kind: Entry["kind"]; title: string; intro: string }[] = [
  { kind: "form", title: "Forms", intro: "Keywords this prelude adds. Each is a `form` descriptor: its slots, their types, and the IR it produces." },
  { kind: "macro", title: "Macros", intro: "Syntax rewrites expanded before evaluation and type checking." },
  { kind: "function", title: "Functions", intro: "Ordinary typed definitions that programs and elaboration hooks can call." },
  { kind: "type", title: "Types", intro: "Payload contracts and IR shapes, shown as authored." },
  { kind: "declaration", title: "Declarations", intro: "Top-level declarations written in another prelude's vocabulary." },
];

export function renderPrelude(prelude: Prelude): string {
  const out: string[] = [];
  const badge = `<span class="fp-badge is-${prelude.tone}">${escape(prelude.status)}</span>`;
  const links = [
    prelude.guide && `<a href="${prelude.guide.link}">${escape(prelude.guide.text)} →</a>`,
    prelude.playground && `<a href="${prelude.playground.link}" target="_self">${escape(prelude.playground.text)} →</a>`,
    `<a href="${sourceBase}/preludes/${prelude.file}">Source</a>`,
  ].filter(Boolean).join("");
  out.push(`<div class="fp-page">
<p class="fp-crumb"><a href="/preludes/">preludes</a> / ${prelude.file}</p>
<h1 class="fp-title" id="${prelude.slug}">${escape(prelude.slug)}</h1>
<p class="fp-lead">${escape(prelude.title)}. ${prose(prelude.summary)}</p>
<div class="fp-meta">${badge}<span>${countsLabel(prelude)} · ${prelude.lines} lines</span>${links}</div>
</div>`);
  if (prelude.note) out.push(`<p class="fp-note">${prose(prelude.note)}</p>`);

  if (prelude.header.length) {
    out.push("## From the source");
    for (const paragraph of prelude.header) {
      if (/^\(/u.test(paragraph)) out.push(fence(paragraph));
      else out.push(`<p v-pre>${prose(paragraph.replace(/\n/gu, " "))}</p>`);
    }
  }

  if (prelude.embed) {
    out.push("## Try it");
    out.push(`<WorkbenchEmbed example="${prelude.embed.example}" file="${prelude.embed.file}" title="${escape(prelude.embed.title)}" />`);
  }

  for (const section of sections) {
    const entries = prelude.entries.filter((entry) => entry.kind === section.kind);
    if (!entries.length) continue;
    out.push(`## ${section.title} <span class="fp-count">${entries.length}</span> {#${section.kind}s}`);
    out.push(`<p class="fp-intro">${prose(section.intro)}</p>`);
    for (const entry of entries) out.push(renderEntry(prelude, entry));
  }

  if (prelude.exampleList.length) {
    out.push(`## Example corpus <span class="fp-count">${prelude.exampleList.length}</span> {#examples}`);
    out.push("<p class=\"fp-intro\">Unrelated domains written against this stack. Each is reviewable Markdown with Lisp in fenced blocks, and conformance inputs for the engine.</p>");
    out.push(`<ul class="fp-catalog">${prelude.exampleList.map((example) =>
      `<li><a href="${example.link}">${escape(example.title)}</a><span v-pre>${prose(example.summary)}</span></li>`).join("")}</ul>`);
  }
  return out.join("\n\n");
}
