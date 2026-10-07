/**
 * An analysis workspace: the preludes and documents an editor has open, and
 * every language service over them as a memoized query.
 *
 * Inputs are source texts. Each input carries a revision that changes only
 * when its text does, and each query result is keyed by the revisions it
 * read, so editing one document re-analyzes that document and reuses the
 * prelude scope, and repeated requests between edits cost a lookup. All
 * positions are offsets; editors convert to lines and columns.
 */

import { Effect } from "effect";
import { elaborateSources } from "../descriptor/elaborate.js";
import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import type { Diagnostic, Span } from "../diagnostic/diagnostic.js";
import { formSlots } from "../editor/slots.js";
import {
  createSymbolIndexCache,
  findReferences,
  indexSymbols,
  kernelNames,
  type DefinitionKind,
  type SymbolDefinition,
  type SymbolIndex,
  type SymbolReference,
} from "../editor/symbols.js";
import { formatLispSource } from "../Formatter.js";
import { analyzeLsp, type LspResult } from "../lsp/hm-lsp.js";
import { parse, toSExprMany } from "../reader/index.js";
import { head } from "../surface/effect.js";
import {
  identifySyntax,
  indexSyntax,
  type SyntaxIndex,
  type SyntaxNode,
} from "../syntax/identity.js";
import { builtinScheme } from "../type/builtin-schemes.js";
import type { MakeInferContextOptions } from "../type/context.js";
import type { TypeEnv } from "../type/substitution.js";
import { showScheme } from "../type/types.js";
import { completionsAt, type CompletionItem } from "./completion.js";
import {
  analyzeOptions,
  buildPreludeScopes,
  type PreludeScopes,
  type Scope,
} from "./scope.js";
import { semanticTokens, type SemanticTokens } from "./semantic-tokens.js";

export interface WorkspaceOptions {
  /** Types for host builtins and names a type policy covers. */
  readonly inferOptions?: MakeInferContextOptions | undefined;
}

/** A typed expression of a document. */
export interface TypedSpan {
  readonly start: number;
  readonly end: number;
  readonly type: string;
  readonly exprTag: string;
}

export interface DocumentAnalysis {
  readonly sourceId: string;
  /** The type of the last form, when every form typed. */
  readonly resultType?: string | undefined;
  /** Typed expressions in document order. */
  readonly typedSpans: readonly TypedSpan[];
  readonly diagnostics: readonly Diagnostic[];
  /** Types of the document's definitions and everything in scope before it. */
  readonly typeEnv: TypeEnv;
}

export interface Hover {
  readonly span: Span;
  readonly markdown: string;
}

export interface TextEdit {
  readonly span: Span;
  readonly newText: string;
}

export type RenameResult =
  | { readonly ok: true; readonly edits: readonly TextEdit[] }
  | { readonly ok: false; readonly message: string };

export interface DocumentSymbol {
  readonly name: string;
  readonly kind: DefinitionKind;
  /** The head of the form that defines it. */
  readonly form: string;
  /** The whole defining form. */
  readonly span: Span;
  /** The defined name. */
  readonly selectionSpan: Span;
}

interface Input {
  readonly text: string;
  readonly revision: number;
}

export class AnalysisWorkspace {
  readonly #options: WorkspaceOptions;
  readonly #preludes = new Map<string, Input>();
  readonly #documents = new Map<string, Input>();
  readonly #memo = new Map<string, { readonly key: string; readonly value: unknown }>();
  readonly #symbolCache = createSymbolIndexCache();
  #nextRevision = 1;

  constructor(options: WorkspaceOptions = {}) {
    this.#options = options;
  }

  // ---------------------------------------------------------------------------
  // Inputs
  // ---------------------------------------------------------------------------

  /** Add or replace a prelude. Preludes are in scope for every document, in the order added. */
  setPrelude(sourceId: string, text: string): void {
    this.#set(this.#preludes, sourceId, text);
  }

