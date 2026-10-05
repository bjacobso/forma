/**
 * Structural editing transforms and editor language services.
 *
 * @module Editor
 */

export {
  barfBackwardAtOffset,
  barfForwardAtOffset,
  raiseAtOffset,
  raiseToTopLevelAtOffset,
  selectEnclosingListRange,
  slurpBackwardAtOffset,
  slurpForwardAtOffset,
  spliceAtOffset,
  transposeBackwardAtOffset,
  transposeForwardAtOffset,
  wrapSelectionWithHead,
  type OffsetRange,
  type StructuralEditResult,
} from "./editor/structural-editing.js";
export {
  findReferences,
  indexSymbols,
  type DefinitionKind,
  type ReferenceResolution,
  type SymbolDefinition,
  type SymbolDocument,
  type SymbolIndex,
  type SymbolIndexOptions,
  type SymbolOccurrences,
  type SymbolReference,
  type SymbolTarget,
} from "./editor/symbols.js";
export {
  editorDescriptors,
  type DescriptorLookup,
  type DescriptorSource,
} from "./editor/descriptors.js";
