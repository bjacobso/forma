/** Browser-safe source metadata shared by the host and prelude reference pages. */
export interface Slot {
  readonly name: string;
  readonly type: string;
}

export interface Entry {
  readonly kind: "form" | "macro" | "type" | "function" | "declaration";
  readonly name: string;
  readonly id: string;
  readonly line: number;
  readonly source: string;
  readonly pattern?: string | undefined;
  readonly signature?: string | undefined;
  readonly doc?: string | undefined;
  readonly examples?: readonly string[] | undefined;
  readonly slots?: readonly Slot[] | undefined;
  readonly ir?: string | undefined;
  readonly emits?: boolean | undefined;
}

interface Node {
  readonly kind: "list" | "vector" | "map" | "atom" | "string";
  readonly start: number;
  readonly end: number;
  readonly children: Node[];
  readonly text: string;
}

const closers: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const kinds: Record<string, Node["kind"]> = { "(": "list", "[": "vector", "{": "map" };

function read(source: string): Node[] {
  let i = 0;
  const skip = () => {
    while (i < source.length) {
      const c = source[i]!;
      if (c === ";") while (i < source.length && source[i] !== "\n") i++;
      else if (/[\s,]/u.test(c)) i++;
      else break;
    }
  };
  const node = (): Node | undefined => {
    skip();
    if (i >= source.length) return undefined;
    const start = i;
    const c = source[i]!;
    if (c === ")" || c === "]" || c === "}") return undefined;
    if (c === "'" || c === "`" || c === "~" || c === "@" || c === "#") {
      i++;
      if (source[i] === "@") i++;
      return node();
    }
    if (c === "\"") {
      i++;
      while (i < source.length && source[i] !== "\"") i += source[i] === "\\" ? 2 : 1;
      i++;
      return { kind: "string", start, end: i, children: [], text: source.slice(start, i) };
    }
    if (c in closers) {
      i++;
      const children: Node[] = [];
      for (;;) {
        skip();
        if (i >= source.length) break;
        if (source[i] === closers[c]) { i++; break; }
        const child = node();
        if (child) children.push(child);
        else i++;
      }
      return { kind: kinds[c]!, start, end: i, children, text: source.slice(start, i) };
    }
    while (i < source.length && !/[\s,()[\]{}";]/u.test(source[i]!)) i++;
    return { kind: "atom", start, end: i, children: [], text: source.slice(start, i) };
  };
  const forms: Node[] = [];
  for (;;) {
    const form = node();
    if (form) forms.push(form);
    else if (i < source.length) i++;
    else return forms;
  }
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source[i] === "\n") line++;
  return line;
}

function commentText(line: string): string {
  return line.replace(/^\s*;+\s?/u, "").trimEnd();
}

function isRule(text: string): boolean {
  return /^[-=]{3,}$/u.test(text.trim());
}

// Contiguous comment lines that end right above `line` (1-based).
function commentsAbove(lines: readonly string[], line: number): { text: string[]; first: number } {
  const text: string[] = [];
  let index = line - 2;
  while (index >= 0 && /^\s*;/u.test(lines[index]!)) {
    text.unshift(commentText(lines[index]!));
    index--;
  }
  return { text: text.filter((part) => !isRule(part)), first: index + 2 };
}

function stringValue(node: Node | undefined): string | undefined {
  if (node?.kind !== "string") return undefined;
  return node.text.slice(1, -1).replace(/\\"/gu, "\"").replace(/\\n/gu, "\n");
}

// Each program vector contains ordinary source forms, retained as documentation.
function examplesOf(node: Node | undefined, source: string): string[] | undefined {
  if (node?.kind !== "vector") return undefined;
  return node.children.map(example => {
    if (example.kind === "string") return stringValue(example) ?? "";
    if (example.kind !== "vector") return "";
    return example.children.map(form => {
      const column = form.start - source.lastIndexOf("\n", form.start - 1) - 1;
      return form.text.split("\n").map((line, i) => i ? line.slice(Math.min(column, line.search(/\S|$/u))) : line).join("\n");
    }).join("\n");
  });
}

function joinDoc(lines: readonly string[]): string | undefined {
  const text = lines.join(" ").replace(/\s+/gu, " ").trim();
  return text || undefined;
}

function idFor(kind: string, name: string): string {
  return `${kind}-${name}`.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

function slotsOf(map: Node | undefined): Slot[] | undefined {
  if (map?.kind !== "map") return undefined;
  const slots: Slot[] = [];
  for (let index = 0; index + 1 < map.children.length; index += 2) {
    slots.push({
      name: map.children[index]!.text.replace(/^:/u, ""),
      type: map.children[index + 1]!.text.replace(/\s+/gu, " "),
    });
  }
  return slots;
}

function option(children: readonly Node[], key: string): Node | undefined {
  const index = children.findIndex((child) => child.kind === "atom" && child.text === key);
  return index >= 0 ? children[index + 1] : undefined;
}

// The leading comment block is the file header. When it runs straight into the
// first form, anything after its last banner rule documents that form instead.
function headerLines(lines: readonly string[]): { count: number; split: number } {
  let count = 0;
  while (count < lines.length && /^\s*;/u.test(lines[count]!)) count++;
  let split = count;
  if (count < lines.length && lines[count]!.trim()) {
    for (let index = count - 1; index >= 0; index--) {
      if (isRule(commentText(lines[index]!))) {
        if (index < count - 1) split = index;
        break;
      }
    }
  }
  return { count, split };
}

function headerOf(lines: readonly string[], file: string, split: number): string[] {
  // Paragraphs split on blank comment lines; drop banner rules and the file name.
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) paragraphs.push(current.join("\n"));
    current = [];
  };
  for (const text of lines.slice(0, split).map(commentText)) {
    if (isRule(text) || text === file) continue;
    if (!text.trim()) flush();
    else current.push(text);
  }
  flush();
  return paragraphs;
}

