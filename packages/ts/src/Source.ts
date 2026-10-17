/**
 * Source identity, provenance, and content hashing.
 *
 * @module Source
 */

export {
  hashSourceText,
  makeSource,
  type Source,
  type SourceInput,
  type SourceOrigin,
} from "./source/source.js";

export { extractMarkdownFences, isFormaFence, type MarkdownFence } from "./source/markdown.js";
