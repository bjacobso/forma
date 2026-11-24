import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  CompletionItem,
  CompletionKind,
  Diagnostic,
  Hover,
  Span,
  TypedSpan,
} from "@formalang/ts/analysis";
import { authorNames, diagnosticFromUnknown } from "@formalang/ts/diagnostic";
import {
  findReferences,
  indexSymbols,
  type SymbolDefinition,
  type SymbolIndex,
  type SymbolIndexCache,
} from "@formalang/ts/editor";
import {
  checkModuleGraph,
  ModuleError,
  normalizeModuleId,
  PACKAGE_ID_PREFIX,
  packageOfModule,
  relativeModuleId,
  resolveModuleGraph,
  type ModuleBinding,
  type ModuleCheckResult,
  type ModuleCoreOptions,
  type ModuleGraph,
  type ModuleResolver,
  type ResolvedModule,
} from "@formalang/ts/modules";
import {
  readFormaManifest,
  readVendoredPackages,
  type FormaManifest,
  type NodePackages,
} from "@formalang/ts/node";
import { parse, toSExprMany, type SExpr } from "@formalang/ts/reader";
import { identifySyntax, indexSyntax, type SyntaxIndex } from "@formalang/ts/syntax";
import { builtinScheme, showScheme } from "@formalang/ts/type";

const MODULE_DIRECTIVES = new Set(["import", "export", "export-from"]);
const DELIMITER = /[\s()[\]{}"';`~@,]/;
const MODULE_KEYWORDS = [
  "define",
  "fn",
  "let",
  "if",
  "do",
  "match",
  "type",
  "class",
  "error",
  "service",
  "layer",
  "macro",
  "form",
  "import",
  "export",
  "export-from",
  "do!",
  "succeed",
  "fail",
  "catch",
] as const;

export interface ProjectContext {
  readonly root: string;
  readonly manifest: FormaManifest;
  readonly packages: NodePackages;
  readonly stamp: string;
  readonly preludePath?: string | undefined;
}

export interface ModuleAnalysis {
  readonly entryId: string;
  readonly entryUri: string;
  readonly projectRoot?: string | undefined;
  readonly graph?: ModuleGraph | undefined;
  readonly check?: ModuleCheckResult | undefined;
  readonly diagnostics: readonly Diagnostic[];
  /** All resolved or attempted dependency module IDs (excluding entryId). */
  readonly dependencies: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
  readonly moduleIdToUri: ReadonlyMap<string, string>;
  readonly symbols?: SymbolIndex | undefined;
  readonly syntax: SyntaxIndex;
}

export interface ModuleResolverContext {
  readonly workspaceRoot: string;
  readonly getOpenText: (moduleId: string) => string | undefined;
  readonly getOpenUri: (moduleId: string) => string | undefined;
  readonly getProject: (entryPath: string) => { readonly project?: ProjectContext; readonly error?: ModuleError };
  readonly inferOptions?: import("@formalang/ts/analysis").WorkspaceOptions["inferOptions"];
  readonly symbolCache: SymbolIndexCache;
}

/** Canonicalize a filesystem path, resolving symlinks on the nearest existing ancestor. */
export function canonicalPath(filePath: string): string {
  const absolute = resolve(filePath);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return join(canonicalPath(parent), basename(absolute));
  }
}

/** Convert an LSP URI to a canonical module ID (filesystem path for file:// URIs). */
export function uriToModuleId(uri: string): string {
  if (!uri.startsWith("file:")) return uri;
  try {
    return canonicalPath(fileURLToPath(uri));
  } catch {
    return uri;
  }
}

/** Convert a module ID to a file:// URI when it represents a filesystem path. */
export function moduleIdToFileUri(moduleId: string): string {
  if (moduleId.startsWith("file:") || moduleId.startsWith("forma:") || moduleId.startsWith(PACKAGE_ID_PREFIX)) {
    return moduleId;
  }
  return pathToFileURL(moduleId).href;
}

/** True when source text contains a top-level file-module directive (`import`, `export`, `export-from`). */
export function hasModuleDirectives(text: string): boolean {
  const { redTree } = parse(text);
  for (const expr of toSExprMany(redTree)) {
    if (expr._tag === "List" && expr.items[0]?._tag === "Sym" && MODULE_DIRECTIVES.has(expr.items[0].name)) {
      return true;
    }
  }
  return false;
}