export function extractPreludeReference(file: string, source: string): { header: string[]; entries: Entry[] } {
  const lines = source.split("\n");
  const { count: headerEnd, split } = headerLines(lines);
  const header = headerOf(lines, file, split);
  const forms = read(source);
  const signatures = new Map<string, { text: string; doc: string[] }>();
  const entries: Entry[] = [];

  for (const form of forms) {
    if (form.kind !== "list" || form.children.length === 0) continue;
    const [head, second, third] = form.children;
    const line = lineOf(source, form.start);
    const above = commentsAbove(lines, line);
    // The file header is not the first form's doc comment.
    const comments = above.first > headerEnd ? above.text
      : lines.slice(split + 1, line - 1).map(commentText).filter((part) => part.trim() && !isRule(part));
    const doc = joinDoc(comments);
    const base = { line, source: form.text };

    switch (head!.text) {
      case ":": {
        if (second) signatures.set(second.text, { text: form.text, doc: comments });
        break;
      }
      case "form": {
        const pattern = second?.kind === "list" ? second : undefined;
        const name = pattern?.children[0]?.text ?? second?.text ?? "form";
        const docstring = stringValue(third);
        entries.push({
          ...base,
          kind: "form",
          name,
          id: idFor("form", name),
          pattern: pattern?.text.replace(/\s+/gu, " ").replace(/\( /gu, "(") ?? name,
          doc: docstring ?? doc,
          examples: examplesOf(option(form.children, ":examples"), source),
          slots: slotsOf(option(form.children, ":types")),
          ir: option(form.children, ":ir")?.text,
          emits: option(form.children, ":emit") !== undefined,
        });
        break;
      }
      case "macro": {
        const name = second?.kind === "list" ? second.children[0]?.text ?? "macro" : second?.text ?? "macro";
        entries.push({
          ...base,
          kind: "macro",
          name,
          id: idFor("macro", name),
          pattern: second?.text.replace(/\s+/gu, " "),
          doc: doc?.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")} [—-] `, "u"), ""),
        });
        break;
      }
      case "type": {
        const name = second?.text ?? "type";
        entries.push({ ...base, kind: "type", name, id: idFor("type", name), doc });
        break;
      }
      case "define": {
        const name = second?.text ?? "define";
        const params = third?.kind === "vector" ? third.text.replace(/\s+/gu, " ") : undefined;
        entries.push({
          ...base,
          kind: "function",
          name,
          id: idFor("fn", name),
          pattern: params ? `(define ${name} ${params} …)` : `(define ${name} …)`,
          doc,
        });
        break;
      }
      default: {
        const name = second?.text ?? head!.text;
        entries.push({
          ...base,
          kind: "declaration",
          name: `${head!.text} ${name}`,
          id: idFor(head!.text, name),
          pattern: form.text,
          doc,
        });
      }
    }
  }

  // Attach `(: name type)` signatures to their definitions.
  return {
    header,
    entries: entries.map((entry) => {
      if (entry.kind !== "function") return entry;
      const signature = signatures.get(entry.name);
      if (!signature) return entry;
      return { ...entry, signature: signature.text, doc: joinDoc(signature.doc) ?? entry.doc };
    }),
  };
}