  removePrelude(sourceId: string): void {
    this.#preludes.delete(sourceId);
  }

  /** Add or replace a document. */
  setDocument(sourceId: string, text: string): void {
    this.#set(this.#documents, sourceId, text);
  }

  removeDocument(sourceId: string): void {
    this.#documents.delete(sourceId);
    for (const name of [...this.#memo.keys()]) {
      if (name.endsWith(`@${sourceId}`)) this.#memo.delete(name);
    }
  }

  /** The text of a document, or of a prelude no document replaces. */
  text(sourceId: string): string | undefined {
    return (this.#documents.get(sourceId) ?? this.#preludes.get(sourceId))?.text;
  }

  get preludeIds(): readonly string[] {
    return [...this.#preludes.keys()];
  }

  get documentIds(): readonly string[] {
    return [...this.#documents.keys()];
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Every prelude analyzed in load order, and the scope documents see. */
  preludeScopes(): PreludeScopes {
    return this.#query("preludes", this.#preludeKey(), () =>
      buildPreludeScopes(
        [...this.#preludes].map(([sourceId, input]) => ({ sourceId, text: input.text })),
        this.#options.inferOptions,
      ),
    );
  }

  /** The scope a source is analyzed in: for a prelude, the preludes before it. */
  scope(sourceId: string): Scope {
    const scopes = this.preludeScopes();
    return scopes.layers.find((layer) => layer.sourceId === sourceId)?.before ?? scopes.scope;
  }

  /** Types and diagnostics of one source. */
  analysis(sourceId: string): DocumentAnalysis {
    const input = this.#input(sourceId);
    return this.#query(`analysis@${sourceId}`, `${this.#preludeKey()}|${input?.revision}`, () =>
      analyzeDocument(
        sourceId,
        input?.text ?? "",
        this.scope(sourceId),
        this.#options.inferOptions,
      ),
    );
  }

  diagnostics(sourceId: string): readonly Diagnostic[] {
    return this.analysis(sourceId).diagnostics;
  }

  /** Definitions and references across every prelude and document. */
  symbols(): SymbolIndex {
    return this.#query("symbols", this.#allKey(), () =>
      indexSymbols(
        [...this.#preludes, ...this.#documents].map(([sourceId, input]) => ({
          sourceId,
          source: input.text,
        })),
        { descriptors: this.#descriptors(), cache: this.#symbolCache },
      ),
    );
  }

  /** The syntax of one source, with the ids the symbol index uses. */
  syntax(sourceId: string): SyntaxIndex {
    const input = this.#input(sourceId);
    return this.#query(`syntax@${sourceId}`, `${this.#allKey()}`, () =>
      indexSyntax(this.symbols().identities[sourceId] ?? identifySyntax(input?.text ?? "")),
    );
  }

  /** The innermost typed expression at an offset. */
  typeAt(sourceId: string, offset: number): TypedSpan | undefined {
    let found: TypedSpan | undefined;
    for (const span of this.analysis(sourceId).typedSpans) {
      if (span.start <= offset && offset < span.end) {
        if (!found || span.end - span.start < found.end - found.start) found = span;
      }
    }
    return found;
  }

  hover(sourceId: string, offset: number): Hover | undefined {
    const text = this.text(sourceId);
    if (text === undefined) return undefined;
    const node = this.syntax(sourceId).at(offset);
    const typed = this.typeAt(sourceId, offset);
    const sections: string[] = [];
    let span: Span | undefined;

    if (node?.kind === "Symbol") {
      const name = text.slice(node.span.start, node.span.end);
      span = { sourceId, startOffset: node.span.start, endOffset: node.span.end };
      const type =
        typed && typed.start === node.span.start && typed.end === node.span.end
          ? typed.type
          : this.#typeOfName(sourceId, name);
      const descriptor = this.#descriptors().find((candidate) => candidate.name === name);
      if (descriptor) sections.push(describeForm(descriptor));
      else if (type !== undefined) sections.push(codeBlock(`${name} : ${type}`));
      const definition = this.definition(sourceId, offset);
      if (definition && !descriptor) {
        const where = definition.sourceId === sourceId ? "" : ` in \`${definition.sourceId}\``;
        sections.push(`*${definition.kind}* defined by \`${definition.form}\`${where}`);
      }
    } else if (typed) {
      span = { sourceId, startOffset: typed.start, endOffset: typed.end };
      sections.push(codeBlock(typed.type));
    }
    return span && sections.length > 0 ? { span, markdown: sections.join("\n\n") } : undefined;
  }

  completions(sourceId: string, offset: number): readonly CompletionItem[] {
    const text = this.text(sourceId);
    if (text === undefined) return [];
    const descriptors = this.#descriptors();
    return completionsAt({
      sourceId,
      text,
      offset,
      symbols: this.symbols(),
      syntax: this.syntax(sourceId),
      descriptors,
      slots: () =>
        formSlots({ source: text, offset, descriptors, descriptorSources: [] }) ?? undefined,
      typeOf: (name) => this.#typeOfName(sourceId, name),
      kernel: kernelNames(),
    });
  }

  /** The definition of the symbol at an offset. */
  definition(sourceId: string, offset: number): SymbolDefinition | undefined {
    return findReferences(this.symbols(), { sourceId, offset }).definition;
  }

  /** Every occurrence of the symbol at an offset, optionally with its definition first. */
  references(
    sourceId: string,
    offset: number,
    options: { readonly includeDeclaration?: boolean } = {},
  ): readonly Span[] {
    const { definition, references } = findReferences(this.symbols(), { sourceId, offset });
    return [
      ...(definition && options.includeDeclaration ? [definition] : []),
      ...references,
    ].map(spanOf);
  }

  /** The name a rename at an offset would change, if it can be renamed. */
  prepareRename(sourceId: string, offset: number): Span | undefined {
    const index = this.symbols();
    const { definition } = findReferences(index, { sourceId, offset });
    if (!definition) return undefined;
    const hit = [definition, ...index.references].find(
      (item: SymbolDefinition | SymbolReference) =>
        item.sourceId === sourceId && item.span.start <= offset && offset <= item.span.end,
    );
    return hit ? spanOf(hit) : undefined;
  }

  /** Rename the symbol at an offset and every reference that resolves to it. */
  rename(sourceId: string, offset: number, newName: string): RenameResult {
    const index = this.symbols();
    const { definition, references } = findReferences(index, { sourceId, offset });
    if (!definition) return { ok: false, message: "Only names defined in the workspace can be renamed." };
    if (!isSymbolName(newName)) return { ok: false, message: `'${newName}' is not a symbol.` };
    if (newName === definition.name) return { ok: true, edits: [] };
    const clash = index.definitions.find(
      (candidate) =>
        candidate.name === newName &&
        (candidate.scope === "global" || candidate.scopeNodeId === definition.scopeNodeId),
    );
    if (clash) {
      return {
        ok: false,
        message: `'${newName}' is already defined by \`${clash.form}\` in ${clash.sourceId}.`,
      };
    }
    return {
      ok: true,
      edits: [definition, ...references].map((item) => ({ span: spanOf(item), newText: newName })),
    };
  }

  /** The top-level definitions of a source. */
  documentSymbols(sourceId: string): readonly DocumentSymbol[] {
    const syntax = this.syntax(sourceId);
    return this.symbols()
      .definitions.filter(
        (definition) => definition.sourceId === sourceId && definition.scope === "global",
      )
      .map((definition) => {
        const form = definition.formNodeId ? syntax.node(definition.formNodeId) : undefined;
        const outer = form ? topLevel(syntax, form) : undefined;
        return {
          name: definition.name,
          kind: definition.kind,
          form: definition.form,
          span: outer
            ? { sourceId, startOffset: outer.span.start, endOffset: outer.span.end }
            : spanOf(definition),
          selectionSpan: spanOf(definition),
        };
      });
  }

  semanticTokens(sourceId: string): SemanticTokens {
    const input = this.#input(sourceId);
    return this.#query(`tokens@${sourceId}`, this.#allKey(), () =>
      semanticTokens({
        sourceId,
        text: input?.text ?? "",
        syntax: this.syntax(sourceId),
        symbols: this.symbols(),
        descriptors: this.#descriptors(),
      }),
    );
  }