/** Walk upward from `startDir` looking for `forma.json`. */
export function findFormaProjectRoot(startDir: string, workspaceRoot: string): string | undefined {
  for (let dir = canonicalPath(startDir); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "forma.json"))) return dir;
    if (dirname(dir) === dir) break;
  }
  const canonicalRoot = canonicalPath(workspaceRoot);
  if (existsSync(join(canonicalRoot, "forma.json"))) return canonicalRoot;
  return undefined;
}

/** Compute a lightweight invalidation stamp from `forma.json` and `forma.lock` mtimes/sizes. */
export function projectStamp(root: string): string {
  const parts: string[] = [];
  for (const file of ["forma.json", "forma.lock"]) {
    const full = join(root, file);
    try {
      const st = statSync(full);
      parts.push(`${file}:${st.mtimeMs}:${st.size}`);
    } catch {
      parts.push(`${file}:missing`);
    }
  }
  return parts.join("|");
}

/** Load a Forma project's manifest and verified vendored packages from `root`. */
export function loadProjectContext(root: string): ProjectContext {
  const stamp = projectStamp(root);
  const manifest = readFormaManifest(root);
  const packages = readVendoredPackages(root);
  const preludePath = manifest.prelude ? canonicalPath(resolve(root, manifest.prelude)) : undefined;
  return { root, manifest, packages, stamp, ...(preludePath ? { preludePath } : {}) };
}

/** Resolve and typecheck one file module with open-document overlays. */
export function analyzeModuleDocument(
  entryUri: string,
  entryId: string,
  text: string,
  context: ModuleResolverContext,
): ModuleAnalysis {
  const sources = new Map<string, string>([[entryId, text]]);
  const moduleIdToUri = new Map<string, string>([[entryId, entryUri]]);
  const dependencies = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  const syntax = indexSyntax(identifySyntax(text));

  let project: ProjectContext | undefined;
  if (entryUri.startsWith("file:")) {
    const loaded = context.getProject(entryId);
    if (loaded.error) {
      diagnostics.push(...loaded.error.diagnostics);
    } else {
      project = loaded.project;
    }
  }

  const packages = project?.packages;
  const resolver: ModuleResolver = (specifier, importer) => {
    if (importer.startsWith(PACKAGE_ID_PREFIX)) {
      if (!packages) return undefined;
      const id = relativeModuleId(specifier, importer);
      const name = packageOfModule(id);
      const directory = name === undefined ? undefined : packages.directories.get(name);
      if (name === undefined || directory === undefined) return undefined;
      const filePath = resolve(directory, id.slice(PACKAGE_ID_PREFIX.length + name.length + 1));
      if (filePath !== directory && !filePath.startsWith(directory + sep)) return undefined;
      const canonical = canonicalPath(filePath);
      if (canonical !== directory && !canonical.startsWith(directory + sep)) {
        throw new ModuleError({
          code: "module/package-integrity",
          severity: "error",
          phase: "typecheck",
          message: `${filePath} leaves its package directory.`,
        });
      }
      const uri = context.getOpenUri(canonical) ?? pathToFileURL(canonical).href;
      dependencies.add(id);
      dependencies.add(canonical);
      moduleIdToUri.set(id, uri);
      moduleIdToUri.set(canonical, uri);
      const open = context.getOpenText(canonical);
      if (open !== undefined) {
        sources.set(id, open);
        return { id, source: open };
      }
      try {
        const disk = readFileSync(canonical, "utf8");
        sources.set(id, disk);
        return { id, source: disk };
      } catch (error) {
        if (["ENOENT", "ENOTDIR", "EISDIR"].includes(String((error as NodeJS.ErrnoException).code))) {
          return undefined;
        }
        throw error;
      }
    }

    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
    const baseDir = importer.startsWith("file:") ? dirname(uriToModuleId(importer)) : dirname(importer);
    const id = canonicalPath(resolve(baseDir, specifier));
    const uri = context.getOpenUri(id) ?? pathToFileURL(id).href;
    dependencies.add(id);
    moduleIdToUri.set(id, uri);
    const open = context.getOpenText(id);
    if (open !== undefined) {
      sources.set(id, open);
      return { id, source: open };
    }
    try {
      const disk = readFileSync(id, "utf8");
      sources.set(id, disk);
      return { id, source: disk };
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EISDIR"].includes(String((error as NodeJS.ErrnoException).code))) {
        return undefined;
      }
      throw error;
    }
  };

  const coreOptions: ModuleCoreOptions = {
    ...(packages ? { packages: packages.table } : {}),
    ...(project?.manifest.prelude
      ? {
          projects: [
            {
              id: project.root,
              base: join(project.root, "forma.json"),
              prelude: project.manifest.prelude.startsWith("./")
                ? project.manifest.prelude
                : `./${project.manifest.prelude}`,
            },
          ],
          projectForModule: (id: string) =>
            id === project!.root || id.startsWith(project!.root + sep) ? project!.root : undefined,
        }
      : {}),
  };

  let graph: ModuleGraph | undefined;
  let check: ModuleCheckResult | undefined;
  let symbols: SymbolIndex | undefined;

  if (diagnostics.length === 0) {
    try {
      graph = resolveModuleGraph({ id: entryId, source: text }, resolver, coreOptions);
      for (const mod of graph.modules) {
        sources.set(mod.id, mod.source);
        if (mod.id !== entryId) dependencies.add(mod.id);
        if (!moduleIdToUri.has(mod.id)) {
          moduleIdToUri.set(mod.id, context.getOpenUri(mod.id) ?? moduleIdToFileUri(mod.id));
        }
      }
      check = checkModuleGraph(graph, {
        ...context.inferOptions,
        editor: true,
      });
      for (const d of check.diagnostics) {
        diagnostics.push({
          ...d,
          message: authorNames(d.message),
        });
      }
      symbols = indexSymbols(
        graph.modules.map((mod) => ({ sourceId: mod.id, source: mod.source })),
        {
          moduleSourceIds: graph.modules.map((mod) => mod.id),
          cache: context.symbolCache,
        },
      );
    } catch (error) {
      if (error instanceof ModuleError) {
        for (const d of error.diagnostics) {
          diagnostics.push({ ...d, message: authorNames(d.message) });
        }
      } else {
        diagnostics.push(diagnosticFromUnknown(error, "typecheck", entryId));
      }
    }
  }

  dependencies.delete(entryId);
  return {
    entryId,
    entryUri,
    ...(project ? { projectRoot: project.root } : {}),
    ...(graph ? { graph } : {}),
    ...(check ? { check } : {}),
    diagnostics,
    dependencies: [...dependencies],
    sources,
    moduleIdToUri,
    ...(symbols ? { symbols } : {}),
    syntax,
  };
}

