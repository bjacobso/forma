import { countsLabel, loadPreludes, renderPrelude } from "../.vitepress/preludes.ts";

// One reference page per prelude, generated from its source file.
export default {
  watch: ["../../preludes/*.lisp", "../../examples/*/README.md"],
  paths() {
    return loadPreludes().map((prelude) => ({
      params: {
        slug: prelude.slug,
        title: `${prelude.slug} prelude`,
        description: `${prelude.title}: ${prelude.summary} ${countsLabel(prelude)}, generated from preludes/${prelude.file}.`,
        outline: prelude.entries.length > 40 ? 2 : [2, 3],
      },
      content: renderPrelude(prelude),
    }));
  },
};