  /** The formatted text of a source, or `undefined` when it does not parse. */
  format(sourceId: string): string | undefined {
    const text = this.text(sourceId);
    if (text === undefined) return undefined;
    const result = Effect.runSync(
      Effect.result(formatLispSource(text, { descriptors: this.#descriptors() })),
    );
    return result._tag === "Success" ? result.success : undefined;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  #set(inputs: Map<string, Input>, sourceId: string, text: string): void {
    if (inputs.get(sourceId)?.text === text) return;
    inputs.set(sourceId, { text, revision: this.#nextRevision++ });
  }

  #input(sourceId: string): Input | undefined {
    return this.#documents.get(sourceId) ?? this.#preludes.get(sourceId);
  }

  #preludeKey(): string {
    return [...this.#preludes].map(([id, input]) => `${id}:${input.revision}`).join(",");
  }

  #allKey(): string {
    return `${this.#preludeKey()}|${[...this.#documents]
      .map(([id, input]) => `${id}:${input.revision}`)
      .join(",")}`;
  }

  #query<T>(name: string, key: string, compute: () => T): T {
    const cached = this.#memo.get(name);
    if (cached && cached.key === key) return cached.value as T;
    const value = compute();
    this.#memo.set(name, { key, value });
    return value;
  }

  #descriptors(): readonly FormDescriptor[] {
    return this.#query("descriptors", this.#preludeKey(), () =>
      this.preludeScopes().scope.prelude?.descriptions.list() ?? [],
    );
  }

