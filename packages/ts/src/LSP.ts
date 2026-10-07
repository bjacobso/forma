/**
 * Type analysis for editors: typed spans and type errors for one source.
 * Workspace-wide language services live in `@formalang/ts/analysis`.
 *
 * @module LSP
 */

export {
  analyzeLsp,
  findTypeAtOffset,
  type AnalyzeLspOptions,
  type LspResult,
  type TypedSpan,
  type LspError,
} from "./lsp/hm-lsp.js";

export type { DSLTypeProvider, DSLSlotInfo, SlotMode } from "./type/dsl-provider.js";