/**
 * Filter/project module-graph diagnostics for `entryId`.
 * Diagnostics inside imported modules are surfaced on the importer's matching
 * `(import ...)` form with `related` pointing to the exact cross-file span.
 */
export function diagnosticsForEntry(analysis: ModuleAnalysis): readonly Diagnostic[] {
  const out: Diagnostic[] = [];
  const text = analysis.sources.get(analysis.entryId) ?? "";
  for (const diagnostic of analysis.diagnostics) {
    const sourceId = diagnostic.span?.sourceId;
    if (!sourceId || sourceId === analysis.entryId) {
      out.push(diagnostic);
      continue;
    }
    const importSpan = findImportSpanForTarget(analysis.entryId, text, sourceId) ?? {
      sourceId: analysis.entryId,
      startOffset: 0,
      endOffset: 0,
    };
    const label = sourceId.startsWith("forma:") || sourceId.startsWith(PACKAGE_ID_PREFIX)
      ? sourceId
      : basename(sourceId);
    out.push({
      ...diagnostic,
      message: `In imported module ${label}: ${diagnostic.message}`,
      span: importSpan,
      related: [
        { span: diagnostic.span!, message: diagnostic.message },
        ...(diagnostic.related ?? []),
      ],
    });
  }
  return out;
}

/** Compute hover markdown and span for a module document. */
export function moduleHover(
  analysis: ModuleAnalysis,
  offset: number,
  definition: SymbolDefinition | undefined,
): Hover | undefined {
  const text = analysis.sources.get(analysis.entryId);
  if (text === undefined) return undefined;
  const entry = analysis.graph?.modules.find((m) => m.id === analysis.entryId);
  const node = analysis.syntax.at(offset);
  const typed = moduleTypeAt(analysis, offset);
  const sections: string[] = [];
  let span: Span | undefined;

  if (node?.kind === "Symbol") {
    const name = text.slice(node.span.start, node.span.end);
    span = { sourceId: analysis.entryId, startOffset: node.span.start, endOffset: node.span.end };
    const exactTyped =
      typed && typed.start === node.span.start && typed.end === node.span.end
        ? typed.type
        : undefined;
    const bindingType = entry ? displayTypeForName(analysis, entry, name) : undefined;
    const type = exactTyped ?? bindingType;
    const form = entry?.compileTime?.forms.get(name)?.descriptor;
    if (form) {
      sections.push(`**form** \`${name}\``);
    } else if (type !== undefined) {
      sections.push(codeBlock(`${name} : ${type}`));
    } else if (typed?.exprTag.startsWith("Mechanics.")) {
      sections.push(codeBlock(typed.type));
    }
    if (definition && !form) {
      const targetUri = analysis.moduleIdToUri.get(definition.sourceId) ?? definition.sourceId;
      const where =
        definition.sourceId === analysis.entryId
          ? ""
          : ` in \`${targetUri.startsWith("file:") ? basename(uriToModuleId(targetUri)) : targetUri}\``;
      sections.push(`*${definition.kind}* defined by \`${definition.form}\`${where}`);
    }
  } else if (typed) {
    span = { sourceId: analysis.entryId, startOffset: typed.start, endOffset: typed.end };
    sections.push(codeBlock(typed.type));
  }
  return span && sections.length > 0 ? { span, markdown: sections.join("\n\n") } : undefined;
}

