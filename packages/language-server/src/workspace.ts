import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  AnalysisWorkspace,
  type CompletionItem,
  type Diagnostic,
  type DocumentSymbol,
  type Hover,
  type RenameResult,
  type SearchQuery,
  type SearchResult,
  type SemanticTokens,
  type Span,
  type WorkspaceOptions,
} from "@formalang/ts/analysis";
import {
  createSymbolIndexCache,
  type SymbolDefinition,
} from "@formalang/ts/editor";
import { ModuleError, PACKAGE_ID_PREFIX } from "@formalang/ts/modules";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
  analyzeModuleDocument,
  diagnosticsForEntry,
  findFormaProjectRoot,
  hasModuleDirectives,
  loadProjectContext,
  moduleCompletions,
  moduleDefinition,
  moduleHover,
  moduleIdToFileUri,
  moduleReferences,
  projectStamp,
  uriToModuleId,
  type ModuleAnalysis,
  type ProjectContext,
} from "./modules.js";

export interface FormaWorkspaceOptions {
  readonly workspaceRoot?: string;
  /** Prelude files, absolute or relative to the workspace root, in load order. */
  readonly preludePaths?: readonly string[];
  readonly analysis?: WorkspaceOptions;
}

/**
 * The editor's view of a Forma workspace: the open documents, configured
 * preludes, and file-module `import` / `forma.json` graphs, analyzed by
 * `@formalang/ts`. Sources are keyed by URI, so locations in preludes and
 * imported modules are ordinary LSP locations.
 */
export class FormaWorkspace {
  readonly workspaceRoot: string;
  readonly analysis: AnalysisWorkspace;
  /** Open documents, including open preludes. */
  readonly documents = new Map<string, TextDocument>();

  readonly #analysisOptions: WorkspaceOptions | undefined;
  readonly #preludeUris: readonly string[];
  readonly #preludePaths: ReadonlyMap<string, string>;
  readonly #openByModuleId = new Map<string, TextDocument>();
  readonly #moduleIdToUri = new Map<string, string>();
  readonly #moduleSources = new Map<string, string>();
  readonly #moduleAnalyses = new Map<string, ModuleAnalysis>();
  readonly #dependencies = new Map<string, Set<string>>();
  readonly #dependents = new Map<string, Set<string>>();
  readonly #projectCache = new Map<
    string,
    { readonly stamp: string; readonly project?: ProjectContext; readonly error?: ModuleError }
  >();
  readonly #symbolCache = createSymbolIndexCache();
  #loading: Promise<void> | undefined;

  constructor(options: FormaWorkspaceOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.#analysisOptions = options.analysis;
    this.analysis = new AnalysisWorkspace(options.analysis);
    const paths = (options.preludePaths ?? readPreludePathsFromEnv() ?? []).map((path) =>
      isAbsolute(path) ? path : resolve(this.workspaceRoot, path),
    );
    this.#preludePaths = new Map(paths.map((path) => [pathToFileURL(path).href, path]));
    this.#preludeUris = [...this.#preludePaths.keys()];
  }