  #typeOfName(sourceId: string, name: string): string | undefined {
    const scheme = this.analysis(sourceId).typeEnv.get(name) ?? builtinScheme(name);
    return scheme ? showScheme(scheme) : undefined;
  }
}

// =============================================================================
// Document analysis
// =============================================================================

function analyzeDocument(
  sourceId: string,
  text: string,
  scope: Scope,
  inferOptions: MakeInferContextOptions | undefined,
): DocumentAnalysis {
  const parsed = parse(text);
  const diagnostics: Diagnostic[] = parsed.errors.map((error) => ({
    code: "parse/syntax",
    severity: "error",
    message: error.message,
    phase: "parse",
    span: {
      sourceId,
      startOffset: error.loc?.start ?? 0,
      endOffset: error.loc?.end ?? error.loc?.start ?? 0,
    },
  }));
  // Forms that do not parse are blanked, keeping every offset, so the forms
  // around them are still typed.
  const typedText = parsed.errors.length > 0 ? blankBrokenForms(text) : text;
  let typeEnv: TypeEnv = scope.typeEnv;
  const result: LspResult = Effect.runSync(
    analyzeLsp(typedText, {
      ...analyzeOptions(scope, inferOptions),
      captureEnv: (env) => {
        typeEnv = env;
      },
    }),
  );
  for (const error of result.errors) {
    diagnostics.push({
      code: "typecheck/error",
      severity: "error",
      message: withoutOffset(error.message),
      phase: "typecheck",
      span: {
        sourceId,
        startOffset: error.span?.start ?? 0,
        endOffset: error.span?.end ?? error.span?.start ?? 0,
      },
    });
  }
  for (const diagnostic of result.diagnostics) {
    diagnostics.push({
      code: `${diagnostic.source}/diagnostic`,
      severity: diagnostic.severity,
      message: diagnostic.message,
      phase: "typecheck",
      span: {
        sourceId,
        startOffset: diagnostic.span?.start ?? 0,
        endOffset: diagnostic.span?.end ?? diagnostic.span?.start ?? 0,
      },
    });
  }
  if (parsed.errors.length === 0) diagnostics.push(...formDiagnostics(sourceId, text, scope));
  return {
    sourceId,
    ...(result.resultTypeString !== undefined ? { resultType: result.resultTypeString } : {}),
    typedSpans: result.typedSpans.map((span) => ({
      start: span.span.start,
      end: span.span.end,
      type: span.typeString,
      exprTag: span.exprTag,
    })),
    diagnostics: dedupe(diagnostics),
    typeEnv,
  };
}