/** Resolve go-to-definition for a position in a module document. */
export function moduleDefinition(
  analysis: ModuleAnalysis,
  offset: number,
): SymbolDefinition | undefined {
  const text = analysis.sources.get(analysis.entryId);
  if (text === undefined) return undefined;

  // 1. Local definitions take precedence over imports and globals.
  if (analysis.symbols) {
    const local = findReferences(analysis.symbols, { sourceId: analysis.entryId, offset }).definition;
    if (local?.scope === "local") return local;
  }

  const entry = analysis.graph?.modules.find((m) => m.id === analysis.entryId);
  const node = analysis.syntax.at(offset);
  if (!node || !entry || !analysis.graph) return undefined;

  // 2. Clicking on the string specifier in `(import "./foo.lisp" ...)` jumps to that file.
  if (node.kind === "String") {
    const targetId = resolveImportSpecifierAt(analysis, offset);
    if (targetId && analysis.sources.has(targetId)) {
      return {
        key: `${targetId}#module`,
        name: targetId,
        kind: "declaration",
        scope: "global",
        sourceId: targetId,
        nodeId: "module",
        span: { start: 0, end: 0 },
        form: "import",
      };
    }
    return undefined;
  }

  if (node.kind !== "Symbol") return undefined;
  const name = text.slice(node.span.start, node.span.end);

  // 3. Resolve binding identity via the module graph (handles imports, aliases, re-exports, packages, forma:*).
  const target = resolveSymbolTarget(analysis.graph, entry, name, offset);
  if (target) {
    if (analysis.symbols) {
      const found = findDefinitionByIdentity(analysis.symbols, target.moduleId, target.declaration);
      if (found) return found;
    }
    const owner = analysis.graph.modules.find((m) => normalizeModuleId(m.id) === normalizeModuleId(target.moduleId));
    const binding = owner?.bindings.get(target.declaration);
    if (owner && binding) {
      const declSpan = binding.declaration?.span;
      if (declSpan) {
        return {
          key: `${declSpan.sourceId}#decl:${binding.name}`,
          name: binding.name,
          kind: "declaration",
          scope: "global",
          sourceId: declSpan.sourceId,
          nodeId: `decl:${binding.name}`,
          span: { start: declSpan.startOffset, end: declSpan.endOffset },
          form: binding.declaration!.form.declaration,
        };
      }
      const authored = findAuthoredDeclarationSpan(owner.source, binding.name);
      if (authored) {
        return {
          key: `${owner.id}#decl:${binding.name}`,
          name: binding.name,
          kind: "declaration",
          scope: "global",
          sourceId: owner.id,
          nodeId: `decl:${binding.name}`,
          span: authored.span,
          form: authored.form,
        };
      }
    }
  }

  // 4. Fallback to symbol index for anything else in the current module.
  if (analysis.symbols) {
    return findReferences(analysis.symbols, { sourceId: analysis.entryId, offset }).definition;
  }
  return undefined;
}

