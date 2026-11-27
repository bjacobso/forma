/**
 * Read-only in-memory `DefinitionIndex` builder (RFC 0029 Stage 0).
 *
 * Builds a content-addressed `DefinitionIndex` over:
 * - Raw `.lisp` source lists (`buildDefinitionIndexFromSources`)
 * - Resolved/checked `ModuleGraph`s (`buildDefinitionIndexFromModuleGraph`)
 * - `AnalysisWorkspace` instances (`buildDefinitionIndexFromWorkspace`)
 *
 * Browser-safe: contains no Node-only imports.
 */

import { Effect, Layer } from "effect";
import type { AnalysisWorkspace } from "../analysis/workspace.js";
import type { ModuleCheckOptions, ModuleCheckResult } from "../modules/check.js";
import { checkModuleGraph } from "../modules/check.js";
import { moduleFormProvider } from "../modules/compile-time.js";
import type { ModuleGraph, ResolvedModule } from "../modules/graph.js";
import { parse, toSExprMany, type SExpr } from "../reader/index.js";
import { headSym } from "../reader/types.js";
import { makeOwnedInferContext, InferContext, type MakeInferContextOptions } from "../type/context.js";
import type { CoreExpr } from "../type/core-expr.js";
import { resetNodeIds } from "../type/core-expr.js";
import { inferProgram } from "../type/infer-program.js";
import { lowerProgram } from "../type/lower.js";
import type { TypeEnv } from "../type/substitution.js";
import type { Scheme } from "../type/types.js";
import { unifiedFormProvider } from "../type/unified-form-provider.js";
import {
  hashDefinitionGroup,
  type DefinitionHashInput,
} from "./def-hash.js";
import {
  DEFAULT_LANGUAGE_PROFILE,
  type DefHash,
  type DefinitionIndex,
  type DefinitionRecord,
  type OpaqueBoundaryRef,
  type PresentationMeta,
  type StoreDefinitionKind,
} from "./types.js";

export interface DefinitionIndexSource {
  readonly id: string;
  readonly source: string;
}

