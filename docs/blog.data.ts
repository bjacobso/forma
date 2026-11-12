import { loadPosts } from "../scripts/site-content.mjs";

export default {
  watch: ["blog/**/*.md"],
  load: loadPosts,
};