/** Resolve all references to the symbol at `offset` across `analyses` (open module documents). */
export function moduleReferences(
  analysis: ModuleAnalysis,
  offset: number,
  allAnalyses: readonly ModuleAnalysis[],
  options: { readonly includeDeclaration?: boolean } = {},
): readonly Span[] {
  // Local binding: references stay within the current document.
  if (analysis.symbols) {
    const local = findReferences(analysis.symbols, { sourceId: analysis.entryId, offset });
    if (local.definition?.scope === "local") {
      return [
        ...(options.includeDeclaration ? [local.definition] : []),
        ...local.references,
      ].map((item) => ({
        sourceId: item.sourceId,
        startOffset: item.span.start,
        endOffset: item.span.end,
      }));
    }
  }

  const targetDef = moduleDefinition(analysis, offset);
  if (!targetDef) return [];

  const seen = new Set<string>();
  const spans: Span[] = [];
  const push = (span: Span) => {
    const key = `${span.sourceId}:${span.startOffset}:${span.endOffset}`;
    if (seen.has(key)) return;
    seen.add(key);
    spans.push(span);
  };

  if (options.includeDeclaration) {
    push({
      sourceId: targetDef.sourceId,
      startOffset: targetDef.span.start,
      endOffset: targetDef.span.end,
    });
  }

  const targetModuleId = normalizeModuleId(targetDef.sourceId);
  const targetDecl = targetDef.name;

  // Search every open module analysis (including the current one) for references to (targetModuleId, targetDecl).
  const visitedDocs = new Set<string>();
  for (const candidate of [analysis, ...allAnalyses]) {
    if (visitedDocs.has(candidate.entryId)) continue;
    visitedDocs.add(candidate.entryId);
    const mod = candidate.graph?.modules.find((m) => m.id === candidate.entryId);
    if (!mod || !candidate.graph) continue;
    const text = candidate.sources.get(candidate.entryId);
    if (text === undefined) continue;

    // Collect every local name in `mod` that refers to (targetModuleId, targetDecl).
    const matchingNames = matchingLocalNames(candidate.graph, mod, targetModuleId, targetDecl);
    if (matchingNames.size === 0) continue;

    const syms = candidate.symbols;
    if (syms) {
      for (const ref of syms.references) {
        if (ref.sourceId !== candidate.entryId) continue;
        if (!matchingNames.has(ref.name)) continue;
        // Skip shadowed local references.
        if (ref.definition) {
          const def = syms.definitions.find((d) => d.key === ref.definition);
          if (def && def.scope === "local") continue;
        }
        push({ sourceId: ref.sourceId, startOffset: ref.span.start, endOffset: ref.span.end });
      }
    }
  }

  return spans;
}

/** Completions visible in a module document: locals, own declarations, imports, namespace imports, builtins. */
export function moduleCompletions(analysis: ModuleAnalysis, offset: number): readonly CompletionItem[] {
  const text = analysis.sources.get(analysis.entryId);
  if (text === undefined) return [];
  let start = offset;
  while (start > 0 && !DELIMITER.test(text[start - 1]!)) start--;
  const replace = { start, end: offset };
  const items = new Map<string, CompletionItem>();
  const add = (item: Omit<CompletionItem, "replace">) => {
    if (!items.has(item.label)) items.set(item.label, { ...item, replace });
  };

  // 1. Locals in scope
  if (analysis.symbols) {
    for (const def of analysis.symbols.definitions) {
      if (def.sourceId !== analysis.entryId || def.scope !== "local") continue;
      const scopeNode = def.scopeNodeId ? analysis.syntax.node(def.scopeNodeId) : undefined;
      if (scopeNode && scopeNode.span.start <= offset && offset <= scopeNode.span.end) {
        add({
          label: def.name,
          kind: def.kind === "parameter" ? "parameter" : "variable",
          detail: def.form,
          sortText: `0${def.name}`,
        });
      }
    }
  }

  const entry = analysis.graph?.modules.find((m) => m.id === analysis.entryId);
  if (entry && analysis.graph) {
    // 2. Own top-level declarations
    for (const [name, binding] of entry.bindings) {
      const detail = displayTypeForBinding(analysis, entry, binding);
      add({
        label: name,
        kind: bindingCompletionKind(binding, detail),
        ...(detail ? { detail } : {}),
        sortText: `1${name}`,
      });
    }
    // 3. Direct imports
    for (const [name, binding] of entry.imports) {
      const detail = displayTypeForBinding(analysis, entry, binding);
      const from = formatModuleOrigin(analysis, binding.identity.moduleId);
      add({
        label: name,
        kind: bindingCompletionKind(binding, detail),
        ...(detail ? { detail } : {}),
        documentation: `Imported from \`${from}\``,
        sortText: `2${name}`,
      });
    }
    // 4. Namespace imports (`alias/name`)
    for (const { alias, target } of namespaceImportsOf(analysis.graph, entry)) {
      const from = formatModuleOrigin(analysis, target.id);
      for (const binding of target.interface.exports) {
        const label = `${alias}/${binding.name}`;
        const detail = displayTypeForBinding(analysis, target, binding);
        add({
          label,
          kind: bindingCompletionKind(binding, detail),
          ...(detail ? { detail } : {}),
          documentation: `Imported from \`${from}\``,
          sortText: `2${label}`,
        });
      }
    }
  }

  // 5. Core keywords
  for (const kw of MODULE_KEYWORDS) {
    add({ label: kw, kind: "keyword", detail: "keyword", sortText: `4${kw}` });
  }

  return [...items.values()];
}

