/**
 * Which docs code fences render as live Forma blocks, and with what. The
 * markdown hook in config.ts and the website's docs-blocks test share these
 * rules, so every block the docs show live is a block CI has checked.
 *
 * - A `lisp` or `forma` fence is a live block: the playground's reader replaces
 *   its code with types on hover, structural selection, and live checking.
 * - `fragment` keeps a fence static, for code that is not a whole program, such
 *   as an excerpt or another Lisp.
 * - `file=name.lisp` names the block's file; blocks on one page that name their
 *   files can import each other.
 * - `preludes=ontology` checks against another bundled prelude stack (`effect`
 *   by default; also `ui`, `email`, and `elm`).
 *
 * A page's `formaBlocks` frontmatter sets how its blocks relate: `separate`
 * (the default) checks each alone; `continued` puts every earlier live block
 * without a file name in scope, for pages that build a program step by step;
 * `static` keeps every block on the page static.
 */

export interface FenceOptions {
  readonly live: boolean;
  readonly file?: string | undefined;
  readonly preludes?: string | undefined;
}

export type PageMode = "separate" | "continued" | "static";

/** The options of a fence's info string, such as `lisp{6,18} [log.lisp] preludes=ontology`, or undefined for other languages. */
export function fenceOptions(info: string): FenceOptions | undefined {
  const lang = /^[\w-]+/.exec(info.trim())?.[0];
  if (lang !== "lisp" && lang !== "forma") return undefined;
  const meta = info.trim().slice(lang.length).replace(/\{[^}]*\}|\[[^\]]*\]/g, " ").split(/\s+/).filter(Boolean);
  const value = (key: string) => meta.find(word => word.startsWith(`${key}=`))?.slice(key.length + 1);
  return { live: !meta.includes("fragment"), file: value("file"), preludes: value("preludes") };
}

export function pageMode(frontmatter: Readonly<Record<string, unknown>> | undefined): PageMode {
  const mode = frontmatter?.formaBlocks;
  return mode === "continued" || mode === "static" ? mode : "separate";
}
