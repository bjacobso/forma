/** Stable structural digests, independent of author layout and source offsets. */
import { parse, type AstNode, type ParseRequest, type Diagnostic, type Span } from "./operations.js";

export interface IncrementalSummary {
  readonly sourceId: string;
  readonly formCount: number;
  readonly forms: readonly { readonly index: number; readonly span?: Span | undefined; readonly digest: string }[];
  readonly diagnostics: readonly Diagnostic[];
}

function shape(node: AstNode): unknown {
  const {span: _span, ...value} = node;
  if ("items" in value) return {...value, items:value.items.map(shape)};
  if ("entries" in value) return {...value, entries:value.entries.map(({key,value}) => ({key:shape(key),value:shape(value)}))};
  return value;
}

/** FNV-1a over UTF-8 canonical AST JSON. Algorithm changes require a new contract. */
function digest(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16,"0");
}

export function incrementalSummary(request: ParseRequest): IncrementalSummary {
  const result = parse(request);
  return {sourceId:result.sourceId, formCount:result.ast.length, diagnostics:result.diagnostics,
    forms:result.ast.map((node,index) => ({index, span:node.span, digest:digest(JSON.stringify(shape(node)))}))};
}

export function parseSummary(request: ParseRequest): { readonly formCount: number; readonly diagnostics: readonly Diagnostic[] } {
  const result = parse(request);
  return {formCount:result.ast.length, diagnostics:result.diagnostics};
}