// =============================================================================
// Internal helpers
// =============================================================================

function moduleTypeAt(analysis: ModuleAnalysis, offset: number): TypedSpan | undefined {
  const check = analysis.check;
  if (!check) return undefined;
  const spans: TypedSpan[] = [
    ...(check.mechanics?.typedSpans
      .filter((s) => s.span.sourceId === analysis.entryId)
      .map((s) => ({
        start: s.span.startOffset,
        end: s.span.endOffset,
        type: authorNames(s.display),
        exprTag: s.exprTag,
      })) ?? []),
    ...(check.typedSpans.get(analysis.entryId)?.map((s) => ({
      start: s.span.start,
      end: s.span.end,
      type: authorNames(s.typeString),
      exprTag: s.exprTag,
    })) ?? []),
  ];
  let found: TypedSpan | undefined;
  for (const span of spans) {
    if (span.start <= offset && offset < span.end) {
      if (!found || span.end - span.start < found.end - found.start) found = span;
    }
  }
  return found;
}

function displayTypeForName(
  analysis: ModuleAnalysis,
  entry: ResolvedModule,
  name: string,
): string | undefined {
  const binding =
    entry.bindings.get(name) ??
    entry.imports.get(name) ??
    resolveNamespaceBinding(analysis.graph!, entry, name);
  if (binding) return displayTypeForBinding(analysis, entry, binding);
  const builtin = builtinScheme(name);
  return builtin ? showScheme(builtin) : undefined;
}

function displayTypeForBinding(
  analysis: ModuleAnalysis,
  module: ResolvedModule,
  binding: ModuleBinding,
): string | undefined {
  const check = analysis.check;
  if (!check) return undefined;
  const mechanics = check.mechanics?.bindingTypes.get(binding.symbol);
  if (mechanics !== undefined) return authorNames(mechanics);
  const scheme =
    check.environments.get(module.id)?.get(binding.symbol) ??
    check.environments.get(binding.identity.moduleId)?.get(binding.symbol);
  if (scheme) return authorNames(showScheme(scheme));
  return undefined;
}

function bindingCompletionKind(binding: ModuleBinding, detail: string | undefined): CompletionKind {
  switch (binding.kind) {
    case "macro":
      return "macro";
    case "form":
      return "form";
    case "type":
    case "class":
    case "error":
    case "service":
    case "layer":
    case "typeclass":
    case "declaration":
      return "type";
    default:
      return detail?.includes("->") ? "function" : "variable";
  }
}

function formatModuleOrigin(analysis: ModuleAnalysis, moduleId: string): string {
  const uri = analysis.moduleIdToUri.get(moduleId) ?? moduleId;
  if (uri.startsWith("file:")) return basename(uriToModuleId(uri));
  return uri;
}

function resolveNamespaceBinding(
  graph: ModuleGraph,
  entry: ResolvedModule,
  name: string,
): ModuleBinding | undefined {
  const slash = name.indexOf("/");
  if (slash <= 0) return undefined;
  const alias = name.slice(0, slash);
  const member = name.slice(slash + 1);
  for (const ns of namespaceImportsOf(graph, entry)) {
    if (ns.alias !== alias) continue;
    const hit = ns.target.interface.exports.find((b) => b.name === member);
    if (hit) return hit;
  }
  return undefined;
}

function namespaceImportsOf(
  graph: ModuleGraph,
  entry: ResolvedModule,
): readonly { readonly alias: string; readonly target: ResolvedModule }[] {
  const out: { readonly alias: string; readonly target: ResolvedModule }[] = [];
  const parsed = toSExprMany(parse(entry.source).redTree);
  for (const expr of parsed) {
    if (
      expr._tag === "List" &&
      expr.items[0]?._tag === "Sym" &&
      expr.items[0].name === "import" &&
      expr.items[1]?._tag === "Str" &&
      expr.items[2]?._tag === "Sym" &&
      expr.items[2].name === ":as" &&
      expr.items[3]?._tag === "Sym"
    ) {
      const target = findTargetModule(graph, entry.id, expr.items[1].value);
      if (target) out.push({ alias: expr.items[3].name, target });
    }
  }
  return out;
}