  /** Load the configured preludes. Safe to call repeatedly. */
  async ready(): Promise<void> {
    this.#loading ??= (async () => {
      for (const uri of this.#preludeUris) {
        this.analysis.setPrelude(uri, await this.#readPrelude(uri));
      }
    })();
    await this.#loading;
  }

  isPrelude(uri: string): boolean {
    return this.#preludePaths.has(uri);
  }

  /**
   * Record a document's current text. Returns the open documents whose
   * analysis may have changed: this document, any reverse-importing open
   * documents, or every open document when a prelude changed.
   */
  async update(document: TextDocument): Promise<readonly TextDocument[]> {
    await this.ready();
    this.documents.set(document.uri, document);
    const moduleId = uriToModuleId(document.uri);
    this.#openByModuleId.set(moduleId, document);
    this.#moduleIdToUri.set(moduleId, document.uri);

    if (this.isPrelude(document.uri)) {
      this.analysis.setPrelude(document.uri, document.getText());
      this.#moduleAnalyses.clear();
      return [...this.documents.values()];
    }

    this.analysis.setDocument(document.uri, document.getText());

    const affected = new Map<string, TextDocument>([[document.uri, document]]);
    const impactedModuleIds = this.#collectReverseDependents(moduleId);

    // If this document is a project prelude (via forma.json), every open document in that project is affected.
    for (const openUri of this.documents.keys()) {
      if (openUri === document.uri) continue;
      const openId = uriToModuleId(openUri);
      const cached = this.#moduleAnalyses.get(openId);
      if (cached?.projectRoot) {
        const proj = this.#projectCache.get(cached.projectRoot)?.project;
        if (proj?.preludePath === moduleId) impactedModuleIds.add(openId);
      }
    }

    this.#moduleAnalyses.delete(moduleId);
    for (const depId of impactedModuleIds) {
      this.#moduleAnalyses.delete(depId);
      const openDoc = this.#openByModuleId.get(depId);
      if (openDoc) affected.set(openDoc.uri, openDoc);
    }

    // Eagerly refresh dependency graph edges for module documents so future
    // edits in imported files propagate invalidation back to this document.
    if (this.#isModuleDocument(document.uri, moduleId, document.getText())) {
      this.#getModuleAnalysis(document.uri);
    }

    return [...affected.values()];
  }

  /** Forget a closed document. A closed prelude or imported module reverts to disk and invalidates dependents. */
  async close(uri: string): Promise<readonly TextDocument[]> {
    this.documents.delete(uri);
    const moduleId = uriToModuleId(uri);
    this.#openByModuleId.delete(moduleId);

    if (this.isPrelude(uri)) {
      this.analysis.setPrelude(uri, await this.#readPrelude(uri));
      this.#moduleAnalyses.clear();
      return [...this.documents.values()];
    }

    this.analysis.removeDocument(uri);
    this.#moduleAnalyses.delete(moduleId);
    this.#setDependencies(moduleId, []);

    const affected = new Map<string, TextDocument>();
    for (const depId of this.#collectReverseDependents(moduleId)) {
      this.#moduleAnalyses.delete(depId);
      const openDoc = this.#openByModuleId.get(depId);
      if (openDoc) affected.set(openDoc.uri, openDoc);
    }
    return [...affected.values()];
  }

  /** A document for converting offsets in any source, open or not. */
  document(uriOrModuleId: string): TextDocument | undefined {
    const open = this.documents.get(uriOrModuleId) ?? this.#openByModuleId.get(uriOrModuleId);
    if (open) return open;

    if (uriOrModuleId.startsWith("file:")) {
      const id = uriToModuleId(uriOrModuleId);
      const openById = this.#openByModuleId.get(id);
      if (openById) return openById;
      const text = this.#moduleSources.get(id);
      if (text !== undefined) {
        return TextDocument.create(this.#moduleIdToUri.get(id) ?? uriOrModuleId, "forma", 0, text);
      }
    }

    const mappedUri = this.#moduleIdToUri.get(uriOrModuleId);
    if (mappedUri) {
      const openMapped = this.documents.get(mappedUri);
      if (openMapped) return openMapped;
    }

    const moduleText = this.#moduleSources.get(uriOrModuleId);
    if (moduleText !== undefined) {
      const uri = mappedUri ?? moduleIdToFileUri(uriOrModuleId);
      return TextDocument.create(uri, "forma", 0, moduleText);
    }

    const text = this.analysis.text(uriOrModuleId);
    return text === undefined ? undefined : TextDocument.create(uriOrModuleId, "forma", 0, text);
  }

  // ---------------------------------------------------------------------------
  // Language service queries (module-graph aware with AnalysisWorkspace fallback)
  // ---------------------------------------------------------------------------

  diagnostics(uri: string): readonly Diagnostic[] {
    const mod = this.#getModuleAnalysisIfModule(uri);
    if (mod) return diagnosticsForEntry(mod);
    return this.analysis.diagnostics(uri);
  }

  hover(uri: string, offset: number): Hover | undefined {
    const mod = this.#getModuleAnalysisIfModule(uri);
    if (mod) return moduleHover(mod, offset, moduleDefinition(mod, offset));
    return this.analysis.hover(uri, offset);
  }

  definition(uri: string, offset: number): SymbolDefinition | undefined {
    const mod = this.#getModuleAnalysisIfModule(uri);
    if (mod) return moduleDefinition(mod, offset);
    return this.analysis.definition(uri, offset);
  }

  references(
    uri: string,
    offset: number,
    options: { readonly includeDeclaration?: boolean } = {},
  ): readonly Span[] {
    const mod = this.#getModuleAnalysisIfModule(uri);
    if (mod) {
      const openModuleAnalyses: ModuleAnalysis[] = [];
      for (const [openUri, openDoc] of this.documents) {
        const openId = uriToModuleId(openUri);
        if (this.#isModuleDocument(openUri, openId, openDoc.getText())) {
          const analysis = this.#getModuleAnalysis(openUri);
          if (analysis) openModuleAnalyses.push(analysis);
        }
      }
      return moduleReferences(mod, offset, openModuleAnalyses, options);
    }
    return this.analysis.references(uri, offset, options);
  }

  completions(uri: string, offset: number): readonly CompletionItem[] {
    const mod = this.#getModuleAnalysisIfModule(uri);
    if (mod) return moduleCompletions(mod, offset);
    return this.analysis.completions(uri, offset);
  }

  documentSymbols(uri: string): readonly DocumentSymbol[] {
    return this.analysis.documentSymbols(uri);
  }

  prepareRename(uri: string, offset: number): Span | undefined {
    return this.analysis.prepareRename(uri, offset);
  }

  rename(uri: string, offset: number, newName: string): RenameResult {
    return this.analysis.rename(uri, offset, newName);
  }

  semanticTokens(uri: string): SemanticTokens {
    return this.analysis.semanticTokens(uri);
  }

  format(uri: string): string | undefined {
    return this.analysis.format(uri);
  }

  search(query: SearchQuery): readonly SearchResult[] {
    return this.analysis.search(query);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  #isModuleDocument(uri: string, moduleId: string, text: string): boolean {
    if (this.isPrelude(uri)) return false;
    if (hasModuleDirectives(text)) return true;
    if ((this.#dependents.get(moduleId)?.size ?? 0) > 0) return true;
    if (uri.startsWith("file:")) {
      const loaded = this.#getProject(moduleId);
      if (loaded.project?.preludePath && loaded.project.preludePath !== moduleId) {
        return true;
      }
    }
    return false;
  }

  #getModuleAnalysisIfModule(uri: string): ModuleAnalysis | undefined {
    const doc = this.documents.get(uri);
    if (!doc) return undefined;
    const moduleId = uriToModuleId(uri);
    if (!this.#isModuleDocument(uri, moduleId, doc.getText())) return undefined;
    return this.#getModuleAnalysis(uri);
  }

  #getModuleAnalysis(uri: string): ModuleAnalysis | undefined {
    const doc = this.documents.get(uri);
    if (!doc) return undefined;
    const moduleId = uriToModuleId(uri);
    const cached = this.#moduleAnalyses.get(moduleId);
    if (cached && this.#isProjectFresh(cached.projectRoot)) {
      return cached;
    }

    const analysis = analyzeModuleDocument(uri, moduleId, doc.getText(), {
      workspaceRoot: this.workspaceRoot,
      getOpenText: (id) => this.#openByModuleId.get(id)?.getText(),
      getOpenUri: (id) => this.#openByModuleId.get(id)?.uri,
      getProject: (entryPath) => this.#getProject(entryPath),
      inferOptions: this.#analysisOptions?.inferOptions,
      symbolCache: this.#symbolCache,
    });

    this.#moduleAnalyses.set(moduleId, analysis);
    this.#setDependencies(moduleId, analysis.dependencies);
    for (const [id, text] of analysis.sources) {
      this.#moduleSources.set(id, text);
    }
    for (const [id, targetUri] of analysis.moduleIdToUri) {
      // Never overwrite an open document's canonical client URI.
      if (!this.#openByModuleId.has(id) || id.startsWith(PACKAGE_ID_PREFIX)) {
        this.#moduleIdToUri.set(id, targetUri);
      }
    }
    return analysis;
  }

  #isProjectFresh(projectRoot: string | undefined): boolean {
    if (!projectRoot) return true;
    const cached = this.#projectCache.get(projectRoot);
    if (!cached) return false;
    return cached.stamp === projectStamp(projectRoot);
  }

  #getProject(entryPath: string): { readonly project?: ProjectContext; readonly error?: ModuleError } {
    const root = findFormaProjectRoot(dirname(entryPath), this.workspaceRoot);
    if (!root) return {};
    const stamp = projectStamp(root);
    const cached = this.#projectCache.get(root);
    if (cached && cached.stamp === stamp) {
      return cached;
    }
    try {
      const project = loadProjectContext(root);
      const entry = { stamp: project.stamp, project };
      this.#projectCache.set(root, entry);
      return entry;
    } catch (error) {
      if (error instanceof ModuleError) {
        const entry = { stamp, error };
        this.#projectCache.set(root, entry);
        return entry;
      }
      throw error;
    }
  }

  #setDependencies(importerId: string, dependencies: readonly string[]): void {
    const previous = this.#dependencies.get(importerId);
    if (previous) {
      for (const dep of previous) {
        const rev = this.#dependents.get(dep);
        if (rev) {
          rev.delete(importerId);
          if (rev.size === 0) this.#dependents.delete(dep);
        }
      }
    }
    if (dependencies.length === 0) {
      this.#dependencies.delete(importerId);
      return;
    }
    const next = new Set(dependencies);
    this.#dependencies.set(importerId, next);
    for (const dep of next) {
      let rev = this.#dependents.get(dep);
      if (!rev) {
        rev = new Set();
        this.#dependents.set(dep, rev);
      }
      rev.add(importerId);
    }
  }

  #collectReverseDependents(moduleId: string): Set<string> {
    const visited = new Set<string>();
    const queue = [moduleId];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const dependent of this.#dependents.get(current) ?? []) {
        if (dependent === moduleId || visited.has(dependent)) continue;
        visited.add(dependent);
        queue.push(dependent);
      }
    }
    return visited;
  }

  async #readPrelude(uri: string): Promise<string> {
    const path = this.#preludePaths.get(uri)!;
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      throw new Error(`Cannot read prelude ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function readPreludePathsFromEnv(): readonly string[] | undefined {
  const raw = process.env["FORMA_LANGUAGE_SERVER_PRELUDES"];
  if (raw === undefined) return undefined;
  if (raw.trim() === "" || raw === "0" || raw.toLowerCase() === "none") return [];
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}