/** Slot and identifier diagnostics for applications of described forms. */
function formDiagnostics(sourceId: string, text: string, scope: Scope): readonly Diagnostic[] {
  const prelude = scope.prelude;
  if (!prelude) return [];
  const described = toSExprMany(parse(text).redTree).some((expr) =>
    prelude.descriptions.has(head(expr) ?? ""),
  );
  if (!described) return [];
  try {
    return elaborateSources([{ sourceId, source: text }], { prelude }).diagnostics.filter(
      (diagnostic) => diagnostic.span?.sourceId === sourceId,
    );
  } catch {
    return [];
  }
}

function blankBrokenForms(text: string): string {
  const identity = identifySyntax(text);
  const broken = identity.nodes.filter(
    (node) =>
      node.parent === null &&
      (node.kind === "Error" ||
        identity.errors.some(
          (error) => error.span.start < node.span.end && node.span.start <= error.span.start,
        )),
  );
  let result = text;
  for (const node of broken) {
    const blank = text.slice(node.span.start, node.span.end).replace(/[^\n]/g, " ");
    result = result.slice(0, node.span.start) + blank + result.slice(node.span.end);
  }
  return result;
}

function withoutOffset(message: string): string {
  return message.replace(/ \(at offset \d+\)$/, "");
}

/**
 * One diagnostic per message and span. A diagnostic without a position is
 * dropped when the same message is also reported at one.
 */
function dedupe(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  const unplaced = (diagnostic: Diagnostic) =>
    !diagnostic.span || (diagnostic.span.startOffset === 0 && diagnostic.span.endOffset === 0);
  const placed = new Set(diagnostics.filter((d) => !unplaced(d)).map((d) => d.message));
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    if (unplaced(diagnostic) && placed.has(diagnostic.message)) return false;
    const key = `${diagnostic.span?.startOffset}:${diagnostic.span?.endOffset}:${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// =============================================================================
// Helpers
// =============================================================================

function spanOf(item: {
  readonly sourceId: string;
  readonly span: { readonly start: number; readonly end: number };
}): Span {
  return { sourceId: item.sourceId, startOffset: item.span.start, endOffset: item.span.end };
}

function topLevel(syntax: SyntaxIndex, node: SyntaxNode): SyntaxNode {
  return syntax.ancestors(node.id).at(-1) ?? node;
}

function isSymbolName(name: string): boolean {
  if (name.startsWith(":")) return false;
  const parsed = parse(name);
  if (parsed.errors.length > 0) return false;
  const exprs = toSExprMany(parsed.redTree);
  return exprs.length === 1 && exprs[0]!._tag === "Sym" && exprs[0]!.name === name;
}

function codeBlock(text: string): string {
  return `\`\`\`forma\n${text}\n\`\`\``;
}

function describeForm(descriptor: FormDescriptor): string {
  const lines = [`**form** \`${descriptor.name}\``];
  if (descriptor.doc) lines.push(descriptor.doc);
  if (descriptor.slots.length > 0) {
    lines.push(
      descriptor.slots
        .map(
          (slot) =>
            `- \`:${slot.name}\`${slot.required ? " (required)" : ""}${slot.doc ? ` — ${slot.doc}` : ""}`,
        )
        .join("\n"),
    );
  }
  return lines.join("\n\n");
}