function resolveSymbolTarget(
  graph: ModuleGraph,
  entry: ResolvedModule,
  name: string,
  offset: number,
): { readonly moduleId: string; readonly declaration: string } | undefined {
  // Check if cursor is on an imported symbol inside `(import "spec" [a b])`
  const importTarget = resolveImportListSymbolAt(graph, entry, name, offset);
  if (importTarget) return importTarget;

  // Direct import
  const direct = entry.imports.get(name);
  if (direct) return direct.identity;

  // Qualified constructor or service method: `Type.Ctor` or `Service.method`
  const dot = name.indexOf(".");
  if (dot > 0) {
    const prefix = name.slice(0, dot);
    const suffix = name.slice(dot + 1);
    const owner = entry.imports.get(prefix) ?? entry.bindings.get(prefix);
    if (owner) {
      return { moduleId: owner.identity.moduleId, declaration: `${owner.identity.declaration}.${suffix}` };
    }
  }

  // Namespace import: `alias/name` or `alias/Type.Ctor`
  const slash = name.indexOf("/");
  if (slash > 0) {
    const alias = name.slice(0, slash);
    const rest = name.slice(slash + 1);
    const restDot = rest.indexOf(".");
    const baseName = restDot > 0 ? rest.slice(0, restDot) : rest;
    const suffix = restDot > 0 ? rest.slice(restDot + 1) : undefined;
    for (const ns of namespaceImportsOf(graph, entry)) {
      if (ns.alias !== alias) continue;
      const exported = ns.target.interface.exports.find((b) => b.name === baseName);
      if (exported) {
        return suffix
          ? { moduleId: exported.identity.moduleId, declaration: `${exported.identity.declaration}.${suffix}` }
          : exported.identity;
      }
    }
  }

  // Local top-level binding
  const local = entry.bindings.get(name);
  if (local) return local.identity;

  return undefined;
}

function resolveImportListSymbolAt(
  graph: ModuleGraph,
  entry: ResolvedModule,
  name: string,
  offset: number,
): { readonly moduleId: string; readonly declaration: string } | undefined {
  const parsed = toSExprMany(parse(entry.source).redTree);
  for (const expr of parsed) {
    if (
      expr._tag === "List" &&
      expr.items[0]?._tag === "Sym" &&
      (expr.items[0].name === "import" || expr.items[0].name === "export-from") &&
      expr.items[1]?._tag === "Str" &&
      expr.loc.start <= offset &&
      offset <= expr.loc.end
    ) {
      const target = findTargetModule(graph, entry.id, expr.items[1].value);
      if (!target) return undefined;
      const exported = target.interface.exports.find((b) => b.name === name);
      if (exported) return exported.identity;
    }
  }
  return undefined;
}

function resolveImportSpecifierAt(analysis: ModuleAnalysis, offset: number): string | undefined {
  const entry = analysis.graph?.modules.find((m) => m.id === analysis.entryId);
  if (!entry || !analysis.graph) return undefined;
  const parsed = toSExprMany(parse(entry.source).redTree);
  for (const expr of parsed) {
    if (
      expr._tag === "List" &&
      expr.items[0]?._tag === "Sym" &&
      (expr.items[0].name === "import" || expr.items[0].name === "export-from") &&
      expr.items[1]?._tag === "Str" &&
      expr.items[1].loc.start <= offset &&
      offset <= expr.items[1].loc.end
    ) {
      return findTargetModule(analysis.graph, entry.id, expr.items[1].value)?.id;
    }
  }
  return undefined;
}

function findTargetModule(
  graph: ModuleGraph,
  importerId: string,
  specifier: string,
): ResolvedModule | undefined {
  if (specifier.startsWith("forma:")) {
    return graph.modules.find((m) => m.id === specifier);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const resolved = importerId.startsWith(PACKAGE_ID_PREFIX)
      ? relativeModuleId(specifier, importerId)
      : canonicalPath(resolve(dirname(importerId), specifier));
    return graph.modules.find((m) => normalizeModuleId(m.id) === normalizeModuleId(resolved));
  }
  // Package specifier: match against pkg:<specifier>/... among entry's dependencies
  const importer = graph.modules.find((m) => m.id === importerId);
  if (!importer) return undefined;
  const pkgPrefix = `${PACKAGE_ID_PREFIX}${specifier}/`;
  for (const depId of importer.dependencies) {
    if (depId.startsWith(pkgPrefix) || depId === `${PACKAGE_ID_PREFIX}${specifier}`) {
      return graph.modules.find((m) => m.id === depId);
    }
  }
  return undefined;
}

