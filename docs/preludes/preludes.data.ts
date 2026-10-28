import { defineLoader } from "vitepress";
import { countsLabel, loadPreludes, type PreludeGroup, type PreludeTone } from "../.vitepress/preludes.ts";

export interface PreludeCard {
  readonly slug: string;
  readonly file: string;
  readonly title: string;
  readonly summary: string;
  readonly status: string;
  readonly tone: PreludeTone;
  readonly group: PreludeGroup;
  readonly counts: string;
  readonly lines: number;
  readonly vocabulary: readonly string[];
  readonly more: number;
  readonly guide?: { readonly text: string; readonly link: string };
}

declare const data: PreludeCard[];
export { data };

export default defineLoader({
  watch: ["../../preludes/*.lisp"],
  load(): PreludeCard[] {
    return loadPreludes().map((prelude) => ({
      slug: prelude.slug,
      file: prelude.file,
      title: prelude.title,
      summary: prelude.summary,
      status: prelude.status,
      tone: prelude.tone,
      group: prelude.group,
      counts: countsLabel(prelude),
      lines: prelude.lines,
      vocabulary: prelude.vocabulary.slice(0, 6),
      more: Math.max(0, prelude.vocabulary.length - 6),
      guide: prelude.guide,
    }));
  },
});
