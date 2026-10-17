import type { SourceOrigin } from "./source.js";

export interface MarkdownFence {
  readonly language: string;
  readonly info: string;
  /** Body with the opening fence's indentation removed (CommonMark). */
  readonly text: string;
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly start: number;
  readonly end: number;
  readonly indent: string;
  readonly ignored: boolean;
  readonly closed: boolean;
  readonly unsupported: boolean;
  readonly origin: Extract<SourceOrigin, { kind: "markdown-fence" }>;
}

/** Scan fenced blocks without interpreting their contents. Offsets are UTF-16,
 * like the reader and LSP. Unsupported container/HTML fences remain visible to
 * callers for reporting, but must not be rewritten. */
export function extractMarkdownFences(source: string, fileId = "<markdown>"): readonly MarkdownFence[] {
  const lines = [...source.matchAll(/[^\n]*(?:\n|$)/g)].filter(m => m[0].length > 0);
  const blocks: MarkdownFence[] = [];
  let htmlEnd: RegExp | undefined;
  let htmlUntilBlank = false;
  let listIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]![0], line = raw.replace(/\r?\n$/, ""), start = lines[i]!.index!;
    if (htmlEnd) { if (htmlEnd.test(line)) htmlEnd = undefined; continue; }
    if (htmlUntilBlank) { if (!line.trim()) htmlUntilBlank = false; else continue; }
    if (/^ {0,3}<!--/.test(line) && !line.includes("-->")) { htmlEnd = /-->/; continue; }
    const tag = /^ {0,3}<(script|pre|style|textarea)(?:\s|>|$)/i.exec(line);
    if (tag) { if (!new RegExp(`</${tag[1]}>`, "i").test(line)) htmlEnd = new RegExp(`</${tag[1]}>`, "i"); continue; }
    if (/^ {0,3}<(?:address|article|aside|base|blockquote|body|caption|center|col|div|dl|fieldset|figure|footer|form|h[1-6]|head|header|hr|html|iframe|li|link|main|menu|nav|ol|p|section|table|tbody|td|th|tr|ul)(?:\s|\/?>|$)/i.test(line)) { htmlUntilBlank = true; continue; }
    const list = /^( *)(?:[-+*]|\d+[.)])( +)/.exec(line);
    if (list) listIndent = list[0].length;
    else if (line.trim() && line.search(/\S/) < listIndent) listIndent = 0;
    const container = /^(?: {0,3}> ?)+/.exec(line);
    const candidate = container ? line.slice(container[0].length) : line;
    const opening = /^( *)(`{3,}|~{3,})([^\r\n]*)$/.exec(candidate);
    if (!opening) continue;
    const spaces = opening[1]!.length;
    if (spaces > 3 && !(listIndent && spaces >= listIndent && spaces - listIndent <= 3)) continue;
    const marker = opening[2]!, info = opening[3]!.trim();
    if (marker[0] === "`" && info.includes("`")) continue;
    const bodyStart = start + raw.length;
    const indent = opening[1]!;
    let j = i + 1;
    const closing = new RegExp(`^ {0,${spaces + 3}}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
    for (; j < lines.length; j++) {
      const next = lines[j]![0].replace(/\r?\n$/, "");
      if (closing.test(container ? next.replace(/^(?: {0,3}> ?)+/, "") : next)) break;
    }
    const bodyEnd = j < lines.length ? lines[j]!.index! : source.length;
    const end = j < lines.length ? bodyEnd + lines[j]![0].length : bodyEnd;
    const body = source.slice(bodyStart, bodyEnd);
    const text = body.replace(new RegExp(`^ {0,${spaces}}`, "gm"), "");
    blocks.push({ language: info.split(/\s+/)[0] ?? "", info, text, bodyStart, bodyEnd, start, end,
      indent, closed: j < lines.length, unsupported: !!container || !!list,
      ignored: i > 0 && lines[i - 1]![0].trim() === "<!-- forma-fmt-ignore -->",
      origin: { kind: "markdown-fence", fileId, blockIndex: blocks.length,
        blockStartOffset: bodyStart, blockStartLine: i + 2, blockStartColumn: spaces + 1 } });
    i = j;
  }
  return blocks;
}

export function isFormaFence(block: MarkdownFence): boolean {
  return block.language === "lisp" || block.language === "forma";
}