function findDefinitionByIdentity(
  symbols: SymbolIndex,
  moduleId: string,
  declaration: string,
): SymbolDefinition | undefined {
  const normalizedTarget = normalizeModuleId(moduleId);
  const direct = symbols.definitions.find(
    (def) =>
      def.scope === "global" &&
      normalizeModuleId(def.sourceId) === normalizedTarget &&
      def.name === declaration,
  );
  if (direct) return direct;
  const dot = declaration.indexOf(".");
  if (dot > 0) {
    const ctor = declaration.slice(dot + 1);
    return symbols.definitions.find(
      (def) =>
        def.scope === "global" &&
        normalizeModuleId(def.sourceId) === normalizedTarget &&
        def.name === ctor &&
        (def.kind === "constructor" || def.kind === "method"),
    );
  }
  return undefined;
}

function matchingLocalNames(
  graph: ModuleGraph,
  mod: ResolvedModule,
  targetModuleId: string,
  targetDecl: string,
): Set<string> {
  const names = new Set<string>();
  const matches = (binding: ModuleBinding) =>
    normalizeModuleId(binding.identity.moduleId) === targetModuleId &&
    binding.identity.declaration === targetDecl;
  for (const [localName, binding] of mod.bindings) {
    if (matches(binding)) names.add(localName);
  }
  for (const [localName, binding] of mod.imports) {
    if (matches(binding)) names.add(localName);
  }
  for (const { alias, target } of namespaceImportsOf(graph, mod)) {
    for (const binding of target.interface.exports) {
      if (matches(binding)) names.add(`${alias}/${binding.name}`);
    }
  }
  return names;
}

function findImportSpanForTarget(
  entryId: string,
  text: string,
  targetId: string,
): Span | undefined {
  const parsed = toSExprMany(parse(text).redTree);
  const normalizedTarget = normalizeModuleId(targetId);
  let firstImport: SExpr | undefined;
  for (const expr of parsed) {
    if (
      expr._tag === "List" &&
      expr.items[0]?._tag === "Sym" &&
      (expr.items[0].name === "import" || expr.items[0].name === "export-from") &&
      expr.items[1]?._tag === "Str"
    ) {
      firstImport ??= expr;
      const spec = expr.items[1].value;
      const resolved =
        spec.startsWith("forma:")
          ? spec
          : spec.startsWith("./") || spec.startsWith("../")
            ? canonicalPath(resolve(dirname(entryId), spec))
            : undefined;
      if (resolved && normalizeModuleId(resolved) === normalizedTarget) {
        return { sourceId: entryId, startOffset: expr.loc.start, endOffset: expr.loc.end };
      }
      if (targetId.startsWith(`${PACKAGE_ID_PREFIX}${spec}/`)) {
        return { sourceId: entryId, startOffset: expr.loc.start, endOffset: expr.loc.end };
      }
    }
  }
  if (firstImport) {
    return { sourceId: entryId, startOffset: firstImport.loc.start, endOffset: firstImport.loc.end };
  }
  return undefined;
}

function findAuthoredDeclarationSpan(
  source: string,
  name: string,
): { readonly span: { readonly start: number; readonly end: number }; readonly form: string } | undefined {
  for (const expr of toSExprMany(parse(source).redTree)) {
    if (expr._tag !== "List" || expr.items[0]?._tag !== "Sym") continue;
    const form = expr.items[0].name;
    if (MODULE_DIRECTIVES.has(form) || form === ":") continue;
    const target = expr.items[1];
    if (target?._tag === "Sym" && target.name === name) {
      return { span: { start: target.loc.start, end: target.loc.end }, form };
    }
    if (target?._tag === "List" && target.items[0]?._tag === "Sym" && target.items[0].name === name) {
      return { span: { start: target.items[0].loc.start, end: target.items[0].loc.end }, form };
    }
  }
  return undefined;
}

function codeBlock(text: string): string {
  return `\`\`\`lisp\n${text}\n\`\`\``;
}