export interface BuildDefinitionIndexOptions {
  readonly languageProfile?: string | undefined;
  /** Run Hindley-Milner + Effect typechecking to attach resolved signatures, requirements, and errors. Defaults to `true`. */
  readonly typecheck?: boolean | undefined;
  /** Pinned opaque boundaries (`symbolName` -> `OpaqueBoundaryRef`). */
  readonly opaqueBoundaries?: ReadonlyMap<string, OpaqueBoundaryRef> | undefined;
  /** Already-hashed external definitions (`qualifiedName` -> `DefHash`). */
  readonly externalHashes?: ReadonlyMap<string, DefHash> | undefined;
  /** Options forwarded to `makeOwnedInferContext` when typechecking raw sources. */
  readonly inferOptions?: MakeInferContextOptions | undefined;
  /** Options forwarded to `checkModuleGraph` when checking a `ModuleGraph`. */
  readonly checkOptions?: ModuleCheckOptions | undefined;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function qualifiedNameOf(moduleId: string, name: string): string {
  return `${moduleId}::${name}`;
}

/** Extract a docstring from a raw defining `SExpr`, if present. */
function extractDocstring(expr: SExpr | undefined): string | undefined {
  if (!expr || expr._tag !== "List" || expr.items.length < 3) return undefined;
  const h = headSym(expr);

  // (define (f x) "docstring" body...)
  if (h === "define" && expr.items[1]?._tag === "List" && expr.items.length >= 4 && expr.items[2]?._tag === "Str") {
    return expr.items[2].value;
  }

  // Keyword option `:doc "..."` in top-level list
  for (let i = 1; i < expr.items.length - 1; i++) {
    const item = expr.items[i]!;
    const next = expr.items[i + 1]!;
    if (item._tag === "Sym" && item.name === ":doc" && next._tag === "Str") {
      return next.value;
    }
  }

  // Map literal containing `:doc "..."`
  for (const item of expr.items) {
    if (item._tag === "Map") {
      for (const [k, v] of item.pairs) {
        if (k._tag === "Sym" && k.name === ":doc" && v._tag === "Str") {
          return v.value;
        }
      }
    }
  }

  return undefined;
}

/** Extract the declared symbol name of a top-level raw `SExpr`, if any. */
function rawDeclarationInfo(
  expr: SExpr,
  fallbackIndex: number,
): { readonly name: string; readonly kind: StoreDefinitionKind; readonly formHead?: string | undefined } | undefined {
  if (expr._tag !== "List" || expr.items.length < 2) return undefined;
  const h = headSym(expr);
  if (!h) return undefined;

  if (h === "define" || h === "__operation") {
    const second = expr.items[1]!;
    if (second._tag === "Sym") return { name: second.name, kind: "define" };
    if (second._tag === "List" && second.items[0]?._tag === "Sym") {
      return { name: second.items[0].name, kind: "define" };
    }
    return undefined;
  }
  if (h === "type" || h === "__sum-type") {
    const second = expr.items[1]!;
    if (second._tag === "Sym") return { name: second.name, kind: "type" };
    if (second._tag === "List" && second.items[0]?._tag === "Sym") {
      return { name: second.items[0].name, kind: "type" };
    }
    return undefined;
  }
  if (h === "error") {
    const second = expr.items[1]!;
    if (second._tag === "Sym") return { name: second.name, kind: "error" };
    if (second._tag === "List" && second.items[0]?._tag === "Sym") {
      return { name: second.items[0].name, kind: "error" };
    }
    return undefined;
  }
  if (h === "service" || h === "__service") {
    const second = expr.items[1]!;
    if (second._tag === "Sym") return { name: second.name, kind: "service" };
    return undefined;
  }
  if (h === "layer" || h === "__layer") {
    const second = expr.items[1]!;
    if (second._tag === "Sym") return { name: second.name, kind: "layer" };
    return undefined;
  }
  if (h === "class" || h === "typeclass" || h === "__typeclass") {
    const second = expr.items[1]!;
    if (second._tag === "Sym") return { name: second.name, kind: "class" };
    if (second._tag === "List" && second.items[0]?._tag === "Sym") {
      return { name: second.items[0].name, kind: "class" };
    }
    return undefined;
  }
  if (h === "instance") {
    const second = expr.items[1]!;
    if (second._tag === "List" && second.items[0]?._tag === "Sym") {
      return { name: `instance:${second.items[0].name}#${fallbackIndex}`, kind: "instance" };
    }
    return { name: `instance#${fallbackIndex}`, kind: "instance" };
  }
  if (h === "form") {
    const second = expr.items[1]!;
    if (second._tag === "Sym") return { name: second.name, kind: "form" };
    if (second._tag === "List" && second.items[0]?._tag === "Sym") {
      return { name: second.items[0].name, kind: "form" };
    }
    return undefined;
  }
  if (h === "macro" || h === "__macro") {
    const second = expr.items[1]!;
    if (second._tag === "Sym") return { name: second.name, kind: "macro" };
    if (second._tag === "List" && second.items[0]?._tag === "Sym") {
      return { name: second.items[0].name, kind: "macro" };
    }
    return undefined;
  }
  if (h === "test") {
    const second = expr.items[1]!;
    if (second._tag === "Str") return { name: second.value, kind: "test" };
    if (second._tag === "Sym") return { name: second.name, kind: "test" };
    return { name: `test#${fallbackIndex}`, kind: "test" };
  }
  return undefined;
}

function collectMacroOriginsFromCore(expr: CoreExpr, out: Set<string>): void {
  const visitSpan = (span: { readonly macroOrigins?: readonly { readonly macroName: string }[] } | undefined): void => {
    if (!span?.macroOrigins) return;
    for (const origin of span.macroOrigins) {
      out.add(origin.macroName);
    }
  };
  visitSpan(expr.span);
  switch (expr._tag) {
    case "Lit":
    case "Var":
    case "TypeDef":
    case "DefClass":
    case "DefService":
      return;
    case "Lam":
      collectMacroOriginsFromCore(expr.body, out);
      return;
    case "App":
      collectMacroOriginsFromCore(expr.fn, out);
      for (const a of expr.args) collectMacroOriginsFromCore(a, out);
      return;
    case "Let":
    case "EffectDo":
      for (const b of expr.bindings) {
        visitSpan(b.span);
        collectMacroOriginsFromCore(b.expr, out);
      }
      collectMacroOriginsFromCore(expr.body, out);
      return;
    case "EffectFail":
      collectMacroOriginsFromCore(expr.payload, out);
      return;
    case "EffectCatch":
      collectMacroOriginsFromCore(expr.body, out);
      for (const arm of expr.arms) collectMacroOriginsFromCore(arm.handler, out);
      return;
    case "If":
      collectMacroOriginsFromCore(expr.cond, out);
      collectMacroOriginsFromCore(expr.then, out);
      collectMacroOriginsFromCore(expr.else_, out);
      return;
    case "Record":
      for (const f of expr.fields) collectMacroOriginsFromCore(f.value, out);
      return;
    case "Get":
      collectMacroOriginsFromCore(expr.record, out);
      if (expr.key) collectMacroOriginsFromCore(expr.key, out);
      return;
    case "Def":
      collectMacroOriginsFromCore(expr.expr, out);
      return;
    case "Ascribe":
      collectMacroOriginsFromCore(expr.expr, out);
      return;
    case "DSLForm":
      out.add(expr.name);
      for (const c of expr.children) collectMacroOriginsFromCore(c.expr, out);
      return;
    case "Match":
      collectMacroOriginsFromCore(expr.scrutinee, out);
      for (const arm of expr.arms) collectMacroOriginsFromCore(arm.body, out);
      return;
    case "Instance":
      for (const m of expr.methods) collectMacroOriginsFromCore(m.expr, out);
      return;
    case "DefLayer":
      if (expr.body.kind === "compose") {
        collectMacroOriginsFromCore(expr.body.expr, out);
      } else {
        for (const step of expr.body.setup) collectMacroOriginsFromCore(step.binding.expr, out);
        for (const m of expr.body.methods) collectMacroOriginsFromCore(m.body, out);
      }
      return;
  }
}

function coreKindAndName(
  expr: CoreExpr,
  fallbackIndex: number,
): { readonly kind: StoreDefinitionKind; readonly name: string } | undefined {
  switch (expr._tag) {
    case "Def":
      return { kind: "define", name: expr.name };
    case "TypeDef":
      return {
        kind: expr.source === "error" ? "error" : expr.source === "form" ? "form" : "type",
        name: expr.name,
      };
    case "DefService":
      return { kind: "service", name: expr.name };
    case "DefLayer":
      return { kind: "layer", name: expr.name };
    case "DefClass":
      return { kind: "class", name: expr.name };
    case "Instance":
      return { kind: "instance", name: `instance:${expr.className}#${fallbackIndex}` };
    case "DSLForm": {
      const second = expr.rawExpr?._tag === "List" ? expr.rawExpr.items[1] : undefined;
      const declName =
        second?._tag === "Sym"
          ? second.name
          : second?._tag === "Str"
            ? second.value
            : `${expr.name}#${fallbackIndex}`;
      return { kind: "declaration", name: declName };
    }
    default:
      return undefined;
  }
}

/** Assemble the read-only `DefinitionIndex` from hashed `DefinitionRecord`s. */
export function createDefinitionIndex(
  records: readonly DefinitionRecord[],
  languageProfile: string = DEFAULT_LANGUAGE_PROFILE,
): DefinitionIndex {
  const definitions = new Map<DefHash, DefinitionRecord>();
  const bindings = new Map<string, DefHash>();
  const byNameSets = new Map<string, Set<DefHash>>();
  const dependentsSets = new Map<DefHash, Set<DefHash>>();
  const metadata = new Map<DefHash, PresentationMeta>();

  for (const record of records) {
    definitions.set(record.hash, record);
    bindings.set(record.qualifiedName, record.hash);
    metadata.set(record.hash, record.meta);

    let nameSet = byNameSets.get(record.name);
    if (!nameSet) {
      nameSet = new Set<DefHash>();
      byNameSets.set(record.name, nameSet);
    }
    nameSet.add(record.hash);

    if (!dependentsSets.has(record.hash)) {
      dependentsSets.set(record.hash, new Set<DefHash>());
    }
  }

  // Populate reverse dependency edges
  for (const record of records) {
    for (const depHash of record.dependencies) {
      let depSet = dependentsSets.get(depHash);
      if (!depSet) {
        depSet = new Set<DefHash>();
        dependentsSets.set(depHash, depSet);
      }
      depSet.add(record.hash);
    }
  }

  // Add unambiguous unqualified name aliases to `bindings`
  const byName = new Map<string, readonly DefHash[]>();
  for (const [name, hashes] of byNameSets) {
    const sorted = [...hashes].sort(compareStrings);
    byName.set(name, sorted);
    if (sorted.length === 1 && !bindings.has(name)) {
      bindings.set(name, sorted[0]!);
    }
  }

  const dependents = new Map<DefHash, readonly DefHash[]>();
  for (const [hash, depSet] of dependentsSets) {
    dependents.set(hash, [...depSet].sort(compareStrings));
  }

  return {
    definitions,
    bindings,
    byName,
    dependents,
    metadata,
    languageProfile,
  };
}

// ---------------------------------------------------------------------------
// Entry Point 1: Build from raw sources
// ---------------------------------------------------------------------------

interface ParsedSourceInfo {
  readonly id: string;
  readonly source: string;
  readonly rawExprs: readonly SExpr[];
  readonly coreExprs: readonly CoreExpr[];
  readonly env: ReadonlyMap<string, Scheme>;
}

function desugarDefineFunctionHeads(exprs: readonly SExpr[]): SExpr[] {
  return exprs.map((expr) => {
    if (
      expr._tag === "List" &&
      expr.items.length >= 3 &&
      expr.items[0]?._tag === "Sym" &&
      expr.items[0].name === "define" &&
      expr.items[1]?._tag === "List" &&
      expr.items[1].items[0]?._tag === "Sym"
    ) {
      const fnHead = expr.items[1];
      const fnName = fnHead.items[0]!;
      const paramsVec: SExpr = {
        _tag: "Vector",
        items: fnHead.items.slice(1),
        loc: fnHead.loc,
      };
      const fnExpr: SExpr = {
        _tag: "List",
        items: [{ _tag: "Sym", name: "fn", loc: fnHead.loc }, paramsVec, ...expr.items.slice(2)],
        loc: fnHead.loc,
      };
      return {
        _tag: "List",
        items: [expr.items[0], fnName, fnExpr],
        loc: expr.loc,
      };
    }
    return expr;
  });
}

/**
 * Build a read-only `DefinitionIndex` from an ordered list of Forma source strings.
 * Earlier sources (such as preludes) are visible to later sources during name
 * resolution and type inference.
 */
export function buildDefinitionIndexFromSources(
  sources: readonly DefinitionIndexSource[],
  options: BuildDefinitionIndexOptions = {},
): DefinitionIndex {
  const languageProfile = options.languageProfile ?? DEFAULT_LANGUAGE_PROFILE;
  const shouldTypecheck = options.typecheck !== false;

  const parsedSources: ParsedSourceInfo[] = [];
  let cumulativeEnv: TypeEnv = new Map();
  const cumulativeRawExprs: SExpr[] = [];

  if (shouldTypecheck) {
    resetNodeIds();
  }

  for (const src of sources) {
    const parsed = parse(src.source);
    const rawExprs = toSExprMany(parsed.redTree, src.id);
    const allRawForProvider = [...cumulativeRawExprs, ...rawExprs];
    let provider: ReturnType<typeof unifiedFormProvider> | undefined;
    try {
      provider = unifiedFormProvider(src.source, allRawForProvider);
    } catch {
      provider = undefined;
    }

    let coreExprs: CoreExpr[] = [];
    try {
      coreExprs = lowerProgram(desugarDefineFunctionHeads(rawExprs), provider);
    } catch {
      // Fallback: keep empty coreExprs and hash from rawExprs
      coreExprs = [];
    }

    let sourceEnv: ReadonlyMap<string, Scheme> = new Map();
    if (shouldTypecheck && coreExprs.length > 0) {
      try {
        const nextEnv = Effect.runSync(
          Effect.gen(function* () {
            const ctx = yield* makeOwnedInferContext(options.inferOptions);
            let captured: TypeEnv = new Map(cumulativeEnv);
            yield* Effect.provide(
              inferProgram(coreExprs, cumulativeEnv, provider, rawExprs, (env) => {
                captured = env;
              }),
              Layer.succeed(InferContext, ctx),
            );
            return captured;
          }),
        );
        sourceEnv = nextEnv;
        cumulativeEnv = nextEnv;
      } catch {
        // Best-effort typechecking: still index definitions even if a form has type errors
        sourceEnv = cumulativeEnv;
      }
    }

    cumulativeRawExprs.push(...rawExprs);
    parsedSources.push({
      id: src.id,
      source: src.source,
      rawExprs,
      coreExprs,
      env: sourceEnv,
    });
  }

  // First pass: collect all declared names per source so cross-source references resolve cleanly
  const sourceLocalNames = new Map<string, Map<string, string>>();
  const globalOrderNames = new Map<string, string>(); // unqualified name -> qualifiedName (later overrides or earlier prelude)
  const knownFormAndMacroNames = new Map<string, string>(); // name -> qualifiedName

  const inputs: DefinitionHashInput[] = [];

  for (const ps of parsedSources) {
    const localMap = new Map<string, string>();
    sourceLocalNames.set(ps.id, localMap);

    // Map raw expressions by declaration name for metadata & fallback
    const rawByName = new Map<string, SExpr>();
    const rawDecls: Array<{ expr: SExpr; name: string; kind: StoreDefinitionKind }> = [];

    ps.rawExprs.forEach((raw, idx) => {
      const info = rawDeclarationInfo(raw, idx);
      if (info) {
        rawByName.set(info.name, raw);
        rawDecls.push({ expr: raw, name: info.name, kind: info.kind });
        const qName = qualifiedNameOf(ps.id, info.name);
        localMap.set(info.name, qName);
        if (info.kind === "form" || info.kind === "macro") {
          knownFormAndMacroNames.set(info.name, qName);
        }
      }
    });

    ps.coreExprs.forEach((core, idx) => {
      const info = coreKindAndName(core, idx);
      if (info) {
        const qName = qualifiedNameOf(ps.id, info.name);
        localMap.set(info.name, qName);
        if (info.kind === "form") {
          knownFormAndMacroNames.set(info.name, qName);
        }
      }
    });

    for (const [name, qName] of localMap) {
      globalOrderNames.set(name, qName);
    }

    const resolveReference = (sym: string): string | undefined => {
      return localMap.get(sym) ?? globalOrderNames.get(sym);
    };

    const emittedNames = new Set<string>();

    // Emit from lowered CoreExprs first (authoritative alpha-equivalent AST)
    ps.coreExprs.forEach((core, idx) => {
      const info = coreKindAndName(core, idx);
      if (!info) return;
      emittedNames.add(info.name);

      const qName = qualifiedNameOf(ps.id, info.name);
      const raw = rawByName.get(info.name);
      const span = raw
        ? { start: raw.loc.start, end: raw.loc.end, sourceId: ps.id }
        : { start: core.span.start, end: core.span.end, sourceId: ps.id };
      const authoredSource =
        span.end > span.start && span.end <= ps.source.length
          ? ps.source.slice(span.start, span.end)
          : undefined;

      const macroOrigins = new Set<string>();
      collectMacroOriginsFromCore(core, macroOrigins);
      const formDeps: string[] = [];
      for (const mName of macroOrigins) {
        const target = knownFormAndMacroNames.get(mName);
        if (target && target !== qName) formDeps.push(target);
      }

      // If this is a `form` declaration, hash its raw SExpr too so descriptor edits change DefHash
      const isFormOrMacro = info.kind === "form" || info.kind === "macro";

      inputs.push({
        qualifiedName: qName,
        name: info.name,
        moduleId: ps.id,
        kind: info.kind,
        coreExpr: isFormOrMacro && raw ? undefined : core,
        rawExpr: isFormOrMacro ? raw : undefined,
        scheme: ps.env.get(info.name),
        formDependencyNames: formDeps,
        resolveReference,
        meta: {
          displayName: info.name,
          qualifiedName: qName,
          moduleId: ps.id,
          authoredSource,
          docstring: extractDocstring(raw),
          span,
        },
      });
    });

    // Emit any raw declarations not covered by CoreExpr (e.g. `macro`, `test`, or unlowered `form`)
    for (const decl of rawDecls) {
      if (emittedNames.has(decl.name)) continue;
      emittedNames.add(decl.name);

      const qName = qualifiedNameOf(ps.id, decl.name);
      const span = { start: decl.expr.loc.start, end: decl.expr.loc.end, sourceId: ps.id };
      const authoredSource =
        span.end > span.start && span.end <= ps.source.length
          ? ps.source.slice(span.start, span.end)
          : undefined;

      const head = headSym(decl.expr);
      const formDeps: string[] = [];
      if (head) {
        const target = knownFormAndMacroNames.get(head);
        if (target && target !== qName) formDeps.push(target);
      }

      inputs.push({
        qualifiedName: qName,
        name: decl.name,
        moduleId: ps.id,
        kind: decl.kind,
        rawExpr: decl.expr,
        scheme: ps.env.get(decl.name),
        formDependencyNames: formDeps,
        resolveReference,
        meta: {
          displayName: decl.name,
          qualifiedName: qName,
          moduleId: ps.id,
          authoredSource,
          docstring: extractDocstring(decl.expr),
          span,
        },
      });
    }
  }

  const records = hashDefinitionGroup(inputs, {
    languageProfile,
    externalHashes: options.externalHashes,
    opaqueBoundaries: options.opaqueBoundaries,
  });

  return createDefinitionIndex(records, languageProfile);
}

// ---------------------------------------------------------------------------
// Entry Point 2: Build from a resolved ModuleGraph
// ---------------------------------------------------------------------------

/**
 * Build a read-only `DefinitionIndex` from a resolved `ModuleGraph` and
 * optional `ModuleCheckResult`. Cross-module bindings and imports resolve
 * directly to their owning module's definition `DefHash`.
 */
export function buildDefinitionIndexFromModuleGraph(
  graph: ModuleGraph,
  checkResult?: ModuleCheckResult,
  options: BuildDefinitionIndexOptions = {},
): DefinitionIndex {
  const languageProfile = options.languageProfile ?? DEFAULT_LANGUAGE_PROFILE;
  const shouldTypecheck = options.typecheck !== false;

  const checked =
    checkResult ??
    (shouldTypecheck ? checkModuleGraph(graph, options.checkOptions) : undefined);

  // Global symbol map: mangled `binding.symbol` -> `moduleId::declaration`
  const mangledToQualified = new Map<string, string>();
  const formAndMacroBySymbol = new Map<string, string>();

  for (const mod of graph.modules) {
    for (const binding of mod.bindings.values()) {
      const qName = qualifiedNameOf(binding.identity.moduleId, binding.identity.declaration);
      mangledToQualified.set(binding.symbol, qName);
      if (binding.kind === "form" || binding.kind === "macro") {
        formAndMacroBySymbol.set(binding.symbol, qName);
        formAndMacroBySymbol.set(binding.name, qName);
      }
    }
  }

  const inputs: DefinitionHashInput[] = [];

  for (const mod of graph.modules) {
    const modInputs = extractModuleHashInputs(
      mod,
      checked?.environments.get(mod.id),
      mangledToQualified,
      formAndMacroBySymbol,
    );
    inputs.push(...modInputs);
  }

  const records = hashDefinitionGroup(inputs, {
    languageProfile,
    externalHashes: options.externalHashes,
    opaqueBoundaries: options.opaqueBoundaries,
  });

  return createDefinitionIndex(records, languageProfile);
}

function extractModuleHashInputs(
  mod: ResolvedModule,
  env: ReadonlyMap<string, Scheme> | undefined,
  mangledToQualified: ReadonlyMap<string, string>,
  formAndMacroBySymbol: ReadonlyMap<string, string>,
): DefinitionHashInput[] {
  const localSymbolToQualified = new Map<string, string>();
  const mangledToAuthorName = new Map<string, string>();

  for (const binding of mod.bindings.values()) {
    const qName = qualifiedNameOf(binding.identity.moduleId, binding.identity.declaration);
    localSymbolToQualified.set(binding.symbol, qName);
    localSymbolToQualified.set(binding.name, qName);
    mangledToAuthorName.set(binding.symbol, binding.identity.declaration);
  }
  for (const [alias, binding] of mod.imports) {
    const qName = qualifiedNameOf(binding.identity.moduleId, binding.identity.declaration);
    localSymbolToQualified.set(binding.symbol, qName);
    localSymbolToQualified.set(alias, qName);
  }
  for (const binding of mod.namespaceImports) {
    const qName = qualifiedNameOf(binding.identity.moduleId, binding.identity.declaration);
    localSymbolToQualified.set(binding.symbol, qName);
  }

  const resolveReference = (sym: string): string | undefined => {
    return localSymbolToQualified.get(sym) ?? mangledToQualified.get(sym);
  };

  const expanded = mod.compileTime?.expand(mod.expressions) ?? mod.expressions;
  const provider = mod.compileTime
    ? moduleFormProvider(mod.compileTime)
    : unifiedFormProvider(mod.source, expanded);

  let coreExprs: CoreExpr[] = [];
  try {
    coreExprs = lowerProgram(expanded, provider, {
      includePrelude: false,
      ...(mod.compileTime ? { types: mod.compileTime.types } : {}),
    });
  } catch {
    coreExprs = [];
  }

  const rawByAuthorName = new Map<string, SExpr>();
  const rawDecls: Array<{ expr: SExpr; authorName: string; symbolName: string; kind: StoreDefinitionKind }> = [];

  mod.expressions.forEach((raw, idx) => {
    const info = rawDeclarationInfo(raw, idx);
    if (!info) return;
    const authorName = mangledToAuthorName.get(info.name) ?? info.name;
    rawByAuthorName.set(authorName, raw);
    rawDecls.push({ expr: raw, authorName, symbolName: info.name, kind: info.kind });
  });

  const out: DefinitionHashInput[] = [];
  const emitted = new Set<string>();

  coreExprs.forEach((core, idx) => {
    const info = coreKindAndName(core, idx);
    if (!info) return;
    const authorName = mangledToAuthorName.get(info.name) ?? info.name;
    emitted.add(authorName);

    const qName = qualifiedNameOf(mod.id, authorName);
    const raw = rawByAuthorName.get(authorName);
    const span = raw
      ? { start: raw.loc.start, end: raw.loc.end, sourceId: mod.id }
      : { start: core.span.start, end: core.span.end, sourceId: mod.id };
    const authoredSource =
      span.end > span.start && span.end <= mod.source.length
        ? mod.source.slice(span.start, span.end)
        : undefined;

    const macroOrigins = new Set<string>();
    collectMacroOriginsFromCore(core, macroOrigins);
    const formDeps: string[] = [];
    for (const mName of macroOrigins) {
      const target = formAndMacroBySymbol.get(mName);
      if (target && target !== qName) formDeps.push(target);
    }

    const isFormOrMacro = info.kind === "form" || info.kind === "macro";

    out.push({
      qualifiedName: qName,
      name: authorName,
      moduleId: mod.id,
      kind: info.kind,
      coreExpr: isFormOrMacro && raw ? undefined : core,
      rawExpr: isFormOrMacro ? raw : undefined,
      scheme: env?.get(info.name) ?? env?.get(authorName),
      formDependencyNames: formDeps,
      resolveReference,
      meta: {
        displayName: authorName,
        qualifiedName: qName,
        moduleId: mod.id,
        authoredSource,
        docstring: extractDocstring(raw),
        span,
      },
    });
  });

  for (const decl of rawDecls) {
    if (emitted.has(decl.authorName)) continue;
    emitted.add(decl.authorName);

    const qName = qualifiedNameOf(mod.id, decl.authorName);
    const span = { start: decl.expr.loc.start, end: decl.expr.loc.end, sourceId: mod.id };
    const authoredSource =
      span.end > span.start && span.end <= mod.source.length
        ? mod.source.slice(span.start, span.end)
        : undefined;

    out.push({
      qualifiedName: qName,
      name: decl.authorName,
      moduleId: mod.id,
      kind: decl.kind,
      rawExpr: decl.expr,
      scheme: env?.get(decl.symbolName) ?? env?.get(decl.authorName),
      resolveReference,
      meta: {
        displayName: decl.authorName,
        qualifiedName: qName,
        moduleId: mod.id,
        authoredSource,
        docstring: extractDocstring(decl.expr),
        span,
      },
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Entry Point 3: Build from an AnalysisWorkspace
// ---------------------------------------------------------------------------

/**
 * Build a read-only `DefinitionIndex` over all preludes and documents currently
 * registered in an `AnalysisWorkspace`.
 */
export function buildDefinitionIndexFromWorkspace(
  workspace: AnalysisWorkspace,
  options: BuildDefinitionIndexOptions = {},
): DefinitionIndex {
  const sources: DefinitionIndexSource[] = [];
  for (const id of workspace.preludeIds) {
    const text = workspace.text(id);
    if (text !== undefined) sources.push({ id, source: text });
  }
  for (const id of workspace.documentIds) {
    const text = workspace.text(id);
    if (text !== undefined) sources.push({ id, source: text });
  }
  return buildDefinitionIndexFromSources(sources, options);
}
